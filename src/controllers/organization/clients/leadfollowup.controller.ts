import { Request, Response } from "express";
import { database, connection } from "../../../configs/connection.config";
import { clients, notifications } from "../../../schema/schema";
import { eq, and } from "drizzle-orm";
import { logger } from "@/utils/logger.util";
import status from "http-status";
import { requireOrganizationId } from "@/utils/organization.util";
import crypto from "crypto";

const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0);
const endOfDay   = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999);

// PATCH /leads/:clientId/followup
export const updateLeadFollowUp = async (req: Request, res: Response): Promise<void> => {
  try {
    const organizationId = requireOrganizationId(req as any, res);
    if (!organizationId) return;

    const { clientId } = req.params;
    const { followUpAt } = req.body;

    if (!clientId) {
      res.status(status.BAD_REQUEST).json({ success: false, message: "Client ID is required" });
      return;
    }

    const followUpDate = followUpAt ? new Date(followUpAt) : null;

    if (followUpAt && isNaN(followUpDate!.getTime())) {
      res.status(status.BAD_REQUEST).json({ success: false, message: "followUpAt must be a valid ISO date string or null" });
      return;
    }

    const updated = await database
      .update(clients)
      .set({ followUpAt: followUpDate, updatedAt: new Date() })
      .where(and(eq(clients.id, clientId), eq(clients.organizationId, organizationId)))
      .returning();

    if (!updated.length) {
      res.status(status.NOT_FOUND).json({ success: false, message: "Client not found" });
      return;
    }

    if (followUpDate && req.user?.id) {
      const client = updated[0];
      const dateLabel = followUpDate.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
      try {
        await database.insert(notifications).values({
          id: crypto.randomUUID(),
          userId: req.user.id,
          organizationId,
          type: "follow_up_scheduled",
          title: `Follow-up scheduled: ${client.name}`,
          message: `Follow-up with ${client.name} is due on ${dateLabel}`,
          data: { clientId: client.id, followUpAt: followUpDate.toISOString() },
          read: false,
          createdAt: new Date(),
        });
      } catch (notifErr) {
        logger.error("Failed to create follow-up notification:", notifErr);
      }
    }

    res.status(status.OK).json({ success: true, data: updated[0] });

  } catch (error) {
    logger.error("Error updating lead follow-up:", error);
    res.status(status.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: (error as Error).message || "Internal server error"
    });
  }
};

const FOLLOW_UP_SELECT = `
  id,
  name,
  email,
  phone,
  status,
  lead_temperature  AS "leadTemperature",
  follow_up_at      AS "followUpAt",
  last_interaction_at AS "lastInteractionAt",
  webhook_id        AS "webhookId",
  webhook_name      AS "webhookName"
`;

// GET /leads/followups/pending  — overdue + today (full day window)
export const getPendingFollowUps = async (req: Request, res: Response): Promise<void> => {
  try {
    const organizationId = requireOrganizationId(req as any, res);
    if (!organizationId) return;

    const now    = new Date();
    const todayEnd = endOfDay(now);

    const result = await connection.query({
      text: `
        SELECT ${FOLLOW_UP_SELECT}
        FROM clients
        WHERE organization_id = $1
          AND type = 'lead'
          AND follow_up_at IS NOT NULL
          AND follow_up_at <= $2
        ORDER BY follow_up_at ASC
      `,
      values: [organizationId, todayEnd],
    });

    res.status(status.OK).json({ success: true, data: result.rows });

  } catch (error) {
    logger.error("Error fetching pending follow-ups:", error);
    res.status(status.INTERNAL_SERVER_ERROR).json({ success: false, message: "Internal server error" });
  }
};

// GET /leads/followups/dashboard — categorized: overdue / today / upcoming (7 days)
export const getFollowUpsDashboard = async (req: Request, res: Response): Promise<void> => {
  try {
    const organizationId = requireOrganizationId(req as any, res);
    if (!organizationId) return;

    const now        = new Date();
    const todayStart = startOfDay(now);
    const todayEnd   = endOfDay(now);
    const in7Days    = endOfDay(new Date(now.getFullYear(), now.getMonth(), now.getDate() + 7));

    const BASE = `
      FROM clients
      WHERE organization_id = $1
        AND type = 'lead'
        AND follow_up_at IS NOT NULL
    `;

    const [overdueRes, todayRes, upcomingRes] = await Promise.all([
      connection.query({
        text:   `SELECT ${FOLLOW_UP_SELECT} ${BASE} AND follow_up_at < $2 ORDER BY follow_up_at ASC`,
        values: [organizationId, todayStart],
      }),
      connection.query({
        text:   `SELECT ${FOLLOW_UP_SELECT} ${BASE} AND follow_up_at >= $2 AND follow_up_at <= $3 ORDER BY follow_up_at ASC`,
        values: [organizationId, todayStart, todayEnd],
      }),
      connection.query({
        text:   `SELECT ${FOLLOW_UP_SELECT} ${BASE} AND follow_up_at > $2 AND follow_up_at <= $3 ORDER BY follow_up_at ASC`,
        values: [organizationId, todayEnd, in7Days],
      }),
    ]);

    res.status(status.OK).json({
      success: true,
      data: {
        overdue:  overdueRes.rows,
        today:    todayRes.rows,
        upcoming: upcomingRes.rows,
      },
    });

  } catch (error) {
    logger.error("Error fetching follow-ups dashboard:", error);
    res.status(status.INTERNAL_SERVER_ERROR).json({ success: false, message: "Internal server error" });
  }
};

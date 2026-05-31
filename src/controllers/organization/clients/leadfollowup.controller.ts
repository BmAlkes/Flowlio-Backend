import { Request, Response } from "express";
import { database } from "../../../configs/connection.config";
import { clients, notifications } from "../../../schema/schema";
import { eq, and, lte, gte, isNotNull, lt, gt } from "drizzle-orm";
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

    // Create notification for the current user when follow-up is set
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

const FOLLOW_UP_COLUMNS = {
  id: clients.id,
  name: clients.name,
  email: clients.email,
  phone: clients.phone,
  status: clients.status,
  leadTemperature: clients.leadTemperature,
  followUpAt: clients.followUpAt,
  lastInteractionAt: clients.lastInteractionAt,
} as const;

// GET /leads/followups/pending  — overdue + today (full day window)
export const getPendingFollowUps = async (req: Request, res: Response): Promise<void> => {
  try {
    const organizationId = requireOrganizationId(req as any, res);
    if (!organizationId) return;

    const now = new Date();
    const pending = await database
      .select(FOLLOW_UP_COLUMNS)
      .from(clients)
      .where(
        and(
          eq(clients.organizationId, organizationId),
          isNotNull(clients.followUpAt),
          lte(clients.followUpAt, endOfDay(now))  // includes all of today
        )
      )
      .orderBy(clients.followUpAt);

    res.status(status.OK).json({ success: true, data: pending });

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

    const now = new Date();
    const todayStart = startOfDay(now);
    const todayEnd   = endOfDay(now);
    const in7Days    = endOfDay(new Date(now.getFullYear(), now.getMonth(), now.getDate() + 7));

    const [overdue, today, upcoming] = await Promise.all([
      database.select(FOLLOW_UP_COLUMNS).from(clients).where(
        and(eq(clients.organizationId, organizationId), isNotNull(clients.followUpAt), lt(clients.followUpAt, todayStart))
      ).orderBy(clients.followUpAt),

      database.select(FOLLOW_UP_COLUMNS).from(clients).where(
        and(eq(clients.organizationId, organizationId), isNotNull(clients.followUpAt), gte(clients.followUpAt, todayStart), lte(clients.followUpAt, todayEnd))
      ).orderBy(clients.followUpAt),

      database.select(FOLLOW_UP_COLUMNS).from(clients).where(
        and(eq(clients.organizationId, organizationId), isNotNull(clients.followUpAt), gt(clients.followUpAt, todayEnd), lte(clients.followUpAt, in7Days))
      ).orderBy(clients.followUpAt),
    ]);

    res.status(status.OK).json({
      success: true,
      data: { overdue, today, upcoming }
    });

  } catch (error) {
    logger.error("Error fetching follow-ups dashboard:", error);
    res.status(status.INTERNAL_SERVER_ERROR).json({ success: false, message: "Internal server error" });
  }
};

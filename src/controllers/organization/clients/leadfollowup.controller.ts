import { Request, Response } from "express";
import { database } from "../../../configs/connection.config";
import { clients } from "../../../schema/schema";
import { eq, and, lte, isNotNull } from "drizzle-orm";
import { logger } from "@/utils/logger.util";
import status from "http-status";
import { requireOrganizationId } from "@/utils/organization.util";

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

    res.status(status.OK).json({ success: true, data: updated[0] });

  } catch (error) {
    logger.error("Error updating lead follow-up:", error);
    res.status(status.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: (error as Error).message || "Internal server error"
    });
  }
};

export const getPendingFollowUps = async (req: Request, res: Response): Promise<void> => {
  try {
    const organizationId = requireOrganizationId(req as any, res);
    if (!organizationId) return;

    const pending = await database
      .select({
        id: clients.id,
        name: clients.name,
        email: clients.email,
        phone: clients.phone,
        status: clients.status,
        leadTemperature: clients.leadTemperature,
        followUpAt: clients.followUpAt,
        lastInteractionAt: clients.lastInteractionAt,
      })
      .from(clients)
      .where(
        and(
          eq(clients.organizationId, organizationId),
          isNotNull(clients.followUpAt),
          lte(clients.followUpAt, new Date())
        )
      )
      .orderBy(clients.followUpAt);

    res.status(status.OK).json({ success: true, data: pending });

  } catch (error) {
    logger.error("Error fetching pending follow-ups:", error);
    res.status(status.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: "Internal server error"
    });
  }
};

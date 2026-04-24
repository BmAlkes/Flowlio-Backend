import { Request, Response } from "express";
import { database } from "../../../configs/connection.config";
import { clients, clientInteractions } from "../../../schema/schema";
import { eq, and } from "drizzle-orm";
import { logger } from "@/utils/logger.util";
import status from "http-status";
import { requireOrganizationId } from "@/utils/organization.util";

export const updateLeadStatus = async (req: Request, res: Response): Promise<void> => {
  try {
    const organizationId = requireOrganizationId(req as any, res);
    if (!organizationId) return;

    const { clientId, newStatus, newPosition, oldStatus } = req.body;

    if (!clientId || !newStatus) {
      res.status(status.BAD_REQUEST).json({
        success: false,
        message: "Client ID and new status are required"
      });
      return;
    }

    // 1. Update the client's status and position
    await database
      .update(clients)
      .set({ 
        status: newStatus,
        position: newPosition ?? 0,
        updatedAt: new Date()
      })
      .where(
        and(
          eq(clients.id, clientId),
          eq(clients.organizationId, organizationId)
        )
      );

    // 2. Log the status change in interactions (Timeline)
    if (oldStatus && oldStatus !== newStatus) {
      await database.insert(clientInteractions).values({
        clientId,
        userId: req.user?.id as string,
        organizationId,
        type: "status_change",
        content: `Lead status changed from ${oldStatus} to ${newStatus}`,
        metadata: { fromStatus: oldStatus, toStatus: newStatus }
      });
    }

    res.status(status.OK).json({
      success: true,
      message: "Lead status updated successfully"
    });

  } catch (error) {
    logger.error("Error updating lead status:", error);
    res.status(status.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: (error as Error).message || "Internal server error",
    });
  }
};

import { Request, Response } from "express";
import { database } from "../../../configs/connection.config";
import { clients } from "../../../schema/schema";
import { eq, and } from "drizzle-orm";
import { logger } from "@/utils/logger.util";
import status from "http-status";
import { requireOrganizationId } from "@/utils/organization.util";

export const updateLeadValue = async (req: Request, res: Response): Promise<void> => {
  try {
    const organizationId = requireOrganizationId(req as any, res);
    if (!organizationId) return;

    const { clientId } = req.params;
    const { leadValue } = req.body;

    if (!clientId) {
      res.status(status.BAD_REQUEST).json({ success: false, message: "Client ID is required" });
      return;
    }

    if (leadValue === undefined || leadValue === null || isNaN(Number(leadValue)) || Number(leadValue) < 0) {
      res.status(status.BAD_REQUEST).json({ success: false, message: "leadValue must be a non-negative number" });
      return;
    }

    const updated = await database
      .update(clients)
      .set({ leadValue: String(leadValue), updatedAt: new Date() })
      .where(and(eq(clients.id, clientId), eq(clients.organizationId, organizationId)))
      .returning();

    if (!updated.length) {
      res.status(status.NOT_FOUND).json({ success: false, message: "Client not found" });
      return;
    }

    res.status(status.OK).json({ success: true, data: updated[0] });

  } catch (error) {
    logger.error("Error updating lead value:", error);
    res.status(status.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: (error as Error).message || "Internal server error"
    });
  }
};

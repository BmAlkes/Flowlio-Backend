import { Request, Response } from "express";
import { database } from "../../../configs/connection.config";
import { clientInteractions } from "../../../schema/schema";
import { eq, and } from "drizzle-orm";
import { logger } from "@/utils/logger.util";
import status from "http-status";
import { requireOrganizationId } from "@/utils/organization.util";

export const deleteClientInteraction = async (req: Request, res: Response): Promise<void> => {
  try {
    const organizationId = requireOrganizationId(req as any, res);
    if (!organizationId) return;

    const { interactionId } = req.params;

    if (!interactionId) {
      res.status(status.BAD_REQUEST).json({ success: false, message: "Interaction ID is required" });
      return;
    }

    const existing = await database.query.clientInteractions.findFirst({
      where: and(
        eq(clientInteractions.id, interactionId),
        eq(clientInteractions.organizationId, organizationId)
      )
    });

    if (!existing) {
      res.status(status.NOT_FOUND).json({ success: false, message: "Interaction not found" });
      return;
    }

    await database
      .delete(clientInteractions)
      .where(and(
        eq(clientInteractions.id, interactionId),
        eq(clientInteractions.organizationId, organizationId)
      ));

    res.status(status.OK).json({ success: true });

  } catch (error) {
    logger.error("Error deleting client interaction:", error);
    res.status(status.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: "Internal server error"
    });
  }
};

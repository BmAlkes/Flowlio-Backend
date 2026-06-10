import { Request, Response } from "express";
import { connection } from "@/configs/connection.config";
import { requireOrganizationId } from "@/utils/organization.util";
import { logger } from "@/utils/logger.util";
import status from "http-status";

export const deleteInteraction = async (req: Request, res: Response): Promise<void> => {
  try {
    const organizationId = requireOrganizationId(req as any, res);
    if (!organizationId) return;

    const { interactionId } = req.params;

    const existing = await connection.query<{ id: string }>({
      text: `SELECT id FROM client_interactions WHERE id = $1 AND organization_id = $2 LIMIT 1`,
      values: [interactionId, organizationId],
    });

    if (existing.rows.length === 0) {
      res.status(status.NOT_FOUND).json({ success: false, message: "Interaction not found" });
      return;
    }

    // Replies have ON DELETE CASCADE but we delete explicitly for clarity
    await connection.query({
      text: `DELETE FROM interaction_replies WHERE interaction_id = $1`,
      values: [interactionId],
    });

    await connection.query({
      text: `DELETE FROM client_interactions WHERE id = $1`,
      values: [interactionId],
    });

    res.status(status.OK).json({
      success: true,
      data: { deletedId: interactionId },
    });
  } catch (error: any) {
    logger.error("Error deleting interaction:", {
      message: error?.message,
      cause: error?.cause,
      detail: error?.detail,
    });
    res.status(status.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: error?.cause?.message ?? error?.message ?? "Internal server error",
    });
  }
};

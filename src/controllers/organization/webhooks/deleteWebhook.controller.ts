import { Request, Response } from "express";
import { connection } from "@/configs/connection.config";
import { requireOrganizationId } from "@/utils/organization.util";
import { logger } from "@/utils/logger.util";

export const deleteWebhook = async (req: Request, res: Response): Promise<void> => {
  try {
    const organizationId = requireOrganizationId(req, res);
    if (!organizationId) return;

    const { id } = req.params;

    const result = await connection.query({
      text: `
        DELETE FROM lead_webhooks
        WHERE id = $1 AND org_id = $2
        RETURNING id
      `,
      values: [id, organizationId],
    });

    if (result.rows.length === 0) {
      res.status(404).json({ success: false, message: "Webhook not found" });
      return;
    }

    res.status(200).json({ success: true, message: "Webhook deleted" });
  } catch (error: any) {
    logger.error("Error deleting webhook:", { message: error?.message });
    res.status(500).json({ success: false, message: "Internal server error" });
  }
};

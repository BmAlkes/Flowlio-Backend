import { Request, Response } from "express";
import { connection } from "@/configs/connection.config";
import { requireOrganizationId } from "@/utils/organization.util";
import { logger } from "@/utils/logger.util";

export const deleteWebhookLog = async (req: Request, res: Response): Promise<void> => {
  try {
    const organizationId = requireOrganizationId(req, res);
    if (!organizationId) return;

    const { logId } = req.params;

    // Verify log exists and belongs to a webhook owned by this org
    const check = await connection.query({
      text: `
        SELECT l.id
        FROM lead_webhook_logs l
        INNER JOIN lead_webhooks w ON w.id = l.webhook_id
        WHERE l.id = $1 AND w.org_id = $2
      `,
      values: [logId, organizationId],
    });

    if (check.rows.length === 0) {
      res.status(404).json({ success: false, message: "Log not found" });
      return;
    }

    await connection.query({
      text: `DELETE FROM lead_webhook_logs WHERE id = $1`,
      values: [logId],
    });

    res.status(200).json({ success: true });
  } catch (error: any) {
    logger.error("Error deleting webhook log:", { message: error?.message });
    res.status(500).json({ success: false, message: "Internal server error" });
  }
};

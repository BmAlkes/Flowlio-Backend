import { Request, Response } from "express";
import { connection } from "@/configs/connection.config";
import { requireOrganizationId } from "@/utils/organization.util";
import { logger } from "@/utils/logger.util";

export const getLeadWebhookLog = async (req: Request, res: Response): Promise<void> => {
  try {
    const organizationId = requireOrganizationId(req, res);
    if (!organizationId) return;

    const { leadId } = req.params;

    // Verify lead belongs to this org
    const leadCheck = await connection.query({
      text: `SELECT id FROM clients WHERE id = $1 AND organization_id = $2 AND type = 'lead'`,
      values: [leadId, organizationId],
    });

    if (leadCheck.rows.length === 0) {
      res.status(404).json({ success: false, message: "Lead not found" });
      return;
    }

    const result = await connection.query({
      text: `
        SELECT
          l.payload,
          w.name      AS "webhookName",
          l.created_at AS "createdAt"
        FROM lead_webhook_logs l
        LEFT JOIN lead_webhooks w ON w.id = l.webhook_id
        WHERE l.lead_id = $1
          AND l.status = 'success'
        ORDER BY l.created_at DESC
        LIMIT 1
      `,
      values: [leadId],
    });

    res.status(200).json({
      success: true,
      data: result.rows.length > 0 ? result.rows[0] : null,
    });
  } catch (error: any) {
    logger.error("Error fetching lead webhook log:", { message: error?.message });
    res.status(500).json({ success: false, message: "Internal server error" });
  }
};

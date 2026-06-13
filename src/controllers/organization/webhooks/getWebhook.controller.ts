import { Request, Response } from "express";
import { connection } from "@/configs/connection.config";
import { requireOrganizationId } from "@/utils/organization.util";
import { logger } from "@/utils/logger.util";

export const getWebhook = async (req: Request, res: Response): Promise<void> => {
  try {
    const organizationId = requireOrganizationId(req, res);
    if (!organizationId) return;

    const { id } = req.params;

    const result = await connection.query({
      text: `
        SELECT
          w.id,
          w.org_id           AS "orgId",
          w.name,
          w.source,
          w.token,
          w.active,
          w.field_mapping    AS "fieldMapping",
          w.created_at       AS "createdAt",
          w.updated_at       AS "updatedAt",
          COUNT(l.id)::int   AS "totalCalls",
          MAX(l.created_at)  AS "lastCallAt"
        FROM lead_webhooks w
        LEFT JOIN lead_webhook_logs l ON l.webhook_id = w.id
        WHERE w.id = $1 AND w.org_id = $2
        GROUP BY w.id
      `,
      values: [id, organizationId],
    });

    if (result.rows.length === 0) {
      res.status(404).json({ success: false, message: "Webhook not found" });
      return;
    }

    res.status(200).json({ success: true, webhook: result.rows[0] });
  } catch (error: any) {
    logger.error("Error fetching webhook:", { message: error?.message });
    res.status(500).json({ success: false, message: "Internal server error" });
  }
};

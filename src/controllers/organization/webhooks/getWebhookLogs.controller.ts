import { Request, Response } from "express";
import { connection } from "@/configs/connection.config";
import { requireOrganizationId } from "@/utils/organization.util";
import { logger } from "@/utils/logger.util";

export const getWebhookLogs = async (req: Request, res: Response): Promise<void> => {
  try {
    const organizationId = requireOrganizationId(req, res);
    if (!organizationId) return;

    const { id } = req.params;
    const {
      page = "1",
      limit = "50",
      status = "",
    } = req.query as Record<string, string>;

    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.min(200, Math.max(1, parseInt(limit, 10) || 50));
    const offset = (pageNum - 1) * limitNum;

    // Verify ownership
    const ownerCheck = await connection.query({
      text: `SELECT id FROM lead_webhooks WHERE id = $1 AND org_id = $2`,
      values: [id, organizationId],
    });
    if (ownerCheck.rows.length === 0) {
      res.status(404).json({ success: false, message: "Webhook not found" });
      return;
    }

    const conditions = [`l.webhook_id = $1`];
    const values: any[] = [id];
    let idx = 2;

    if (status) {
      conditions.push(`l.status = $${idx}`);
      values.push(status);
      idx++;
    }

    const where = conditions.join(" AND ");

    const [dataResult, countResult] = await Promise.all([
      connection.query({
        text: `
          SELECT
            l.id,
            l.webhook_id  AS "webhookId",
            l.status,
            l.payload,
            l.lead_id     AS "leadId",
            l.error,
            l.ip,
            l.created_at  AS "createdAt"
          FROM lead_webhook_logs l
          WHERE ${where}
          ORDER BY l.created_at DESC
          LIMIT $${idx} OFFSET $${idx + 1}
        `,
        values: [...values, limitNum, offset],
      }),
      connection.query({
        text: `SELECT COUNT(*) FROM lead_webhook_logs l WHERE ${where}`,
        values,
      }),
    ]);

    res.status(200).json({
      success: true,
      logs: dataResult.rows,
      total: parseInt(countResult.rows[0].count, 10),
      page: pageNum,
    });
  } catch (error: any) {
    logger.error("Error fetching webhook logs:", { message: error?.message });
    res.status(500).json({ success: false, message: "Internal server error" });
  }
};

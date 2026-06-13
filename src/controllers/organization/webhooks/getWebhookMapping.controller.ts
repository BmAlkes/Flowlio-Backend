import { Request, Response } from "express";
import { connection } from "@/configs/connection.config";
import { requireOrganizationId } from "@/utils/organization.util";
import { logger } from "@/utils/logger.util";

export const getWebhookMapping = async (req: Request, res: Response): Promise<void> => {
  try {
    const organizationId = requireOrganizationId(req, res);
    if (!organizationId) return;

    const { id } = req.params;

    const result = await connection.query({
      text: `SELECT field_mapping AS "fieldMapping" FROM lead_webhooks WHERE id = $1 AND org_id = $2`,
      values: [id, organizationId],
    });

    if (result.rows.length === 0) {
      res.status(404).json({ success: false, message: "Webhook not found" });
      return;
    }

    res.status(200).json({ success: true, fieldMapping: result.rows[0].fieldMapping ?? {} });
  } catch (error: any) {
    logger.error("Error fetching webhook mapping:", { message: error?.message });
    res.status(500).json({ success: false, message: "Internal server error" });
  }
};

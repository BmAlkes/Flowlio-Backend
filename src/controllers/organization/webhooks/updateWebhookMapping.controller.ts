import { Request, Response } from "express";
import { connection } from "@/configs/connection.config";
import { requireOrganizationId } from "@/utils/organization.util";
import { logger } from "@/utils/logger.util";

export const updateWebhookMapping = async (req: Request, res: Response): Promise<void> => {
  try {
    const organizationId = requireOrganizationId(req, res);
    if (!organizationId) return;

    const { id } = req.params;
    const mapping = req.body as Record<string, string>;

    if (!mapping || typeof mapping !== "object" || Array.isArray(mapping)) {
      res.status(400).json({ success: false, message: "Body must be a JSON object mapping external fields to lead fields" });
      return;
    }

    const result = await connection.query({
      text: `
        UPDATE lead_webhooks
        SET field_mapping = $1::jsonb, updated_at = now()
        WHERE id = $2 AND org_id = $3
        RETURNING field_mapping AS "fieldMapping"
      `,
      values: [JSON.stringify(mapping), id, organizationId],
    });

    if (result.rows.length === 0) {
      res.status(404).json({ success: false, message: "Webhook not found" });
      return;
    }

    res.status(200).json({ success: true, fieldMapping: result.rows[0].fieldMapping });
  } catch (error: any) {
    logger.error("Error updating webhook mapping:", { message: error?.message });
    res.status(500).json({ success: false, message: "Internal server error" });
  }
};

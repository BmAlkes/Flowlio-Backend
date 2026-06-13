import { Request, Response } from "express";
import { connection } from "@/configs/connection.config";
import { requireOrganizationId } from "@/utils/organization.util";
import { logger } from "@/utils/logger.util";

export const updateLeadCustomValues = async (req: Request, res: Response): Promise<void> => {
  try {
    const organizationId = requireOrganizationId(req, res);
    if (!organizationId) return;

    const { id } = req.params;
    const incoming = req.body as Record<string, any>;

    if (!incoming || typeof incoming !== "object" || Array.isArray(incoming)) {
      res.status(400).json({ success: false, message: "Body must be a JSON object of { fieldId: value }" });
      return;
    }

    // Merge incoming values into existing custom_fields
    const result = await connection.query({
      text: `
        UPDATE clients
        SET
          custom_fields = COALESCE(custom_fields, '{}'::jsonb) || $1::jsonb,
          updated_at = now()
        WHERE id = $2 AND organization_id = $3 AND type = 'lead'
        RETURNING custom_fields AS "customFields"
      `,
      values: [JSON.stringify(incoming), id, organizationId],
    });

    if (result.rows.length === 0) {
      res.status(404).json({ success: false, message: "Lead not found" });
      return;
    }

    res.status(200).json({
      success: true,
      customFields: result.rows[0].customFields ?? {},
    });
  } catch (error: any) {
    logger.error("Error updating lead custom values:", { message: error?.message });
    res.status(500).json({ success: false, message: "Internal server error" });
  }
};

import { Request, Response } from "express";
import { connection } from "@/configs/connection.config";
import { requireOrganizationId } from "@/utils/organization.util";
import { logger } from "@/utils/logger.util";

export const deleteLeadField = async (req: Request, res: Response): Promise<void> => {
  try {
    const organizationId = requireOrganizationId(req, res);
    if (!organizationId) return;

    const { fieldId } = req.params;

    // Remove this field's key from all leads' custom_fields in the org
    await connection.query({
      text: `
        UPDATE clients
        SET custom_fields = custom_fields - $1, updated_at = now()
        WHERE organization_id = $2
          AND custom_fields ? $1
      `,
      values: [fieldId, organizationId],
    });

    const result = await connection.query({
      text: `
        DELETE FROM lead_field_definitions
        WHERE id = $1 AND org_id = $2
        RETURNING id
      `,
      values: [fieldId, organizationId],
    });

    if (result.rows.length === 0) {
      res.status(404).json({ success: false, message: "Field not found" });
      return;
    }

    res.status(200).json({ success: true, message: "Field deleted" });
  } catch (error: any) {
    logger.error("Error deleting lead field:", { message: error?.message });
    res.status(500).json({ success: false, message: "Internal server error" });
  }
};

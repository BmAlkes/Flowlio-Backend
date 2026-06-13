import { Request, Response } from "express";
import { connection } from "@/configs/connection.config";
import { requireOrganizationId } from "@/utils/organization.util";
import { logger } from "@/utils/logger.util";

export const getLeadCustomValues = async (req: Request, res: Response): Promise<void> => {
  try {
    const organizationId = requireOrganizationId(req, res);
    if (!organizationId) return;

    const { id } = req.params;

    const result = await connection.query({
      text: `
        SELECT custom_fields AS "customFields"
        FROM clients
        WHERE id = $1 AND organization_id = $2 AND type = 'lead'
      `,
      values: [id, organizationId],
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
    logger.error("Error fetching lead custom values:", { message: error?.message });
    res.status(500).json({ success: false, message: "Internal server error" });
  }
};

import { Request, Response } from "express";
import { connection } from "@/configs/connection.config";
import { requireOrganizationId } from "@/utils/organization.util";
import { logger } from "@/utils/logger.util";

export const getLead = async (req: Request, res: Response): Promise<void> => {
  try {
    const organizationId = requireOrganizationId(req, res);
    if (!organizationId) return;

    const { id } = req.params;

    const result = await connection.query({
      text: `
        SELECT
          c.id,
          c.organization_id       AS "organizationId",
          c.name,
          c.email,
          c.phone,
          c.cpf_cnpj_number       AS cpfcnpj,
          c.business_industry     AS "businessIndustry",
          c.address,
          c.status,
          c.type,
          c.custom_fields         AS "customFields",
          c.lead_value            AS "leadValue",
          c.lead_probability      AS "leadProbability",
          c.lead_temperature      AS "leadTemperature",
          c.follow_up_at          AS "followUpAt",
          c.last_interaction_at   AS "lastInteractionAt",
          c.position,
          c.created_at            AS "createdAt",
          c.updated_at            AS "updatedAt"
        FROM clients c
        WHERE c.id = $1
          AND c.organization_id = $2
          AND c.type = 'lead'
      `,
      values: [id, organizationId],
    });

    if (result.rows.length === 0) {
      res.status(404).json({ success: false, message: "Lead not found" });
      return;
    }

    res.status(200).json({ success: true, data: result.rows[0] });
  } catch (error: any) {
    logger.error("Error fetching lead:", { message: error?.message, detail: error?.detail });
    res.status(500).json({ success: false, message: "Internal server error" });
  }
};

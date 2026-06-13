import { Request, Response } from "express";
import { connection } from "@/configs/connection.config";
import { requireOrganizationId } from "@/utils/organization.util";
import { logger } from "@/utils/logger.util";

const ALLOWED_FIELDS: Record<string, string> = {
  name: "name",
  email: "email",
  phone: "phone",
  cpfcnpj: "cpf_cnpj_number",
  businessIndustry: "business_industry",
  address: "address",
  leadValue: "lead_value",
};

export const updateLead = async (req: Request, res: Response): Promise<void> => {
  try {
    const organizationId = requireOrganizationId(req, res);
    if (!organizationId) return;

    const { id } = req.params;
    const body = req.body as Record<string, any>;

    const setClauses: string[] = [];
    const values: any[] = [];
    let idx = 1;

    for (const [jsKey, sqlCol] of Object.entries(ALLOWED_FIELDS)) {
      if (jsKey in body) {
        setClauses.push(`${sqlCol} = $${idx}`);
        values.push(body[jsKey] ?? null);
        idx++;
      }
    }

    if (setClauses.length === 0) {
      res.status(400).json({ success: false, message: "No valid fields to update" });
      return;
    }

    setClauses.push(`updated_at = now()`);
    values.push(id, organizationId);

    const result = await connection.query({
      text: `
        UPDATE clients
        SET ${setClauses.join(", ")}
        WHERE id = $${idx} AND organization_id = $${idx + 1} AND type = 'lead'
        RETURNING
          id, name, email, phone,
          cpf_cnpj_number AS cpfcnpj,
          business_industry AS "businessIndustry",
          address, status, type,
          lead_value AS "leadValue",
          updated_at AS "updatedAt"
      `,
      values,
    });

    if (result.rows.length === 0) {
      res.status(404).json({ success: false, message: "Lead not found" });
      return;
    }

    res.status(200).json({ success: true, data: result.rows[0] });
  } catch (error: any) {
    logger.error("Error updating lead:", { message: error?.message, detail: error?.detail });
    res.status(500).json({ success: false, message: "Internal server error" });
  }
};

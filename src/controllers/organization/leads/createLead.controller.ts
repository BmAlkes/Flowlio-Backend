import { Request, Response } from "express";
import { connection } from "@/configs/connection.config";
import { requireOrganizationId } from "@/utils/organization.util";
import { logger } from "@/utils/logger.util";
import { randomUUID } from "crypto";
import { canCreateLead } from "@/utils/plan-access.util";

export const createLead = async (req: Request, res: Response): Promise<void> => {
  try {
    const organizationId = requireOrganizationId(req, res);
    if (!organizationId) return;

    const leadAccess = await canCreateLead(organizationId);
    if (!leadAccess.hasAccess) {
      res.status(403).json({ success: false, message: leadAccess.reason });
      return;
    }

    const userId = (req as any).user?.id as string;

    const {
      name,
      email,
      phone,
      cpfcnpj,
      businessIndustry,
      address,
      status = "New Lead",
      leadValue,
    } = req.body;

    if (!name || !email) {
      res.status(400).json({ success: false, message: "name and email are required" });
      return;
    }

    const id = randomUUID();
    const now = new Date();

    const result = await connection.query({
      text: `
        INSERT INTO clients (
          id, organization_id, name, email, phone, cpf_cnpj_number,
          business_industry, address, status, type, created_by,
          position, created_at, updated_at
        )
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'lead',$10,0,$11,$11)
        RETURNING
          id, organization_id AS "organizationId", name, email, phone,
          cpf_cnpj_number AS cpfcnpj, business_industry AS "businessIndustry",
          address, status, type, lead_value AS "leadValue",
          lead_temperature AS "leadTemperature", follow_up_at AS "followUpAt",
          position, created_at AS "createdAt", updated_at AS "updatedAt"
      `,
      values: [
        id,
        organizationId,
        name,
        email,
        phone ?? null,
        cpfcnpj ?? null,
        businessIndustry ?? null,
        address ?? null,
        status,
        userId,
        now,
      ],
    });

    if (leadValue !== undefined) {
      await connection.query({
        text: `UPDATE clients SET lead_value = $1, updated_at = now() WHERE id = $2`,
        values: [leadValue, id],
      });
      result.rows[0].leadValue = leadValue;
    }

    res.status(201).json({ success: true, data: result.rows[0] });
  } catch (error: any) {
    logger.error("Error creating lead:", { message: error?.message, detail: error?.detail });
    res.status(500).json({ success: false, message: "Internal server error" });
  }
};

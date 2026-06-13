import { Request, Response } from "express";
import { connection } from "@/configs/connection.config";
import { requireOrganizationId } from "@/utils/organization.util";
import { logger } from "@/utils/logger.util";

export const getLeads = async (req: Request, res: Response): Promise<void> => {
  try {
    const organizationId = requireOrganizationId(req, res);
    if (!organizationId) return;

    const {
      search = "",
      status = "",
      temperature = "",
      dateFrom = "",
      dateTo = "",
      page = "1",
      limit = "50",
    } = req.query as Record<string, string>;

    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.min(200, Math.max(1, parseInt(limit, 10) || 50));
    const offset = (pageNum - 1) * limitNum;

    const conditions: string[] = [`c.organization_id = $1`, `c.type = 'lead'`];
    const values: any[] = [organizationId];
    let idx = 2;

    if (search) {
      conditions.push(`(c.name ILIKE $${idx} OR c.email ILIKE $${idx})`);
      values.push(`%${search}%`);
      idx++;
    }
    if (status) {
      conditions.push(`c.status = $${idx}`);
      values.push(status);
      idx++;
    }
    if (temperature) {
      conditions.push(`c.lead_temperature = $${idx}`);
      values.push(temperature);
      idx++;
    }
    if (dateFrom) {
      conditions.push(`c.created_at >= $${idx}`);
      values.push(dateFrom);
      idx++;
    }
    if (dateTo) {
      conditions.push(`c.created_at <= $${idx}`);
      values.push(dateTo);
      idx++;
    }

    const where = conditions.join(" AND ");

    const [dataResult, countResult] = await Promise.all([
      connection.query({
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
            c.lead_temperature      AS "leadTemperature",
            c.follow_up_at          AS "followUpAt",
            c.last_interaction_at   AS "lastInteractionAt",
            c.position,
            c.created_at            AS "createdAt",
            c.updated_at            AS "updatedAt"
          FROM clients c
          WHERE ${where}
          ORDER BY c.position ASC, c.created_at DESC
          LIMIT $${idx} OFFSET $${idx + 1}
        `,
        values: [...values, limitNum, offset],
      }),
      connection.query({
        text: `SELECT COUNT(*) FROM clients c WHERE ${where}`,
        values,
      }),
    ]);

    const total = parseInt(countResult.rows[0].count, 10);

    res.status(200).json({
      success: true,
      data: dataResult.rows,
      total,
      page: pageNum,
      limit: limitNum,
    });
  } catch (error: any) {
    logger.error("Error fetching leads:", { message: error?.message, detail: error?.detail });
    res.status(500).json({ success: false, message: "Internal server error" });
  }
};

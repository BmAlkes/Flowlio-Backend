import { Request, Response } from "express";
import { connection } from "@/configs/connection.config";
import { requireOrganizationId } from "@/utils/organization.util";
import { logger } from "@/utils/logger.util";

const PG_UNDEFINED_COLUMN = "42703";

const SELECT_FULL = `
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
  c.webhook_id            AS "webhookId",
  c.webhook_name          AS "webhookName",
  c.assigned_to           AS "assignedTo",
  c.assigned_at           AS "assignedAt",
  c.position,
  c.created_at            AS "createdAt",
  c.updated_at            AS "updatedAt",
  CASE WHEN au.id IS NOT NULL
    THEN json_build_object('id', au.id, 'name', au.name, 'email', au.email)
    ELSE NULL
  END AS "assignedUser",
  COALESCE(
    (SELECT json_agg(json_build_object('id', lt.id, 'name', lt.name, 'color', lt.color))
     FROM lead_tag_assignments lta
     JOIN lead_tags lt ON lt.id = lta.tag_id
     WHERE lta.lead_id = c.id),
    '[]'::json
  ) AS tags
`;

const SELECT_BASE = `
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
  NULL                    AS "webhookId",
  NULL                    AS "webhookName",
  NULL                    AS "assignedTo",
  NULL                    AS "assignedAt",
  c.position,
  c.created_at            AS "createdAt",
  c.updated_at            AS "updatedAt",
  NULL                    AS "assignedUser",
  '[]'::json              AS tags
`;

export const getLeads = async (req: Request, res: Response): Promise<void> => {
  try {
    const organizationId = requireOrganizationId(req, res);
    if (!organizationId) return;

    const {
      search      = "",
      status      = "",
      temperature = "",
      webhookId   = "",
      assignedTo  = "",
      tagId       = "",
      dateFrom    = "",
      dateTo      = "",
      page        = "1",
      limit       = "50",
    } = req.query as Record<string, string>;

    const pageNum  = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.min(200, Math.max(1, parseInt(limit, 10) || 50));
    const offset   = (pageNum - 1) * limitNum;

    const conditions: string[] = [`c.organization_id = $1`, `c.type = 'lead'`];
    const values: any[]        = [organizationId];
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
    if (webhookId) {
      conditions.push(`c.webhook_id = $${idx}`);
      values.push(webhookId);
      idx++;
    }
    if (assignedTo) {
      conditions.push(`c.assigned_to = $${idx}`);
      values.push(assignedTo);
      idx++;
    }
    if (tagId) {
      conditions.push(`EXISTS (SELECT 1 FROM lead_tag_assignments lta2 WHERE lta2.lead_id = c.id AND lta2.tag_id = $${idx})`);
      values.push(tagId);
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

    const runQuery = async (selectCols: string, useJoin: boolean) => {
      const joinClause = useJoin ? `LEFT JOIN users au ON au.id = c.assigned_to` : ``;
      const [data, count] = await Promise.all([
        connection.query({
          text: `
            SELECT ${selectCols}
            FROM clients c
            ${joinClause}
            WHERE ${where}
            ORDER BY c.position ASC, c.created_at DESC
            LIMIT $${idx} OFFSET $${idx + 1}
          `,
          values: [...values, limitNum, offset],
        }),
        connection.query({
          text:   `SELECT COUNT(*) FROM clients c WHERE ${where}`,
          values,
        }),
      ]);
      return { rows: data.rows, total: parseInt(count.rows[0].count, 10) };
    };

    let result: { rows: any[]; total: number };

    try {
      result = await runQuery(SELECT_FULL, true);
    } catch (err: any) {
      if (err?.code === PG_UNDEFINED_COLUMN) {
        logger.warn("getLeads: new columns missing, falling back to base SELECT");
        result = await runQuery(SELECT_BASE, false);
      } else {
        throw err;
      }
    }

    res.status(200).json({
      success: true,
      data:    result.rows,
      total:   result.total,
      page:    pageNum,
      limit:   limitNum,
    });
  } catch (error: any) {
    logger.error("Error fetching leads:", { message: error?.message, detail: error?.detail });
    res.status(500).json({ success: false, message: "Internal server error" });
  }
};

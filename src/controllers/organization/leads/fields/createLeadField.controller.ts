import { Request, Response } from "express";
import { connection } from "@/configs/connection.config";
import { requireOrganizationId } from "@/utils/organization.util";
import { logger } from "@/utils/logger.util";
import { randomUUID } from "crypto";

const VALID_TYPES = ["text", "number", "select", "multiselect", "date", "boolean", "url"];

export const createLeadField = async (req: Request, res: Response): Promise<void> => {
  try {
    const organizationId = requireOrganizationId(req, res);
    if (!organizationId) return;

    const { name, type, options, required = false, position = 0 } = req.body;

    if (!name || !type) {
      res.status(400).json({ success: false, message: "name and type are required" });
      return;
    }
    if (!VALID_TYPES.includes(type)) {
      res.status(400).json({ success: false, message: `type must be one of: ${VALID_TYPES.join(", ")}` });
      return;
    }

    const id = randomUUID();
    const now = new Date();
    const optionsJson = options ? JSON.stringify(options) : null;

    const result = await connection.query({
      text: `
        INSERT INTO lead_field_definitions (id, org_id, name, type, options, required, position, created_at, updated_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $8)
        RETURNING
          id, org_id AS "orgId", name, type, options, required, position,
          created_at AS "createdAt"
      `,
      values: [id, organizationId, name, type, optionsJson, required, position, now],
    });

    res.status(201).json({ success: true, field: result.rows[0] });
  } catch (error: any) {
    logger.error("Error creating lead field:", { message: error?.message });
    res.status(500).json({ success: false, message: "Internal server error" });
  }
};

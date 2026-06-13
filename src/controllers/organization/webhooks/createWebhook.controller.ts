import { Request, Response } from "express";
import { connection } from "@/configs/connection.config";
import { requireOrganizationId } from "@/utils/organization.util";
import { logger } from "@/utils/logger.util";
import { randomUUID } from "crypto";

const VALID_SOURCES = ["wordpress", "facebook", "generic"];

export const createWebhook = async (req: Request, res: Response): Promise<void> => {
  try {
    const organizationId = requireOrganizationId(req, res);
    if (!organizationId) return;

    const { name, source } = req.body;

    if (!name || !source) {
      res.status(400).json({ success: false, message: "name and source are required" });
      return;
    }
    if (!VALID_SOURCES.includes(source)) {
      res.status(400).json({ success: false, message: `source must be one of: ${VALID_SOURCES.join(", ")}` });
      return;
    }

    const id = randomUUID();
    const token = randomUUID();
    const now = new Date();

    const result = await connection.query({
      text: `
        INSERT INTO lead_webhooks (id, org_id, name, source, token, active, field_mapping, created_at, updated_at)
        VALUES ($1, $2, $3, $4, $5, true, '{}', $6, $6)
        RETURNING
          id, org_id AS "orgId", name, source, token, active,
          field_mapping AS "fieldMapping",
          created_at AS "createdAt", updated_at AS "updatedAt"
      `,
      values: [id, organizationId, name, source, token, now],
    });

    res.status(201).json({ success: true, webhook: { ...result.rows[0], totalCalls: 0, lastCallAt: null } });
  } catch (error: any) {
    logger.error("Error creating webhook:", { message: error?.message });
    res.status(500).json({ success: false, message: "Internal server error" });
  }
};

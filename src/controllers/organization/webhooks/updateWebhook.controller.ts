import { Request, Response } from "express";
import { connection } from "@/configs/connection.config";
import { requireOrganizationId } from "@/utils/organization.util";
import { logger } from "@/utils/logger.util";

export const updateWebhook = async (req: Request, res: Response): Promise<void> => {
  try {
    const organizationId = requireOrganizationId(req, res);
    if (!organizationId) return;

    const { id } = req.params;
    const { name, source, active } = req.body;

    const setClauses: string[] = [];
    const values: any[] = [];
    let idx = 1;

    if (name !== undefined) { setClauses.push(`name = $${idx}`); values.push(name); idx++; }
    if (source !== undefined) { setClauses.push(`source = $${idx}`); values.push(source); idx++; }
    if (active !== undefined) { setClauses.push(`active = $${idx}`); values.push(active); idx++; }

    if (setClauses.length === 0) {
      res.status(400).json({ success: false, message: "No valid fields to update" });
      return;
    }

    setClauses.push(`updated_at = now()`);
    values.push(id, organizationId);

    const result = await connection.query({
      text: `
        UPDATE lead_webhooks
        SET ${setClauses.join(", ")}
        WHERE id = $${idx} AND org_id = $${idx + 1}
        RETURNING
          id, org_id AS "orgId", name, source, token, active,
          field_mapping AS "fieldMapping",
          created_at AS "createdAt", updated_at AS "updatedAt"
      `,
      values,
    });

    if (result.rows.length === 0) {
      res.status(404).json({ success: false, message: "Webhook not found" });
      return;
    }

    res.status(200).json({ success: true, webhook: result.rows[0] });
  } catch (error: any) {
    logger.error("Error updating webhook:", { message: error?.message });
    res.status(500).json({ success: false, message: "Internal server error" });
  }
};

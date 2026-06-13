import { Request, Response } from "express";
import { connection } from "@/configs/connection.config";
import { requireOrganizationId } from "@/utils/organization.util";
import { logger } from "@/utils/logger.util";

export const updateLeadField = async (req: Request, res: Response): Promise<void> => {
  try {
    const organizationId = requireOrganizationId(req, res);
    if (!organizationId) return;

    const { fieldId } = req.params;
    const { name, options, required, position } = req.body;

    const setClauses: string[] = [];
    const values: any[] = [];
    let idx = 1;

    if (name !== undefined) { setClauses.push(`name = $${idx}`); values.push(name); idx++; }
    if (options !== undefined) { setClauses.push(`options = $${idx}`); values.push(JSON.stringify(options)); idx++; }
    if (required !== undefined) { setClauses.push(`required = $${idx}`); values.push(required); idx++; }
    if (position !== undefined) { setClauses.push(`position = $${idx}`); values.push(position); idx++; }

    if (setClauses.length === 0) {
      res.status(400).json({ success: false, message: "No valid fields to update" });
      return;
    }

    setClauses.push(`updated_at = now()`);
    values.push(fieldId, organizationId);

    const result = await connection.query({
      text: `
        UPDATE lead_field_definitions
        SET ${setClauses.join(", ")}
        WHERE id = $${idx} AND org_id = $${idx + 1}
        RETURNING
          id, org_id AS "orgId", name, type, options, required, position,
          created_at AS "createdAt"
      `,
      values,
    });

    if (result.rows.length === 0) {
      res.status(404).json({ success: false, message: "Field not found" });
      return;
    }

    res.status(200).json({ success: true, field: result.rows[0] });
  } catch (error: any) {
    logger.error("Error updating lead field:", { message: error?.message });
    res.status(500).json({ success: false, message: "Internal server error" });
  }
};

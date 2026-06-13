import { Request, Response } from "express";
import { connection } from "@/configs/connection.config";
import { requireOrganizationId } from "@/utils/organization.util";
import { logger } from "@/utils/logger.util";

export const getLeadFields = async (req: Request, res: Response): Promise<void> => {
  try {
    const organizationId = requireOrganizationId(req, res);
    if (!organizationId) return;

    const result = await connection.query({
      text: `
        SELECT
          id,
          org_id        AS "orgId",
          name,
          type,
          options,
          required,
          position,
          created_at    AS "createdAt"
        FROM lead_field_definitions
        WHERE org_id = $1
        ORDER BY position ASC, created_at ASC
      `,
      values: [organizationId],
    });

    res.status(200).json({ success: true, fields: result.rows });
  } catch (error: any) {
    logger.error("Error fetching lead fields:", { message: error?.message });
    res.status(500).json({ success: false, message: "Internal server error" });
  }
};

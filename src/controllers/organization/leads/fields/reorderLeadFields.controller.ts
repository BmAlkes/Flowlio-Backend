import { Request, Response } from "express";
import { connection } from "@/configs/connection.config";
import { requireOrganizationId } from "@/utils/organization.util";
import { logger } from "@/utils/logger.util";

export const reorderLeadFields = async (req: Request, res: Response): Promise<void> => {
  try {
    const organizationId = requireOrganizationId(req, res);
    if (!organizationId) return;

    const items: { id: string; position: number }[] = req.body;

    if (!Array.isArray(items) || items.length === 0) {
      res.status(400).json({ success: false, message: "Array of { id, position } required" });
      return;
    }

    await Promise.all(
      items.map(({ id, position }) =>
        connection.query({
          text: `
            UPDATE lead_field_definitions
            SET position = $1, updated_at = now()
            WHERE id = $2 AND org_id = $3
          `,
          values: [position, id, organizationId],
        }),
      ),
    );

    res.status(200).json({ success: true });
  } catch (error: any) {
    logger.error("Error reordering lead fields:", { message: error?.message });
    res.status(500).json({ success: false, message: "Internal server error" });
  }
};

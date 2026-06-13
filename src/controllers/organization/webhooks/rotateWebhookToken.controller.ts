import { Request, Response } from "express";
import { connection } from "@/configs/connection.config";
import { requireOrganizationId } from "@/utils/organization.util";
import { logger } from "@/utils/logger.util";
import { randomUUID } from "crypto";

export const rotateWebhookToken = async (req: Request, res: Response): Promise<void> => {
  try {
    const organizationId = requireOrganizationId(req, res);
    if (!organizationId) return;

    const { id } = req.params;
    const newToken = randomUUID();

    const result = await connection.query({
      text: `
        UPDATE lead_webhooks
        SET token = $1, updated_at = now()
        WHERE id = $2 AND org_id = $3
        RETURNING id, token
      `,
      values: [newToken, id, organizationId],
    });

    if (result.rows.length === 0) {
      res.status(404).json({ success: false, message: "Webhook not found" });
      return;
    }

    res.status(200).json({ success: true, token: result.rows[0].token });
  } catch (error: any) {
    logger.error("Error rotating webhook token:", { message: error?.message });
    res.status(500).json({ success: false, message: "Internal server error" });
  }
};

import { Request, Response } from "express";
import { connection } from "@/configs/connection.config";
import { requireOrganizationId } from "@/utils/organization.util";
import { logger } from "@/utils/logger.util";
import { randomUUID } from "crypto";

const TEST_PAYLOAD: Record<string, string> = {
  name: "Test Lead",
  email: `test-${Date.now()}@example.com`,
  phone: "+351 910 000 000",
  message: "This is a test submission",
};

function applyMapping(payload: Record<string, any>, mapping: Record<string, string>): Record<string, any> {
  const result: Record<string, any> = {};
  for (const [externalKey, leadField] of Object.entries(mapping)) {
    if (payload[externalKey] !== undefined) {
      result[leadField] = payload[externalKey];
    }
  }
  return result;
}

export const testWebhook = async (req: Request, res: Response): Promise<void> => {
  try {
    const organizationId = requireOrganizationId(req, res);
    if (!organizationId) return;

    const { id } = req.params;

    const webhookResult = await connection.query({
      text: `SELECT id, org_id, field_mapping, active FROM lead_webhooks WHERE id = $1 AND org_id = $2`,
      values: [id, organizationId],
    });

    if (webhookResult.rows.length === 0) {
      res.status(404).json({ success: false, message: "Webhook not found" });
      return;
    }

    const webhook = webhookResult.rows[0];
    const mapping: Record<string, string> = webhook.field_mapping ?? {};
    const payload: Record<string, string> = { ...TEST_PAYLOAD, email: `test-${Date.now()}@example.com` };
    const mapped = applyMapping(payload, mapping);

    const leadId = randomUUID();
    const leadName = (mapped.name as string) || (payload.name as string);
    const leadEmail = (mapped.email as string) || (payload.email as string);
    const logId = randomUUID();
    const now = new Date();

    let createdLeadId: string | null = null;
    let logStatus = "success";
    let logError: string | null = null;

    try {
      await connection.query({
        text: `
          INSERT INTO clients (id, organization_id, name, email, status, type, created_by, position, created_at, updated_at)
          VALUES ($1, $2, $3, $4, 'New Lead', 'lead', $5, 0, $6, $6)
        `,
        values: [leadId, organizationId, leadName, leadEmail, (req as any).user?.id, now],
      });
      createdLeadId = leadId;
    } catch (insertErr: any) {
      logStatus = "error";
      logError = "Failed to create test lead";
      logger.error("testWebhook insert failed:", insertErr?.message);
    }

    await connection.query({
      text: `
        INSERT INTO lead_webhook_logs (id, webhook_id, status, payload, lead_id, error, ip, created_at)
        VALUES ($1, $2, $3, $4::jsonb, $5, $6, $7, $8)
      `,
      values: [logId, id, logStatus, JSON.stringify(payload), createdLeadId, logError, req.ip ?? null, now],
    });

    res.status(200).json({
      success: logStatus === "success",
      leadId: createdLeadId,
      payload,
      mapped,
      message: logStatus === "success" ? "Test lead created" : logError,
    });
  } catch (error: any) {
    logger.error("Error testing webhook:", { message: error?.message });
    res.status(500).json({ success: false, message: "Internal server error" });
  }
};

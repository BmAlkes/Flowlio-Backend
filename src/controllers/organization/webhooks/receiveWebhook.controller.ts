import { Request, Response } from "express";
import { connection } from "@/configs/connection.config";
import { logger } from "@/utils/logger.util";
import { randomUUID } from "crypto";

function safeStringify(value: unknown): string | null {
  try {
    return JSON.stringify(value) ?? null;
  } catch {
    return null;
  }
}

function parseBody(rawBody: string): Record<string, any> {
  // Try JSON first
  try {
    const parsed = JSON.parse(rawBody);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed;
  } catch { /* not JSON */ }

  // Try application/x-www-form-urlencoded (WordPress Contact Form 7, Gravity Forms, etc.)
  try {
    const params = new URLSearchParams(rawBody);
    const obj: Record<string, any> = {};
    params.forEach((value, key) => { obj[key] = value; });
    if (Object.keys(obj).length > 0) return obj;
  } catch { /* not form-encoded */ }

  return {};
}

function applyMapping(
  payload: Record<string, any>,
  mapping: Record<string, string>,
): Record<string, any> {
  if (!mapping || Object.keys(mapping).length === 0) return payload;
  const result: Record<string, any> = {};
  for (const [externalKey, leadField] of Object.entries(mapping)) {
    if (payload[externalKey] !== undefined) {
      result[leadField] = payload[externalKey];
    }
  }
  return result;
}

export const receiveWebhook = async (req: Request, res: Response): Promise<void> => {
  const { token } = req.params;
  const ip = req.ip ?? req.socket?.remoteAddress ?? null;

  let webhookId: string | null = null;
  let orgId: string | null = null;
  let incomingPayload: Record<string, any> = {};
  let payloadJson: string | null = null;
  let leadId: string | null = null;
  let logStatus: "success" | "error" = "success";
  let logError: string | null = null;

  try {
    // Capture raw body string regardless of content type
    let rawBodyStr = "";
    if (Buffer.isBuffer(req.body)) {
      rawBodyStr = req.body.toString("utf8");
    } else if (typeof req.body === "string") {
      rawBodyStr = req.body;
    } else if (req.body && typeof req.body === "object") {
      // Already parsed by some middleware — use as-is
      incomingPayload = req.body as Record<string, any>;
      rawBodyStr = safeStringify(incomingPayload) ?? "";
    }

    // Parse raw body if not yet populated
    if (rawBodyStr && Object.keys(incomingPayload).length === 0) {
      incomingPayload = parseBody(rawBodyStr);
    }

    // Store payload JSON early so the finally block always has it,
    // even if subsequent code throws
    payloadJson = safeStringify(incomingPayload);

    // Look up webhook by token
    const webhookResult = await connection.query({
      text: `SELECT id, org_id, field_mapping, active FROM lead_webhooks WHERE token = $1`,
      values: [token],
    });

    if (webhookResult.rows.length === 0) {
      res.status(404).json({ success: false, error: "Webhook not found" });
      return;
    }

    const webhook = webhookResult.rows[0];
    webhookId = webhook.id;
    orgId = webhook.org_id;

    if (!webhook.active) {
      res.status(403).json({ success: false, error: "Webhook is disabled" });
      return;
    }

    const mapping: Record<string, string> = webhook.field_mapping ?? {};
    const mapped = applyMapping(incomingPayload, mapping);

    const leadName  = (mapped.name as string)  || (incomingPayload.name as string)  || "Lead sem nome";
    const leadEmail =
      (mapped.email as string) ||
      (incomingPayload.email as string) ||
      `lead-${randomUUID()}@noemail.invalid`;
    const leadPhone   = (mapped.phone as string)   || (incomingPayload.phone as string)   || null;
    const leadAddress = (mapped.address as string) || (incomingPayload.address as string) || null;

    const newLeadId = randomUUID();
    const now = new Date();

    await connection.query({
      text: `
        INSERT INTO clients (id, organization_id, name, email, phone, address, status, type, created_by, position, created_at, updated_at)
        SELECT $1, $2, $3, $4, $5, $6, 'New Lead', 'lead', u.id, 0, $7, $7
        FROM users u
        INNER JOIN user_organizations uo ON uo.user_id = u.id AND uo.organization_id = $2 AND uo.role = 'owner'
        LIMIT 1
      `,
      values: [newLeadId, orgId, leadName, leadEmail, leadPhone, leadAddress, now],
    });

    leadId = newLeadId;

    res.status(200).json({ success: true, leadId });
  } catch (error: any) {
    logStatus = "error";
    logError = "Failed to process webhook";
    logger.error("receiveWebhook error:", { message: error?.message, detail: error?.detail });
    if (!res.headersSent) {
      res.status(500).json({ success: false, error: "Internal server error" });
    }
  } finally {
    if (webhookId) {
      connection
        .query({
          text: `
            INSERT INTO lead_webhook_logs (id, webhook_id, status, payload, lead_id, error, ip, created_at)
            VALUES ($1, $2, $3, $4::jsonb, $5, $6, $7, now())
          `,
          values: [randomUUID(), webhookId, logStatus, payloadJson, leadId, logError, ip],
        })
        .catch((e) => logger.error("webhook log insert failed:", { message: e?.message, detail: e?.detail }));
    }
  }
};

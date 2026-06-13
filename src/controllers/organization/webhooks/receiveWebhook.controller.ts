import { Request, Response } from "express";
import { connection } from "@/configs/connection.config";
import { logger } from "@/utils/logger.util";
import { randomUUID } from "crypto";

function safeStringify(value: unknown): string | null {
  try {
    const s = JSON.stringify(value);
    return s ?? null;
  } catch {
    return null;
  }
}

function parseRawBody(rawBody: string): Record<string, any> {
  if (!rawBody) return {};

  // Try JSON first
  try {
    const parsed = JSON.parse(rawBody);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed;
  } catch { /* not JSON */ }

  // Try application/x-www-form-urlencoded (WordPress CF7, Gravity Forms, etc.)
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
  let webhookName: string | null = null;
  let orgId: string | null = null;
  let incomingPayload: Record<string, any> = {};
  // payloadJson is set immediately after parsing — before any DB calls —
  // so the finally block always has the correct value even if something throws later
  let payloadJson: string | null = null;
  let leadId: string | null = null;
  let logStatus: "success" | "error" = "success";
  let logError: string | null = null;

  try {
    // ── 1. Capture and parse the request body ──────────────────────────────
    // express.raw({ type: '*/*' }) at server.ts level converts the body to a
    // Buffer before this handler runs. We convert back to string then parse.
    if (Buffer.isBuffer(req.body)) {
      const rawStr = req.body.toString("utf8");
      incomingPayload = parseRawBody(rawStr);
    } else if (typeof req.body === "string") {
      incomingPayload = parseRawBody(req.body);
    } else if (req.body && typeof req.body === "object") {
      incomingPayload = req.body as Record<string, any>;
    }

    // Serialise immediately — never rely on incomingPayload being stable past this point
    payloadJson = safeStringify(incomingPayload) ?? "{}";

    logger.info("receiveWebhook: body parsed", {
      token,
      payloadKeys: Object.keys(incomingPayload),
      payloadJson,
    });

    // ── 2. Look up webhook ─────────────────────────────────────────────────
    const webhookResult = await connection.query({
      text: `SELECT id, org_id, name, field_mapping, active FROM lead_webhooks WHERE token = $1`,
      values: [token],
    });

    if (webhookResult.rows.length === 0) {
      res.status(404).json({ success: false, error: "Webhook not found" });
      return;
    }

    const webhook = webhookResult.rows[0];
    webhookId   = webhook.id as string;
    webhookName = webhook.name as string;
    orgId       = webhook.org_id as string;

    if (!webhook.active) {
      res.status(403).json({ success: false, error: "Webhook is disabled" });
      return;
    }

    // ── 3. Apply field mapping ─────────────────────────────────────────────
    const mapping: Record<string, string> = webhook.field_mapping ?? {};
    const mapped = applyMapping(incomingPayload, mapping);

    const leadName  = (mapped.name    as string) || (incomingPayload.name    as string) || "Lead sem nome";
    const leadEmail = (mapped.email   as string) || (incomingPayload.email   as string) || `lead-${randomUUID()}@noemail.invalid`;
    const leadPhone = (mapped.phone   as string) || (incomingPayload.phone   as string) || null;
    const leadAddr  = (mapped.address as string) || (incomingPayload.address as string) || null;

    // ── 4. Create the lead ─────────────────────────────────────────────────
    const newLeadId = randomUUID();
    const now = new Date();

    await connection.query({
      text: `
        INSERT INTO clients
          (id, organization_id, name, email, phone, address,
           status, type, webhook_id, webhook_name,
           created_by, position, created_at, updated_at)
        SELECT
          $1, $2, $3, $4, $5, $6,
          'New Lead', 'lead', $7, $8,
          u.id, 0, $9, $9
        FROM users u
        INNER JOIN user_organizations uo
          ON uo.user_id = u.id AND uo.organization_id = $2 AND uo.role = 'owner'
        LIMIT 1
      `,
      values: [newLeadId, orgId, leadName, leadEmail, leadPhone, leadAddr, webhookId, webhookName, now],
    });

    leadId = newLeadId;

    res.status(200).json({ success: true, leadId });

  } catch (error: any) {
    logStatus = "error";
    logError   = "Failed to process webhook";
    logger.error("receiveWebhook error:", { message: error?.message, detail: error?.detail });
    if (!res.headersSent) {
      res.status(500).json({ success: false, error: "Internal server error" });
    }
  } finally {
    // Always log — even on early returns (404/403) webhookId may be null, skip then
    if (webhookId) {
      connection
        .query({
          text: `
            INSERT INTO lead_webhook_logs
              (id, webhook_id, status, payload, lead_id, error, ip, created_at)
            VALUES ($1, $2, $3, $4::jsonb, $5, $6, $7, now())
          `,
          values: [randomUUID(), webhookId, logStatus, payloadJson, leadId, logError, ip],
        })
        .catch((e) =>
          logger.error("webhook log insert failed:", { message: e?.message, detail: e?.detail }),
        );
    }
  }
};

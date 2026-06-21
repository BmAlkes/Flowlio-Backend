import { Request, Response } from "express";
import { connection } from "@/configs/connection.config";
import { logger } from "@/utils/logger.util";
import { randomUUID } from "crypto";
import { applyRoutingRules } from "@/services/leadRouting.service";

// PostgreSQL error code for "column does not exist"
const PG_UNDEFINED_COLUMN = "42703";

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value) ?? "{}";
  } catch {
    return "{}";
  }
}

function parseRawBody(rawBody: string): Record<string, any> {
  if (!rawBody) return {};

  try {
    const parsed = JSON.parse(rawBody);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed;
  } catch { /* not JSON */ }

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
    if (payload[externalKey] !== undefined) result[leadField] = payload[externalKey];
  }
  return result;
}

async function findOrgUserId(orgId: string): Promise<string | null> {
  // Prefer owner → admin → any active member
  const res = await connection.query({
    text: `
      SELECT user_id
      FROM user_organizations
      WHERE organization_id = $1
      ORDER BY
        CASE WHEN role = 'owner' THEN 0
             WHEN role = 'admin' THEN 1
             ELSE 2
        END,
        id
      LIMIT 1
    `,
    values: [orgId],
  });
  return res.rows.length > 0 ? (res.rows[0].user_id as string) : null;
}

export const receiveWebhook = async (req: Request, res: Response): Promise<void> => {
  const { token } = req.params;
  const ip = req.ip ?? req.socket?.remoteAddress ?? null;

  let webhookId: string | null = null;
  let webhookName: string | null = null;
  let orgId: string | null = null;
  let incomingPayload: Record<string, any> = {};
  let payloadJson = "{}";
  let leadId: string | null = null;
  let logStatus: "success" | "error" | "merged" = "success";
  let logError: string | null = null;

  try {
    // ── 1. Parse body ──────────────────────────────────────────────────────
    if (Buffer.isBuffer(req.body)) {
      incomingPayload = parseRawBody(req.body.toString("utf8"));
    } else if (typeof req.body === "string") {
      incomingPayload = parseRawBody(req.body);
    } else if (req.body && typeof req.body === "object") {
      incomingPayload = req.body as Record<string, any>;
    }

    // Serialise immediately so finally always has the correct value
    payloadJson = safeStringify(incomingPayload);

    logger.info("receiveWebhook payload", { token, keys: Object.keys(incomingPayload) });

    // ── 2. Look up webhook ─────────────────────────────────────────────────
    const wh = await connection.query({
      text: `SELECT id, org_id, name, field_mapping, active FROM lead_webhooks WHERE token = $1`,
      values: [token],
    });

    if (wh.rows.length === 0) {
      res.status(404).json({ success: false, error: "Webhook not found" });
      return;
    }

    const webhook = wh.rows[0];
    webhookId   = webhook.id as string;
    webhookName = webhook.name as string;
    orgId       = webhook.org_id as string;

    if (!webhook.active) {
      res.status(403).json({ success: false, error: "Webhook is disabled" });
      return;
    }

    // ── 3. Map fields ──────────────────────────────────────────────────────
    const mapping: Record<string, string> = webhook.field_mapping ?? {};
    const mapped = applyMapping(incomingPayload, mapping);

    // Separate base fields from custom fields.
    // Mapped keys starting with "custom_" are custom field definitions:
    //   e.g. leadField = "custom_abc123" → customFields["abc123"] = value
    const customFields: Record<string, any> = {};
    for (const [leadField, value] of Object.entries(mapped)) {
      if (leadField.startsWith("custom_")) {
        const fieldId = leadField.slice(7); // strip "custom_"
        customFields[fieldId] = value;
      }
    }
    const hasCustomFields = Object.keys(customFields).length > 0;

    const leadName  = (mapped.name    as string) || (incomingPayload.name    as string) || "Lead sem nome";
    const leadEmail = (mapped.email   as string) || (incomingPayload.email   as string) || `lead-${randomUUID()}@noemail.invalid`;
    const leadPhone = (mapped.phone   as string) || (incomingPayload.phone   as string) || null;
    const leadAddr  = (mapped.address as string) || (incomingPayload.address as string) || null;

    // ── 4. Resolve created_by (prefer owner → admin → any member) ─────────
    const createdBy = await findOrgUserId(orgId);
    if (!createdBy) {
      throw new Error(`No member found for org ${orgId} — cannot create lead`);
    }

    const now = new Date();
    const customFieldsJson = hasCustomFields ? safeStringify(customFields) : null;

    // ── 5. Duplicate detection ────────────────────────────────────────────
    const isRealEmail = leadEmail && !leadEmail.includes("@noemail.invalid");

    if (isRealEmail) {
      const dup = await connection.query({
        text: `SELECT id, custom_fields FROM clients WHERE organization_id = $1 AND email = $2 AND type = 'lead' LIMIT 1`,
        values: [orgId, leadEmail],
      });

      if (dup.rows.length > 0) {
        const existing = dup.rows[0];
        leadId = existing.id as string;
        logStatus = "merged";

        // Merge custom fields (new overwrite existing)
        const mergedCf = { ...(existing.custom_fields ?? {}), ...customFields };
        await connection.query({
          text: `UPDATE clients SET custom_fields = $1::jsonb, last_interaction_at = $2, updated_at = $2 WHERE id = $3`,
          values: [safeStringify(mergedCf), now, leadId],
        });

        res.status(200).json({ success: true, action: "merged", leadId });
        return;
      }
    } else if (leadPhone) {
      const dup = await connection.query({
        text: `SELECT id, custom_fields FROM clients WHERE organization_id = $1 AND phone = $2 AND type = 'lead' LIMIT 1`,
        values: [orgId, leadPhone],
      });

      if (dup.rows.length > 0) {
        const existing = dup.rows[0];
        leadId = existing.id as string;
        logStatus = "merged";

        const mergedCf = { ...(existing.custom_fields ?? {}), ...customFields };
        await connection.query({
          text: `UPDATE clients SET custom_fields = $1::jsonb, last_interaction_at = $2, updated_at = $2 WHERE id = $3`,
          values: [safeStringify(mergedCf), now, leadId],
        });

        res.status(200).json({ success: true, action: "merged", leadId });
        return;
      }
    }

    // ── 6. INSERT lead ───────────────────────────────────────────────────
    const newLeadId = randomUUID();

    try {
      const result = await connection.query({
        text: `
          INSERT INTO clients
            (id, organization_id, name, email, phone, address,
             status, type, webhook_id, webhook_name,
             custom_fields, created_by, position, created_at, updated_at)
          VALUES ($1, $2, $3, $4, $5, $6,
                  'New Lead', 'lead', $7, $8,
                  $9::jsonb, $10, 0, $11, $11)
        `,
        values: [newLeadId, orgId, leadName, leadEmail, leadPhone, leadAddr,
                 webhookId, webhookName, customFieldsJson, createdBy, now],
      });

      if ((result.rowCount ?? 0) === 0) {
        throw new Error("INSERT returned rowCount 0 — lead not created");
      }
    } catch (insertErr: any) {
      if (insertErr?.code === PG_UNDEFINED_COLUMN) {
        logger.warn("receiveWebhook: webhook_id/webhook_name columns missing, inserting without source");
        const fallback = await connection.query({
          text: `
            INSERT INTO clients
              (id, organization_id, name, email, phone, address,
               status, type, custom_fields, created_by, position, created_at, updated_at)
            VALUES ($1, $2, $3, $4, $5, $6, 'New Lead', 'lead', $7::jsonb, $8, 0, $9, $9)
          `,
          values: [newLeadId, orgId, leadName, leadEmail, leadPhone, leadAddr,
                   customFieldsJson, createdBy, now],
        });
        if ((fallback.rowCount ?? 0) === 0) {
          throw new Error("Fallback INSERT returned rowCount 0 — lead not created");
        }
      } else {
        throw insertErr;
      }
    }

    leadId = newLeadId;

    // ── 7. Auto-routing rules ────────────────────────────────────────────
    applyRoutingRules(orgId, {
      id: newLeadId,
      name: leadName,
      email: leadEmail,
      phone: leadPhone,
      source: webhookName,
      webhookId,
      industry: null,
      customFields: hasCustomFields ? customFields : null,
    }).catch((err) => logger.error("Auto-routing error:", err));

    res.status(200).json({ success: true, action: "created", leadId });

  } catch (error: any) {
    logStatus = "error";
    logError   = "Failed to process webhook";
    logger.error("receiveWebhook error:", { message: error?.message, detail: error?.detail });
    if (!res.headersSent) {
      res.status(500).json({ success: false, error: "Internal server error" });
    }
  } finally {
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
        .catch((e) => logger.error("webhook log insert failed:", { message: e?.message }));
    }
  }
};

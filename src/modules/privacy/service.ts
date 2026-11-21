import { randomBytes, randomUUID } from "node:crypto";
import { readdir, stat, unlink } from "node:fs/promises";
import path from "node:path";
import type { Pool, PoolClient } from "pg";

// LGPD art. 18: confirmation, access and portability (export) and elimination/anonymization (deletion).
// Retention follows the Privacy Policy; access logs (IP + time in `session`) are kept 6 months
// as required by Marco Civil da Internet art. 15.

/** Keys that never leave the server, even in the user's own export. */
const SECRET_KEY = /(password|token|secret|code_hash|p256dh|^auth$|backup_codes|input_hash|apply_hash)/i;

function scrub(rows: Record<string, unknown>[]) {
  return rows.map(row => Object.fromEntries(Object.entries(row).filter(([key]) => !SECRET_KEY.test(key))));
}

type Query = { key: string; sql: string; by: "id" | "email" };
const EXPORT_QUERIES: Query[] = [
  { key: "profile", sql: "select * from users where id=$1", by: "id" },
  { key: "organizationMemberships", sql: "select uo.*, o.name organization_name from user_organizations uo left join organizations o on o.id=uo.organization_id where uo.user_id=$1", by: "id" },
  { key: "teamMemberRecords", sql: "select * from user_management where lower(email)=lower($1)", by: "email" },
  { key: "clientRecords", sql: "select * from clients where user_id=$1", by: "id" },
  { key: "connectedAccounts", sql: "select id, provider_id, scope, created_at, updated_at from account where user_id=$1", by: "id" },
  { key: "accessLogs", sql: "select created_at, expires_at, ip_address, user_agent from session where user_id=$1 order by created_at desc limit 500", by: "id" },
  { key: "timeEntries", sql: "select * from time_entries where user_id=$1 order by created_at desc", by: "id" },
  { key: "assignedTasks", sql: "select id, project_id, title, status, start_date, end_date, created_at from tasks where assigned_to=$1", by: "id" },
  { key: "calendarEvents", sql: "select * from calendar_events where user_id=$1", by: "id" },
  { key: "notifications", sql: "select * from notifications where user_id=$1 order by created_at desc limit 1000", by: "id" },
  { key: "assistantConversations", sql: "select id, conversation_id, input->>'prompt' prompt, result->>'answer' answer, state, created_at from ai_agent_runs where actor_id=$1 order by created_at desc", by: "id" },
  { key: "aiUsage", sql: "select feature, provider, model, status, created_at from ai_usage_logs where user_id=$1 order by created_at desc limit 1000", by: "id" },
  { key: "supportTickets", sql: "select * from support_tickets where submitted_by=$1", by: "id" },
  { key: "supportMessages", sql: "select * from support_ticket_messages where sender_id=$1", by: "id" },
  { key: "clientInteractions", sql: "select * from client_interactions where user_id=$1", by: "id" },
  { key: "projectComments", sql: "select * from project_comments where user_id=$1", by: "id" },
  { key: "whatsapp", sql: "select phone, language, verified_at, updated_at from whatsapp_links where user_id=$1", by: "id" },
  { key: "pushDevices", sql: "select id, created_at from push_subscriptions where user_id=$1", by: "id" },
  { key: "newsletter", sql: "select email, subscribed, subscribed_at, unsubscribed_at from newsletter_subscribers where lower(email)=lower($1)", by: "email" },
  { key: "activity", sql: "select type, action, resource, message, created_at from recent_activities where actor_id=$1 order by created_at desc limit 1000", by: "id" },
  { key: "privacyRequests", sql: "select id, type, status, requested_at, completed_at from privacy_requests where user_id=$1", by: "id" },
];

export async function exportUserData(pool: Pool, user: { id: string; email: string }) {
  const data: Record<string, unknown> = {};
  for (const query of EXPORT_QUERIES) {
    try {
      const result = await pool.query(query.sql, [query.by === "id" ? user.id : user.email]);
      data[query.key] = scrub(result.rows);
    } catch {
      // A table missing in an older database must not block the whole export.
      data[query.key] = [];
    }
  }
  await recordRequest(pool, { userId: user.id, type: "export", status: "completed" });
  return {
    generatedAt: new Date().toISOString(),
    controller: "Flowlio",
    legalBasis: "LGPD (Lei 13.709/2018), art. 18, II and V",
    note: "Records your organization keeps about you as its client or lead are controlled by that organization; ask it directly for changes.",
    data,
  };
}

async function recordRequest(db: Pool | PoolClient, request: { userId: string; organizationId?: string | null; type: "export" | "deletion"; status: "pending" | "completed"; details?: unknown }) {
  await db.query(
    "insert into privacy_requests (id, user_id, organization_id, type, status, details, completed_at) values ($1,$2,$3,$4,$5,$6, case when $5='completed' then now() end)",
    [randomUUID(), request.userId, request.organizationId ?? null, request.type, request.status, request.details ? JSON.stringify(request.details) : null],
  );
}

export class PrivacyError extends Error {
  constructor(public code: string, message: string, public status = 400) { super(message); }
}

/**
 * Account deletion. Members, managers and portal clients are anonymized at once: personal data is
 * removed but the rows other people's work points to (tasks, projects, invoices) stay intact, since a
 * hard delete would cascade into the organization's projects. Organization owners get a pending
 * request instead, because their deletion ends the organization and its data.
 */
export async function requestAccountDeletion(pool: Pool, user: { id: string; organizationId?: string | null; isOrganizationOwner?: boolean; isSuperAdmin?: boolean }) {
  if (user.isSuperAdmin) throw new PrivacyError("SUPER_ADMIN", "Super admin accounts cannot be deleted from here.", 403);
  if (user.isOrganizationOwner) {
    const existing = await pool.query("select id from privacy_requests where user_id=$1 and type='deletion' and status='pending' limit 1", [user.id]);
    if (!existing.rowCount) await recordRequest(pool, { userId: user.id, organizationId: user.organizationId, type: "deletion", status: "pending", details: { reason: "organization_owner" } });
    return { status: "pending" as const };
  }
  await anonymizeUser(pool, user.id);
  await recordRequest(pool, { userId: user.id, organizationId: user.organizationId, type: "deletion", status: "completed" });
  return { status: "completed" as const };
}

export async function anonymizeUser(pool: Pool, userId: string) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const found = await client.query<{ email: string }>("select email from users where id=$1 for update", [userId]);
    if (!found.rowCount) throw new PrivacyError("NOT_FOUND", "User not found", 404);
    const email = found.rows[0].email;
    const placeholder = `deleted-${userId}@deleted.flowlio.invalid`;
    await client.query(
      `update users set name='Usuário removido', email=$2, email_verified=false, image=null, phone=null, address=null,
        billing_email=null, position=null, pending_organization_data=null, two_factor_enabled=false, status='inactive',
        banned=true, ban_reason='account_deleted', deleted_at=now(), updated_at=now() where id=$1`,
      [userId, placeholder],
    );
    await client.query(
      `update user_management set firstname='Usuário', lastname='removido', email=$2, phonenumber='', password=$3, status='inactive'
        where lower(email)=lower($1)`,
      [email, placeholder, randomBytes(32).toString("hex")],
    );
    await client.query("update user_organizations set status='inactive' where user_id=$1", [userId]);
    await client.query("update clients set user_id=null, portal_access_enabled=false where user_id=$1", [userId]);
    // Credentials, OAuth tokens and devices go; access logs stay until the 6-month retention ends.
    for (const table of ["account", "two_factor", "push_subscriptions", "whatsapp_links", "google_calendar_sync_state", "notifications", "user_onboarding", "onboarding_progress", "ai_agent_runs"]) {
      const column = table === "ai_agent_runs" ? "actor_id" : "user_id";
      await client.query(`delete from ${table} where ${column}=$1`, [userId]);
    }
    await client.query("update session set token=$2 || id, expires_at=now() where user_id=$1", [userId, "revoked-" + randomBytes(16).toString("hex") + "-"]);
    await client.query("update newsletter_subscribers set subscribed=false, unsubscribed_at=coalesce(unsubscribed_at, now()) where lower(email)=lower($1)", [email]);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

/** Retention periods published in the Privacy Policy. Each step is independent so one failure does not stop the rest. */
export const RETENTION = [
  { name: "expired-sessions", sql: "delete from session where expires_at < now() - interval '6 months'" },
  { name: "expired-verifications", sql: "delete from verification where expires_at < now() - interval '1 day'" },
  { name: "assistant-conversations", sql: "delete from ai_agent_runs where created_at < now() - interval '180 days'" },
  { name: "webhook-payloads", sql: "delete from lead_webhook_logs where created_at < now() - interval '90 days' and status not in ('pending_retry')" },
  { name: "notifications", sql: "delete from notifications where created_at < now() - interval '12 months'" },
  { name: "audit-network-data", sql: "update audit_logs set ip_address=null, user_agent=null where created_at < now() - interval '12 months' and (ip_address is not null or user_agent is not null)" },
  { name: "blog-view-data", sql: "delete from blog_post_views where created_at < now() - interval '12 months'" },
];

export async function pruneRetention(pool: Pool, log: (step: string, error: unknown) => void = () => undefined) {
  for (const step of RETENTION) {
    await pool.query(step.sql).catch(error => log(step.name, error));
  }
  await pruneUploads().catch(error => log("assistant-uploads", error));
}

/** Files sent to the AI assistant are only needed while a request runs; leftovers older than a day are removed. */
async function pruneUploads(folder = path.join(process.cwd(), "uploads")) {
  const cutoff = Date.now() - 24 * 3600 * 1000;
  let names: string[];
  try { names = await readdir(folder); } catch { return; }
  for (const name of names) {
    const file = path.join(folder, name);
    const info = await stat(file).catch(() => null);
    if (info?.isFile() && info.mtimeMs < cutoff) await unlink(file).catch(() => undefined);
  }
}

import crypto from "crypto";
import type { Pool } from "pg";

/**
 * Self-serve start for new accounts: a free plan or a no-card trial of a paid plan. Both create the
 * organization, the owner membership and the subscription in one transaction, so a signup is never left
 * half done. Paid plans without a trial still go through PayPal.
 */
export type StartMode = "free" | "trial";

export class SignupFlowError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message);
  }
}

export interface StartInput {
  userId: string;
  planId: string;
  mode: StartMode;
  organizationName?: string | null;
  country?: string | null;
  now?: Date;
}

export interface StartResult {
  organizationId: string;
  organizationName: string;
  planId: string;
  planName: string;
  mode: StartMode;
  periodEnd: string;
  trialEndsAt: string | null;
}

const newId = () => crypto.randomUUID().replace(/-/g, "");
const DAY = 86_400_000;

/** End of the first billing period of a free plan. */
export function periodEnd(plan: { duration_type?: string | null; duration_value?: number | null }, now: Date) {
  const value = Number(plan.duration_value) > 0 ? Number(plan.duration_value) : 1;
  const type = String(plan.duration_type || "monthly").toLowerCase();
  if (type === "days") return new Date(now.getTime() + value * DAY);
  if (type === "yearly" || type === "year") return new Date(Date.UTC(now.getUTCFullYear() + value, now.getUTCMonth(), now.getUTCDate(), now.getUTCHours(), now.getUTCMinutes()));
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + value, now.getUTCDate(), now.getUTCHours(), now.getUTCMinutes()));
}

/** Interface language for a new organization, from its country. */
export function languageFor(country?: string | null) {
  const code = String(country || "").toUpperCase();
  if (["BR", "PT", "AO", "MZ"].includes(code)) return "pt";
  if (code === "IL") return "he";
  if (["ES", "MX", "AR", "CO", "CL", "PE", "UY", "PY", "BO", "EC", "VE"].includes(code)) return "es";
  return "en";
}

export function organizationSlug(name: string, userId: string) {
  const base = name.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "").slice(0, 60) || "org";
  return `${base}-${userId.slice(0, 8)}-${crypto.randomBytes(2).toString("hex")}`;
}

export async function startOrganization(pool: Pool, input: StartInput): Promise<StartResult> {
  const now = input.now ?? new Date();
  const client = await pool.connect();
  try {
    await client.query("begin");
    const user = (await client.query("select id, email, name from users where id = $1 and deleted_at is null for update", [input.userId])).rows[0];
    if (!user) throw new SignupFlowError(404, "USER_NOT_FOUND", "User not found");
    const hasOrganization = (await client.query("select 1 from user_organizations where user_id = $1 limit 1", [input.userId])).rowCount;
    if (hasOrganization) throw new SignupFlowError(409, "ALREADY_HAS_ORGANIZATION", "This account already has an organization");

    const plan = (await client.query(
      "select id, name, price, trial_days, duration_type, duration_value, features from subscription_plans where id = $1 and is_active = true",
      [input.planId],
    )).rows[0];
    if (!plan) throw new SignupFlowError(404, "PLAN_NOT_FOUND", "Plan not found or inactive");
    const price = Number(plan.price);
    const trialDays = Number(plan.trial_days) || 0;
    if (input.mode === "free" && price > 0) throw new SignupFlowError(400, "PLAN_REQUIRES_PAYMENT", "This plan requires payment");
    if (input.mode === "trial" && (price <= 0 || trialDays <= 0)) throw new SignupFlowError(400, "PLAN_HAS_NO_TRIAL", "This plan has no free trial");

    const trialEndsAt = input.mode === "trial" ? new Date(now.getTime() + trialDays * DAY) : null;
    const end = trialEndsAt ?? periodEnd(plan, now);
    const name = String(input.organizationName ?? "").trim().slice(0, 120) || `${String(user.email).split("@")[0]}'s Organization`;
    const country = input.country ? String(input.country).toUpperCase().slice(0, 2) : null;
    const features = plan.features ?? {};
    const organizationId = newId();
    const settings = { timezone: "UTC", dateFormat: "MM/DD/YYYY", language: languageFor(country), notifications: { email: true, push: false, sms: false } };

    await client.query(
      `insert into organizations (id, name, slug, description, country, status, subscription_plan_id, subscription_status,
         subscription_start_date, subscription_end_date, trial_ends_at, max_users, max_projects, max_storage, settings, created_at, updated_at)
       values ($1, $2, $3, $4, $5, 'active', $6, $7, $8, $9, $10, $11, $12, $13, $14::json, $8, $8)`,
      [organizationId, name, organizationSlug(name, input.userId), `${name} organization`, country, plan.id, trialEndsAt ? "trialing" : "active",
        now, end, trialEndsAt, features.maxUsers ?? 5, features.maxProjects ?? 3, features.maxStorage ?? 1, JSON.stringify(settings)],
    );
    await client.query(
      `insert into user_organizations (id, user_id, organization_id, role, status, permissions, joined_at, created_at, updated_at)
       values ($1, $2, $3, 'owner', 'active', $4::json, $5, $5, $5)`,
      [newId(), input.userId, organizationId, JSON.stringify({ canManageUsers: true, canManageProjects: true, canManageBilling: true, canViewAnalytics: true, canInviteUsers: true }), now],
    );
    await client.query(
      `insert into subscriptions (id, organization_id, plan_id, status, current_period_start, current_period_end, cancel_at_period_end,
         trial_start, trial_end, metadata, created_at, updated_at)
       values ($1, $2, $3, 'active', $4, $5, false, $6, $7, $8::json, $4, $4)`,
      [newId(), organizationId, plan.id, now, end, trialEndsAt ? now : null, trialEndsAt,
        JSON.stringify({ createdBy: input.userId, startedBy: input.mode === "trial" ? "self_serve_trial" : "free_plan" })],
    );
    await client.query(
      "update users set status = 'active', role = 'user', is_organization_owner = true, selected_plan_id = null, pending_organization_data = null, updated_at = $2 where id = $1",
      [input.userId, now],
    );
    await client.query("commit");
    return { organizationId, organizationName: name, planId: plan.id, planName: plan.name, mode: input.mode, periodEnd: end.toISOString(), trialEndsAt: trialEndsAt?.toISOString() ?? null };
  } catch (error) {
    await client.query("rollback").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

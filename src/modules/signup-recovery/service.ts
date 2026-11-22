import crypto from "crypto";
import type { Pool } from "pg";

/**
 * Unfinished signups: people who created an account but never got an organization, either because they
 * never picked a plan ("no_plan") or because they stopped at checkout ("checkout"). A super admin can send
 * them a short follow-up asking what stopped them; the answer is one click and is recorded here.
 */
export type SignupStage = "no_plan" | "checkout";
export const REASONS = ["price", "missing_feature", "too_complex", "payment_problem", "just_exploring", "other"] as const;
export type SignupReason = (typeof REASONS)[number];

export const MAX_REMINDERS = 2;
export const MIN_DAYS_BETWEEN = 7;
export const MIN_ACCOUNT_AGE_HOURS = 24;
export const MAX_PER_REQUEST = 100;

export interface PendingSignup {
  id: string;
  name: string;
  email: string;
  emailVerified: boolean;
  createdAt: string;
  daysSinceSignup: number;
  stage: SignupStage;
  planName: string | null;
  planPrice: string | null;
  organizationName: string | null;
  lastSeenAt: string | null;
  reminders: number;
  lastReminderAt: string | null;
  reason: SignupReason | null;
  answeredAt: string | null;
  optedOut: boolean;
  /** Why no reminder can be sent now; null when one can. */
  blockedBy: "opted_out" | "answered" | "max_reminders" | "recent_reminder" | "too_new" | null;
}

const PENDING_SQL = `
  select u.id, u.name, u.email, u.email_verified, u.created_at,
    u.selected_plan_id, u.pending_organization_data::jsonb ->> 'planId' pending_plan_id,
    u.pending_organization_data::jsonb ->> 'organizationName' organization_name,
    (u.pending_organization_data is not null) has_org_data,
    p.name plan_name, p.price::text plan_price, s.last_seen_at,
    coalesce(f.reminders, 0)::int reminders, f.last_sent_at, f.reason, f.answered_at, coalesce(f.opted_out, false) opted_out
  from users u
  left join subscription_plans p on p.id = coalesce(u.selected_plan_id, u.pending_organization_data::jsonb ->> 'planId')
  left join lateral (select max(updated_at) last_seen_at from session where user_id = u.id) s on true
  left join lateral (
    select count(*) reminders, max(sent_at) last_sent_at, max(answered_at) answered_at,
      (array_agg(reason order by answered_at desc nulls last))[1] reason, bool_or(opted_out_at is not null) opted_out
    from signup_followups where user_id = u.id
  ) f on true
  where u.is_super_admin = false and (u.status = 'pending' or u.status is null)
    and u.deleted_at is null and u.banned = false and u.subadmin_id is null and coalesce(u.role, 'user') <> 'client'
    and not exists (select 1 from user_organizations uo where uo.user_id = u.id)
    %FILTER%
  order by u.created_at desc`;

type Row = Record<string, any>;
const iso = (value: unknown) => (value == null ? null : new Date(value as string).toISOString());

export function blockedBy(row: { optedOut: boolean; reason: string | null; reminders: number; lastReminderAt: string | null; createdAt: string }, now = Date.now()): PendingSignup["blockedBy"] {
  if (row.optedOut) return "opted_out";
  if (row.reason) return "answered";
  if (row.reminders >= MAX_REMINDERS) return "max_reminders";
  if (row.lastReminderAt && now - new Date(row.lastReminderAt).getTime() < MIN_DAYS_BETWEEN * 86400000) return "recent_reminder";
  if (now - new Date(row.createdAt).getTime() < MIN_ACCOUNT_AGE_HOURS * 3600000) return "too_new";
  return null;
}

function toSignup(row: Row, now: number): PendingSignup {
  const createdAt = iso(row.created_at)!;
  const base = {
    id: row.id, name: row.name, email: row.email, emailVerified: !!row.email_verified, createdAt,
    daysSinceSignup: Math.floor((now - new Date(createdAt).getTime()) / 86400000),
    stage: (row.selected_plan_id || row.pending_plan_id || row.has_org_data ? "checkout" : "no_plan") as SignupStage,
    planName: row.plan_name ?? null, planPrice: row.plan_price ?? null, organizationName: row.organization_name ?? null,
    lastSeenAt: iso(row.last_seen_at), reminders: Number(row.reminders) || 0, lastReminderAt: iso(row.last_sent_at),
    reason: (REASONS as readonly string[]).includes(row.reason) ? row.reason : null, answeredAt: iso(row.answered_at), optedOut: !!row.opted_out,
  };
  return { ...base, blockedBy: blockedBy(base, now) };
}

export async function listPendingSignups(pool: Pool, userIds?: string[], now = Date.now()): Promise<PendingSignup[]> {
  const sql = PENDING_SQL.replace("%FILTER%", userIds ? "and u.id = any($1::text[])" : "");
  const { rows } = await pool.query(sql, userIds ? [userIds] : []);
  return rows.map(row => toSignup(row, now));
}

export function summarize(signups: PendingSignup[]) {
  const reasons = Object.fromEntries(REASONS.map(reason => [reason, 0])) as Record<SignupReason, number>;
  for (const signup of signups) if (signup.reason) reasons[signup.reason] += 1;
  return {
    total: signups.length,
    noPlan: signups.filter(s => s.stage === "no_plan").length,
    checkout: signups.filter(s => s.stage === "checkout").length,
    canRemind: signups.filter(s => !s.blockedBy).length,
    reminded: signups.filter(s => s.reminders > 0).length,
    answered: signups.filter(s => s.reason).length,
    optedOut: signups.filter(s => s.optedOut).length,
    reasons,
  };
}

// One-click answer links: the follow-up id signed with the server secret, so nobody can answer for someone else.
export function answerToken(followupId: string, secret: string) {
  return crypto.createHmac("sha256", secret).update("signup-followup:" + followupId).digest("base64url").slice(0, 32);
}

export function validToken(followupId: string, token: unknown, secret: string) {
  if (typeof token !== "string" || token.length !== 32) return false;
  return crypto.timingSafeEqual(Buffer.from(token), Buffer.from(answerToken(followupId, secret)));
}

export type SendFollowup = (signup: PendingSignup, followupId: string) => Promise<void>;

/** Sends one follow-up per eligible person and records it only after the email provider accepted it. */
export async function sendFollowups(pool: Pool, userIds: string[], actorId: string | null, send: SendFollowup) {
  const ids = [...new Set(userIds)].slice(0, MAX_PER_REQUEST);
  const signups = await listPendingSignups(pool, ids);
  const found = new Set(signups.map(s => s.id));
  const skipped: { id: string; reason: string }[] = ids.filter(id => !found.has(id)).map(id => ({ id, reason: "not_pending" }));
  let sent = 0;
  for (const signup of signups) {
    if (signup.blockedBy) {
      skipped.push({ id: signup.id, reason: signup.blockedBy });
      continue;
    }
    const followupId = crypto.randomUUID();
    try {
      await send(signup, followupId);
    } catch {
      skipped.push({ id: signup.id, reason: "email_failed" });
      continue;
    }
    await pool.query("insert into signup_followups(id, user_id, stage, sent_by) values ($1, $2, $3, $4)", [followupId, signup.id, signup.stage, actorId]);
    sent += 1;
  }
  return { sent, skipped };
}

/** Records a one-click answer ("unsubscribe" stops further follow-ups). Returns false for unknown links. */
export async function recordAnswer(pool: Pool, followupId: string, answer: string) {
  if (answer === "unsubscribe") {
    const { rowCount } = await pool.query("update signup_followups set opted_out_at = coalesce(opted_out_at, now()) where id = $1", [followupId]);
    return (rowCount ?? 0) > 0;
  }
  if (!(REASONS as readonly string[]).includes(answer)) return false;
  const { rowCount } = await pool.query("update signup_followups set reason = $2, answered_at = now() where id = $1", [followupId, answer]);
  return (rowCount ?? 0) > 0;
}

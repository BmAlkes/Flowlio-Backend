import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import { anonymizeUser } from "@/modules/privacy/service";
import { collectOrganization, loadGraph, quote, withUserTriggersDisabled } from "./graph";

/**
 * Closing an organization (Terms of Service / LGPD): after 90 days without an active subscription its data is
 * deleted, with a warning email to the owners at day 75. Day 0 is the first time the worker saw the organization
 * inactive, so nothing is ever deleted sooner than 90 days after this code is deployed.
 */
export const INACTIVE_SQL = `(o.subscription_status in ('cancelled','expired')
  or (o.trial_ends_at < now() and coalesce(o.subscription_status,'') not in ('active','trialing')))
  and coalesce(o.settings->>'demo','false') <> 'true'`;
export const WARN_AFTER_DAYS = 75;
export const DELETE_AFTER_DAYS = 90;

export async function trackInactiveOrganizations(pool: Pool) {
  const started = await pool.query(`update organizations o set inactive_since=now() where o.inactive_since is null and ${INACTIVE_SQL}`);
  const ended = await pool.query(`update organizations o set inactive_since=null, deletion_warning_sent_at=null where o.inactive_since is not null and not (${INACTIVE_SQL})`);
  return { started: started.rowCount ?? 0, reactivated: ended.rowCount ?? 0 };
}

export async function organizationsPendingDeletion(pool: Pool) {
  return (await pool.query<{ id: string; name: string; inactive_since: string; deletion_warning_sent_at: string | null; deletes_at: string }>(
    `select o.id, o.name, o.inactive_since, o.deletion_warning_sent_at, o.inactive_since + interval '${DELETE_AFTER_DAYS} days' deletes_at
     from organizations o where o.inactive_since is not null order by o.inactive_since`,
  )).rows;
}

/**
 * Deletes every row of the organization (parents after children), the organization itself, its backups
 * (cascade) and anonymizes people who belonged only to it. Uploaded assets are removed afterwards, best effort.
 */
export async function deleteOrganizationCompletely(pool: Pool, organizationId: string, reason: string, removeAsset: (publicId: string) => Promise<void> = async () => undefined) {
  const client = await pool.connect();
  let people: string[] = [];
  let assets: string[] = [];
  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL lock_timeout = '15s'");
    const graph = await loadGraph(client);
    const scopes = await collectOrganization(client, organizationId, graph);
    if (scopes.some(scope => scope.truncated)) throw new Error("Organization too large to delete in one pass");
    people = (await client.query<{ id: string }>(
      `select user_id id from user_organizations where organization_id=$1
       union select user_id from clients where organization_id=$1 and user_id is not null`, [organizationId],
    )).rows.map(row => row.id);
    assets = scopes.flatMap(scope => scope.rows.flatMap(row => Object.entries(row)
      .filter(([key, value]) => /public_id$/i.test(key) && typeof value === "string" && value).map(([, value]) => value as string)));
    await withUserTriggersDisabled(client, scopes.map(scope => scope.table), async () => {
      for (const scope of [...scopes].reverse()) {
        if (scope.where !== "false") await client.query(`delete from ${quote(scope.table)} where ${scope.where}`, scope.params);
      }
    });
    await client.query("delete from operational_events where organization_id=$1", [organizationId]).catch(() => undefined);
    await client.query("delete from organizations where id=$1", [organizationId]);
    await client.query(
      "insert into privacy_requests (id, user_id, organization_id, type, status, details, completed_at) values ($1,null,$2,'deletion','completed',$3,now())",
      [randomUUID(), organizationId, JSON.stringify({ scope: "organization", reason })],
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
  // People who still belong to another organization, and super admins, keep their accounts.
  for (const userId of people) {
    const keep = await pool.query("select 1 from users u where u.id=$1 and (u.is_super_admin or u.deleted_at is not null or exists (select 1 from user_organizations uo where uo.user_id=u.id) or exists (select 1 from clients c where c.user_id=u.id))", [userId]);
    if (!keep.rowCount) await anonymizeUser(pool, userId).catch(() => undefined);
  }
  for (const publicId of assets) await removeAsset(publicId).catch(() => undefined);
  return { people: people.length, assets: assets.length };
}

type Owner = { organization_id: string; organization_name: string; email: string; name: string };

/** Warns owners at day 75 and deletes at day 90. Does nothing unless explicitly enabled. */
export async function runAutoDeletion(pool: Pool, options: {
  enabled: boolean;
  warn: (owner: Owner, deletesAt: string) => Promise<void>;
  removeAsset?: (publicId: string) => Promise<void>;
  log?: (organizationId: string, error: unknown) => void;
}) {
  if (!options.enabled) return { warned: 0, deleted: 0 };
  let warned = 0;
  let deleted = 0;
  const toWarn = await pool.query<Owner & { deletes_at: string }>(
    `select o.id organization_id, o.name organization_name, u.email, u.name, o.inactive_since + interval '${DELETE_AFTER_DAYS} days' deletes_at
     from organizations o join user_organizations uo on uo.organization_id=o.id join users u on u.id=uo.user_id
     where o.inactive_since < now() - interval '${WARN_AFTER_DAYS} days' and o.deletion_warning_sent_at is null
       and (uo.role='owner' or u.is_organization_owner) and u.deleted_at is null`,
  );
  const warnedOrganizations = new Set<string>();
  for (const owner of toWarn.rows) {
    try { await options.warn(owner, owner.deletes_at); warnedOrganizations.add(owner.organization_id); } catch (error) { options.log?.(owner.organization_id, error); }
  }
  for (const id of warnedOrganizations) {
    await pool.query("update organizations set deletion_warning_sent_at=now() where id=$1", [id]);
    warned++;
  }
  // At least 14 days between the warning and the deletion, even if the warning went out late.
  const due = await pool.query<{ id: string }>(
    `select o.id from organizations o where o.inactive_since < now() - interval '${DELETE_AFTER_DAYS} days'
       and o.deletion_warning_sent_at < now() - interval '14 days' and ${INACTIVE_SQL}`,
  );
  for (const { id } of due.rows) {
    try { await deleteOrganizationCompletely(pool, id, "inactive_90_days", options.removeAsset); deleted++; } catch (error) { options.log?.(id, error); }
  }
  return { warned, deleted };
}

import type { Pool, PoolClient } from "pg";
import { createBackup, loadBackup, BackupError, schemaVersion } from "./backup";
import { collectOrganization, loadGraph, organizationTables, quote, withUserTriggersDisabled, type Graph, type Row } from "./graph";

/**
 * Restores ONE organization's business data from one of its backups. Nothing outside that organization is read
 * or written. Left untouched on purpose:
 *  - team access (memberships, invitations, team records): a removed member must not get access back;
 *  - billing with Flowlio, AI usage and audit/activity history: they record what really happened.
 * Every restore first saves a "pre_restore" backup, so it can itself be undone. With dryRun the whole restore
 * runs and is rolled back, reporting what would change.
 */
export const RESTORE_SKIP = new Set([
  "user_organizations", "user_management", "invitations", "subadmin",
  "subscriptions", "plan_payment_requests", "ai_token_limits", "ai_usage_logs", "ai_usage_alerts",
  "audit_logs", "business_audit_events", "recent_activities",
]);
const MAX_PARAMS = 60000;

export type RestoreReport = {
  dryRun: boolean;
  backupId: string;
  preRestoreBackupId: string | null;
  backupSchemaVersion: number;
  currentSchemaVersion: number;
  tables: { table: string; before: number; after: number }[];
  warnings: string[];
};

/** Rows of a self-referencing table (subtasks) ordered so a parent is inserted before its children. */
export function parentsFirst(rows: Row[], selfColumns: string[], key = "id") {
  if (!selfColumns.length) return rows;
  const ids = new Set(rows.map(row => String(row[key])));
  const placed = new Set<string>();
  const ordered: Row[] = [];
  let pending = rows;
  while (pending.length) {
    const next: Row[] = [];
    for (const row of pending) {
      const waiting = selfColumns.some(column => row[column] != null && ids.has(String(row[column])) && !placed.has(String(row[column])));
      if (waiting) next.push(row); else { ordered.push(row); placed.add(String(row[key])); }
    }
    if (next.length === pending.length) { ordered.push(...next); break; } // cycle: let the database decide
    pending = next;
  }
  return ordered;
}

function toParam(value: unknown, type: string) {
  if (value == null) return null;
  if (type === "json" || type === "jsonb") return JSON.stringify(value);
  return value;
}

async function insertRows(client: PoolClient, graph: Graph, table: string, rows: Row[], warnings: string[]) {
  if (!rows.length) return;
  const columns = graph.tables.get(table)!;
  const known = new Map(columns.map(column => [column.name, column.type]));
  const names = [...new Set(rows.flatMap(row => Object.keys(row)))];
  const dropped = names.filter(name => !known.has(name));
  if (dropped.length) warnings.push(`${table}: columns no longer exist and were ignored (${dropped.join(", ")})`);
  const used = names.filter(name => known.has(name));
  const selfColumns = graph.foreignKeys.filter(fk => fk.child === table && fk.parent === table).map(fk => fk.column);
  const ordered = parentsFirst(rows, selfColumns);
  const chunk = Math.max(1, Math.floor(MAX_PARAMS / used.length));
  for (let start = 0; start < ordered.length; start += chunk) {
    const part = ordered.slice(start, start + chunk);
    const params: unknown[] = [];
    const tuples = part.map(row => "(" + used.map(name => { params.push(toParam(row[name], known.get(name)!)); return "$" + params.length; }).join(",") + ")");
    await client.query(`insert into ${quote(table)} (${used.map(quote).join(",")}) values ${tuples.join(",")}`, params);
  }
}

export async function restoreOrganization(pool: Pool, input: { organizationId: string; backupId: string; dryRun: boolean; actorId: string | null }): Promise<RestoreReport> {
  const { meta, payload } = await loadBackup(pool, input.backupId);
  if (meta.organization_id !== input.organizationId) throw new BackupError("WRONG_ORGANIZATION", "This backup belongs to another organization", 409);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL lock_timeout = '15s'");
    await client.query("SET LOCAL statement_timeout = '300s'");
    const graph = await loadGraph(client);
    const ordered = organizationTables(graph).filter(({ table }) => !RESTORE_SKIP.has(table));
    const scope = new Set(ordered.map(({ table }) => table));
    const warnings: string[] = [];

    // Never trust a snapshot to stay inside its organization.
    for (const { table, root } of ordered) {
      if (!root) continue;
      for (const row of payload.tables[table] ?? []) {
        if (row.organization_id !== input.organizationId) throw new BackupError("INVALID_BACKUP", `${table} has rows of another organization`);
      }
    }
    for (const table of Object.keys(payload.tables)) {
      if (!scope.has(table) && !RESTORE_SKIP.has(table)) warnings.push(`${table}: table no longer exists and was ignored`);
    }
    for (const { table } of ordered) {
      if (!(table in payload.tables)) warnings.push(`${table}: not in this backup (newer table); its current rows will be removed`);
    }
    const backupVersion = payload.schemaVersion;
    const currentVersion = await schemaVersion(client);
    if (backupVersion !== currentVersion) warnings.push(`Backup was taken at schema version ${backupVersion}; the database is at ${currentVersion}`);

    const preRestore = input.dryRun ? null : await createBackup(client, input.organizationId, "pre_restore", input.actorId);
    const current = (await collectOrganization(client, input.organizationId, graph)).filter(entry => scope.has(entry.table));
    const before = new Map(current.map(entry => [entry.table, entry.rows.length]));

    await withUserTriggersDisabled(client, [...scope], async () => {
      for (const entry of [...current].reverse()) {
        if (entry.where !== "false") await client.query(`delete from ${quote(entry.table)} where ${entry.where}`, entry.params);
      }
      for (const { table } of ordered) await insertRows(client, graph, table, payload.tables[table] ?? [], warnings);
    });

    const after = (await collectOrganization(client, input.organizationId, graph)).filter(entry => scope.has(entry.table));
    const report: RestoreReport = {
      dryRun: input.dryRun,
      backupId: input.backupId,
      preRestoreBackupId: preRestore?.id ?? null,
      backupSchemaVersion: backupVersion,
      currentSchemaVersion: currentVersion,
      tables: after.map(entry => ({ table: entry.table, before: before.get(entry.table) ?? 0, after: entry.rows.length }))
        .filter(entry => entry.before || entry.after),
      warnings,
    };
    for (const { table } of ordered) {
      const expected = (payload.tables[table] ?? []).length;
      const restored = after.find(entry => entry.table === table)?.rows.length ?? 0;
      if (expected !== restored) throw new BackupError("RESTORE_MISMATCH", `${table}: expected ${expected} rows, found ${restored}`, 500);
    }
    await client.query(input.dryRun ? "ROLLBACK" : "COMMIT");
    return report;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

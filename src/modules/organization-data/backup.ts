import { randomUUID } from "node:crypto";
import { gunzipSync, gzipSync } from "node:zlib";
import type { Pool } from "pg";
import { collectOrganization, loadGraph, type Db, type Row } from "./graph";

/**
 * Per-organization backups: a full, unscrubbed snapshot of one organization (gzip JSON in Postgres) that can
 * be restored without touching any other organization. Railway's own database backups still cover disasters;
 * these cover "undo what happened to this one customer".
 */
export const BACKUP_FORMAT = "flowlio-organization-backup/1";
export const KEEP_SCHEDULED = 7;
export const KEEP_OTHER_DAYS = 30;

export type BackupPayload = { format: string; organizationId: string; createdAt: string; schemaVersion: number; tables: Record<string, Row[]> };
export type BackupMeta = { id: string; organization_id: string; kind: string; created_by: string | null; schema_version: number; table_count: number; row_count: number; size_bytes: number; created_at: string };

export class BackupError extends Error {
  constructor(public code: string, message: string, public status = 400) { super(message); }
}

export async function schemaVersion(db: Db) {
  try {
    return (await db.query<{ n: number }>("select count(*)::int n from flowlio_releases.migrations")).rows[0].n;
  } catch {
    return 0;
  }
}

export async function createBackup(db: Db, organizationId: string, kind: "scheduled" | "manual" | "pre_restore", createdBy: string | null = null): Promise<BackupMeta> {
  const exists = await db.query("select 1 from organizations where id=$1", [organizationId]);
  if (!exists.rowCount) throw new BackupError("NOT_FOUND", "Organization not found", 404);
  const graph = await loadGraph(db);
  const scopes = await collectOrganization(db, organizationId, graph);
  const truncated = scopes.filter(scope => scope.truncated).map(scope => scope.table);
  // An incomplete snapshot must never be restorable.
  if (truncated.length) throw new BackupError("TOO_LARGE", "Organization too large for a backup: " + truncated.join(", "), 413);
  const payload: BackupPayload = {
    format: BACKUP_FORMAT,
    organizationId,
    createdAt: new Date().toISOString(),
    schemaVersion: await schemaVersion(db),
    tables: Object.fromEntries(scopes.map(scope => [scope.table, scope.rows])),
  };
  const data = gzipSync(Buffer.from(JSON.stringify(payload)));
  const rowCount = scopes.reduce((total, scope) => total + scope.rows.length, 0);
  const { rows } = await db.query<BackupMeta>(
    `insert into organization_backups (id, organization_id, kind, created_by, schema_version, table_count, row_count, size_bytes, data)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9)
     returning id, organization_id, kind, created_by, schema_version, table_count, row_count, size_bytes, created_at`,
    [randomUUID(), organizationId, kind, createdBy, payload.schemaVersion, scopes.length, rowCount, data.length, data],
  );
  return rows[0];
}

export async function listBackups(db: Db, organizationId: string) {
  return (await db.query<BackupMeta>(
    `select id, organization_id, kind, created_by, schema_version, table_count, row_count, size_bytes, created_at
     from organization_backups where organization_id=$1 order by created_at desc`, [organizationId],
  )).rows;
}

export async function loadBackup(db: Db, backupId: string) {
  const { rows } = await db.query<BackupMeta & { data: Buffer }>("select * from organization_backups where id=$1", [backupId]);
  if (!rows[0]) throw new BackupError("NOT_FOUND", "Backup not found", 404);
  const payload = JSON.parse(gunzipSync(rows[0].data).toString("utf8")) as BackupPayload;
  if (payload.format !== BACKUP_FORMAT || payload.organizationId !== rows[0].organization_id) {
    throw new BackupError("INVALID_BACKUP", "Backup file does not match its organization");
  }
  return { meta: rows[0], payload };
}

/** Keeps the last 7 scheduled snapshots per organization and manual/pre-restore ones for 30 days. */
export async function pruneBackups(db: Db) {
  await db.query(
    `delete from organization_backups b where b.kind='scheduled' and b.id in (
       select id from (select id, row_number() over (partition by organization_id order by created_at desc) n
       from organization_backups where kind='scheduled') ranked where n > $1)`, [KEEP_SCHEDULED],
  );
  await db.query(`delete from organization_backups where kind in ('manual','pre_restore') and created_at < now() - ($1 || ' days')::interval`, [String(KEEP_OTHER_DAYS)]);
}

/**
 * Daily snapshot per organization, a few organizations per call so the hourly worker cycle stays short.
 * Inactive organizations are skipped once a snapshot exists after they became inactive (nothing changes).
 */
export async function runScheduledBackups(pool: Pool, limit = 25, log: (organizationId: string, error: unknown) => void = () => undefined) {
  const due = await pool.query<{ id: string }>(
    `select o.id from organizations o
     left join lateral (select max(created_at) last from organization_backups b where b.organization_id=o.id and b.kind='scheduled') b on true
     where (b.last is null or b.last < now() - interval '23 hours')
       and (o.inactive_since is null or b.last is null or b.last < o.inactive_since)
     order by b.last nulls first, o.id limit $1`, [limit],
  );
  let created = 0;
  for (const { id } of due.rows) {
    try { await createBackup(pool, id, "scheduled"); created++; } catch (error) { log(id, error); }
  }
  await pruneBackups(pool);
  return created;
}

import type { Pool } from "pg";

/**
 * Full export of one organization's data (portability, backup before closing an account, moving away).
 *
 * The table list is read from the database itself, so new tables are included without code changes:
 *  1. every table with an `organization_id` column, filtered by this organization;
 *  2. then, repeatedly, tables without that column whose foreign key points at rows already exported
 *     (e.g. tasks -> projects, comments -> tasks). Shared tables (users, plans) are never walked into.
 * Credentials, tokens and secrets are removed from every row.
 */
export const EXPORT_FORMAT = "flowlio-organization-export/1";

/** Technical, credential or cross-tenant tables that never belong in a customer export. */
const EXCLUDED = new Set([
  "users", "organizations", "session", "account", "verification", "two_factor", "two_factor_backup_codes",
  "push_subscriptions", "throttle", "throttle_insight", "operational_events", "operational_metrics",
  "durable_jobs", "job_schedules", "webhook_secrets", "privacy_requests", "google_calendar_sync_state",
  "whatsapp_links", "subscription_plans", "blog_posts", "blog_post_views", "newsletter_subscribers",
]);
const SECRET_KEY = /(password|token|secret|code_hash|p256dh|^auth$|backup_codes|input_hash|apply_hash|api_key)/i;
const IDENTIFIER = /^[a-z_][a-z0-9_]*$/;
export const ROW_LIMIT = 100000;

type ForeignKey = { child: string; column: string; parent: string; parentColumn: string };
type Row = Record<string, unknown>;

const quote = (name: string) => {
  if (!IDENTIFIER.test(name)) throw new Error("Unsafe identifier: " + name);
  return `"${name}"`;
};
const scrub = (rows: Row[]) => rows.map(row => Object.fromEntries(Object.entries(row).filter(([key]) => !SECRET_KEY.test(key))));

async function schemaGraph(pool: Pool) {
  const columns = await pool.query<{ table_name: string; column_name: string }>(
    "select c.table_name, c.column_name from information_schema.columns c join information_schema.tables t on t.table_name=c.table_name and t.table_schema=c.table_schema where c.table_schema='public' and t.table_type='BASE TABLE'",
  );
  const fks = await pool.query<{ child: string; column: string; parent: string; parent_column: string }>(
    `select cl.relname child, a.attname "column", pl.relname parent, pa.attname parent_column
     from pg_constraint con
     join pg_class cl on cl.oid=con.conrelid join pg_namespace n on n.oid=cl.relnamespace
     join pg_class pl on pl.oid=con.confrelid
     join pg_attribute a on a.attrelid=con.conrelid and a.attnum=con.conkey[1]
     join pg_attribute pa on pa.attrelid=con.confrelid and pa.attnum=con.confkey[1]
     where con.contype='f' and n.nspname='public' and array_length(con.conkey,1)=1`,
  );
  const tables = new Map<string, Set<string>>();
  for (const { table_name, column_name } of columns.rows) {
    if (!tables.has(table_name)) tables.set(table_name, new Set());
    tables.get(table_name)!.add(column_name);
  }
  const foreignKeys: ForeignKey[] = fks.rows.map(fk => ({ child: fk.child, column: fk.column, parent: fk.parent, parentColumn: fk.parent_column }));
  return { tables, foreignKeys };
}

/**
 * Child tables reachable from the organization by foreign key, parents before children, so a table with
 * several parents is read only after all of them. Cycles are broken by taking the remaining tables as is.
 */
export function childTablesInOrder(rootTables: string[], allTables: string[], foreignKeys: ForeignKey[]) {
  const roots = new Set(rootTables);
  const reachable = new Set<string>();
  const known = () => new Set(["organizations", ...roots, ...reachable]);
  for (let grew = true; grew;) {
    grew = false;
    const sources = known();
    for (const table of allTables) {
      if (EXCLUDED.has(table) || roots.has(table) || reachable.has(table)) continue;
      if (foreignKeys.some(fk => fk.child === table && sources.has(fk.parent))) { reachable.add(table); grew = true; }
    }
  }
  const ordered: string[] = [];
  const pending = new Set(reachable);
  while (pending.size) {
    const ready = [...pending].sort().filter(table =>
      foreignKeys.every(fk => fk.child !== table || fk.parent === table || !pending.has(fk.parent)));
    const batch = ready.length ? ready : [...pending].sort();
    for (const table of batch) { ordered.push(table); pending.delete(table); }
  }
  return ordered;
}

export async function exportOrganization(pool: Pool, organizationId: string) {
  const { tables, foreignKeys } = await schemaGraph(pool);
  const data: Record<string, Row[]> = {};
  const truncated: string[] = [];
  // Values of each exported table's referenced columns, so children can be found by foreign key.
  const exportedKeys = new Map<string, Map<string, unknown[]>>([["organizations", new Map([["id", [organizationId]]])]]);

  const remember = (table: string, rows: Row[]) => {
    const byColumn = new Map<string, unknown[]>();
    for (const fk of foreignKeys) {
      if (fk.parent !== table || byColumn.has(fk.parentColumn)) continue;
      byColumn.set(fk.parentColumn, rows.map(row => row[fk.parentColumn]).filter(value => value != null));
    }
    exportedKeys.set(table, byColumn);
  };
  const store = (table: string, rows: Row[]) => {
    if (rows.length > ROW_LIMIT) { truncated.push(table); rows = rows.slice(0, ROW_LIMIT); }
    remember(table, rows);
    data[table] = scrub(rows);
  };

  for (const [table, columns] of [...tables].sort(([a], [b]) => a.localeCompare(b))) {
    if (EXCLUDED.has(table) || !columns.has("organization_id")) continue;
    const { rows } = await pool.query<Row>(`select * from ${quote(table)} where organization_id=$1 limit ${ROW_LIMIT + 1}`, [organizationId]);
    store(table, rows);
  }

  for (const table of childTablesInOrder(Object.keys(data), [...tables.keys()], foreignKeys)) {
    const links = foreignKeys.filter(fk => fk.child === table && exportedKeys.has(fk.parent));
    const usable = links.filter(fk => (exportedKeys.get(fk.parent)?.get(fk.parentColumn)?.length ?? 0) > 0);
    if (!usable.length) { store(table, []); continue; }
    const where = usable.map((fk, index) => `${quote(fk.column)}::text = any($${index + 1}::text[])`).join(" or ");
    const params = usable.map(fk => exportedKeys.get(fk.parent)!.get(fk.parentColumn)!.map(String));
    const { rows } = await pool.query<Row>(`select * from ${quote(table)} where ${where} limit ${ROW_LIMIT + 1}`, params);
    store(table, rows);
  }

  const organization = await pool.query<Row>("select * from organizations where id=$1", [organizationId]);
  const members = await pool.query<Row>(
    `select u.id, u.name, u.email, u.phone, u.position, u.role, u.timezone, u.created_at, uo.role organization_role, uo.status
     from user_organizations uo join users u on u.id=uo.user_id where uo.organization_id=$1`,
    [organizationId],
  );

  return {
    format: EXPORT_FORMAT,
    generatedAt: new Date().toISOString(),
    organizationId,
    organization: scrub(organization.rows)[0] ?? null,
    members: members.rows,
    counts: Object.fromEntries(Object.entries(data).map(([table, rows]) => [table, rows.length])),
    truncated,
    data,
  };
}

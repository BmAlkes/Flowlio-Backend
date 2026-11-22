import { types as pgTypes } from "pg";
import type { Pool, PoolClient, QueryConfig } from "pg";

/**
 * The tables that hold one organization's data, read from the database itself so new tables are
 * covered without code changes:
 *  - "root" tables have an `organization_id` column;
 *  - "child" tables have no such column but a foreign key to rows already in scope (tasks -> projects).
 * Shared tables (users, plans) and credential/technical tables are never part of the scope.
 */
export const EXCLUDED = new Set([
  "users", "organizations", "session", "account", "verification", "two_factor", "two_factor_backup_codes",
  "push_subscriptions", "throttle", "throttle_insight", "operational_events", "operational_metrics",
  "durable_jobs", "job_schedules", "webhook_secrets", "privacy_requests", "google_calendar_sync_state",
  "whatsapp_links", "subscription_plans", "blog_posts", "blog_post_views", "newsletter_subscribers",
  "organization_backups",
]);
export const ROW_LIMIT = 100000;
const IDENTIFIER = /^[a-z_][a-z0-9_]*$/;

export type Db = Pool | PoolClient;
export type ForeignKey = { child: string; column: string; parent: string; parentColumn: string };
export type Column = { name: string; type: string };
export type Graph = { tables: Map<string, Column[]>; foreignKeys: ForeignKey[] };
export type Row = Record<string, unknown>;
export type TableScope = { table: string; root: boolean; where: string; params: unknown[]; rows: Row[]; truncated: boolean };

export const quote = (name: string) => {
  if (!IDENTIFIER.test(name)) throw new Error("Unsafe identifier: " + name);
  return `"${name}"`;
};

/** Dates come back as the exact database text, so a backup restores the same value whatever the server time zone. */
const RAW_TYPES = new Set([1082, 1083, 1114, 1184, 1266]);
const types = { getTypeParser: (oid: number, format?: string) => (RAW_TYPES.has(oid) ? (value: string) => value : pgTypes.getTypeParser(oid, format as "text")) };
export function rawQuery<R extends Row = Row>(db: Db, text: string, values: unknown[] = []) {
  return db.query<R>({ text, values, types } as QueryConfig);
}

export async function loadGraph(db: Db): Promise<Graph> {
  const columns = await db.query<{ table_name: string; column_name: string; data_type: string }>(
    `select c.table_name, c.column_name, c.data_type from information_schema.columns c
     join information_schema.tables t on t.table_name=c.table_name and t.table_schema=c.table_schema
     where c.table_schema='public' and t.table_type='BASE TABLE' order by c.table_name, c.ordinal_position`,
  );
  const fks = await db.query<{ child: string; column: string; parent: string; parent_column: string }>(
    `select cl.relname child, a.attname "column", pl.relname parent, pa.attname parent_column
     from pg_constraint con
     join pg_class cl on cl.oid=con.conrelid join pg_namespace n on n.oid=cl.relnamespace
     join pg_class pl on pl.oid=con.confrelid
     join pg_attribute a on a.attrelid=con.conrelid and a.attnum=con.conkey[1]
     join pg_attribute pa on pa.attrelid=con.confrelid and pa.attnum=con.confkey[1]
     where con.contype='f' and n.nspname='public' and array_length(con.conkey,1)=1`,
  );
  const tables = new Map<string, Column[]>();
  for (const row of columns.rows) {
    if (!tables.has(row.table_name)) tables.set(row.table_name, []);
    tables.get(row.table_name)!.push({ name: row.column_name, type: row.data_type });
  }
  return { tables, foreignKeys: fks.rows.map(fk => ({ child: fk.child, column: fk.column, parent: fk.parent, parentColumn: fk.parent_column })) };
}

/** Root tables plus every child reachable by foreign key, parents before children. */
export function organizationTables(graph: Graph) {
  const all = [...graph.tables.keys()].sort();
  const roots = all.filter(table => !EXCLUDED.has(table) && graph.tables.get(table)!.some(column => column.name === "organization_id"));
  const children = childTablesInOrder(roots, all, graph.foreignKeys);
  const scope = new Set([...roots, ...children]);
  const ordered: string[] = [];
  const pending = new Set(scope);
  while (pending.size) {
    const ready = [...pending].sort().filter(table =>
      graph.foreignKeys.every(fk => fk.child !== table || fk.parent === table || !pending.has(fk.parent)));
    for (const table of ready.length ? ready : [...pending].sort()) { ordered.push(table); pending.delete(table); }
  }
  return ordered.map(table => ({ table, root: roots.includes(table) }));
}

/** Child tables reachable from the root tables, parents before children. Cycles are broken by taking the rest as is. */
export function childTablesInOrder(rootTables: string[], allTables: string[], foreignKeys: ForeignKey[]) {
  const roots = new Set(rootTables);
  const reachable = new Set<string>();
  for (let grew = true; grew;) {
    grew = false;
    const sources = new Set(["organizations", ...roots, ...reachable]);
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
    for (const table of ready.length ? ready : [...pending].sort()) { ordered.push(table); pending.delete(table); }
  }
  return ordered;
}

/** Reads every row of the organization, table by table, keeping the filter used so it can be deleted the same way. */
export async function collectOrganization(db: Db, organizationId: string, graph: Graph, limit = ROW_LIMIT): Promise<TableScope[]> {
  const keys = new Map<string, Map<string, unknown[]>>([["organizations", new Map([["id", [organizationId]]])]]);
  const scopes: TableScope[] = [];
  for (const { table, root } of organizationTables(graph)) {
    let where: string;
    let params: unknown[];
    if (root) {
      where = "organization_id = $1";
      params = [organizationId];
    } else {
      const links = graph.foreignKeys.filter(fk => fk.child === table && fk.parent !== table && (keys.get(fk.parent)?.get(fk.parentColumn)?.length ?? 0) > 0);
      if (!links.length) { scopes.push({ table, root, where: "false", params: [], rows: [], truncated: false }); remember(keys, graph, table, []); continue; }
      where = links.map((fk, index) => `${quote(fk.column)}::text = any($${index + 1}::text[])`).join(" or ");
      params = links.map(fk => keys.get(fk.parent)!.get(fk.parentColumn)!.map(String));
    }
    const { rows } = await rawQuery(db, `select * from ${quote(table)} where ${where} limit ${limit + 1}`, params);
    const truncated = rows.length > limit;
    const kept = truncated ? rows.slice(0, limit) : rows;
    remember(keys, graph, table, kept);
    scopes.push({ table, root, where, params, rows: kept, truncated });
  }
  return scopes;
}

function remember(keys: Map<string, Map<string, unknown[]>>, graph: Graph, table: string, rows: Row[]) {
  const byColumn = new Map<string, unknown[]>();
  for (const fk of graph.foreignKeys) {
    if (fk.parent !== table || byColumn.has(fk.parentColumn)) continue;
    byColumn.set(fk.parentColumn, rows.map(row => row[fk.parentColumn]).filter(value => value != null));
  }
  keys.set(table, byColumn);
}

/**
 * Turns protection triggers (audit immutability, invoice numbering, retainer guards) off for the current
 * transaction only, so whole-organization delete/restore keeps rows exactly as they were. Foreign keys stay on.
 * ALTER TABLE is transactional: a rollback switches them back on.
 */
export async function withUserTriggersDisabled<T>(client: PoolClient, tables: string[], work: () => Promise<T>) {
  const withTriggers = (await client.query<{ relname: string }>(
    `select distinct c.relname from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace
     where not t.tgisinternal and n.nspname='public' and c.relname = any($1::text[])`, [tables],
  )).rows.map(row => row.relname).sort();
  for (const table of withTriggers) await client.query(`alter table ${quote(table)} disable trigger user`);
  const result = await work();
  for (const table of withTriggers) await client.query(`alter table ${quote(table)} enable trigger user`);
  return result;
}

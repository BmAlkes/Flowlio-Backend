import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import type { Pool } from "pg";

type Migration = { tag: string; sql: string; hash: string };
export async function readReleaseMigrations(folder: string): Promise<Migration[]> {
  const journal = JSON.parse(await readFile(path.join(folder, "meta/_journal.json"), "utf8"));
  if (journal.version !== "7" || journal.dialect !== "postgresql" || !Array.isArray(journal.entries) || !journal.entries.length) {
    throw new Error("Invalid release migration journal");
  }
  const seen = new Set<string>();
  let previousTime = -1;
  const migrations: Migration[] = [];
  for (const [index, entry] of journal.entries.entries()) {
    if (entry.idx !== index || typeof entry.tag !== "string" || !/^\d{4}_[a-z0-9_]+$/.test(entry.tag)
      || seen.has(entry.tag) || !Number.isSafeInteger(entry.when) || entry.when <= previousTime) {
      throw new Error("Invalid release migration entry at index " + index);
    }
    previousTime = entry.when;
    seen.add(entry.tag);
    const sql = (await readFile(path.join(folder, entry.tag + ".sql"), "utf8")).replace(/\r\n/g, "\n");
    if (!sql.trim()) throw new Error("Empty migration: " + entry.tag);
    migrations.push({ tag: entry.tag, sql, hash: createHash("sha256").update(sql).digest("hex") });
  }
  for (const file of await readdir(folder)) {
    if (file.endsWith(".sql") && !seen.has(file.slice(0, -4))) throw new Error("Unregistered migration: " + file);
  }
  return migrations;
}

/** One transaction and one shared lock cover adoption, DDL and history. */
export async function runReleaseMigrations(pool: Pool, folder = path.resolve("drizzle/releases")): Promise<void> {
  const migrations = await readReleaseMigrations(folder);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL lock_timeout = '30s'");
    await client.query("SET LOCAL statement_timeout = '120s'");
    await client.query("SET LOCAL search_path = public, pg_catalog");
    await client.query("SELECT pg_advisory_xact_lock(6039001)");
    // Acquire the previous releases' guard locks before taking any table locks.
    for (const key of [6034001, 6035001, 6036001]) await client.query("SELECT pg_advisory_xact_lock($1)", [key]);
    await client.query("CREATE SCHEMA IF NOT EXISTS flowlio_releases");
    await client.query("CREATE TABLE IF NOT EXISTS flowlio_releases.migrations (position integer PRIMARY KEY, name text NOT NULL UNIQUE, hash text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())");
    const history = await client.query<{ position: number; name: string; hash: string }>("SELECT position, name, hash FROM flowlio_releases.migrations ORDER BY position");
    for (const [index, row] of history.rows.entries()) {
      const migration = migrations[index];
      if (row.position !== index || !migration || row.name !== migration.tag || row.hash !== migration.hash) {
        throw new Error("Release migration history mismatch: " + row.name + ". Restore the published migration files; do not rewrite applied history.");
      }
    }
    for (let index = history.rows.length; index < migrations.length; index++) {
      const migration = migrations[index];
      await client.query(migration.sql);
      await client.query("INSERT INTO flowlio_releases.migrations (position, name, hash) VALUES ($1, $2, $3)", [index, migration.tag, migration.hash]);
    }
    const missing = await client.query<{ name: string }>(`
      SELECT required.name FROM (VALUES
        ('public.invoices', 'invoices_assign_number'),
        ('public.time_entries', 'time_entries_protect_billing'),
        ('public.time_entries', 'time_entries_guard_active')
      ) AS required(relation, name)
      LEFT JOIN pg_trigger t ON t.tgrelid = to_regclass(required.relation) AND t.tgname = required.name
      WHERE t.oid IS NULL OR t.tgenabled <> 'O'
    `);
    if (missing.rows.length) throw new Error("Required database guards unavailable: " + missing.rows.map(row => row.name).join(", "));
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally { client.release(); }
}

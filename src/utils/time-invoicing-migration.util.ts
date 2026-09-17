import { readFile } from "node:fs/promises";
import path from "node:path";
import type { Pool } from "pg";

export async function prepareTimeInvoicing(pool: Pool): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL lock_timeout = '15s'");
    await client.query("SELECT pg_advisory_xact_lock(6035001)");
    const installed = await client.query("SELECT 1 FROM pg_trigger WHERE tgrelid = to_regclass('public.time_entries') AND tgname = 'time_entries_protect_billing' AND tgenabled = 'O' AND to_regclass('public.time_invoicing_requests') IS NOT NULL AND to_regclass('public.invoice_time_items') IS NOT NULL");
    if (!installed.rowCount) await client.query(await readFile(path.resolve("drizzle/0035_time_invoicing.sql"), "utf8"));
    await client.query("COMMIT");
  } catch (error) { await client.query("ROLLBACK"); throw error; }
  finally { client.release(); }
}

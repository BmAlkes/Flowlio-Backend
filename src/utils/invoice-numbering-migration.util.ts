import { readFile } from "node:fs/promises";
import path from "node:path";
import type { Pool } from "pg";

/** Narrow release prerequisite; it does not run the legacy migration backlog. */
export async function prepareInvoiceNumbering(pool: Pool): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL lock_timeout = '15s'");
    await client.query("SELECT pg_advisory_xact_lock(6034001)");
    const installed = await client.query(
      "SELECT 1 FROM pg_trigger WHERE tgrelid = to_regclass('public.invoices') AND tgname = 'invoices_assign_number' AND tgenabled = 'O'",
    );
    if (installed.rowCount === 0) {
      const migration = await readFile(path.resolve("drizzle/0034_invoice_number_sequences.sql"), "utf8");
      await client.query(migration);
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally { client.release(); }
}

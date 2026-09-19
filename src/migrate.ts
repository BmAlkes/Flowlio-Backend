import "dotenv/config";
import { Pool } from "pg";
import { runReleaseMigrations } from "./utils/release-migrations.util";

async function main() {
  if (!process.env.CONNECTION_URL) throw new Error("CONNECTION_URL is required");
  const pool = new Pool({ connectionString: process.env.CONNECTION_URL, max: 1, connectionTimeoutMillis: 15000 });
  try {
    await runReleaseMigrations(pool);
    console.log("Release migrations completed successfully");
  } finally { await pool.end(); }
}
void main().catch(error => {
  console.error("Release migration failed:", error instanceof Error ? error.message : "Unknown error");
  process.exitCode = 1;
});

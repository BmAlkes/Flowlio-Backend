const { spawnSync } = require("node:child_process");
const { readdirSync } = require("node:fs");
const path = require("node:path");
const { Pool } = require("pg");
const { databases } = require("../tests/ci-environment.cjs");

async function main() {
  for (const [port, database] of Object.values(databases)) {
    // Fixed dedicated localhost databases; no user-provided database identifiers.
    const pool = new Pool({ connectionString: `postgres://postgres:flowlio_local_test@127.0.0.1:${port}/postgres` });
    try {
      const exists = await pool.query("select 1 from pg_database where datname=$1", [database]);
      if (!exists.rowCount) await pool.query(`create database "${database}"`);
    } finally { await pool.end(); }
  }
  const files = readdirSync("tests").filter(name => name.endsWith(".test.cjs")).map(name => path.join("tests", name));
  const result = spawnSync(process.execPath, ["-r", "./tests/ci-environment.cjs", "-r", "ts-node/register/transpile-only", "-r", "tsconfig-paths/register", "--test", "--test-concurrency=2", ...files], { stdio: "inherit", windowsHide: true, env: process.env });
  process.exitCode = result.status ?? 1;
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });

const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const Module = require("node:module");
const { performance } = require("node:perf_hooks");
if (!process.env.DATA_ACCESS_TEST_DATABASE_URL) {
  test("Data access PostgreSQL integration (set DATA_ACCESS_TEST_DATABASE_URL)", { skip: true }, () => {});
} else {
  const url = new URL(process.env.DATA_ACCESS_TEST_DATABASE_URL);
  assert.ok(["localhost", "127.0.0.1"].includes(url.hostname) && url.port === "55442" && url.pathname === "/flowlio_data_access_test", "Dedicated local test database only");
  const { Pool } = require("pg");
  const pool = new Pool({ connectionString: url.toString() });
  const { drizzle } = require("drizzle-orm/node-postgres");
  const schema = require("../src/schema/schema");
  let queries = 0;
  const database = drizzle(pool, { schema, casing: "snake_case", logger: { logQuery() { queries++; } } });
  const original = Module._load;
  Module._load = function(request, parent, main) {
    if (request.includes("configs/connection.config")) return { database };
    if (request.includes("utils/logger.util")) return { logger: { info() {}, error() {}, warn() {} } };
    return original.call(this, request, parent, main);
  };
  const { listProjects } = require("../src/modules/projects/read-projects");
  const { getTasks } = require("../src/controllers/organization/tasks/gettasks.controller");
  const { getAllTimeEntries } = require("../src/controllers/organization/tasks/getalltimeentries.controller");
  Module._load = original;
  const actor = { id: "owner", role: "user", organizationId: "org-a", isOrganizationOwner: true };
  function response() { return { code: 200, status(code) { this.code = code; return this; }, json(body) { this.body = body; } }; }
  before(async () => {
    await pool.query("drop schema public cascade; create schema public; drop schema if exists flowlio_releases cascade; drop schema if exists drizzle cascade");
    await require("../src/utils/release-migrations.util").runReleaseMigrations(pool);
    await pool.query(`
      insert into users(id,name,email,email_verified,two_factor_enabled,is_super_admin,timezone,created_at,updated_at)
      values ('owner','Owner','owner@example.test',true,false,false,'UTC',now(),now());
      insert into organizations(id,name,slug,created_at,updated_at) values ('org-a','A','a',now(),now()),('org-b','B','b',now(),now());
      insert into projects(id,name,project_number,organization_id,created_by,status,visibility,created_at,updated_at)
      select 'p-'||n, 'Project '||n, 'P'||n, case when n>1000 then 'org-b' else 'org-a' end, 'owner',case when n%2=0 then 'active' else 'pending' end,'public','2026-01-01',now() from generate_series(1,1100) n;
      insert into tasks(id,title,project_id,created_by,status,visibility,created_at,updated_at)
      select 't-'||n,'Task '||n,'p-1','owner','todo','public','2026-01-01',now() from generate_series(1,205) n;
      insert into time_entries(id,user_id,project_id,task_id,start_time,end_time,duration,status,created_at,updated_at)
      select 'e-'||n,'owner','p-1','t-1','2026-01-01','2026-01-01 00:05',5,'completed','2026-01-01',now() from generate_series(1,205) n;
      analyze;
    `);
  });
  after(async () => { await pool.end(); });
  test("project pages cover every authorized row once even with identical timestamps", async () => {
    const seen = new Set();
    for (let page = 1; page <= 10; page++) {
      const rows = await listProjects(actor, { page: String(page), pageSize: "100" });
      for (const row of rows.slice(0,100)) { assert.equal(row.organizationId,"org-a"); assert.ok(!seen.has(row.id)); seen.add(row.id); }
    }
    assert.equal(seen.size,1000);
    const filtered = await listProjects(actor,{page:"1",pageSize:"100",status:"ongoing",search:"Project 20"});
    assert.ok(filtered.length>0); assert.ok(filtered.every(row=>row.projectName.includes("Project 20") && row.status==="active"));
  });
  test("task and time pages return only the requested window", async () => {
    for (const handler of [getTasks,getAllTimeEntries]) {
      const res=response(); await handler({user:actor,query:{page:"3",pageSize:"100"}},res);
      assert.equal(res.code,200); assert.equal(res.body.data.length,5); assert.equal(res.body.pagination.hasMore,false);
    }
  });
  test("record local query latency and payload before and after bounding the first page", async () => {
    await listProjects(actor); // warm connection
    queries=0; let start=performance.now(); const all=await listProjects(actor); const beforeMs=performance.now()-start;
    const beforeQueries=queries; queries=0; start=performance.now(); const page=await listProjects(actor,{page:"1",pageSize:"100"}); const afterMs=performance.now()-start;
    const measurement={fixtureProjects:1100,authorized:all.length,before:{queries:beforeQueries,ms:+beforeMs.toFixed(2),bytes:Buffer.byteLength(JSON.stringify(all))},firstPage:{queries,ms:+afterMs.toFixed(2),bytes:Buffer.byteLength(JSON.stringify(page.slice(0,100)))}};
    assert.equal(all.length,1000); assert.equal(page.length,101);
    assert.ok(measurement.firstPage.bytes < measurement.before.bytes / 5);
    console.log("T14 local benchmark",JSON.stringify(measurement));
  });
}

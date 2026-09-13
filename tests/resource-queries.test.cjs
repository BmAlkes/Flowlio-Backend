const { test } = require("node:test");
const assert = require("node:assert/strict");
const Module = require("node:module");
const { drizzle } = require("drizzle-orm/node-postgres");
const { and, eq } = require("drizzle-orm");
const schema = require("../src/schema/schema");
const queries = [];
// Drizzle still compiles and maps the real queries. The driver returns fixtures.
const db = drizzle(
  {
    query: async (config, params) => {
      queries.push({ text: config.text, params });
      if (config.text.includes('from "clients"'))
        return { rows: [["client-a", "org-a", "Client A"]] };
      return { rows: [] };
    },
  },
  { schema, casing: "snake_case" },
);
const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request.includes("configs/connection.config")) return { database: db };
  if (request.includes("utils/logger.util"))
    return { logger: { info() {}, error() {}, warn() {} } };
  return originalLoad.call(this, request, parent, isMain);
};
let access, getTasksByClient;
try {
  access = require("../src/security/resource-access");
  ({
    getTasksByClient,
  } = require("../src/controllers/organization/tasks/gettasksbyclient.controller"));
} finally {
  Module._load = originalLoad;
}
const member = { id: "member", role: "user", organizationId: "org-a" };

test("client queries enforce identity with AND even for public projects", () => {
  const query = db
    .select()
    .from(schema.projects)
    .where(
      access.projectReadScope({ ...member, id: "client-user", role: "client" }),
    )
    .toSQL();
  assert.ok(query.params.includes("org-a"));
  assert.ok(query.params.includes("client-user"));
  assert.ok(query.sql.includes("exists"));
  assert.equal(
    query.params.includes("public"),
    false,
    "public visibility must not bypass client ownership",
  );
});
test("task scope requires project visibility as well as task visibility", () => {
  const query = db
    .select()
    .from(schema.tasks)
    .innerJoin(schema.projects, eq(schema.tasks.projectId, schema.projects.id))
    .where(access.taskReadScope(member))
    .toSQL();
  assert.match(query.sql, /"projects"\."visibility"/);
  assert.match(query.sql, /"tasks"\."visibility"/);
  assert.ok(query.params.includes("org-a"));
});
test("private comments are scoped through project and linked task", () => {
  const query = db
    .select()
    .from(schema.projectComments)
    .where(access.commentReadScope(member))
    .toSQL();
  assert.match(query.sql, /to_jsonb\("project_comments"\)->>'task_id'/);
  assert.match(query.sql, /"tasks"\."visibility"/);
  assert.ok(query.params.includes("org-a"));
});
test("missing organization and unknown roles produce a false scope", () => {
  for (const actor of [
    { ...member, organizationId: undefined },
    { ...member, role: "unknown" },
  ]) {
    const query = db
      .select()
      .from(schema.projects)
      .where(access.projectReadScope(actor))
      .toSQL();
    assert.match(query.sql, /where false$/);
  }
});
test("the real tasks-by-client controller ignores a forged body organization", async () => {
  queries.length = 0;
  let result, code;
  const res = {
    status(value) {
      code = value;
      return this;
    },
    json(value) {
      result = value;
    },
  };
  await getTasksByClient(
    {
      params: { clientId: "client-a" },
      body: { organizationId: "org-b" },
      user: member,
    },
    res,
  );
  assert.equal(code, 200, JSON.stringify(result));
  assert.equal(queries.length, 2);
  for (const query of queries) {
    assert.ok(query.params.includes("org-a"));
    assert.equal(query.params.includes("org-b"), false);
  }
  assert.match(queries[1].text, /"tasks"\."visibility"/);
});
test("budget redaction is independent of the project visibility", () => {
  assert.equal(access.projectBudget(member, "12500.00"), null);
  assert.equal(
    access.projectBudget({ ...member, isOrganizationOwner: true }, "12500.00"),
    "12500.00",
  );
  assert.equal(
    access.projectBudget(
      { ...member, role: "client", isOrganizationOwner: true },
      "12500.00",
    ),
    null,
  );
});

const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const Module = require("node:module");
const express = require("express");
const { createResourceGuards } = require("../src/security/resource-guards");
const {
  canReadProject,
  canReadTask,
  canViewProjectFinancials,
} = require("../src/security/resource-policy");

const actors = {
  member: { id: "member", role: "user", organizationId: "org-a" },
  owner: {
    id: "owner",
    role: "user",
    organizationId: "org-a",
    isOrganizationOwner: true,
  },
  manager: {
    id: "manager",
    role: "user",
    organizationId: "org-a",
    isOrganizationManager: true,
  },
  viewer: { id: "viewer", role: "viewer", organizationId: "org-a" },
  operator: { id: "operator", role: "operator", organizationId: "org-a" },
  client: { id: "client-user", role: "client", organizationId: "org-a" },
  otherOrg: {
    id: "other-user",
    role: "user",
    organizationId: "org-b",
    isOrganizationOwner: true,
  },
  unknown: {
    id: "unknown",
    role: "unknown",
    organizationId: "org-a",
    isOrganizationOwner: true,
  },
  noOrg: { id: "owner", role: "user", isOrganizationOwner: true },
};
const projects = [
  {
    id: "shared",
    organizationId: "org-a",
    visibility: "public",
    createdBy: "owner",
    clientId: "client-a",
  },
  {
    id: "private",
    organizationId: "org-a",
    visibility: "private",
    createdBy: "owner",
    clientId: "client-a",
  },
  {
    id: "other-client",
    organizationId: "org-a",
    visibility: "public",
    createdBy: "owner",
    clientId: "client-b",
  },
  {
    id: "foreign",
    organizationId: "org-b",
    visibility: "public",
    createdBy: "other-user",
    clientId: "client-c",
  },
];
const tasks = [
  {
    id: "visible-task",
    projectId: "shared",
    createdBy: "member",
    assignedTo: "viewer",
    visibility: "public",
  },
  {
    id: "private-task",
    projectId: "shared",
    createdBy: "owner",
    visibility: "private",
  },
  {
    id: "hidden-parent-task",
    projectId: "private",
    createdBy: "owner",
    visibility: "public",
  },
  {
    id: "other-client-task",
    projectId: "other-client",
    createdBy: "owner",
    visibility: "public",
  },
];
const clients = [
  { id: "client-a", userId: "client-user", organizationId: "org-a" },
  { id: "client-b", userId: "other-client-user", organizationId: "org-a" },
  { id: "client-c", userId: "foreign-client", organizationId: "org-b" },
];
const repository = {
  project: async (id, org) =>
    projects.find((p) => p.id === id && p.organizationId === org),
  task: async (id, org) =>
    tasks.find(
      (t) =>
        t.id === id &&
        projects.some((p) => p.id === t.projectId && p.organizationId === org),
    ),
  client: async (id, org) =>
    clients.find((c) => c.id === id && c.organizationId === org),
  ownClient: async (userId, org) =>
    clients.find((c) => c.userId === userId && c.organizationId === org)?.id,
  member: async (userId, org) =>
    !!actors[userId] && actors[userId].organizationId === org,
  comment: async (id) =>
    id === "own-comment"
      ? { projectId: "shared", userId: "member" }
      : id === "foreign-comment"
        ? { projectId: "foreign", userId: "member" }
        : undefined,
  file: async (id) =>
    id === "private-file"
      ? { organizationId: "org-a", projectId: "private", uploadedBy: "owner" }
      : id === "own-file"
        ? { organizationId: "org-a", projectId: "shared", uploadedBy: "member" }
        : id === "client-file"
          ? {
              organizationId: "org-a",
              clientId: "client-b",
              uploadedBy: "owner",
            }
          : undefined,
};
const resourceAccess = createResourceGuards(repository);
let server, origin;
let reached = 0;

before(async () => {
  // Load the actual route declarations, substituting session, DB repository and
  // terminal controllers only. No DB, cloud storage or production credentials.
  const originalLoad = Module._load;
  Module._load = function (request, parent, isMain) {
    if (request.includes("security/resource-access")) return { resourceAccess };
    if (request.includes("middlewares/auth.middleware"))
      return {
        isAuthenticated: (req, _res, next) => {
          req.user = actors[req.headers["x-test-actor"]];
          next();
        },
      };
    if (request.includes("middlewares/plan-feature.middleware"))
      return { requirePlanFeature: () => (_req, _res, next) => next() };
    if (request.includes("utils/logger.util"))
      return { logger: { warn() {}, error() {}, info() {} } };
    // This suite stubs business responses; response-shape checks have their own HTTP suite.
    if (request.includes("middlewares/api-contract.middleware")) {
      const actual = originalLoad.call(this, request, parent, isMain);
      return { ...actual, contractResponse: () => (_req, _res, next) => next() };
    }
    if (request.includes("/controllers/"))
      return new Proxy(
        {},
        {
          get: (_target, key) =>
            key === "upload"
              ? { single: () => (_req, _res, next) => next() }
              : (_req, res) => {
                  reached++;
                  res.json({ reached: true });
                },
        },
      );
    return originalLoad.call(this, request, parent, isMain);
  };
  const app = express();
  app.use(express.json());
  try {
    for (const [prefix, route] of [
      ["/projects", "project"],
      ["/tasks", "task"],
      ["/invoices", "invoices"],
      ["/proposals", "proposals"],
      ["/files", "file"],
    ])
      app.use(prefix, require(`../src/routes/${route}.routes`).default);
  } finally {
    Module._load = originalLoad;
  }
  app.use((error, _req, res, _next) =>
    res.status(500).json({ message: error.message }),
  );
  server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  origin = `http://127.0.0.1:${server.address().port}`;
});
after(async () => {
  if (server) await new Promise((resolve) => server.close(resolve));
});

const scenarios = [
  ["anonymous denied", undefined, "DELETE", "/projects/shared", 401],
  ["missing organization denied", "noOrg", "DELETE", "/projects/shared", 403],
  ["unknown role fails closed", "unknown", "DELETE", "/projects/shared", 403],
  ["viewer cannot delete project", "viewer", "DELETE", "/projects/shared", 403],
  [
    "client cannot delete own project",
    "client",
    "DELETE",
    "/projects/shared",
    403,
  ],
  [
    "operator cannot delete project",
    "operator",
    "DELETE",
    "/projects/shared",
    403,
  ],
  [
    "member can delete accessible project",
    "member",
    "DELETE",
    "/projects/shared",
    200,
  ],
  [
    "member cannot delete private project",
    "member",
    "DELETE",
    "/projects/private",
    404,
  ],
  [
    "owner can delete own private project",
    "owner",
    "DELETE",
    "/projects/private",
    200,
  ],
  [
    "cross-organization admin denied",
    "otherOrg",
    "GET",
    "/projects/shared",
    404,
  ],
  [
    "public never means another client",
    "client",
    "GET",
    "/projects/other-client",
    404,
  ],
  ["client can read own project", "client", "GET", "/projects/shared", 200],
  [
    "client can read own private project via portal",
    "client",
    "GET",
    "/projects/private",
    200,
  ],
  [
    "member cannot read private project",
    "member",
    "GET",
    "/projects/private",
    404,
  ],
  [
    "member cannot read expenses",
    "member",
    "GET",
    "/projects/shared/expenses",
    403,
  ],
  [
    "manager cannot read internal expenses",
    "manager",
    "GET",
    "/projects/shared/expenses",
    403,
  ],
  [
    "client cannot create expense",
    "client",
    "POST",
    "/projects/shared/expenses",
    403,
  ],
  ["owner can read expenses", "owner", "GET", "/projects/shared/expenses", 200],
  [
    "foreign expense access denied",
    "otherOrg",
    "GET",
    "/projects/shared/expenses",
    404,
  ],
  ["viewer cannot delete task", "viewer", "DELETE", "/tasks/visible-task", 403],
  [
    "client cannot update task through staff endpoint",
    "client",
    "PUT",
    "/tasks/update/visible-task",
    403,
    { title: "changed" },
  ],
  [
    "member cannot edit private task",
    "member",
    "PUT",
    "/tasks/update/private-task",
    404,
    { title: "changed" },
  ],
  [
    "private parent blocks public child",
    "member",
    "GET",
    "/tasks/hidden-parent-task",
    404,
  ],
  [
    "client cannot read private task",
    "client",
    "GET",
    "/tasks/private-task",
    404,
  ],
  [
    "client cannot read other client task",
    "client",
    "GET",
    "/tasks/other-client-task",
    404,
  ],
  [
    "client can read shared own task",
    "client",
    "GET",
    "/tasks/visible-task",
    200,
  ],
  [
    "viewer can track assigned task",
    "viewer",
    "POST",
    "/tasks/visible-task/start",
    200,
  ],
  [
    "client cannot track task",
    "client",
    "POST",
    "/tasks/visible-task/start",
    403,
  ],
  [
    "cannot move task to foreign project",
    "member",
    "PUT",
    "/tasks/update/visible-task",
    404,
    { projectId: "foreign" },
  ],
  [
    "cannot link private dependency",
    "member",
    "PUT",
    "/tasks/update/visible-task",
    404,
    { startAfter: "private-task" },
  ],
  [
    "member cannot forge budget",
    "member",
    "PUT",
    "/projects/update/shared",
    403,
    { budget: 500 },
  ],
  [
    "member cannot clear budget with null",
    "member",
    "PUT",
    "/projects/update/shared",
    403,
    { budget: null },
  ],
  [
    "foreign assignee denied",
    "member",
    "PUT",
    "/tasks/update/visible-task",
    404,
    { assignedTo: "otherOrg" },
  ],
  [
    "valid assignee accepted",
    "member",
    "PUT",
    "/tasks/update/visible-task",
    200,
    { assignedTo: "viewer" },
  ],
  [
    "client cannot enumerate internal templates",
    "client",
    "GET",
    "/projects/templates/all",
    403,
  ],
  [
    "client cannot enumerate organization users",
    "client",
    "GET",
    "/projects/users/organization",
    403,
  ],
  [
    "owner can set budget",
    "owner",
    "PUT",
    "/projects/update/shared",
    200,
    { budget: 500 },
  ],
  [
    "client cannot enumerate other client invoices",
    "client",
    "POST",
    "/invoices/client/client-b",
    404,
  ],
  [
    "client can read own invoices",
    "client",
    "POST",
    "/invoices/client/client-a",
    200,
  ],
  [
    "member cannot read client invoices",
    "member",
    "POST",
    "/invoices/client/client-a",
    403,
  ],
  [
    "manager can read client invoices",
    "manager",
    "POST",
    "/invoices/client/client-a",
    200,
  ],
  [
    "body organization cannot authorize foreign client tasks",
    "member",
    "POST",
    "/tasks/client/client-c",
    404,
    { organizationId: "org-b" },
  ],
  [
    "member cannot enumerate proposals",
    "member",
    "GET",
    "/proposals/organization",
    403,
  ],
  [
    "owner can enumerate proposals",
    "owner",
    "GET",
    "/proposals/organization",
    200,
  ],
  [
    "private milestone read denied",
    "member",
    "GET",
    "/projects/private/milestones",
    404,
  ],
  [
    "viewer milestone write denied",
    "viewer",
    "POST",
    "/projects/shared/milestones",
    403,
  ],
  [
    "foreign comment read denied",
    "member",
    "GET",
    "/projects/comments/foreign",
    404,
  ],
  [
    "foreign comment write denied",
    "member",
    "POST",
    "/projects/comments",
    404,
    { projectId: "foreign", content: "test" },
  ],
  [
    "cross-project reply denied",
    "member",
    "POST",
    "/projects/comments",
    404,
    { projectId: "shared", parentId: "foreign-comment", content: "test" },
  ],
  [
    "own comment update allowed",
    "member",
    "PATCH",
    "/projects/comments/own-comment",
    200,
  ],
  [
    "foreign own comment update denied",
    "member",
    "PATCH",
    "/projects/comments/foreign-comment",
    404,
  ],
  [
    "private file versions denied",
    "member",
    "GET",
    "/files/attachments/private-file/versions",
    404,
  ],
  [
    "own visible file delete allowed",
    "member",
    "DELETE",
    "/files/media/own-file",
    200,
  ],
  [
    "viewer file deletion denied",
    "viewer",
    "DELETE",
    "/files/media/own-file",
    403,
  ],
  [
    "other client direct file denied",
    "client",
    "GET",
    "/files/attachments/client-file/versions",
    404,
  ],
  [
    "file cannot be attached to another clients project",
    "owner",
    "POST",
    "/files/clients/client-a/media",
    404,
    { projectId: "other-client" },
  ],
  [
    "bulk reorder validates every project",
    "member",
    "PATCH",
    "/projects/reorder",
    404,
    {
      updates: [
        { projectId: "shared", position: 0 },
        { projectId: "private", position: 1 },
      ],
    },
  ],
];
for (const [name, actor, method, route, status, body] of scenarios)
  test(name, async () => {
    const previous = reached;
    const response = await fetch(origin + route, {
      method,
      headers: {
        ...(actor ? { "x-test-actor": actor } : {}),
        "content-type": "application/json",
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const payload = await response.json();
    assert.equal(response.status, status, JSON.stringify(payload));
    assert.equal(
      reached - previous,
      status === 200 ? 1 : 0,
      "Denied request must not run the controller",
    );
  });

test("resource policies keep tenant, visibility and financial boundaries", () => {
  assert.equal(canReadProject(actors.member, projects[3]), false);
  assert.equal(canReadProject(actors.client, projects[2], "client-a"), false);
  assert.equal(canReadTask(actors.member, tasks[2], projects[1]), false);
  assert.equal(canViewProjectFinancials(actors.unknown), false);
  assert.equal(
    canViewProjectFinancials({ ...actors.client, isOrganizationOwner: true }),
    false,
  );
});

const { test, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const Module = require("node:module");
const { sql } = require("drizzle-orm");
const { PgDialect } = require("drizzle-orm/pg-core");
const dialect = new PgDialect();
let rows, updates, predicates, actors, calls, failRun, failRecord;
const result = { tasksFound: 1, projectsFound: 2, alertsCreated: 3, alertsResolved: 4, invoicesFound: 5, linksFound: 6, webhooksFound: 7, leadsFound: 8, clientsFound: 9, ticketsFound: 10, organizationsFound: 11, emailsSent: 12, emailsFailed: 13 };
const query = {
  from() { return this; }, leftJoin() { return this; },
  where(predicate) { predicates.push(dialect.sqlToQuery(predicate)); return this; },
  orderBy() { return Promise.resolve(rows); }, limit() { return Promise.resolve(rows); },
  set(value) { updates.push(value); return this; }, returning() { return Promise.resolve(rows); },
};
const database = { select() { return query; }, update() { return query; } };
const automationService = new Proxy({}, { get: (_, method) => async options => {
  calls.push({ method, options });
  if (failRun) throw new Error("provider unavailable");
  return result;
} });
const originalLoad = Module._load;
Module._load = function(request, parent, main) {
  if (request.includes("configs/connection.config")) return { database };
  if (request.includes("security/resource-access")) return {
    projectReadScope(actor) { actors.push(actor); return sql`organization_id = ${actor.organizationId}`; },
    projectBudget(actor, budget) { return actor.isOrganizationOwner ? budget : null; },
  };
  if (request.includes("services/automation/automation.service")) return { automationService };
  if (request.includes("utils/automationRun.util")) return { recordAutomationRun: async (...args) => {
    calls.push({ record: args });
    if (failRecord) throw new Error("history unavailable");
  } };
  if (request.includes("utils/logger.util")) return { logger: { info() {}, error() {}, warn() {} } };
  return originalLoad.call(this, request, parent, main);
};
const projects = require("../src/controllers/organization/projects/getproject.controller");
const { updatePaymentLinkStatus } = require("../src/controllers/organization/payment-links/updatepaymentlinkstatus.controller");
const cases = [
  {
    "file": "runClientInactivity",
    "export": "runClientInactivityAutomation",
    "method": "handleClientInactivity",
    "key": "client-inactivity",
    "force": true,
    "message": "Clients found: ${result.clientsFound}, emails sent: ${result.emailsSent}, failed: ${result.emailsFailed}."
  },
  {
    "file": "runInvoiceOverdue",
    "export": "runInvoiceOverdueAutomation",
    "method": "handleInvoiceOverdue",
    "key": "invoice-overdue",
    "force": true,
    "message": "Invoices found: ${result.invoicesFound}, emails sent: ${result.emailsSent}, failed: ${result.emailsFailed}."
  },
  {
    "file": "runLeadFollowup",
    "export": "runLeadFollowupAutomation",
    "method": "handleLeadFollowUpOverdue",
    "key": "lead-followup",
    "force": true,
    "message": "Leads found: ${result.leadsFound}, emails sent: ${result.emailsSent}, failed: ${result.emailsFailed}."
  },
  {
    "file": "runNewLeadNotContacted",
    "export": "runNewLeadNotContactedAutomation",
    "method": "handleNewLeadNotContacted",
    "key": "new-lead-not-contacted",
    "force": true,
    "message": "Leads found: ${result.leadsFound}, emails sent: ${result.emailsSent}, failed: ${result.emailsFailed}."
  },
  {
    "file": "runPaymentLinkReminder",
    "export": "runPaymentLinkReminderAutomation",
    "method": "handlePaymentLinkReminder",
    "key": "payment-link-reminder",
    "force": true,
    "message": "Links found: ${result.linksFound}, emails sent: ${result.emailsSent}, failed: ${result.emailsFailed}."
  },
  {
    "file": "runProjectRisk",
    "export": "runProjectRiskAutomation",
    "method": "handleProjectRiskAlerts",
    "key": "project-risk",
    "force": true,
    "message": "Projects found: ${result.projectsFound}, alerts created: ${result.alertsCreated}, resolved: ${result.alertsResolved}, emails sent: ${result.emailsSent}, failed: ${result.emailsFailed}."
  },
  {
    "file": "runSupportTicketUnanswered",
    "export": "runSupportTicketUnansweredAutomation",
    "method": "handleSupportTicketUnanswered",
    "key": "support-ticket-unanswered",
    "force": true,
    "message": "Tickets found: ${result.ticketsFound}, emails sent: ${result.emailsSent}, failed: ${result.emailsFailed}."
  },
  {
    "file": "runTaskOverdue",
    "export": "runTaskOverdueAutomation",
    "method": "handleOverdueTasks",
    "key": "task-overdue",
    "force": true,
    "message": "Tasks found: ${result.tasksFound}, emails sent: ${result.emailsSent}, failed: ${result.emailsFailed}."
  },
  {
    "file": "runTrialAndUsage",
    "export": "runTrialAndUsageAutomation",
    "method": "handleTrialAndUsageLimits",
    "key": "trial-and-usage",
    "force": true,
    "message": "Organizations found: ${result.organizationsFound}, emails sent: ${result.emailsSent}, failed: ${result.emailsFailed}."
  },
  {
    "file": "runWebhookIssue",
    "export": "runWebhookIssueAutomation",
    "method": "handleWebhookIssue",
    "key": "webhook-issue",
    "force": false,
    "message": "Webhooks with issues: ${result.webhooksFound}, emails sent: ${result.emailsSent}, failed: ${result.emailsFailed}."
  },
  {
    "file": "runWeeklySummary",
    "export": "runWeeklySummaryAutomation",
    "method": "handleWeeklySummary",
    "key": "weekly-summary",
    "force": false,
    "message": "Organizations with activity: ${result.organizationsFound}, emails sent: ${result.emailsSent}, failed: ${result.emailsFailed}."
  }
];
for (const item of cases) item.controller = require("../src/controllers/automations/" + item.file + ".controller")[item.export];
Module._load = originalLoad;
const actor = { id: "owner", role: "user", organizationId: "org-a", isOrganizationOwner: true };
function response() { return { code: 200, body: undefined, status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } }; }
beforeEach(() => { rows = []; updates = []; predicates = []; actors = []; calls = []; failRun = false; failRecord = false; });

for (const item of cases) test("manual automation preserves options, message and history: " + item.key, async () => {
  const res = response();
  await item.controller({ body: { organizationId: " org-a " }, user: actor }, res);
  assert.equal(res.code, 200);
  assert.equal(res.body.data, result);
  assert.equal(res.body.message, item.message.replace(/\$\{result\.(\w+)\}/g, (_, key) => String(result[key])));
  assert.deepEqual(calls, [
    { method: item.method, options: { organizationId: "org-a", ...(item.force ? { forceRun: true } : {}) } },
    { record: [item.key, result, "manual", "org-a"] },
  ]);
});

test("manual runs require an organization except for the existing superadmin flow", async () => {
  for (const item of cases) {
    const res = response(); await item.controller({ body: {}, user: actor }, res);
    assert.equal(res.code, 400);
  }
  assert.deepEqual(calls, []);
  const res = response(); await cases[0].controller({ body: {}, user: { isSuperAdmin: true } }, res);
  assert.equal(res.code, 200);
  assert.equal(calls[0].options.organizationId, undefined);
  assert.equal(calls[1].record[3], null);
});

test("execution failure never records success or retries, and history failure is not reported as success", async () => {
  failRun = true;
  let res = response(); await cases[0].controller({ body: { organizationId: "org-a" }, user: actor }, res);
  assert.equal(res.code, 500); assert.equal(calls.length, 1);
  calls = []; failRun = false; failRecord = true;
  res = response(); await cases[0].controller({ body: { organizationId: "org-a" }, user: actor }, res);
  assert.equal(res.code, 500); assert.equal(calls.length, 2);
});

test("project reads preserve fields, null dates, read scope and budget visibility", async () => {
  const date = new Date("2026-01-01T00:00:00Z");
  rows = [{ id: "p", projectNumber: "P1", name: "Website", status: "ongoing", progress: 0, budget: "125.00", startDate: null, endDate: null, createdAt: date, updatedAt: date, organizationId: "org-a", clientId: "client-a", customFields: { reference: "R1" } }];
  let res = response(); await projects.getAllProjects({ user: actor }, res);
  assert.equal(res.code, 200); assert.equal(res.body.data[0].projectName, "Website");
  assert.equal(res.body.data[0].budget, "125.00"); assert.equal(res.body.data[0].endDate, null);
  assert.equal(res.body.data[0].createdAt.toISOString(), date.toISOString());
  assert.deepEqual(res.body.data[0].customFields, { reference: "R1" });
  assert.equal(actors[0], actor); assert.ok(predicates[0].params.includes("org-a"));
  res = response(); await projects.getProjectById({ user: { ...actor, isOrganizationOwner: false }, params: { id: "p" } }, res);
  assert.equal(res.body.data.budget, null);
  assert.ok(predicates[1].params.includes("p")); assert.ok(predicates[1].params.includes("org-a"));
});

test("project controllers keep missing context and absent records distinct", async () => {
  let res = response(); await projects.getAllProjects({ user: {} }, res);
  assert.equal(res.code, 400); assert.equal(predicates.length, 0);
  res = response(); await projects.getProjectById({ user: actor, params: { id: "missing" } }, res);
  assert.equal(res.code, 404);
  res = response(); await projects.getAllProjects({ user: actor }, res);
  assert.deepEqual(res.body.data, []);
});

test("payment status write keeps organization and ID in the same database predicate", async () => {
  rows = [{ id: "link-a", status: "paid" }];
  const res = response(); await updatePaymentLinkStatus({ user: actor, params: { id: "link-a" }, body: { status: "paid" } }, res);
  assert.equal(res.code, 200); assert.deepEqual(res.body.data, { id: "link-a", status: "paid" });
  assert.deepEqual(predicates[0].params, ["link-a", "org-a"]);
  assert.equal(updates[0].status, "paid"); assert.ok(updates[0].updatedAt instanceof Date);
});

test("payment status validation precedes writes and missing links retain 404", async () => {
  let res = response(); await updatePaymentLinkStatus({ user: actor, params: { id: "x" }, body: { status: "invented" } }, res);
  assert.equal(res.code, 400); assert.equal(updates.length, 0);
  res = response(); await updatePaymentLinkStatus({ user: actor, params: { id: "x" }, body: { status: "paid" } }, res);
  assert.equal(res.code, 404);
});

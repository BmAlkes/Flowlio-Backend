import { createHash, randomUUID } from "node:crypto";
import { and, eq, gt, gte, inArray, isNull, lt, or, sql } from "drizzle-orm";
import { database } from "@/configs/connection.config";
import { clients, invoices, invoiceTimeItems, projects, recentActivities, tasks, timeEntries, timeInvoicingRequests, users } from "@/schema/schema";
import { Actor, canManageClients } from "@/security/resource-policy";
import { projectReadScope, taskReadScope } from "@/security/resource-access";
import { canCreateInvoice } from "@/utils/plan-access.util";
import { insertNumberedInvoice } from "./invoice-numbering.service";
import { formatCents, MAX_INVOICE_CENTS, priceTime, TimeBillingFilter, TimeInvoiceInput, TimeInvoicingError } from "./time-invoicing-policy";

type Transaction = Parameters<Parameters<typeof database.transaction>[0]>[0];
export function assertTimeBillingActor(actor?: Actor): asserts actor is Actor & { organizationId: string } {
  if (!actor?.id) throw new TimeInvoicingError(401, "AUTHENTICATION_REQUIRED", "Authentication required.");
  if (!actor.organizationId || !canManageClients(actor)) throw new TimeInvoicingError(403, "BILLING_FORBIDDEN", "You do not have permission to invoice time.");
}
const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");

function eligibleQuery(tx: Transaction | typeof database, actor: Actor, filter: TimeBillingFilter, ids?: string[]) {
  return tx.select({
    id: timeEntries.id, userName: users.name, projectName: projects.name,
    taskTitle: tasks.title, description: timeEntries.description,
    startTime: timeEntries.startTime, endTime: timeEntries.endTime,
    duration: timeEntries.duration, hourlyRate: timeEntries.hourlyRate,
  }).from(timeEntries)
    .innerJoin(projects, eq(projects.id, timeEntries.projectId))
    .innerJoin(users, eq(users.id, timeEntries.userId))
    .leftJoin(tasks, eq(tasks.id, timeEntries.taskId))
    .leftJoin(invoiceTimeItems, eq(invoiceTimeItems.timeEntryId, timeEntries.id))
    .where(and(
      projectReadScope(actor), eq(projects.clientId, filter.clientId),
      or(isNull(timeEntries.clientId), eq(timeEntries.clientId, filter.clientId)),
      or(isNull(timeEntries.taskId), and(eq(tasks.projectId, projects.id), taskReadScope(actor))),
      eq(timeEntries.status, "completed"), eq(timeEntries.billable, true),
      sql`${timeEntries.endTime} is not null`, gt(timeEntries.duration, 0),
      gte(timeEntries.startTime, new Date(filter.start)), lt(timeEntries.startTime, new Date(filter.end)),
      sql`not exists(select 1 from retainer_entries re where re.time_entry_id=${timeEntries.id})`,
      isNull(invoiceTimeItems.id), ids ? inArray(timeEntries.id, ids) : undefined,
    )).orderBy(timeEntries.id);
}
async function requireClient(tx: Transaction | typeof database, orgId: string, clientId: string) {
  const [client] = await tx.select({ id: clients.id, name: clients.name }).from(clients)
    .where(and(eq(clients.id, clientId), eq(clients.organizationId, orgId))).limit(1);
  if (!client) throw new TimeInvoicingError(404, "CLIENT_NOT_FOUND", "Client not found.");
  return client;
}
export async function listBillableTime(actor: Actor, filter: TimeBillingFilter) {
  assertTimeBillingActor(actor);
  await requireClient(database, actor.organizationId, filter.clientId);
  const rows = await eligibleQuery(database, actor, filter).limit(501);
  const legacy = await database.select({ id: invoices.id }).from(invoices).where(and(
    eq(invoices.organizationId, actor.organizationId), eq(invoices.clientId, filter.clientId),
    sql`${invoices.description} ~ ${"^Time tracking [(][0-9]{4}-[0-9]{2}-[0-9]{2} to [0-9]{4}-[0-9]{2}-[0-9]{2}[)], [0-9]+[.][0-9]{2}h total:"}`,
  )).limit(1);
  return { entries: rows.slice(0, 500).map(row => ({ ...row, version: hash(row) })), hasMore: rows.length > 500, hasLegacyTimeInvoices: legacy.length > 0 };
}
export async function createTimeInvoice(actor: Actor, input: TimeInvoiceInput) {
  assertTimeBillingActor(actor);
  const normalized = { ...input, entries: [...input.entries].sort((a, b) => a.id.localeCompare(b.id)) };
  const requestHash = hash(normalized);
  return database.transaction(async tx => {
    // Serializes same-organization requests, including retries, before quota checks.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${"time-invoice:" + actor.organizationId}, 0))`);
    const [prior] = await tx.select().from(timeInvoicingRequests).where(and(
      eq(timeInvoicingRequests.organizationId, actor.organizationId), eq(timeInvoicingRequests.requestKey, input.requestKey),
    ));
    if (prior) {
      if (prior.actorId !== actor.id || prior.requestHash !== requestHash) throw new TimeInvoicingError(409, "REQUEST_KEY_CONFLICT", "This request key was already used for another invoice request.");
      if (!prior.invoiceId) throw new TimeInvoicingError(410, "INVOICE_DELETED", "The invoice created by this request was deleted. Refresh before creating a new invoice.");
      const [invoice] = await tx.select().from(invoices).where(and(eq(invoices.id, prior.invoiceId), eq(invoices.organizationId, actor.organizationId)));
      if (!invoice) throw new TimeInvoicingError(410, "INVOICE_DELETED", "Invoice no longer exists.");
      return { invoice, replayed: true };
    }
    const client = await requireClient(tx, actor.organizationId, input.clientId);
    const access = await canCreateInvoice(actor.organizationId);
    if (!access.hasAccess) throw new TimeInvoicingError(403, "INVOICE_LIMIT_EXCEEDED", access.reason ?? "Invoice limit reached.");
    const rows = await eligibleQuery(tx, actor, input, input.entries.map(entry => entry.id))
      .for("update", { of: [timeEntries, projects] });
    if (rows.length !== input.entries.length) throw new TimeInvoicingError(409, "TIME_CHANGED", "Some selected time is no longer available. Refresh and review your selection.");
    const versions = new Map(input.entries.map(entry => [entry.id, entry.version]));
    const items = rows.map(row => {
      if (versions.get(row.id) !== hash(row)) throw new TimeInvoicingError(409, "TIME_CHANGED", "Selected time or rates changed. Refresh and review the updated values.");
      const price = priceTime(row.duration!, row.hourlyRate, input.fallbackRate);
      return { row, ...price };
    });
    const totalCents = items.reduce((total, item) => total + item.amountCents, BigInt(0));
    if (totalCents <= BigInt(0) || totalCents > MAX_INVOICE_CENTS) throw new TimeInvoicingError(400, "INVALID_AMOUNT", "The invoice total must be positive and within the supported limit.");
    const description = "Tracked time:\n" + items.map(item =>
      item.row.projectName + " / " + (item.row.taskTitle ?? item.row.description ?? "Time entry") +
      " - " + item.row.duration + " min x " + item.hourlyRate + "/h = " + item.amount).join("\n");
    const invoice = await insertNumberedInvoice(tx, "S1", { id: randomUUID(), organizationId: actor.organizationId,
      clientId: client.id, createdBy: actor.id, clientname: client.name.trim(), amount: formatCents(totalCents),
      status: "draft", description, dueDate: input.dueDate ? new Date(input.dueDate + "T00:00:00Z") : null });
    await tx.insert(invoiceTimeItems).values(items.map(item => ({
      id: randomUUID(), invoiceId: invoice.id, timeEntryId: item.row.id,
      userName: item.row.userName, projectName: item.row.projectName, taskTitle: item.row.taskTitle,
      description: item.row.description, startedAt: item.row.startTime, minutes: item.row.duration!,
      hourlyRate: item.hourlyRate, amount: item.amount,
    })));
    await tx.insert(timeInvoicingRequests).values({ organizationId: actor.organizationId, requestKey: input.requestKey,
      actorId: actor.id, requestHash, invoiceId: invoice.id });
    await tx.insert(recentActivities).values({ organizationId: actor.organizationId, actorId: actor.id,
      type: "invoice", action: "create", resource: "invoice", resourceId: invoice.id,
      message: "Created invoice: " + invoice.invoiceNumber + " for " + client.name.trim(),
      metadata: { amount: invoice.amount, clientId: client.id, timeEntryCount: items.length } });
    return { invoice, replayed: false };
  });
}

export async function getInvoiceTimeItems(actor: Actor, invoiceId: string) {
  assertTimeBillingActor(actor);
  const [invoice] = await database.select({ id: invoices.id }).from(invoices)
    .where(and(eq(invoices.id, invoiceId), eq(invoices.organizationId, actor.organizationId))).limit(1);
  if (!invoice) throw new TimeInvoicingError(404, "INVOICE_NOT_FOUND", "Invoice not found.");
  return database.select().from(invoiceTimeItems).where(eq(invoiceTimeItems.invoiceId, invoiceId)).orderBy(invoiceTimeItems.startedAt, invoiceTimeItems.id);
}

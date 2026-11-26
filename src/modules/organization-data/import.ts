import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { z } from "zod";
import { ensureFieldsByName } from "../custom-fields/service";
import { guessType, importValue, normalizeValue } from "../custom-fields/values";

/**
 * Spreadsheet import (Monday, Trello, Asana, Excel/CSV). The browser parses the file and maps the columns;
 * this receives clean rows, validates them and creates everything in one transaction, with the same defaults
 * and plan limits as creating the records by hand.
 */
export const MAX_IMPORT_ROWS = 2000;
const DEFAULT_MILESTONES = ["Discovery", "Design", "Development", "Launch & Handoff"];
const text = (max: number) => z.string().trim().max(max).optional().nullable().transform(value => value || null);
const date = z.string().trim().optional().nullable().transform(value => (value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null));
/** Columns the file has beyond the known ones, by column name; they are kept instead of dropped. */
const extra = z.record(z.string().trim().min(1).max(100), z.union([z.string(), z.number(), z.boolean()]).transform(value => String(value).trim().slice(0, 2000)))
  .optional().default({})
  .refine(value => Object.keys(value).length <= 50, { message: "Too many extra columns" })
  .transform(value => Object.fromEntries(Object.entries(value).filter(([, cell]) => cell !== "")));

export const contactRow = z.object({
  name: z.string().trim().min(1).max(200),
  email: z.string().trim().max(200).optional().nullable().transform(value => value?.toLowerCase() || ""),
  phone: text(50),
  cpfcnpj: text(30),
  businessIndustry: text(200),
  address: text(500),
  status: text(60),
  note: text(2000),
  extra,
}).refine(row => !row.email || z.string().email().safeParse(row.email).success, { message: "Invalid email", path: ["email"] });

export const taskRow = z.object({
  project: z.string().trim().min(1).max(200),
  title: z.string().trim().min(1).max(500),
  description: text(5000),
  status: text(60),
  assigneeEmail: text(200),
  startDate: date,
  endDate: date,
  estimatedHours: z.union([z.number(), z.string()]).optional().nullable().transform(value => {
    const number = typeof value === "string" ? Number(value.replace(",", ".")) : value;
    return number != null && Number.isFinite(number) && number >= 0 && number < 100000 ? number : null;
  }),
  extra,
});

export const importInput = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("leads"), rows: z.array(z.unknown()).min(1).max(MAX_IMPORT_ROWS) }),
  z.object({ kind: z.literal("clients"), rows: z.array(z.unknown()).min(1).max(MAX_IMPORT_ROWS) }),
  z.object({ kind: z.literal("tasks"), rows: z.array(z.unknown()).min(1).max(MAX_IMPORT_ROWS) }),
]);

export type ImportResult = { created: number; skipped: { row: number; reason: string }[]; projectsCreated: number };
export class ImportError extends Error {
  constructor(public code: string, message: string, public status = 400) { super(message); }
}

const LEAD_STAGES = ["New Lead", "Contacted", "Qualified", "Proposal Sent", "Contract Signed", "Project In Progress", "Completed", "Inactive", "Lost"];
export function normalizeLeadStatus(value: string | null) {
  if (!value) return "New Lead";
  return LEAD_STAGES.find(stage => stage.toLowerCase() === value.toLowerCase()) ?? "New Lead";
}

/** Monday/Trello/Asana and Portuguese/Spanish/English labels to Flowlio task statuses. */
export function normalizeTaskStatus(value: string | null) {
  const label = (value ?? "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").trim();
  if (!label) return "todo";
  if (/(done|complete|conclu|finaliz|feito|termin|hech|listo)/.test(label)) return "completed";
  if (/(stuck|block|delay|atras|preso|bloque|trab)/.test(label)) return "delay";
  if (/(working|progress|andamento|doing|fazendo|curso|progreso)/.test(label)) return "in_progress";
  if (/(review|revis|change|ajust|aprova)/.test(label)) return "changes";
  return "todo";
}

/** Same rule as the rest of the app: organization override first, then the plan; 0 or missing means unlimited. */
async function planLimit(client: PoolClient, organizationId: string, feature: "maxLeads" | "maxClients" | "maxProjects" | "maxTasks", override: string | null) {
  const quota = (await client.query(
    `select ${override ? "o." + override : "null::int"} as override, coalesce(s.features, p.features) features
     from organizations o left join subscription_plans p on p.id=o.subscription_plan_id
     left join lateral (select sp.features from subscriptions sub join subscription_plans sp on sp.id=sub.plan_id
       where sub.organization_id=o.id order by sub.created_at desc, sub.id desc limit 1) s on true where o.id=$1`, [organizationId],
  )).rows[0];
  const limit = quota?.override ?? quota?.features?.[feature];
  return Number.isInteger(limit) && limit > 0 ? (limit as number) : null;
}

export async function ensureRoom(client: PoolClient, organizationId: string, feature: "maxLeads" | "maxClients" | "maxProjects" | "maxTasks", override: string | null, countSql: string, adding: number, label: string) {
  if (!adding) return;
  const limit = await planLimit(client, organizationId, feature, override);
  if (limit == null) return;
  const current = (await client.query<{ n: number }>(countSql, [organizationId])).rows[0].n;
  if (current + adding > limit) {
    throw new ImportError("PLAN_LIMIT_REACHED", `${label}: your plan allows ${limit}, you have ${current} and the file adds ${adding}.`, 403);
  }
}

export async function importRows(pool: Pool, actor: { id: string; organizationId: string }, input: z.infer<typeof importInput>): Promise<ImportResult> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = input.kind === "tasks" ? await importTasks(client, actor, input.rows) : await importContacts(client, actor, input.kind, input.rows);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

async function importContacts(client: PoolClient, actor: { id: string; organizationId: string }, kind: "leads" | "clients", raw: unknown[]): Promise<ImportResult> {
  const skipped: ImportResult["skipped"] = [];
  const existing = new Set((await client.query<{ email: string }>("select lower(email) email from clients where organization_id=$1 and email <> ''", [actor.organizationId])).rows.map(row => row.email));
  const rows: { index: number; data: z.infer<typeof contactRow> }[] = [];
  raw.forEach((value, index) => {
    const parsed = contactRow.safeParse(value);
    if (!parsed.success) return skipped.push({ row: index + 1, reason: parsed.error.issues[0]?.path.join(".") + ": " + parsed.error.issues[0]?.message });
    if (parsed.data.email && existing.has(parsed.data.email)) return skipped.push({ row: index + 1, reason: "duplicate email" });
    if (parsed.data.email) existing.add(parsed.data.email);
    rows.push({ index, data: parsed.data });
  });
  const type = kind === "leads" ? "lead" : "client";
  if (kind === "leads") await ensureRoom(client, actor.organizationId, "maxLeads", "override_max_leads", "select count(*)::int n from clients where organization_id=$1 and type='lead'", rows.length, "Leads");
  else await ensureRoom(client, actor.organizationId, "maxClients", null, "select count(*)::int n from clients where organization_id=$1 and type='client'", rows.length, "Clients");
  for (const { data } of rows) {
    // Imported contacts get no portal login; it can be enabled later from the client page.
    await client.query(
      // Extra columns are stored by column name, which the lead and client pages already show.
      `insert into clients (id, organization_id, name, email, phone, cpf_cnpj_number, business_industry, address, status, type, follow_up_note, created_by, position, portal_access_enabled, custom_fields, created_at, updated_at)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,0,false,$13::json,now(),now())`,
      [randomUUID(), actor.organizationId, data.name, data.email, data.phone, data.cpfcnpj, data.businessIndustry, data.address,
        type === "lead" ? normalizeLeadStatus(data.status) : "active", type, data.note, actor.id, Object.keys(data.extra).length ? JSON.stringify(data.extra) : null],
    );
  }
  return { created: rows.length, skipped, projectsCreated: 0 };
}

async function importTasks(client: PoolClient, actor: { id: string; organizationId: string }, raw: unknown[]): Promise<ImportResult> {
  const skipped: ImportResult["skipped"] = [];
  const rows: z.infer<typeof taskRow>[] = [];
  raw.forEach((value, index) => {
    const parsed = taskRow.safeParse(value);
    if (parsed.success) rows.push(parsed.data);
    else skipped.push({ row: index + 1, reason: parsed.error.issues[0]?.path.join(".") + ": " + parsed.error.issues[0]?.message });
  });
  const projects = new Map((await client.query<{ id: string; name: string }>("select id, name from projects where organization_id=$1", [actor.organizationId])).rows.map(row => [row.name.toLowerCase(), row.id]));
  const newProjects = [...new Set(rows.map(row => row.project).filter(name => !projects.has(name.toLowerCase())))];
  await ensureRoom(client, actor.organizationId, "maxProjects", null, "select count(*)::int n from projects where organization_id=$1", newProjects.length, "Projects");
  await ensureRoom(client, actor.organizationId, "maxTasks", "override_max_tasks", "select count(*)::int n from tasks t join projects p on p.id=t.project_id where p.organization_id=$1", rows.length, "Tasks");
  for (const name of newProjects) projects.set(name.toLowerCase(), await createImportedProject(client, actor, name));
  const fields = await taskFieldsFor(client, actor.organizationId, rows);
  const members = new Map((await client.query<{ id: string; email: string }>(
    "select u.id, lower(u.email) email from user_organizations uo join users u on u.id=uo.user_id where uo.organization_id=$1 and uo.status='active'",
    [actor.organizationId],
  )).rows.map(row => [row.email, row.id]));
  for (const row of rows) {
    const assignee = row.assigneeEmail ? members.get(row.assigneeEmail.toLowerCase()) ?? null : null;
    await client.query(
      `insert into tasks (id, title, description, project_id, assigned_to, created_by, status, visibility, start_date, end_date, estimated_hours, custom_fields, created_at, updated_at)
       values ($1,$2,$3,$4,$5,$6,$7,'private',$8::date,$9::date,$10,$11::jsonb,now(),now())`,
      [randomUUID(), row.title, row.description, projects.get(row.project.toLowerCase()), assignee, actor.id, normalizeTaskStatus(row.status), row.startDate, row.endDate, row.estimatedHours, JSON.stringify(taskValues(row.extra, fields))],
    );
  }
  return { created: rows.length, skipped, projectsCreated: newProjects.length };
}

/** Each extra column becomes an organization-wide task field, typed from its values (numbers, dates, a short list of labels...). */
async function taskFieldsFor(client: PoolClient, organizationId: string, rows: { extra: Record<string, string> }[]) {
  const names = [...new Set(rows.flatMap(row => Object.keys(row.extra)))];
  if (!names.length) return new Map();
  const columns = names.map(name => {
    const values = rows.map(row => row.extra[name] ?? "");
    const type = guessType(values);
    // Distinct labels; used when the field is (or already exists as) a select field.
    const options = [...new Map(values.filter(Boolean).map(value => [value.toLowerCase(), value])).values()].slice(0, 50);
    return { name, type, options };
  });
  return ensureFieldsByName(client, organizationId, "task", columns);
}

/** Values that do not fit their field (a word in a number column) are left out rather than failing the row. */
function taskValues(extra: Record<string, string>, fields: Map<string, { id: string; name: string; type: string; options?: { label: string; color: string }[] | null }>) {
  const values: Record<string, unknown> = {};
  for (const [name, raw] of Object.entries(extra)) {
    const field = fields.get(name);
    if (!field) continue;
    try {
      const value = normalizeValue(field, importValue(field.type as never, raw));
      if (value !== null) values[field.id] = value;
    } catch {
      // Kept out on purpose; the rest of the row is imported.
    }
  }
  return values;
}

/** Same defaults as the Projects page: pending, private and the default milestones. */
export async function createImportedProject(client: PoolClient, actor: { id: string; organizationId: string }, name: string) {
  const id = randomUUID();
  await client.query(
    `insert into projects (id, name, project_number, organization_id, created_by, status, visibility, progress, tags, settings, created_at, updated_at)
     values ($1,$2,'',$3,$4,'pending','private',0,'[]','{"allowGuestAccess":false,"autoAssignTasks":false,"requireApproval":false}',now(),now())`,
    [id, name.slice(0, 200), actor.organizationId, actor.id],
  );
  await client.query(
    `insert into project_milestones (id, project_id, organization_id, title, status, position, created_at, updated_at)
     select t.id, $1, $2, t.title, 'pending', t.position - 1, now(), now() from unnest($3::text[], $4::text[]) with ordinality t(title, id, position)`,
    [id, actor.organizationId, DEFAULT_MILESTONES, DEFAULT_MILESTONES.map(() => randomUUID())],
  );
  return id;
}

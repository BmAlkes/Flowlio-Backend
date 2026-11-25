import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { z } from "zod";
import { canManageClients, canPerform, canReadProject, type Actor } from "../../security/resource-policy";
import { applyValues, ENTITY_TYPES, FIELD_TYPES, FieldValueError, type FieldDefinition, type FieldType } from "./values";

export class CustomFieldError extends Error {
  constructor(public status: number, public code: string, message = code) { super(message); }
}

const MAX_FIELDS = 100;
const color = z.string().regex(/^#[0-9a-fA-F]{6}$/).catch("#3b82f6");
const options = z.array(z.object({ label: z.string().trim().min(1).max(100), color })).max(50);
const createInput = z.object({
  name: z.string().trim().min(1).max(100),
  type: z.enum(FIELD_TYPES),
  entityType: z.enum(ENTITY_TYPES).default("project"),
  options: options.optional(),
  projectId: z.string().min(1).max(128).nullable().optional(),
}).strict().refine(input => input.type !== "select" || (input.options?.length ?? 0) > 0, { message: "Select fields need options", path: ["options"] })
  .refine(input => !input.projectId || input.entityType === "task", { message: "Only task fields can belong to a project", path: ["projectId"] });
const updateInput = z.object({ name: z.string().trim().min(1).max(100).optional(), options: options.optional(), position: z.number().int().min(0).max(10000).optional() }).strict();
const valuesInput = z.object({ values: z.record(z.string().max(128), z.unknown()).refine(values => Object.keys(values).length <= 100) }).strict();

const columns = `id, organization_id as "organizationId", entity_type as "entityType", name, type, options, project_id as "projectId", position, created_at as "createdAt", updated_at as "updatedAt"`;
const STAFF = ["superadmin", "subadmin", "user", "operator", "viewer"];

function organization(actor: Actor) {
  if (!actor.organizationId || !STAFF.includes(actor.role)) throw new CustomFieldError(403, "FORBIDDEN");
  return actor.organizationId;
}
function manager(actor: Actor) {
  const organizationId = organization(actor);
  // Fields shape everyone's data, so only owners and managers define them.
  if (!canManageClients(actor)) throw new CustomFieldError(403, "FORBIDDEN", "Only owners and managers can change custom fields");
  return organizationId;
}

async function readableProject(client: Pool | PoolClient, actor: Actor, projectId: string) {
  const project = (await client.query(
    `select id, organization_id as "organizationId", created_by as "createdBy", assigned_to as "assignedTo", visibility from projects where id=$1 and organization_id=$2`,
    [projectId, actor.organizationId])).rows[0];
  if (!project || !canReadProject(actor, project)) throw new CustomFieldError(404, "PROJECT_NOT_FOUND");
  return project;
}

export function createCustomFields(pool: Pool) {
  async function list(actor: Actor, entityType: unknown) {
    const organizationId = organization(actor);
    const entity = ENTITY_TYPES.includes(entityType as never) ? String(entityType) : "project";
    // Project-specific task fields are listed only for projects the person can see.
    return (await pool.query(
      `select ${columns.split(", ").map(column => "f." + column).join(", ")} from custom_field_definitions f
       left join projects p on p.id = f.project_id
       where f.organization_id=$1 and f.entity_type=$2
         and (f.project_id is null or p.created_by=$3 or p.assigned_to=$3 or p.visibility='public')
       order by f.position, f.created_at`, [organizationId, entity, actor.id])).rows;
  }

  async function create(actor: Actor, raw: unknown) {
    const organizationId = manager(actor);
    const parsed = createInput.safeParse(raw);
    if (!parsed.success) throw new CustomFieldError(400, "INVALID_FIELD", parsed.error.issues[0]?.message);
    const input = parsed.data;
    if (input.projectId) await readableProject(pool, actor, input.projectId);
    const count = (await pool.query("select count(*)::int n, coalesce(max(position),-1)::int last from custom_field_definitions where organization_id=$1 and entity_type=$2", [organizationId, input.entityType])).rows[0];
    if (count.n >= MAX_FIELDS) throw new CustomFieldError(409, "TOO_MANY_FIELDS");
    return (await pool.query(
      `insert into custom_field_definitions (id, organization_id, entity_type, name, type, options, project_id, position, created_at, updated_at)
       values ($1,$2,$3,$4,$5,$6,$7,$8,now(),now()) returning ${columns}`,
      [randomUUID(), organizationId, input.entityType, input.name, input.type, input.type === "select" ? JSON.stringify(input.options) : null, input.projectId ?? null, count.last + 1])).rows[0];
  }

  async function update(actor: Actor, id: string, raw: unknown) {
    const organizationId = manager(actor);
    const parsed = updateInput.safeParse(raw);
    if (!parsed.success) throw new CustomFieldError(400, "INVALID_FIELD", parsed.error.issues[0]?.message);
    const current = (await pool.query(`select ${columns} from custom_field_definitions where id=$1 and organization_id=$2`, [id, organizationId])).rows[0];
    if (!current) throw new CustomFieldError(404, "NOT_FOUND");
    if (current.projectId) await readableProject(pool, actor, current.projectId);
    const next = parsed.data;
    if (next.options && current.type !== "select") throw new CustomFieldError(400, "INVALID_FIELD", "Only select fields have options");
    return (await pool.query(
      `update custom_field_definitions set name=coalesce($3,name), options=coalesce($4::json,options), position=coalesce($5,position), updated_at=now()
       where id=$1 and organization_id=$2 returning ${columns}`,
      [id, organizationId, next.name ?? null, next.options ? JSON.stringify(next.options) : null, next.position ?? null])).rows[0];
  }

  async function remove(actor: Actor, id: string) {
    const organizationId = manager(actor);
    const current = (await pool.query(`select ${columns} from custom_field_definitions where id=$1 and organization_id=$2`, [id, organizationId])).rows[0];
    if (!current) throw new CustomFieldError(404, "NOT_FOUND");
    if (current.projectId) await readableProject(pool, actor, current.projectId);
    await pool.query("delete from custom_field_definitions where id=$1 and organization_id=$2", [id, organizationId]);
    // Stored task values for the field are removed too, so they cannot reappear under a new field.
    if (current.entityType === "task") {
      await pool.query("update tasks t set custom_fields = t.custom_fields - $1 from projects p where p.id=t.project_id and p.organization_id=$2 and t.custom_fields ? $1", [id, organizationId]);
    }
    return { id };
  }

  /** Sets values on one task; the route already checked the person may update the task. */
  async function setTaskValues(actor: Actor, taskId: string, raw: unknown) {
    const organizationId = organization(actor);
    if (!canPerform(actor, "update")) throw new CustomFieldError(403, "FORBIDDEN");
    const parsed = valuesInput.safeParse(raw);
    if (!parsed.success) throw new CustomFieldError(400, "INVALID_VALUES");
    const client = await pool.connect();
    try {
      await client.query("begin");
      const task = (await client.query(
        "select t.id, t.project_id, t.custom_fields from tasks t join projects p on p.id=t.project_id where t.id=$1 and p.organization_id=$2 for update of t",
        [taskId, organizationId])).rows[0];
      if (!task) throw new CustomFieldError(404, "TASK_NOT_FOUND");
      const fields = (await client.query<FieldDefinition>(
        `select id, name, type, options, project_id as "projectId" from custom_field_definitions
         where organization_id=$1 and entity_type='task' and (project_id is null or project_id=$2)`, [organizationId, task.project_id])).rows;
      const needsMembers = fields.some(field => field.type === "person" && field.id in parsed.data.values);
      const members = needsMembers ? new Set((await client.query<{ user_id: string }>("select user_id from user_organizations where organization_id=$1 and status='active'", [organizationId])).rows.map(row => row.user_id)) : undefined;
      let values: Record<string, unknown>;
      try {
        values = applyValues(task.custom_fields ?? {}, parsed.data.values, fields, members);
      } catch (error) {
        if (error instanceof FieldValueError) throw new CustomFieldError(400, "INVALID_VALUE", `${fields.find(field => field.id === error.fieldId)?.name ?? error.fieldId}: ${error.reason}`);
        throw error;
      }
      await client.query("update tasks set custom_fields=$2::jsonb, updated_at=now() where id=$1", [taskId, JSON.stringify(values)]);
      await client.query("commit");
      return { id: taskId, customFields: values };
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  }

  return { list, create, update, remove, setTaskValues };
}

/**
 * Used by spreadsheet import: finds or creates organization-wide fields by name (case-insensitive)
 * and returns their definitions, so unknown columns are kept instead of dropped.
 */
export async function ensureFieldsByName(client: PoolClient, organizationId: string, entityType: "task" | "client", columns: { name: string; type: FieldType; options?: string[] }[]) {
  const existing = (await client.query<FieldDefinition & { position: number }>(
    `select id, name, type, options, project_id as "projectId", position from custom_field_definitions where organization_id=$1 and entity_type=$2 and project_id is null`,
    [organizationId, entityType])).rows;
  const byName = new Map(existing.map(field => [field.name.trim().toLowerCase(), field]));
  let position = existing.reduce((max, field) => Math.max(max, field.position), -1);
  const palette = ["#3b82f6", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6", "#ec4899", "#14b8a6", "#f97316", "#6366f1", "#6b7280", "#84cc16", "#0ea5e9"];
  const result = new Map<string, FieldDefinition>();
  for (const column of columns) {
    const key = column.name.trim().toLowerCase();
    let field = byName.get(key);
    if (!field) {
      if (byName.size >= MAX_FIELDS) throw new CustomFieldError(409, "TOO_MANY_FIELDS");
      const fieldOptions = column.type === "select" ? (column.options ?? []).slice(0, 50).map((label, index) => ({ label: label.slice(0, 100), color: palette[index % palette.length] })) : null;
      field = (await client.query<FieldDefinition & { position: number }>(
        `insert into custom_field_definitions (id, organization_id, entity_type, name, type, options, project_id, position, created_at, updated_at)
         values ($1,$2,$3,$4,$5,$6,null,$7,now(),now()) returning id, name, type, options, project_id as "projectId", position`,
        [randomUUID(), organizationId, entityType, column.name.trim().slice(0, 100), column.type, fieldOptions ? JSON.stringify(fieldOptions) : null, ++position])).rows[0];
      byName.set(key, field as FieldDefinition & { position: number });
    } else if (field.type === "select" && column.options?.length) {
      // New labels found in the file are added to an existing select field.
      const known = new Set((field.options ?? []).map(option => option.label.toLowerCase()));
      const added = column.options.filter(label => !known.has(label.toLowerCase()));
      if (added.length) {
        const merged = [...(field.options ?? []), ...added.map((label, index) => ({ label: label.slice(0, 100), color: palette[(known.size + index) % palette.length] }))].slice(0, 50);
        await client.query("update custom_field_definitions set options=$2::json, updated_at=now() where id=$1", [field.id, JSON.stringify(merged)]);
        field = { ...field, options: merged };
      }
    }
    result.set(column.name, field);
  }
  return result;
}

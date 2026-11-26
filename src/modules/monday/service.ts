import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { z } from "zod";
import { canManageClients, type Actor } from "../../security/resource-policy";
import { ensureFieldsByName } from "../custom-fields/service";
import { normalizeValue, type FieldDefinition } from "../custom-fields/values";
import { createImportedProject, ensureRoom, normalizeTaskStatus } from "../organization-data/import";
import { mondayClient, MondayError, type Fetch } from "./client";
import { mapBoard, type MappedBoard } from "./mapping";

const tokenInput = z.object({ token: z.string().min(1).max(4000) }).strict();
const importInput = z.object({ token: z.string().min(1).max(4000), boardId: z.string().regex(/^\d{1,20}$/) }).strict();

export type BoardImportResult = {
  boardId: string; projectId: string; projectName: string; projectCreated: boolean;
  created: number; updated: number; fields: number; unmatchedPeople: string[]; skippedColumns: string[];
};

function manager(actor: Actor) {
  if (!actor.organizationId || !canManageClients(actor)) throw new MondayError(403, "FORBIDDEN", "Only owners and managers can import from monday.com");
  return actor.organizationId;
}

async function link(client: PoolClient, organizationId: string, entityType: "project" | "task", externalId: string) {
  return (await client.query<{ entity_id: string }>(
    "select entity_id from external_links where organization_id=$1 and source='monday' and entity_type=$2 and external_id=$3",
    [organizationId, entityType, externalId])).rows[0]?.entity_id ?? null;
}
async function remember(client: PoolClient, organizationId: string, entityType: "project" | "task", externalId: string, entityId: string) {
  await client.query(
    `insert into external_links (organization_id, source, entity_type, external_id, entity_id) values ($1,'monday',$2,$3,$4)
     on conflict (organization_id, source, entity_type, external_id) do update set entity_id=excluded.entity_id, imported_at=now()`,
    [organizationId, entityType, externalId, entityId]);
}

/** Writes one mapped board: the project, its fields and its tasks, updating what an earlier import created. */
export async function writeBoard(client: PoolClient, actor: { id: string; organizationId: string }, boardId: string, mapped: MappedBoard): Promise<Omit<BoardImportResult, "boardId">> {
  const organizationId = actor.organizationId;
  let projectId: string | null = await link(client, organizationId, "project", boardId);
  if (projectId && !(await client.query("select 1 from projects where id=$1 and organization_id=$2", [projectId, organizationId])).rowCount) projectId = null;
  const projectCreated = !projectId;
  if (!projectId) {
    await ensureRoom(client, organizationId, "maxProjects", null, "select count(*)::int n from projects where organization_id=$1", 1, "Projects");
    projectId = await createImportedProject(client, actor, mapped.name);
    await remember(client, organizationId, "project", boardId, projectId);
  }
  const projectName = (await client.query<{ name: string }>("select name from projects where id=$1", [projectId])).rows[0].name;

  // Earlier imports: which items already exist (and still exist) as tasks.
  const known = new Map((await client.query<{ external_id: string; entity_id: string }>(
    `select l.external_id, l.entity_id from external_links l join tasks t on t.id=l.entity_id join projects p on p.id=t.project_id
     where l.organization_id=$1 and l.source='monday' and l.entity_type='task' and p.organization_id=$1 and l.external_id=any($2::text[])`,
    [organizationId, mapped.tasks.map(task => task.externalId)])).rows.map(row => [row.external_id, row.entity_id]));
  const adding = mapped.tasks.filter(task => !known.has(task.externalId)).length;
  await ensureRoom(client, organizationId, "maxTasks", "override_max_tasks", "select count(*)::int n from tasks t join projects p on p.id=t.project_id where p.organization_id=$1", adding, "Tasks");

  // Board columns become this project's own fields, like a board's columns in monday.
  const fields = mapped.fields.length ? await ensureFieldsByName(client, organizationId, "task", mapped.fields, projectId) : new Map<string, FieldDefinition>();
  const members = new Map((await client.query<{ id: string; email: string }>(
    "select u.id, lower(u.email) email from user_organizations m join users u on u.id=m.user_id where m.organization_id=$1 and m.status='active'", [organizationId])).rows.map(row => [row.email, row.id]));

  const valuesFor = (values: Record<string, string>) => {
    const result: Record<string, unknown> = {};
    for (const [name, raw] of Object.entries(values)) {
      const field = fields.get(name);
      if (!field) continue;
      try {
        const value = normalizeValue(field, raw);
        if (value !== null) result[field.id] = value;
      } catch {
        // A value that does not fit its field is left out; the rest of the item is kept.
      }
    }
    return result;
  };

  let created = 0;
  let updated = 0;
  const taskIds = new Map<string, string>();
  // Parents first, so subitems can point to them.
  for (const task of [...mapped.tasks].sort((a, b) => Number(!!a.parentExternalId) - Number(!!b.parentExternalId))) {
    const parentId = task.parentExternalId ? taskIds.get(task.parentExternalId) ?? null : null;
    const assignee = task.assigneeEmail ? members.get(task.assigneeEmail) ?? null : null;
    const status = normalizeTaskStatus(task.status);
    const values = valuesFor(task.values);
    const existing = known.get(task.externalId);
    if (existing) {
      // Re-import refreshes monday's data and keeps Flowlio-only field values.
      await client.query(
        `update tasks set title=$2, description=coalesce($3, description), status=$4, assigned_to=coalesce($5, assigned_to), start_date=coalesce($6::date, start_date),
           end_date=coalesce($7::date, end_date), parent_id=$8, custom_fields=custom_fields || $9::jsonb, updated_at=now() where id=$1`,
        [existing, task.title, task.description, status, assignee, task.startDate, task.endDate, parentId, JSON.stringify(values)]);
      taskIds.set(task.externalId, existing);
      updated++;
      continue;
    }
    const id = randomUUID();
    await client.query(
      `insert into tasks (id, title, description, project_id, parent_id, assigned_to, created_by, status, visibility, start_date, end_date, custom_fields, created_at, updated_at)
       values ($1,$2,$3,$4,$5,$6,$7,$8,'private',$9::date,$10::date,$11::jsonb,now(),now())`,
      [id, task.title, task.description, projectId, parentId, assignee, actor.id, status, task.startDate, task.endDate, JSON.stringify(values)]);
    await remember(client, organizationId, "task", task.externalId, id);
    taskIds.set(task.externalId, id);
    created++;
  }
  return {
    projectId, projectName, projectCreated, created, updated, fields: fields.size,
    unmatchedPeople: mapped.unmatchedPeople,
    skippedColumns: mapped.plan.filter(entry => entry.role === "skip").map(entry => entry.column.title),
  };
}

export function createMondayImport(pool: Pool, fetchImpl?: Fetch) {
  async function boards(actor: Actor, raw: unknown) {
    manager(actor);
    const parsed = tokenInput.safeParse(raw);
    if (!parsed.success) throw new MondayError(400, "INVALID_TOKEN", "Paste your monday.com API token");
    return mondayClient(parsed.data.token, fetchImpl).boards();
  }

  async function importBoard(actor: Actor, raw: unknown): Promise<BoardImportResult> {
    const organizationId = manager(actor);
    const parsed = importInput.safeParse(raw);
    if (!parsed.success) throw new MondayError(400, "INVALID_REQUEST");
    const monday = mondayClient(parsed.data.token, fetchImpl);
    const [board, users] = await Promise.all([monday.board(parsed.data.boardId), monday.users()]);
    const memberEmails = new Set((await pool.query<{ email: string }>(
      "select lower(u.email) email from user_organizations m join users u on u.id=m.user_id where m.organization_id=$1 and m.status='active'", [organizationId])).rows.map(row => row.email));
    const mapped = mapBoard(board, users, memberEmails);
    const client = await pool.connect();
    try {
      await client.query("begin");
      // One import per organization at a time, so two runs cannot create the same project twice.
      await client.query("select pg_advisory_xact_lock(hashtextextended($1,0))", ["monday-import:" + organizationId]);
      const result = await writeBoard(client, { id: actor.id, organizationId }, board.id, mapped);
      await client.query("commit");
      return { boardId: board.id, ...result };
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  }

  return { boards, importBoard };
}

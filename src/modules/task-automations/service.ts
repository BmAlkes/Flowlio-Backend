import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { canManageClients, canReadProject, type Actor } from "../../security/resource-policy";
import { normalizeValue } from "../custom-fields/values";
import { enqueue } from "../../services/jobs/queue";
import {
  addDays, conditionsMatch, MAX_CHAIN, MAX_RULES, render, ruleInput, scheduleKey, triggerMatches,
  type Action, type Rule, type RuleInput, type TaskEvent, type TaskState,
} from "./rules";

export class AutomationError extends Error {
  constructor(public status: number, public code: string, message = code) { super(message); }
}

const columns = `id, organization_id as "organizationId", project_id as "projectId", name, enabled, trigger, conditions, actions, created_by as "createdBy", run_count as "runCount", last_run_at as "lastRunAt", created_at as "createdAt", updated_at as "updatedAt"`;

function manager(actor: Actor) {
  if (!actor.organizationId || !canManageClients(actor)) throw new AutomationError(403, "FORBIDDEN", "Only owners and managers can manage automations");
  return actor.organizationId;
}

/** Checks that projects, fields and people a rule points to belong to the organization (and its project). */
async function checkReferences(client: Pool | PoolClient, actor: Actor, organizationId: string, rule: RuleInput) {
  const projectIds = new Set<string>();
  if (rule.projectId) projectIds.add(rule.projectId);
  for (const action of rule.actions) {
    if (action.type === "move_project") projectIds.add(action.projectId);
    if (action.type === "create_task" && action.projectId !== "same") projectIds.add(action.projectId);
  }
  for (const projectId of projectIds) {
    const project = (await client.query(`select id, organization_id as "organizationId", created_by as "createdBy", assigned_to as "assignedTo", visibility from projects where id=$1 and organization_id=$2`, [projectId, organizationId])).rows[0];
    if (!project || !canReadProject(actor, project)) throw new AutomationError(400, "INVALID_RULE", "A project in this rule was not found");
  }
  const fieldIds = new Set<string>();
  if (rule.trigger.type === "field_changed") fieldIds.add(rule.trigger.fieldId);
  for (const condition of rule.conditions) if (condition.type === "field") fieldIds.add(condition.fieldId);
  const fieldActions = rule.actions.filter((action): action is Extract<Action, { type: "set_field" }> => action.type === "set_field");
  fieldActions.forEach(action => fieldIds.add(action.fieldId));
  const fields = fieldIds.size ? (await client.query(`select id, name, type, options, project_id as "projectId" from custom_field_definitions where organization_id=$1 and entity_type='task' and id=any($2::text[])`, [organizationId, [...fieldIds]])).rows : [];
  if (fields.length !== fieldIds.size) throw new AutomationError(400, "INVALID_RULE", "A field in this rule was not found");
  const userIds = new Set<string>();
  for (const action of rule.actions) {
    if (action.type === "assign" && action.userId !== "creator") userIds.add(action.userId);
    if (action.type === "notify" && typeof action.recipient === "object") userIds.add(action.recipient.userId);
    if (action.type === "create_task" && !["same", "none"].includes(action.assignee)) userIds.add(action.assignee);
  }
  for (const condition of rule.conditions) if (condition.type === "assignee" && condition.value) userIds.add(condition.value);
  const members = new Set((await client.query<{ user_id: string }>("select user_id from user_organizations where organization_id=$1 and status='active'", [organizationId])).rows.map(row => row.user_id));
  if ([...userIds].some(userId => !members.has(userId))) throw new AutomationError(400, "INVALID_RULE", "A person in this rule is not an active member");
  // Values set by the rule must fit their field, like values typed by hand.
  for (const action of fieldActions) {
    if (action.value === null) continue;
    try { normalizeValue(fields.find(field => field.id === action.fieldId), action.value, members); } catch { throw new AutomationError(400, "INVALID_RULE", "A value does not fit its field"); }
  }
}

export function createTaskAutomations(pool: Pool) {
  async function list(actor: Actor) {
    const organizationId = manager(actor);
    return (await pool.query(`select ${columns} from task_automation_rules where organization_id=$1 order by created_at`, [organizationId])).rows;
  }

  async function save(actor: Actor, raw: unknown, id?: string) {
    const organizationId = manager(actor);
    const parsed = ruleInput.safeParse(raw);
    if (!parsed.success) throw new AutomationError(400, "INVALID_RULE", parsed.error.issues[0]?.message);
    const rule = parsed.data;
    await checkReferences(pool, actor, organizationId, rule);
    if (!id) {
      const count = (await pool.query("select count(*)::int n from task_automation_rules where organization_id=$1", [organizationId])).rows[0].n;
      if (count >= MAX_RULES) throw new AutomationError(409, "TOO_MANY_RULES", `Up to ${MAX_RULES} automations per organization`);
      return (await pool.query(
        `insert into task_automation_rules (id, organization_id, project_id, name, enabled, trigger, conditions, actions, created_by) values ($1,$2,$3,$4,$5,$6,$7,$8,$9) returning ${columns}`,
        [randomUUID(), organizationId, rule.projectId ?? null, rule.name, rule.enabled, JSON.stringify(rule.trigger), JSON.stringify(rule.conditions), JSON.stringify(rule.actions), actor.id])).rows[0];
    }
    // Whoever edits a rule becomes the person it acts for.
    const updated = (await pool.query(
      `update task_automation_rules set project_id=$3, name=$4, enabled=$5, trigger=$6, conditions=$7, actions=$8, created_by=$9, updated_at=now() where id=$1 and organization_id=$2 returning ${columns}`,
      [id, organizationId, rule.projectId ?? null, rule.name, rule.enabled, JSON.stringify(rule.trigger), JSON.stringify(rule.conditions), JSON.stringify(rule.actions), actor.id])).rows[0];
    if (!updated) throw new AutomationError(404, "NOT_FOUND");
    return updated;
  }

  async function toggle(actor: Actor, id: string, enabled: unknown) {
    const organizationId = manager(actor);
    if (typeof enabled !== "boolean") throw new AutomationError(400, "INVALID_RULE");
    const updated = (await pool.query(`update task_automation_rules set enabled=$3, updated_at=now() where id=$1 and organization_id=$2 returning ${columns}`, [id, organizationId, enabled])).rows[0];
    if (!updated) throw new AutomationError(404, "NOT_FOUND");
    return updated;
  }

  async function remove(actor: Actor, id: string) {
    const organizationId = manager(actor);
    const deleted = await pool.query("delete from task_automation_rules where id=$1 and organization_id=$2", [id, organizationId]);
    if (!deleted.rowCount) throw new AutomationError(404, "NOT_FOUND");
    return { id };
  }

  async function history(actor: Actor, ruleId?: unknown) {
    const organizationId = manager(actor);
    return (await pool.query(
      `select r.id, r.rule_id as "ruleId", a.name as "ruleName", r.task_id as "taskId", t.title as "taskTitle", r.outcome, r.details, r.created_at as "createdAt"
       from task_automation_runs r join task_automation_rules a on a.id=r.rule_id left join tasks t on t.id=r.task_id
       where r.organization_id=$1 and ($2::text is null or r.rule_id=$2) order by r.created_at desc limit 100`,
      [organizationId, typeof ruleId === "string" && ruleId ? ruleId : null])).rows;
  }

  return { list, save, toggle, remove, history };
}

// ---------------------------------------------------------------- processing (worker)

type StoredRule = Rule & { projectId: string | null; enabled: boolean };

async function loadTask(client: PoolClient, taskId: string): Promise<TaskState | null> {
  const row = (await client.query(
    `select t.id, t.title, t.status, t.assigned_to as "assignedTo", t.created_by as "createdBy", t.project_id as "projectId", p.name as "projectName",
            to_char(t.end_date, 'YYYY-MM-DD') as "endDate", t.custom_fields as "customFields"
     from tasks t join projects p on p.id=t.project_id where t.id=$1`, [taskId])).rows[0];
  return row ? { ...row, customFields: row.customFields ?? {} } : null;
}

async function planAllows(client: PoolClient, organizationId: string) {
  const row = (await client.query(
    `select o.override_max_tasks as override, coalesce(s.features, p.features) as features from organizations o left join subscription_plans p on p.id=o.subscription_plan_id
     left join lateral (select sp.features from subscriptions sub join subscription_plans sp on sp.id=sub.plan_id where sub.organization_id=o.id order by sub.created_at desc, sub.id desc limit 1) s on true
     where o.id=$1`, [organizationId])).rows[0];
  const limit = row?.override ?? row?.features?.maxTasks;
  if (!Number.isInteger(limit) || limit <= 0) return true;
  const count = (await client.query("select count(*)::int n from tasks t join projects p on p.id=t.project_id where p.organization_id=$1", [organizationId])).rows[0].n;
  return count < limit;
}

/** Applies a rule's actions; each change made here is recorded one step deeper in the chain. */
async function applyActions(client: PoolClient, rule: StoredRule, task: TaskState | null, depth: number, today: Date, members: Set<string>) {
  await client.query("select set_config('flowlio.automation_depth', $1, true)", [String(depth + 1)]);
  const done: string[] = [];
  for (const action of rule.actions) {
    if (action.type === "create_task") {
      if (!(await planAllows(client, rule.organizationId))) { done.push("plan_limit"); continue; }
      const projectId = action.projectId === "same" ? task?.projectId : action.projectId;
      if (!projectId) continue;
      const assignee = action.assignee === "same" ? task?.assignedTo ?? null : action.assignee === "none" ? null : members.has(action.assignee) ? action.assignee : null;
      await client.query(
        `insert into tasks (id, title, project_id, created_by, assigned_to, status, visibility, end_date, created_at, updated_at) values ($1,$2,$3,$4,$5,'todo','private',$6::date,now(),now())`,
        [randomUUID(), render(action.title, task).slice(0, 200) || action.title, projectId, rule.createdBy, assignee, action.dueInDays === undefined ? null : addDays(today, action.dueInDays)]);
      done.push("create_task");
      continue;
    }
    if (!task) continue;
    if (action.type === "notify") {
      const recipient = typeof action.recipient === "object" ? action.recipient.userId
        : action.recipient === "assignee" ? task.assignedTo
        : action.recipient === "creator" ? task.createdBy
        : (await client.query("select coalesce(assigned_to, created_by) as id from projects where id=$1", [task.projectId])).rows[0]?.id;
      if (!recipient || !members.has(recipient)) { done.push("no_recipient"); continue; }
      const message = render(action.message, task);
      await client.query(
        `insert into notifications (id, user_id, organization_id, type, title, message, data, read, created_at) values ($1,$2,$3,'system',$4,$5,$6,false,now())`,
        [randomUUID(), recipient, rule.organizationId, rule.name.slice(0, 200), message, JSON.stringify({ taskId: task.id, projectId: task.projectId, automationId: rule.id })]);
      if (action.channel === "email") {
        await enqueue(client, "task-automation-email", `task-automation-email:${randomUUID()}`, { organizationId: rule.organizationId, userId: recipient, title: rule.name, message });
      }
      done.push("notify");
      continue;
    }
    if (action.type === "set_status") await client.query("update tasks set status=$2, updated_at=now() where id=$1", [task.id, action.status]);
    if (action.type === "assign") {
      const userId = action.userId === "creator" ? task.createdBy : action.userId;
      if (!members.has(userId)) { done.push("no_assignee"); continue; }
      await client.query("update tasks set assigned_to=$2, updated_at=now() where id=$1", [task.id, userId]);
    }
    if (action.type === "set_due") await client.query("update tasks set end_date=$2::date, updated_at=now() where id=$1", [task.id, addDays(today, action.days)]);
    if (action.type === "move_project") {
      const exists = (await client.query("select 1 from projects where id=$1 and organization_id=$2", [action.projectId, rule.organizationId])).rowCount;
      if (!exists) { done.push("no_project"); continue; }
      await client.query("update tasks set project_id=$2, updated_at=now() where id=$1", [task.id, action.projectId]);
    }
    if (action.type === "set_field") {
      const field = (await client.query(`select id, name, type, options, project_id as "projectId" from custom_field_definitions where id=$1 and organization_id=$2 and entity_type='task'`, [action.fieldId, rule.organizationId])).rows[0];
      if (!field || (field.projectId && field.projectId !== task.projectId)) { done.push("no_field"); continue; }
      let normalized: unknown;
      try { normalized = action.value === null ? null : normalizeValue(field, action.value, members); } catch { done.push("invalid_value"); continue; }
      await client.query(
        normalized === null ? "update tasks set custom_fields = custom_fields - $2, updated_at=now() where id=$1" : "update tasks set custom_fields = custom_fields || jsonb_build_object($2::text, $3::jsonb), updated_at=now() where id=$1",
        normalized === null ? [task.id, field.id] : [task.id, field.id, JSON.stringify(normalized)]);
    }
    done.push(action.type);
  }
  return done;
}

/** Records the run once (per event or period) and applies it; returns false when it already ran. */
async function run(client: PoolClient, rule: StoredRule, task: TaskState | null, runKey: string, depth: number, today: Date, members: Set<string>) {
  const runId = randomUUID();
  const inserted = await client.query("insert into task_automation_runs (id, rule_id, organization_id, task_id, run_key, outcome) values ($1,$2,$3,$4,$5,'running') on conflict (rule_id, run_key) do nothing", [runId, rule.id, rule.organizationId, task?.id ?? null, runKey]);
  if (!inserted.rowCount) return false;
  await client.query("savepoint automation_run");
  try {
    const done = await applyActions(client, rule, task, depth, today, members);
    await client.query("release savepoint automation_run");
    await client.query("update task_automation_runs set outcome='done', details=$2 where id=$1", [runId, JSON.stringify({ actions: done })]);
  } catch (error) {
    await client.query("rollback to savepoint automation_run");
    await client.query("update task_automation_runs set outcome='failed', details=$2 where id=$1", [runId, JSON.stringify({ error: (error as Error).message?.slice(0, 300) })]);
  }
  await client.query("update task_automation_rules set run_count=run_count+1, last_run_at=now() where id=$1", [rule.id]);
  return true;
}

/** Rules are disabled when the person they act for left the organization. */
async function activeRules(client: PoolClient, organizationId: string) {
  const rules = (await client.query(`select ${columns} from task_automation_rules where organization_id=$1 and enabled order by created_at`, [organizationId])).rows as StoredRule[];
  const members = new Set((await client.query<{ user_id: string }>("select user_id from user_organizations where organization_id=$1 and status='active'", [organizationId])).rows.map(row => row.user_id));
  const valid: StoredRule[] = [];
  for (const rule of rules) {
    if (members.has(rule.createdBy)) valid.push(rule);
    else await client.query("update task_automation_rules set enabled=false, updated_at=now() where id=$1", [rule.id]);
  }
  return { rules: valid, members };
}

/** Worker entry: change events, then due dates and schedules. Runs in one transaction. */
export async function processTaskAutomations(client: PoolClient, today = new Date()) {
  await client.query("select pg_advisory_xact_lock(hashtextextended('task-automations',0))");
  const events = (await client.query(
    `select id, organization_id as "organizationId", task_id as "taskId", project_id as "projectId", kind, changes, depth from task_events where processed_at is null order by id limit 500 for update skip locked`)).rows as TaskEvent[];
  const cache = new Map<string, Awaited<ReturnType<typeof activeRules>>>();
  const rulesFor = async (organizationId: string) => {
    if (!cache.has(organizationId)) cache.set(organizationId, await activeRules(client, organizationId));
    return cache.get(organizationId)!;
  };
  let runs = 0;
  for (const event of events) {
    if (event.depth < MAX_CHAIN) {
      const { rules, members } = await rulesFor(event.organizationId);
      for (const rule of rules) {
        if (rule.projectId && rule.projectId !== event.projectId) continue;
        if (!triggerMatches(rule.trigger, event)) continue;
        const task = await loadTask(client, event.taskId);
        if (!task || !conditionsMatch(rule.conditions, task)) continue;
        if (await run(client, rule, task, `event:${event.id}`, event.depth, today, members)) runs++;
      }
    }
    await client.query("update task_events set processed_at=now() where id=$1", [event.id]);
  }

  // Due dates and schedules: organizations that have such rules.
  const timed = (await client.query(`select distinct organization_id from task_automation_rules where enabled and trigger->>'type' in ('due_date','schedule')`)).rows;
  for (const { organization_id: organizationId } of timed) {
    const { rules, members } = await rulesFor(organizationId);
    for (const rule of rules) {
      if (rule.trigger.type === "schedule") {
        const key = scheduleKey(rule.trigger, today);
        if (key && await run(client, rule, null, `schedule:${key}`, 0, today, members)) runs++;
        continue;
      }
      if (rule.trigger.type !== "due_date") continue;
      const target = addDays(today, rule.trigger.offsetDays);
      const due = (await client.query(
        `select t.id from tasks t join projects p on p.id=t.project_id where p.organization_id=$1 and t.end_date::date=$2::date and t.status<>'completed' and ($3::text is null or t.project_id=$3) limit 200`,
        [organizationId, target, rule.projectId ?? null])).rows;
      for (const { id } of due) {
        const task = await loadTask(client, id);
        if (!task || !conditionsMatch(rule.conditions, task)) continue;
        if (await run(client, rule, task, `due:${id}:${target}`, 0, today, members)) runs++;
      }
    }
  }
  // Processed events are only kept for a week.
  await client.query("delete from task_events where processed_at < now() - interval '7 days'");
  return { events: events.length, runs };
}

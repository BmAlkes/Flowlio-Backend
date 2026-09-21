import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { z } from "zod";
import { canManageClients, type Actor } from "../../security/resource-policy";

export class WorkflowError extends Error {
  constructor(public status: number, public code: string) { super(code); }
}
const ruleInput = z.object({
  name: z.string().trim().min(1).max(100),
  trigger: z.enum(["proposal_project", "delivery_approved", "delivery_changes_requested"]),
  projectStatus: z.enum(["pending", "ongoing", "completed"]).nullable(),
  title: z.string().trim().min(1).max(150),
  message: z.string().trim().min(1).max(1000),
}).strict();
const stateInput = z.object({ enabled: z.boolean() }).strict();
type Rule = { id: string; organization_id: string; created_by: string; trigger: string; project_status: string | null; title: string; message: string; activated_at: Date };
type Event = { id: string; resource_id: string; visible: boolean; status: string | null };
function authorize(actor: Actor) {
  if (!actor.organizationId || !canManageClients(actor)) throw new WorkflowError(403, "FORBIDDEN");
}
async function events(client: PoolClient, rule: Rule, simulation = false): Promise<Event[]> {
  const result = await client.query(`select a.id,a.resource_id,p.status,
    coalesce(p.created_by=$2 or p.assigned_to=$2 or p.visibility='public',false) as visible
    from recent_activities a left join projects p on p.id=a.resource_id and p.organization_id=a.organization_id
    where a.organization_id=$1 and a.resource='project'
      and (($3='proposal_project' and a.type='project' and a.action='create' and a.metadata->>'proposalId' is not null)
        or ($3<>'proposal_project' and a.type='delivery' and a.action=$3))
      and ($5::boolean or a.created_at AT TIME ZONE 'UTC' >= $4::timestamptz)
      and ($5::boolean or not exists(select 1 from workflow_executions e where e.rule_id=$6 and e.event_id=a.id))
    order by a.created_at,a.id limit 100`, [rule.organization_id, rule.created_by, rule.trigger, rule.activated_at, simulation, rule.id]);
  return result.rows;
}
function outcome(rule: Rule, event: Event) {
  if (!event.visible) return "inaccessible";
  if (rule.project_status && event.status !== rule.project_status) return "condition_not_met";
  return "notified";
}
async function creatorActive(client: PoolClient, rule: Rule) {
  const result = await client.query(`select u.id from users u join user_organizations m on m.user_id=u.id
    join organizations o on o.id=m.organization_id
    where u.id=$1 and m.organization_id=$2 and m.status='active' and u.status='active'
      and u.role='user' and (u.is_organization_owner=true or u.is_organization_manager=true)
      and o.status='active' and o.subscription_status in ('active','trialing')
      and (o.subscription_end_date is null or o.subscription_end_date>now()) limit 1`, [rule.created_by, rule.organization_id]);
  return !!result.rowCount;
}

// Called inside the durable worker's transaction: effects and receipts commit together.
export async function processWorkflowOrganization(client: PoolClient, organizationId: string) {
  const rules = (await client.query("select * from workflow_rules where organization_id=$1 and enabled=true order by id for update", [organizationId])).rows as Rule[];
  for (const rule of rules) {
    if (!await creatorActive(client, rule)) {
      await client.query("update workflow_rules set enabled=false where id=$1", [rule.id]);
      continue;
    }
    for (const event of await events(client, rule)) {
      const result = outcome(rule, event);
      const receipt = await client.query("insert into workflow_executions(id,rule_id,event_id,outcome) values($1,$2,$3,$4) on conflict(rule_id,event_id) do nothing returning id", [randomUUID(), rule.id, event.id, result]);
      if (!receipt.rowCount || result !== "notified") continue;
      await client.query(`insert into notifications(id,user_id,organization_id,type,title,message,data,read,created_at)
        values($1,$2,$3,'system',$4,$5,$6,false,now())`, [randomUUID(), rule.created_by, rule.organization_id, rule.title, rule.message, JSON.stringify({ projectId: event.resource_id, workflowId: rule.id })]);
      // Notifications do not emit eligible activity events: workflow chains stop after one action.
    }
  }
}

export function createWorkflows(pool: Pool) {
  async function ownRule(client: PoolClient, actor: Actor, id: string) {
    const row = (await client.query("select * from workflow_rules where id=$1 and organization_id=$2 and created_by=$3", [id, actor.organizationId, actor.id])).rows[0];
    if (!row) throw new WorkflowError(404, "RULE_NOT_FOUND");
    return row as Rule;
  }
  async function list(actor: Actor) {
    authorize(actor);
    return (await pool.query(`select id,name,trigger,project_status as "projectStatus",title,message,enabled,activated_at as "activatedAt"
      from workflow_rules where organization_id=$1 and created_by=$2 order by created_at desc,id`, [actor.organizationId, actor.id])).rows;
  }
  async function create(actor: Actor, raw: unknown) {
    authorize(actor);
    if (actor.role !== 'user') throw new WorkflowError(403, 'ORGANIZATION_USER_REQUIRED');
    const parsed = ruleInput.safeParse(raw);
    if (!parsed.success) throw new WorkflowError(400, "INVALID_RULE");
    const client = await pool.connect();
    try {
      await client.query("begin");
      await client.query("select pg_advisory_xact_lock(hashtext($1))", ["workflows:" + actor.organizationId]);
      const counts = (await client.query("select count(*)::int total,count(*) filter(where created_by=$2)::int own from workflow_rules where organization_id=$1", [actor.organizationId, actor.id])).rows[0];
      if (counts.total >= 100 || counts.own >= 20) throw new WorkflowError(400, "RULE_LIMIT");
      const value = parsed.data, id = randomUUID();
      await client.query("insert into workflow_rules(id,organization_id,created_by,name,trigger,project_status,title,message) values($1,$2,$3,$4,$5,$6,$7,$8)", [id, actor.organizationId, actor.id, value.name, value.trigger, value.projectStatus, value.title, value.message]);
      await client.query("commit");
      return { id };
    } catch (error) { await client.query("rollback"); throw error; } finally { client.release(); }
  }
  async function setEnabled(actor: Actor, id: string, raw: unknown) {
    authorize(actor);
    const parsed = stateInput.safeParse(raw);
    if (!parsed.success) throw new WorkflowError(400, "INVALID_RULE");
    const result = await pool.query(`update workflow_rules set enabled=$4,
      activated_at=case when $4 and not enabled then now() else activated_at end
      where id=$1 and organization_id=$2 and created_by=$3 returning id`, [id, actor.organizationId, actor.id, parsed.data.enabled]);
    if (!result.rowCount) throw new WorkflowError(404, "RULE_NOT_FOUND");
    return { id, enabled: parsed.data.enabled };
  }
  async function inspect(actor: Actor, id: string, simulation: boolean) {
    authorize(actor);
    const client = await pool.connect();
    try {
      const rule = await ownRule(client, actor, id);
      if (simulation) {
        const candidates = (await events(client, rule, true)).filter(event => event.visible);
        return { sampled: candidates.length, matches: candidates.filter(event => outcome(rule, event) === "notified").length, limit: 100 };
      }
      return (await client.query("select id,outcome,created_at as \"createdAt\" from workflow_executions where rule_id=$1 order by created_at desc,id limit 50", [rule.id])).rows;
    } finally { client.release(); }
  }
  return { list, create, setEnabled, inspect };
}

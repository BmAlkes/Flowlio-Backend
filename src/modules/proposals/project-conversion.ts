import { createHash, randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { z } from "zod";
import { canManageClients, canReadProject, canViewProjectFinancials, type Actor } from "../../security/resource-policy";

const title = z.string().trim().min(1).max(180);
const decimal = z.string().regex(/^\d{1,8}(\.\d{1,2})?$/);
export const conversionInput = z.object({
  version: z.string().regex(/^[a-f0-9]{64}$/),
  templateId: z.string().min(1).max(128).nullable().optional(),
  name: title,
  projectNumber: z.string().trim().max(50).default(""),
  description: z.string().max(10000).default(""),
  budget: decimal.nullable().optional(),
  tasks: z.array(z.object({ title, estimatedHours: decimal.nullable().optional() }).strict()).max(100),
  milestones: z.array(title).max(30),
}).strict();
type Input = z.infer<typeof conversionInput>;
export class ConversionError extends Error {
  constructor(public status: number, public code: string) { super(code); }
}
function authorize(actor: Actor) {
  if (!actor.organizationId || !canManageClients(actor)) throw new ConversionError(403, "FORBIDDEN");
}
const cleanTitles = (values: unknown, max: number) => Array.isArray(values)
  ? values.filter((value): value is string => typeof value === "string" && !!value.trim()).map(value => value.trim().slice(0,180)).slice(0,max) : [];

export function createProposalConversion(pool: Pool) {
  async function previous(client: PoolClient, actor: Actor, sourceId: string) {
    const row = (await client.query(`select c.project_id as "projectId", p.organization_id as "organizationId", p.created_by as "createdBy", p.assigned_to as "assignedTo", p.visibility
      from proposal_project_conversions c left join projects p on p.id=c.project_id where c.source_id=$1 and c.organization_id=$2`, [sourceId, actor.organizationId])).rows[0];
    if (row && !row.projectId) throw new ConversionError(409, "PROJECT_REMOVED");
    if (row && !canReadProject(actor, { ...row, id:row.projectId })) throw new ConversionError(403, "PROJECT_FORBIDDEN");
    return row ? { projectId:row.projectId } : undefined;
  }
  async function draft(client: PoolClient, actor: Actor, sourceId: string, templateId?: string | null, lock=false) {
    const proposal = (await client.query(`select p.* from proposals p join clients c on c.id=p.client_id and c.organization_id=p.organization_id
      where p.id=$1 and p.organization_id=$2 ${lock ? "for update of p" : ""}`, [sourceId,actor.organizationId])).rows[0];
    if (!proposal) throw new ConversionError(404, "PROPOSAL_NOT_FOUND");
    if (proposal.status !== "approved") throw new ConversionError(409, "PROPOSAL_NOT_APPROVED");
    const templates = (await client.query('select id,name from project_templates where organization_id=$1 or is_global=true order by name,id limit 200', [actor.organizationId])).rows;
    let templateTasks: {title:string;estimatedHours:string|null}[] = [];
    if (templateId) {
      const template = (await client.query('select id from project_templates where id=$1 and (organization_id=$2 or is_global=true)', [templateId,actor.organizationId])).rows[0];
      if (!template) throw new ConversionError(404, "TEMPLATE_NOT_FOUND");
      templateTasks = (await client.query('select title,estimated_hours as "estimatedHours" from project_template_tasks where template_id=$1 order by "order",id limit 101', [templateId])).rows;
      if (templateTasks.length > 100) throw new ConversionError(400, "TEMPLATE_TOO_LARGE");
    }
    const data = proposal.proposal_data ?? {};
    const sourceTasks = templateId ? templateTasks : cleanTitles(data.scopeOfWork,100).map(title=>({title,estimatedHours:null}));
    const phases = Array.isArray(data.timeline?.phases) ? data.timeline.phases : [];
    if ((!templateId && Array.isArray(data.scopeOfWork) && data.scopeOfWork.length > 100) || phases.length > 30) throw new ConversionError(400, "DRAFT_TOO_LARGE");
    const milestones = cleanTitles(phases.map((phase: {phase?:unknown})=>phase?.phase),30);
    const budgetText = canViewProjectFinancials(actor) && typeof data.investment?.totalBudget === "string" ? data.investment.totalBudget.slice(0,250) : "";
    return {
      version: createHash("sha256").update(JSON.stringify([proposal.id,proposal.updated_at,proposal.status,proposal.project_title,proposal.client_id,data,templateId??null,templateTasks])).digest("hex"),
      clientId: proposal.client_id, name: proposal.project_title, description: typeof data.projectOverview === "string" ? data.projectOverview.slice(0,10000) : "",
      budgetText, budget: decimal.safeParse(budgetText).success ? budgetText : "", canSetBudget: canViewProjectFinancials(actor),
      tasks: sourceTasks, milestones, templates,
    };
  }
  async function preview(actor: Actor, sourceId: string, templateId?: string | null) {
    authorize(actor); const client=await pool.connect();
    try {
      const existing=await previous(client,actor,sourceId);
      if (existing) return { existing:true, ...existing };
      return { existing:false, ...await draft(client,actor,sourceId,templateId) };
    } finally { client.release(); }
  }
  async function checkLimits(client: PoolClient, actor: Actor, taskCount: number) {
    const row=(await client.query(`select o.override_max_tasks, coalesce(s.features,p.features) as features
      from organizations o left join subscription_plans p on p.id=o.subscription_plan_id
      left join lateral (select sp.features from subscriptions sub join subscription_plans sp on sp.id=sub.plan_id
        where sub.organization_id=o.id order by sub.created_at desc,sub.id desc limit 1) s on true where o.id=$1`,[actor.organizationId])).rows[0];
    if (!row) throw new ConversionError(403,"FORBIDDEN");
    const limits=[row.features?.maxProjects,row.override_max_tasks??row.features?.maxTasks];
    const counts=(await client.query(`select (select count(*)::int from projects where organization_id=$1) as projects,
      (select count(*)::int from tasks t join projects p on p.id=t.project_id where p.organization_id=$1) as tasks`,[actor.organizationId])).rows[0];
    for (const [index,limit] of limits.entries()) {
      if (limit == null || limit === 0) continue;
      if (!Number.isInteger(limit) || limit < 0) throw new ConversionError(503,"PLAN_UNAVAILABLE");
      if ((index===0 ? counts.projects+1 : counts.tasks+taskCount)>limit) throw new ConversionError(403,"PLAN_LIMIT_REACHED");
    }
  }
  async function convert(actor: Actor, sourceId: string, raw: unknown) {
    authorize(actor);
    const parsed=conversionInput.safeParse(raw);
    if (!parsed.success) throw new ConversionError(400,"INVALID_PROJECT_DRAFT");
    const input:Input=parsed.data;
    if (input.budget != null && !canViewProjectFinancials(actor)) throw new ConversionError(403,"BUDGET_FORBIDDEN");
    const client=await pool.connect();
    try {
      await client.query("begin");
      await client.query("select pg_advisory_xact_lock(hashtextextended($1,0))",["proposal-conversion:"+actor.organizationId]);
      const existing=await previous(client,actor,sourceId);
      if (existing) { await client.query("commit"); return {existing:true,...existing}; }
      const source=await draft(client,actor,sourceId,input.templateId,true);
      if (source.version!==input.version) throw new ConversionError(409,"SOURCE_CHANGED");
      await checkLimits(client,actor,input.tasks.length);
      if ((await client.query('select id from projects where organization_id=$1 and name=$2 limit 1',[actor.organizationId,input.name])).rowCount) throw new ConversionError(409,"PROJECT_NAME_EXISTS");
      const projectId=randomUUID();
      await client.query(`insert into projects(id,name,project_number,client_id,description,organization_id,created_by,status,visibility,progress,budget,created_at,updated_at)
        values($1,$2,$3,$4,$5,$6,$7,'pending','private',0,$8,now(),now())`,[projectId,input.name,input.projectNumber,source.clientId,input.description,actor.organizationId,actor.id,input.budget??null]);
      for (const task of input.tasks) await client.query(`insert into tasks(id,title,project_id,created_by,status,visibility,estimated_hours,created_at,updated_at)
        values($1,$2,$3,$4,'todo','private',$5,now(),now())`,[randomUUID(),task.title,projectId,actor.id,task.estimatedHours??null]);
      for (const [position,title] of input.milestones.entries()) await client.query(`insert into project_milestones(id,project_id,organization_id,title,status,position,created_at,updated_at)
        values($1,$2,$3,$4,'pending',$5,now(),now())`,[randomUUID(),projectId,actor.organizationId,title,position]);
      await client.query(`insert into proposal_project_conversions(source_id,proposal_id,project_id,organization_id,created_by,source_version,source_title,template_id)
        values($1,$1,$2,$3,$4,$5,$6,$7)`,[sourceId,projectId,actor.organizationId,actor.id,source.version,source.name,input.templateId??null]);
      await client.query(`insert into recent_activities(id,organization_id,user_id,actor_id,type,action,resource,resource_id,message,metadata,created_at)
        values($1,$2,$3,$3,'project','create','project',$4,'Project created from approved proposal',$5,now())`,[randomUUID(),actor.organizationId,actor.id,projectId,JSON.stringify({proposalId:sourceId,templateId:input.templateId??null})]);
      await client.query("commit"); return {projectId,existing:false};
    } catch(error) { await client.query("rollback"); throw error; }
    finally { client.release(); }
  }
  return { preview,convert };
}

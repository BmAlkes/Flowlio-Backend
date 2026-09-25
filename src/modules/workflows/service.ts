import { randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { z } from 'zod';
import { canManageClients, canViewProjectFinancials, type Actor } from '../../security/resource-policy';
import { enqueue } from '../../services/jobs/queue';
import { setAuditContext } from '../audit/context';
import { WorkflowError, ruleInput, creatorActive, member, events, plan, sourceValid, retryable, type Rule, type Event } from './policy';
export { WorkflowError } from './policy';
function authorize(a:Actor){if(!a.organizationId||!canManageClients(a))throw new WorkflowError(403,'FORBIDDEN');}
// Shared with manual scope application: one commercial draft per approved version.
export async function prepareScopeBilling(c:PoolClient,org:string,changeId:string,revision:number){
 const s=(await c.query(`select s.application,v.amount,v.currency from scope_change_requests s join scope_change_versions v on v.change_id=s.id and v.revision=s.revision
 where s.id=$1 and s.organization_id=$2 and s.revision=$3 and s.state in ('approved','applied') and v.decision='approved' and v.classification='additional' and v.amount>0`,[changeId,org,revision])).rows[0];
 if(!s)throw new WorkflowError(409,'SOURCE_CHANGED');
 await c.query(`insert into workflow_billing_drafts(id,organization_id,source_type,source_id,revision,amount,currency) values($1,$2,'scope',$3,$4,$5,$6) on conflict(organization_id,source_type,source_id,revision) do nothing`,[s.application?.billingDraft?.id??randomUUID(),org,changeId,revision,s.amount,s.currency]);
 return(await c.query("select id,amount,currency from workflow_billing_drafts where organization_id=$1 and source_type='scope' and source_id=$2 and revision=$3",[org,changeId,revision])).rows[0];
}
async function lockOrganization(c:PoolClient,org:string){
 await c.query('select pg_advisory_xact_lock(hashtextextended($1,0))',['time-invoice:'+org]);
 await c.query('select pg_advisory_xact_lock(hashtextextended($1,0))',['proposal-conversion:'+org]);
}
async function lockActors(c:PoolClient,org:string,rules:Rule[]){
 await c.query('select id from organizations where id=$1 for share',[org]);
 const ids=[...new Set(rules.flatMap(r=>[r.created_by,r.recipient_id]))].sort();
 await c.query('select u.id from users u join user_organizations m on m.user_id=u.id where m.organization_id=$1 and u.id=any($2::text[]) order by u.id for share of u,m',[org,ids]);
}
async function effect(c:PoolClient,r:Rule,e:Event,receiptId:string){
 if(r.action_type==='create_task'){
  const id=randomUUID();await c.query(`insert into tasks(id,title,description,project_id,created_by,assigned_to,status,visibility,created_at,updated_at) values($1,$2,$3,$4,$5,$6,'todo','private',now(),now())`,[id,r.title,r.message,e.resource_id,r.created_by,r.recipient_id]);
  return{outcome:'task_created',type:'task',id,details:{projectId:e.resource_id}};
 }
 if(r.action_type==='assign_project'){
  await c.query('update projects set assigned_to=$2,updated_at=now() where id=$1 and organization_id=$3',[e.resource_id,r.recipient_id,r.organization_id]);
  return{outcome:'project_assigned',type:'project',id:e.resource_id,details:{projectId:e.resource_id}};
 }
 if(r.action_type==='prepare_billing'){
  const draft=r.trigger==='scope_approved'?await prepareScopeBilling(c,r.organization_id,e.source_id,e.revision!):(await c.query('select statement from retainer_periods where id=$1',[e.source_id])).rows[0].statement.billing;
  return{outcome:'billing_prepared',type:'commercial_draft',id:draft.id,details:{projectId:e.resource_id,clientId:e.client_id,sourceId:e.source_id,revision:e.revision,amount:draft.amount??draft.overageAmount,currency:draft.currency}};
 }
 if(r.channel!=='internal'){
  const key='workflow-delivery:'+receiptId;await enqueue(c,'workflow-delivery',key,{executionId:receiptId});
  const job=(await c.query('select id from durable_jobs where dedupe_key=$1',[key])).rows[0];
  await c.query('update workflow_executions set job_id=$2 where id=$1',[receiptId,job.id]);
  return{outcome:'queued',type:null,id:null,details:{projectId:e.resource_id,clientId:e.client_id}};
 }
 const id=randomUUID();await c.query(`insert into notifications(id,user_id,organization_id,type,title,message,data,read,created_at) values($1,$2,$3,'system',$4,$5,$6,false,now())`,[id,r.recipient_id,r.organization_id,r.title,r.message,JSON.stringify({projectId:e.resource_id,clientId:e.client_id,workflowId:r.id})]);
 return{outcome:'notified',type:'notification',id,details:{projectId:e.resource_id,clientId:e.client_id}};
}
async function execute(c:PoolClient,r:Rule,e:Event,existing?:string){
 // Project ownership/client changes serialize with this effect. Shared advisory locks also cover scope and time allocations.
 if(e.resource_id)await c.query('select id from projects where id=$1 and organization_id=$2 for update',[e.resource_id,r.organization_id]);
 if(r.trigger==='milestone_completed')await c.query('select id from project_milestones where id=$1 and organization_id=$2 for share',[e.source_id,r.organization_id]);
 if(r.trigger.startsWith('delivery_'))await c.query('select m.id from project_milestones m join delivery_reviews d on d.milestone_id=m.id where d.id=$1 and d.organization_id=$2 for share of m,d',[e.source_id,r.organization_id]);
 const current=(await events(c,r,true,e.id))[0];
 const result=current?await plan(c,r,current):'source_changed';
 const id=existing??randomUUID();
 if(existing)await c.query('update workflow_executions set outcome=$2,attempts=attempts+1 where id=$1',[id,result]);
 else if(!(await c.query('insert into workflow_executions(id,rule_id,event_id,outcome) values($1,$2,$3,$4) on conflict(rule_id,event_id) do nothing returning id',[id,r.id,e.id,result])).rowCount)return;
 if(result!=='ready')return;
 await c.query('savepoint workflow_effect');
 try{
  await setAuditContext(c,{organizationId:r.organization_id,actorKind:'system',actorId:'workflow:'+r.id,operationId:id});
  const applied=await effect(c,r,current!,id);
  await c.query('update workflow_executions set outcome=$2,resource_type=$3,resource_id=$4,details=$5 where id=$1',[id,applied.outcome,applied.type,applied.id,JSON.stringify(applied.details)]);
  await c.query('release savepoint workflow_effect');
 }catch{
  // Every internal effect and outbox enqueue is transactional; a failed savepoint is safe for explicit retry.
  await c.query('rollback to savepoint workflow_effect');await c.query('release savepoint workflow_effect');
  await c.query("update workflow_executions set outcome='failed' where id=$1",[id]);
 }
}
// Internal effects + receipts + external outbox commit together in the durable worker transaction.
export async function processWorkflowOrganization(c:PoolClient,org:string){
 await lockOrganization(c,org);
 const rules=(await c.query('select * from workflow_rules where organization_id=$1 and enabled=true order by id for update',[org])).rows as Rule[];
 await lockActors(c,org,rules);
 let remaining=100;
 for(const r of rules){
  if(!await creatorActive(c,r)){await c.query('update workflow_rules set enabled=false where id=$1',[r.id]);continue;}
  for(const e of await events(c,r)){if(!remaining--)return;await execute(c,r,e);}
 }
}
export function createWorkflows(pool:Pool){
 async function own(c:PoolClient,a:Actor,id:string,lock=false){const r=(await c.query(`select * from workflow_rules where id=$1 and organization_id=$2 and created_by=$3 ${lock?'for update':''}`,[id,a.organizationId,a.id])).rows[0];if(!r)throw new WorkflowError(404,'RULE_NOT_FOUND');return r as Rule;}
 async function list(a:Actor){authorize(a);return(await pool.query(`select r.id,r.name,r.trigger,r.project_status as "projectStatus",r.title,r.message,r.enabled,r.activated_at as "activatedAt",r.action_type as "actionType",r.channel,r.recipient_id as "recipientId",u.name as "recipientName",r.target_project_id as "targetProjectId",p.name as "targetProjectName"
 from workflow_rules r left join users u on u.id=r.recipient_id left join projects p on p.id=r.target_project_id and p.organization_id=r.organization_id and (p.created_by=$2 or p.assigned_to=$2 or p.visibility='public') where r.organization_id=$1 and r.created_by=$2 order by r.created_at desc,r.id`,[a.organizationId,a.id])).rows;}
 async function options(a:Actor,raw:unknown){
  authorize(a);const parsed=z.object({q:z.string().trim().max(100).default('')}).strict().safeParse(raw);if(!parsed.success)throw new WorkflowError(400,'INVALID_QUERY');
  const q='%'+parsed.data.q.replace(/[\\%_]/g,'\\$&')+'%';
  const members=(await pool.query(`select u.id,u.name,u.role from users u join user_organizations m on m.user_id=u.id where m.organization_id=$1 and m.status='active' and u.status='active' and u.role in ('user','operator','viewer') and (u.name ilike $2 or u.id=$3) order by (u.id=$3) desc,u.name,u.id limit 50`,[a.organizationId,q,a.id])).rows;
  const projects=(await pool.query(`select id,name from projects where organization_id=$1 and (created_by=$2 or assigned_to=$2 or visibility='public') and name ilike $3 order by name,id limit 50`,[a.organizationId,a.id,q])).rows;
  return{members,projects,limit:50};
 }
 async function create(a:Actor,raw:unknown){
  authorize(a);if(a.role!=='user')throw new WorkflowError(403,'ORGANIZATION_USER_REQUIRED');
  const parsed=ruleInput.safeParse(raw);if(!parsed.success)throw new WorkflowError(400,'INVALID_RULE');const v=parsed.data;
  if(v.actionType==='prepare_billing'&&!canViewProjectFinancials(a))throw new WorkflowError(403,'FINANCIAL_ACCESS_REQUIRED');
  const c=await pool.connect();try{
   await c.query('begin');await c.query('select pg_advisory_xact_lock(hashtext($1))',['workflows:'+a.organizationId]);
   const recipient=v.recipientId??a.id;
   if(!await member(c,a.organizationId!,recipient))throw new WorkflowError(400,'RECIPIENT_UNAVAILABLE');
   if(v.targetProjectId&&!(await c.query("select 1 from projects where id=$1 and organization_id=$2 and (created_by=$3 or assigned_to=$3 or visibility='public')",[v.targetProjectId,a.organizationId,a.id])).rowCount)throw new WorkflowError(400,'PROJECT_UNAVAILABLE');
   const counts=(await c.query('select count(*)::int total,count(*) filter(where created_by=$2)::int own from workflow_rules where organization_id=$1',[a.organizationId,a.id])).rows[0];if(counts.total>=100||counts.own>=20)throw new WorkflowError(400,'RULE_LIMIT');
   const id=randomUUID();await c.query(`insert into workflow_rules(id,organization_id,created_by,name,trigger,project_status,title,message,action_type,recipient_id,channel,target_project_id) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,[id,a.organizationId,a.id,v.name,v.trigger,v.projectStatus,v.title,v.message,v.actionType,recipient,v.channel,v.targetProjectId]);
   await c.query('commit');return{id};
  }catch(e){await c.query('rollback');throw e;}finally{c.release();}
 }
 async function setEnabled(a:Actor,id:string,raw:unknown){
  authorize(a);const parsed=z.object({enabled:z.boolean()}).strict().safeParse(raw);if(!parsed.success)throw new WorkflowError(400,'INVALID_RULE');
  const row=await pool.query(`update workflow_rules set enabled=$4,activated_at=case when $4 and not enabled then clock_timestamp() else activated_at end where id=$1 and organization_id=$2 and created_by=$3 returning id`,[id,a.organizationId,a.id,parsed.data.enabled]);
  if(!row.rowCount)throw new WorkflowError(404,'RULE_NOT_FOUND');return{id,enabled:parsed.data.enabled};
 }
 async function inspect(a:Actor,id:string,simulation:boolean){
  authorize(a);const c=await pool.connect();try{
   await c.query('begin isolation level repeatable read read only');const r=await own(c,a,id);
   if(simulation){const candidates=(await events(c,r,true)).filter(e=>e.visible);let matches=0;const reasons:Record<string,number>={};for(const e of candidates){const p=await plan(c,r,e);if(p==='ready')matches++;else reasons[p]=(reasons[p]??0)+1;}await c.query('commit');return{sampled:candidates.length,matches,limit:100,reasons};}
   const rows=(await c.query(`select x.id,x.event_id,x.outcome,x.resource_type as "resourceType",x.resource_id as "resourceId",x.details,x.created_at as "createdAt",x.attempts,j.status as "jobStatus" from workflow_executions x left join durable_jobs j on j.id=x.job_id where x.rule_id=$1 order by x.created_at desc,x.id limit 50`,[r.id])).rows;
   for(const row of rows){
    if(row.outcome==='queued')row.outcome=row.jobStatus==='completed'?'sent':row.jobStatus==='uncertain'?'uncertain':row.jobStatus==='failed'?'delivery_failed':'queued';
    row.canRetry=r.enabled&&!row.jobStatus&&row.attempts<5&&(retryable.has(row.outcome)||row.outcome==='failed');
    const e=(await events(c,r,true,row.event_id))[0];delete row.event_id;delete row.jobStatus;
    if(!e?.visible){row.details=null;row.resourceId=null;row.canRetry=false;continue;}
    if(row.resourceType==='commercial_draft'){
     if(!canViewProjectFinancials(a)){row.details=null;row.resourceId=null;continue;}
     row.stale=!await sourceValid(c,r,e);
    }
    row.href=e.resource_id?`/dashboard/project/view/${encodeURIComponent(e.resource_id)}${row.resourceType==='commercial_draft'?'/changes':''}`:e.client_id?`/dashboard/client-management/${encodeURIComponent(e.client_id)}`:null;
   }
   await c.query('commit');return rows;
  }catch(e){await c.query('rollback');throw e;}finally{c.release();}
 }
 async function retry(a:Actor,id:string,executionId:string){
  authorize(a);const c=await pool.connect();try{
   await c.query('begin');await lockOrganization(c,a.organizationId!);const r=await own(c,a,id,true);
   await lockActors(c,a.organizationId!,[r]);
   if(!r.enabled||!await creatorActive(c,r))throw new WorkflowError(409,'RULE_PAUSED');
   const x=(await c.query('select * from workflow_executions where id=$1 and rule_id=$2 for update',[executionId,r.id])).rows[0];
   if(!x||x.attempts>=5||x.job_id||!retryable.has(x.outcome)&&x.outcome!=='failed')throw new WorkflowError(409,'RETRY_UNSAFE');
   const e=(await events(c,r,false,x.event_id))[0];if(!e)throw new WorkflowError(409,'SOURCE_CHANGED');
   await execute(c,r,e,x.id);await c.query('commit');return{id:x.id};
  }catch(e){await c.query('rollback');throw e;}finally{c.release();}
 }
 return{list,options,create,setEnabled,inspect,retry};
}

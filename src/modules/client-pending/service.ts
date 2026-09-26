import { randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { z } from 'zod';
import { canManageClients, type Actor } from '../../security/resource-policy';
import { milestoneVersion } from '../delivery/service';
import { creation,command,hash,project,blocked,dependencies,PendingError } from './policy';
export { PendingError } from './policy';
const identifier=z.string().min(1).max(128);
const paging=z.coerce.number().int().min(1).max(10000).default(1);
const listQuery=z.object({page:paging,projectId:identifier.optional(),state:z.enum(['open','answered','completed','cancelled','all']).default('open'),kind:z.enum(['all','delivery','scope','briefing','question','file']).default('all'),overdue:z.enum(['true','false']).default('false')}).strict();
const shared=`with visible as (select p.id,p.name,p.client_id,cl.name client_name,cl.user_id client_user_id from projects p join clients cl on cl.id=p.client_id and cl.organization_id=p.organization_id where p.organization_id=$1 and ($3::text is null or p.id=$3) and (case when $4 then cl.user_id=$2 and cl.portal_access_enabled=true else p.created_by=$2 or p.assigned_to=$2 or p.visibility='public' end)),
 items as (
 select 'delivery' kind,d.id,d.project_id,d.client_id,d.title,case when d.state='pending' then 'open' else 'completed' end state,d.state source_state,d.requested_at created_at,d.decided_at responded_at,d.due_date at time zone 'UTC' due_at,'UTC' timezone,cl.client_name,cl.name project_name,cl.client_user_id responsible_id,
 jsonb_build_object('version',d.source_version,'milestone',case when m.id is null then null else jsonb_build_object('id',m.id,'title',m.title,'status',m.status,'due_date',m.due_date,'updated_at',m.updated_at) end) metadata
 from delivery_reviews d join visible cl on cl.id=d.project_id and cl.client_id=d.client_id left join project_milestones m on m.id=d.milestone_id and m.project_id=d.project_id and m.organization_id=d.organization_id where d.organization_id=$1
 union all select 'scope',s.id,s.project_id,s.client_id,s.title,case when s.state='awaiting' then 'open' when s.state='cancelled' then 'cancelled' else 'completed' end,s.state,s.created_at,v.decided_at,null::timestamptz,'UTC',cl.client_name,cl.name,cl.client_user_id,'{}'::jsonb
 from scope_change_requests s join visible cl on cl.id=s.project_id and cl.client_id=s.client_id left join scope_change_versions v on v.change_id=s.id and v.revision=s.revision where s.organization_id=$1 and s.state in ('awaiting','approved','rejected','applied','cancelled')
 union all select r.kind,r.id,r.project_id,r.client_id,r.title,r.state,r.state,coalesce((select max(e.created_at) from client_request_events e where e.request_id=r.id and e.action='reopen'),r.created_at),response.created_at,r.due_at,r.timezone,cl.client_name,cl.name,case when r.state='answered' then r.assigned_to else cl.client_user_id end,
 jsonb_build_object('revision',r.revision,'dueDate',r.due_date,'blocked',exists(select 1 from unnest(r.dependencies) dep where not exists(select 1 from client_requests p where p.id=dep and p.organization_id=r.organization_id and p.project_id=r.project_id and p.client_id=r.client_id and p.state='completed')))
 from client_requests r join visible cl on cl.id=r.project_id and cl.client_id=r.client_id left join client_request_responses response on response.request_id=r.id and response.cycle=r.cycle where r.organization_id=$1
 ), filtered as(select * from items where ($5='all' or kind=$5))`;
export function createClientPending(pool:Pool){
 async function tx<T>(a:Actor,work:(c:PoolClient)=>Promise<T>,write=false){
  if(!a.organizationId||a.role!=='client'&&!canManageClients(a))throw new PendingError(403,'FORBIDDEN');
  const c=await pool.connect();try{await c.query(write?'begin':'begin isolation level repeatable read read only');await c.query("set local statement_timeout='15s'");
   if(write)await c.query('select pg_advisory_xact_lock(hashtextextended($1,0))',['client-requests:'+a.organizationId]);
   const result=await work(c);await c.query('commit');return result;
  }catch(e){await c.query('rollback');throw e;}finally{c.release();}
 }
 async function row(c:PoolClient,a:Actor,id:string,lock=false){
  let r=(await c.query('select * from client_requests where id=$1 and organization_id=$2',[id,a.organizationId])).rows[0];if(!r)throw new PendingError(404,'REQUEST_NOT_FOUND');
  const p=await project(c,a,r.project_id,lock);if(a.role==='client'&&r.client_id!==p.clientId)throw new PendingError(404,'REQUEST_NOT_FOUND');
  if(lock){r=(await c.query('select * from client_requests where id=$1 and organization_id=$2 for update',[id,a.organizationId])).rows[0];if(!r)throw new PendingError(404,'REQUEST_NOT_FOUND');}return{r,p};
 }
 async function record(c:PoolClient,a:Actor,id:string,projectId:string,action:string,reason:string,revision:number){
  const operation=randomUUID();await c.query('insert into client_request_events(id,request_id,action,actor_id,reason) values($1,$2,$3,$4,$5)',[operation,id,action,a.id,reason]);
  await c.query(`insert into business_audit_events(id,organization_id,actor_kind,actor_id,action,resource_type,resource_id,project_id,operation_id,changes) values($1,$2,'human',$3,$4,'client_request',$5,$6,$7,$8)`,[randomUUID(),a.organizationId,a.id,'client_request.'+action,id,projectId,operation,JSON.stringify({revision:{before:revision-1,after:revision}})]);
 }
 async function list(a:Actor,raw:unknown){
  const parsed=listQuery.safeParse(raw);if(!parsed.success)throw new PendingError(400,'INVALID_QUERY');const q=parsed.data;
  return tx(a,async c=>{
   const context=q.projectId?await project(c,a,q.projectId):null;
   const params=[a.organizationId,a.id,q.projectId??null,a.role==='client',q.kind];
   const summary=(await c.query(shared+` select count(*) filter(where state='open')::int open,count(*) filter(where state='answered')::int answered,count(*) filter(where state='open' and due_at<now())::int overdue,round(avg(extract(epoch from (responded_at-created_at))/3600) filter(where responded_at is not null)::numeric,1) as "responseHours" from filtered`,params)).rows[0];
   const rows=(await c.query(shared+` select f.*,u.name responsible_name from filtered f left join users u on u.id=f.responsible_id where ($6='all' or f.state=$6) and (not $7::boolean or f.state='open' and f.due_at<now()) order by f.due_at asc nulls last,f.created_at desc,f.kind,f.id limit 26 offset $8`,[...params,q.state,q.overdue==='true',(q.page-1)*25])).rows;
   const items=rows.slice(0,25).map(v=>{
    let stale=false;if(v.kind==='delivery'&&v.state==='open'){const m=v.metadata.milestone;stale=!m||milestoneVersion({...m,due_date:m.due_date?new Date(m.due_date):null,updated_at:new Date(m.updated_at)})!==v.metadata.version;}
    const base=a.role==='client'?'/clients/projects/view/':'/dashboard/project/view/';
    return{id:v.id,kind:v.kind,title:v.title,state:v.state,sourceState:v.source_state,projectId:v.project_id,projectName:v.project_name,clientName:v.client_name,responsible:v.responsible_name??null,dueAt:v.due_at,dueDate:v.metadata.dueDate??null,timezone:v.timezone,createdAt:v.created_at,blocked:!!v.metadata.blocked,stale,revision:v.metadata.revision,href:v.kind==='delivery'?base+encodeURIComponent(v.project_id)+'?reviewId='+encodeURIComponent(v.id)+'#delivery-reviews':v.kind==='scope'?base+encodeURIComponent(v.project_id)+'/changes?changeId='+encodeURIComponent(v.id):null};
   });return{items,page:q.page,hasMore:rows.length>25,summary,project:context?{id:context.id,name:context.name,clientId:context.clientId}:null,canManage:canManageClients(a)};
  });
 }
 async function options(a:Actor,projectId:string){return tx(a,async c=>{
  if(!canManageClients(a))throw new PendingError(403,'FORBIDDEN');const p=await project(c,a,projectId);
  const members=(await c.query(`select u.id,u.name from users u join user_organizations m on m.user_id=u.id where m.organization_id=$1 and m.status='active' and u.status='active' and u.role='user' and (u.is_organization_owner or u.is_organization_manager) and ($3='public' or u.id=$4 or u.id=$5) order by (u.id=$2) desc,u.name,u.id limit 100`,[a.organizationId,a.id,p.visibility,p.createdBy,p.assignedTo])).rows;
  const requests=(await c.query("select id,title,state from client_requests where organization_id=$1 and project_id=$2 and client_id=$3 and state<>'cancelled' order by created_at desc,id limit 100",[a.organizationId,projectId,p.clientId])).rows;
  return{members,requests,hasClient:!!p.clientId&&!!p.clientUserId&&!!p.portalEnabled,limit:100};
 });}
 async function create(a:Actor,raw:unknown){
  if(!canManageClients(a))throw new PendingError(403,'FORBIDDEN');const parsed=creation.safeParse(raw);if(!parsed.success)throw new PendingError(400,'INVALID_INPUT');const d=parsed.data;
  return tx(a,async c=>{
   const p=await project(c,a,d.projectId,true);if(!p.clientId||!p.portalEnabled||!p.clientUserId)throw new PendingError(409,'CLIENT_REQUIRED');
   const prior=(await c.query('select * from client_requests where id=$1',[d.id])).rows[0],fingerprint=hash(d);
   if(prior){if(prior.organization_id!==a.organizationId||prior.created_by!==a.id||prior.request_hash!==fingerprint||prior.client_id!==p.clientId)throw new PendingError(409,'REQUEST_CONFLICT');return{id:prior.id};}
   if(!(await c.query("select 1 from users u join user_organizations m on m.user_id=u.id where u.id=$1 and m.organization_id=$2 and u.status='active' and m.status='active' and u.role='user' and (u.is_organization_owner or u.is_organization_manager) and ($3='public' or u.id=$4 or u.id=$5)",[d.assignedTo,a.organizationId,p.visibility,p.createdBy,p.assignedTo])).rowCount)throw new PendingError(400,'ASSIGNEE_UNAVAILABLE');
   if(!(await c.query('select 1 from pg_timezone_names where name=$1',[d.timezone])).rowCount)throw new PendingError(400,'INVALID_TIMEZONE');
   const count=(await c.query("select count(*)::int n from client_requests where organization_id=$1 and state in ('open','answered')",[a.organizationId])).rows[0].n;if(count>=500)throw new PendingError(409,'REQUEST_LIMIT');
   if(d.dependencies.length&&(await c.query("select id from client_requests where id=any($1::text[]) and organization_id=$2 and project_id=$3 and client_id=$4 and state<>'cancelled'",[d.dependencies,a.organizationId,d.projectId,p.clientId])).rowCount!==d.dependencies.length)throw new PendingError(400,'INVALID_DEPENDENCY');
   await c.query(`insert into client_requests(id,organization_id,project_id,client_id,kind,title,description,questions,dependencies,assigned_to,created_by,request_hash,due_date,timezone,due_at,reminder_hours,reminder_channel,reminder_next_at)
    values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,case when $13::text is null then null else (($13::date+1)::timestamp at time zone $14) end,$15,$16,case when $15=0 then null else (($13::date+1)::timestamp at time zone $14) end)`,[d.id,a.organizationId,d.projectId,p.clientId,d.kind,d.title,d.description,JSON.stringify(d.questions),d.dependencies,d.assignedTo,a.id,fingerprint,d.dueDate,d.timezone,d.reminderHours,d.reminderChannel]);
   await record(c,a,d.id,d.projectId,'created','',0);return{id:d.id};
  },true);
 }
 async function detail(a:Actor,id:string,raw:unknown={}){const q=z.object({page:paging}).strict().safeParse(raw);if(!q.success)throw new PendingError(400,'INVALID_QUERY');return tx(a,async c=>{
  const{r,p}=await row(c,a,id);const deps=await dependencies(c,r);
  const responses=(await c.query('select id,cycle,message,answers,attachments,created_at from client_request_responses where request_id=$1 order by cycle desc limit 11 offset $2',[id,(q.data.page-1)*10])).rows;
  const events=(await c.query('select e.id,e.action,e.reason,e.created_at,u.name actor from client_request_events e left join users u on u.id=e.actor_id where request_id=$1 order by e.created_at desc,e.id desc limit 50',[id])).rows;
  const reminders=canManageClients(a)?(await c.query(`select r.id,r.cycle,r.sequence,case when r.outcome='queued' and j.status='completed' then 'sent' when r.outcome='queued' and j.status='uncertain' then 'uncertain' else r.outcome end outcome,r.created_at from client_request_reminders r left join durable_jobs j on j.id=r.job_id where r.request_id=$1 order by r.created_at desc limit 12`,[id])).rows:[];
  const{request_hash,created_by,...safe}=r;void request_hash;void created_by;
  return{request:safe,project:{id:p.id,name:p.name,clientId:p.clientId},dependencies:deps,blocked:deps.length!==r.dependencies.length||deps.some(v=>v.state!=='completed'),stale:r.client_id!==p.clientId,responses:responses.slice(0,10),hasMoreResponses:responses.length>10,events,reminders,canManage:canManageClients(a),canRespond:a.role==='client'&&r.state==='open'};
 });}
 async function files(a:Actor,id:string){return tx(a,async c=>{const{r}=await row(c,a,id);return(await c.query(`select f.id,v.name,v.size,v.type from files f join lateral(select name,size,type from file_versions where file_id=f.id order by version_number desc,id desc limit 1)v on true where f.organization_id=$1 and f.project_id=$2 and f.client_id=$3 and f.task_id is null order by f.created_at desc,f.id limit 50`,[a.organizationId,r.project_id,r.client_id])).rows;});}
 async function mutate(a:Actor,id:string,raw:unknown){const parsed=command.safeParse(raw);if(!parsed.success)throw new PendingError(400,'INVALID_INPUT');const d=parsed.data;return tx(a,async c=>{
  const{r,p}=await row(c,a,id,true);
  if(d.action==='respond'?a.role!=='client':!canManageClients(a))throw new PendingError(403,'FORBIDDEN');
  const fingerprint=hash(d),prior=(await c.query('select * from client_request_commands where id=$1',[d.key])).rows[0];
  if(prior){if(prior.request_id!==id||prior.actor_id!==a.id||prior.fingerprint!==fingerprint)throw new PendingError(409,'REQUEST_CONFLICT');return{id};}
  if(r.revision!==d.revision)throw new PendingError(409,'VERSION_CHANGED');
  if(r.client_id!==p.clientId&&d.action!=='cancel')throw new PendingError(409,'CLIENT_CHANGED');
  if(d.action==='respond'){
   if(r.state!=='open')throw new PendingError(409,'INVALID_STATE');if(await blocked(c,r))throw new PendingError(409,'DEPENDENCY_PENDING');
   if(r.kind==='question'&&!d.message||r.kind==='file'&&!d.fileIds.length||new Set(d.fileIds).size!==d.fileIds.length)throw new PendingError(400,'ANSWER_REQUIRED');
   const fields=new Set(r.questions.map((q:any)=>q.id));if(Object.keys(d.answers).some(k=>!fields.has(k)))throw new PendingError(400,'INVALID_ANSWERS');
   for(const q of r.questions){const value=Object.prototype.hasOwnProperty.call(d.answers,q.id)?d.answers[q.id]:'';if(q.required&&!value||value&&q.type==='choice'&&!q.options.includes(value))throw new PendingError(400,'INVALID_ANSWERS');}
   const attachments=(await c.query(`select f.id,v.id as "versionId",v.name,v.url,v.size,v.type from files f join lateral(select * from file_versions where file_id=f.id order by version_number desc,id desc limit 1)v on true where f.id=any($1::text[]) and f.organization_id=$2 and f.project_id=$3 and f.client_id=$4 and f.task_id is null order by f.id for share of f`,[d.fileIds,a.organizationId,r.project_id,r.client_id])).rows;if(attachments.length!==d.fileIds.length)throw new PendingError(400,'INVALID_FILES');
   await c.query('insert into client_request_responses(id,request_id,cycle,actor_id,message,answers,attachments) values($1,$2,$3,$4,$5,$6,$7)',[randomUUID(),id,r.cycle,a.id,d.message,JSON.stringify(d.answers),JSON.stringify(attachments)]);
   await c.query("update client_requests set state='answered',revision=revision+1,updated_at=now(),reminder_next_at=null where id=$1",[id]);
  }else if(d.action==='complete'){
   if(r.state!=='answered')throw new PendingError(409,'RESPONSE_REQUIRED');if(await blocked(c,r))throw new PendingError(409,'DEPENDENCY_PENDING');
   await c.query("update client_requests set state='completed',revision=revision+1,updated_at=now(),completed_at=now(),reminder_next_at=null,reason=$2 where id=$1",[id,d.reason]);
  }else{
   if(!d.reason)throw new PendingError(400,'REASON_REQUIRED');
   if(d.action==='cancel'&&!['open','answered'].includes(r.state)||d.action==='reopen'&&!['answered','completed','cancelled'].includes(r.state))throw new PendingError(409,'INVALID_STATE');
   await c.query(`update client_requests set state=$2,revision=revision+1,updated_at=now(),completed_at=null,reason=$3,cycle=cycle+case when $2='open' then 1 else 0 end,reminder_count=0,reminder_next_at=case when $2='open' and reminder_hours>0 then greatest(due_at,now()+make_interval(hours=>reminder_hours)) else null end where id=$1`,[id,d.action==='cancel'?'cancelled':'open',d.reason]);
  }
  await record(c,a,id,r.project_id,d.action,d.action==='respond'?'':d.reason,r.revision+1);
  await c.query('insert into client_request_commands(id,request_id,actor_id,fingerprint) values($1,$2,$3,$4)',[d.key,id,a.id,fingerprint]);return{id};
 },true);}
 return{list,options,create,detail,files,mutate};
}

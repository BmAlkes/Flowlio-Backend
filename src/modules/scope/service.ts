import { prepareScopeBilling } from '../workflows/service';
import { createHash, randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { z } from 'zod';
import { canManageClients, canReadProject, canViewProjectFinancials, type Actor } from '../../security/resource-policy';
import { calendarDate } from '../capacity/calculation';
import { financialSettings } from '../profitability/service';
import { setAuditContext } from '../audit/context';

export class ScopeError extends Error { constructor(public status:number,public code:string){super(code);} }
const identifier=z.string().min(1).max(128),number=z.string().regex(/^\d{1,8}(\.\d{1,2})?$/);
const createInput=z.object({id:z.string().uuid(),title:z.string().trim().min(1).max(200),description:z.string().trim().min(1).max(4000),fileIds:z.array(identifier).max(5).default([])}).strict();
const revision=z.number().int().min(0).max(10000);
const input=z.discriminatedUnion('action',[
 z.object({action:z.literal('analysis'),revision}).strict(),
 z.object({action:z.literal('estimate'),revision,classification:z.enum(['included','additional']),estimatedHours:number,amount:number,currency:financialSettings.shape.currency,endDate:calendarDate.nullable(),note:z.string().trim().min(1).max(4000)}).strict(),
 z.object({action:z.literal('decide'),revision,state:z.enum(['approved','rejected']),comment:z.string().trim().max(2000)}).strict(),
 z.object({action:z.literal('cancel'),revision,reason:z.string().trim().min(1).max(2000)}).strict(),
 z.object({action:z.literal('apply'),revision,createTask:z.boolean(),prepareBilling:z.boolean(),applyDate:z.boolean(),confirm:z.literal(true)}).strict(),
]);
const hash=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const dateValue=(value:Date|string|null)=>value?new Date(typeof value==='string'&&!/[zZ]|[+-]\d\d:\d\d$/.test(value)?value.replace(' ','T')+'Z':value).toISOString():null;
export function createScopeChanges(pool:Pool){
 async function project(c:PoolClient,a:Actor,id:string,lock=false){
  if(!a.organizationId||(a.role!=='client'&&!canManageClients(a)))throw new ScopeError(403,'FORBIDDEN');
  const p=(await c.query(`select p.id,p.name,p.end_date::text,p.start_date::text,p.budget,p.organization_id as "organizationId",p.created_by as "createdBy",p.assigned_to as "assignedTo",p.visibility,p.client_id as "clientId",cl.user_id as "clientUserId"
   from projects p left join clients cl on cl.id=p.client_id and cl.organization_id=p.organization_id where p.id=$1 and p.organization_id=$2 ${lock?'for update of p':''}`,[id,a.organizationId])).rows[0];
  if(p&&lock&&p.clientId)p.clientUserId=(await c.query('select user_id from clients where id=$1 and organization_id=$2 for share',[p.clientId,a.organizationId])).rows[0]?.user_id;
  if(!p||!canReadProject(a,p,p.clientUserId===a.id?p.clientId:undefined))throw new ScopeError(404,'PROJECT_NOT_FOUND');
  return p;
 }
 async function audit(c:PoolClient,a:Actor,projectId:string,id:string,action:string,before:Record<string,unknown>,after:Record<string,unknown>){
  const changes:Record<string,unknown>={};for(const key of Object.keys(after)){if(JSON.stringify(before[key]??null)!==JSON.stringify(after[key]??null))changes[key]={before:before[key]??null,after:after[key]??null};}
  if(!Object.keys(changes).length)return;
  await c.query(`insert into business_audit_events(id,organization_id,actor_kind,actor_id,action,resource_type,resource_id,project_id,operation_id,changes) values($1,$2,'human',$3,$4,'change_request',$5,$6,$7,$8)`,[randomUUID(),a.organizationId,a.id,'change_request.'+action,id,projectId,randomUUID(),JSON.stringify(changes)]);
  await c.query(`insert into recent_activities(id,organization_id,user_id,actor_id,type,action,resource,resource_id,message,metadata,created_at) values($1,$2,$3,$3,'scope',$4,'project',$5,'Scope change updated',$6,now())`,[randomUUID(),a.organizationId,a.id,'scope_'+action,projectId,JSON.stringify({changeId:id,projectId})]);
 }
 async function transaction<T>(a:Actor,projectId:string,work:(c:PoolClient,p:any)=>Promise<T>){
  const c=await pool.connect();try{await c.query('begin');await c.query("set local time zone 'UTC'");await c.query('select pg_advisory_xact_lock(hashtextextended($1,0))',['proposal-conversion:'+a.organizationId]);const p=await project(c,a,projectId,true);await setAuditContext(c,{organizationId:a.organizationId!,actorKind:'human',actorId:a.id});const result=await work(c,p);await c.query('commit');return result;}catch(e){await c.query('rollback');throw e;}finally{c.release();}
 }
 async function taskQuota(c:PoolClient,a:Actor){
  const row=(await c.query(`select o.override_max_tasks,coalesce(s.features,p.features) as features from organizations o left join subscription_plans p on p.id=o.subscription_plan_id
   left join lateral(select sp.features from subscriptions sub join subscription_plans sp on sp.id=sub.plan_id where sub.organization_id=o.id order by sub.created_at desc,sub.id desc limit 1)s on true where o.id=$1`,[a.organizationId])).rows[0];
  if(!row)throw new ScopeError(403,'FORBIDDEN');const limit=row.override_max_tasks??row.features?.maxTasks;
  if(limit==null||limit===0)return;if(!Number.isInteger(limit)||limit<0)throw new ScopeError(503,'PLAN_UNAVAILABLE');
  const count=(await c.query('select count(*)::int n from tasks t join projects p on p.id=t.project_id where p.organization_id=$1',[a.organizationId])).rows[0].n;
  if(count>=limit)throw new ScopeError(403,'PLAN_LIMIT_REACHED');
 }
 async function create(a:Actor,projectId:string,raw:unknown){
  const parsed=createInput.safeParse(raw);if(!parsed.success)throw new ScopeError(400,'INVALID_REQUEST');const data=parsed.data;
  if(new Set(data.fileIds).size!==data.fileIds.length)throw new ScopeError(400,'INVALID_FILES');
  return transaction(a,projectId,async(c,p)=>{
   if(!p.clientId)throw new ScopeError(409,'CLIENT_REQUIRED');
   const fingerprint=hash({...data,fileIds:[...data.fileIds].sort()});
   const prior=(await c.query('select * from scope_change_requests where id=$1',[data.id])).rows[0];
   if(prior){if(prior.organization_id!==a.organizationId||prior.project_id!==projectId||prior.requested_by!==a.id||prior.request_hash!==fingerprint||prior.client_id!==p.clientId)throw new ScopeError(409,'REQUEST_CONFLICT');return{id:prior.id,existing:true};}
   // Only project-level files explicitly shared with this client can become scope attachments.
   const attachments=(await c.query(`select f.id,v.id as "versionId",v.name,v.url,v.size,v.type from files f join lateral (select * from file_versions where file_id=f.id order by version_number desc,id desc limit 1) v on true
    where f.id=any($1::text[]) and f.project_id=$2 and f.organization_id=$3 and f.client_id=$4 and f.task_id is null order by f.id`,[data.fileIds,projectId,a.organizationId,p.clientId])).rows;
   if(attachments.length!==data.fileIds.length)throw new ScopeError(400,'INVALID_FILES');
   const source=(await c.query('select cv.source_id as "proposalId",cv.source_title as title,cv.source_version as version from proposal_project_conversions cv join proposals pr on pr.id=cv.proposal_id and pr.organization_id=cv.organization_id and pr.client_id=$3 where cv.project_id=$1 and cv.organization_id=$2 limit 1',[projectId,a.organizationId,p.clientId])).rows[0]??null;
   await c.query(`insert into scope_change_requests(id,organization_id,project_id,client_id,requested_by,title,description,attachments,source,request_hash) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,[data.id,a.organizationId,projectId,p.clientId,a.id,data.title,data.description,JSON.stringify(attachments),source?JSON.stringify(source):null,fingerprint]);
   await audit(c,a,projectId,data.id,'requested',{}, {state:'requested',revision:0});return{id:data.id,existing:false};
  });
 }
 function commercial(a:Actor){return a.role==='client'||canViewProjectFinancials(a);}
 function safeVersion(a:Actor,row:any){if(!row)return null;const{base_end_date,...result}=row;void base_end_date;if(!commercial(a)){delete result.amount;delete result.currency;}return result;}
 async function list(a:Actor,projectId:string,raw:unknown){
  const parsed=z.object({page:z.coerce.number().int().min(1).max(100000).default(1),changeId:identifier.optional(),versionPage:z.coerce.number().int().min(1).max(10000).default(1)}).strict().safeParse(raw);if(!parsed.success)throw new ScopeError(400,'INVALID_QUERY');
  const c=await pool.connect();try{
   await c.query('begin isolation level repeatable read read only');const p=await project(c,a,projectId);const q=parsed.data;
   const rows=(await c.query(`select * from scope_change_requests where project_id=$1 and organization_id=$2 and ($3::text is null or client_id=$3) and ($4::text is null or id=$4) order by created_at desc,id desc limit 11 offset $5`,[projectId,a.organizationId,a.role==='client'?p.clientId:null,q.changeId??null,(q.page-1)*10])).rows;
   const items=[];
   for(const row of rows.slice(0,10)){
    const latest=(await c.query('select * from scope_change_versions where change_id=$1 and revision=$2',[row.id,row.revision])).rows[0];
    const history=q.changeId?(await c.query('select * from scope_change_versions where change_id=$1 order by revision desc limit 11 offset $2',[row.id,(q.versionPage-1)*10])).rows:[];
    const {request_hash,...publicRow}=row;void request_hash;
    if(!canViewProjectFinancials(a)&&publicRow.application){publicRow.application={appliedAt:publicRow.application.appliedAt,taskId:publicRow.application.taskId,dateApplied:publicRow.application.dateApplied};}
    items.push({...publicRow,latest:safeVersion(a,latest),history:history.slice(0,10).map(v=>safeVersion(a,v)),hasMoreVersions:history.length>10,stale:row.client_id!==p.clientId});
   }
   await c.query('commit');return{items,page:q.page,hasMore:rows.length>10,project:{id:p.id,name:p.name,clientId:p.clientId},canManage:canManageClients(a),canEstimate:canViewProjectFinancials(a),canDecide:a.role==='client'};
  }catch(e){await c.query('rollback');throw e;}finally{c.release();}
 }
 async function transition(a:Actor,projectId:string,id:string,raw:unknown){
  const parsed=input.safeParse(raw);if(!parsed.success)throw new ScopeError(400,'INVALID_INPUT');const data=parsed.data;
  return transaction(a,projectId,async(c,p)=>{
   const row=(await c.query('select * from scope_change_requests where id=$1 and project_id=$2 and organization_id=$3 for update',[id,projectId,a.organizationId])).rows[0];
   if(!row||(a.role==='client'&&row.client_id!==p.clientId))throw new ScopeError(404,'REQUEST_NOT_FOUND');
   if(data.revision!==row.revision)throw new ScopeError(409,'VERSION_CHANGED');
   if(row.client_id!==p.clientId&&data.action!=='cancel')throw new ScopeError(409,'CLIENT_CHANGED');
   const manager=canManageClients(a),money=canViewProjectFinancials(a);
   const old=(await c.query('select *,base_end_date::text from scope_change_versions where change_id=$1 and revision=$2',[id,row.revision])).rows[0];
   if(data.action==='analysis'){
    if(!manager)throw new ScopeError(403,'FORBIDDEN');if(row.state==='analysis')return{id,existing:true};
    if(row.state!=='requested')throw new ScopeError(409,'INVALID_STATE');
    await c.query("update scope_change_requests set state='analysis',updated_at=now() where id=$1",[id]);await audit(c,a,projectId,id,'analysis',{state:row.state},{state:'analysis'});
   }else if(data.action==='estimate'){
    if(!money)throw new ScopeError(403,'FINANCIAL_ACCESS_REQUIRED');
    if(!['requested','analysis','awaiting','rejected','approved'].includes(row.state))throw new ScopeError(409,'INVALID_STATE');
    if(data.classification==='included'&&Number(data.amount)!==0)throw new ScopeError(400,'INCLUDED_MUST_BE_FREE');
    if(data.endDate&&p.start_date&&data.endDate<dateValue(p.start_date)!.slice(0,10))throw new ScopeError(400,'INVALID_DEADLINE');
    await c.query(`insert into scope_change_versions(change_id,revision,classification,estimated_hours,amount,currency,end_date,base_end_date,note,created_by) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,[id,row.revision+1,data.classification,data.estimatedHours,data.amount,data.currency,data.endDate,p.end_date,data.note,a.id]);
    await c.query("update scope_change_requests set state='awaiting',revision=revision+1,updated_at=now() where id=$1",[id]);
    await audit(c,a,projectId,id,'estimated',{state:row.state,revision:row.revision,amount:old?.amount,currency:old?.currency,end_date:old?.end_date},{state:'awaiting',revision:row.revision+1,amount:data.amount,currency:data.currency,end_date:data.endDate});
   }else if(data.action==='decide'){
    if(a.role!=='client')throw new ScopeError(403,'CLIENT_ONLY');
    if(row.state===data.state&&old?.decided_by===a.id&&old.comment===data.comment)return{id,existing:true};
    if(row.state!=='awaiting'||!old)throw new ScopeError(409,'INVALID_STATE');
    if(data.state==='rejected'&&!data.comment)throw new ScopeError(400,'REASON_REQUIRED');
    await c.query('update scope_change_versions set decision=$3,comment=$4,decided_by=$5,decided_at=now() where change_id=$1 and revision=$2',[id,row.revision,data.state,data.comment,a.id]);
    await c.query('update scope_change_requests set state=$2,updated_at=now() where id=$1',[id,data.state]);await audit(c,a,projectId,id,data.state,{state:row.state},{state:data.state,revision:row.revision});
   }else if(data.action==='cancel'){
    if(!manager&&row.requested_by!==a.id)throw new ScopeError(403,'FORBIDDEN');
    if(row.state==='cancelled'&&row.cancellation_reason===data.reason)return{id,existing:true};
    if(row.state==='applied'||row.state==='cancelled'||(!manager&&row.state==='approved'))throw new ScopeError(409,'INVALID_STATE');
    await c.query("update scope_change_requests set state='cancelled',cancellation_reason=$2,updated_at=now() where id=$1",[id,data.reason]);await audit(c,a,projectId,id,'cancelled',{state:row.state},{state:'cancelled',revision:row.revision});
   }else{
    if(!money)throw new ScopeError(403,'FINANCIAL_ACCESS_REQUIRED');
    const signature=hash(data);
    if(row.state==='applied'){if(row.application?.signature!==signature)throw new ScopeError(409,'ALREADY_APPLIED');return{id,existing:true};}
    if(row.state!=='approved'||old?.decision!=='approved')throw new ScopeError(409,'INVALID_STATE');
    if(!data.createTask&&!data.prepareBilling&&!data.applyDate)throw new ScopeError(400,'CHOOSE_APPLICATION');
    if(data.prepareBilling&&(old.classification!=='additional'||Number(old.amount)<=0))throw new ScopeError(400,'NO_ADDITIONAL_CHARGE');
    if(data.applyDate&&(!old.end_date||dateValue(p.end_date)!==dateValue(old.base_end_date)))throw new ScopeError(409,'DEADLINE_CHANGED');
    if((data.applyDate||data.createTask)&&old.end_date&&p.start_date&&old.end_date<dateValue(p.start_date)!.slice(0,10))throw new ScopeError(409,'DEADLINE_CHANGED');
    if(data.createTask)await taskQuota(c,a);
    const taskId=data.createTask?randomUUID():null;
    if(taskId)await c.query(`insert into tasks(id,title,description,project_id,created_by,status,visibility,estimated_hours,end_date,created_at,updated_at) values($1,$2,$3,$4,$5,'todo','private',$6,$7,now(),now())`,[taskId,row.title,row.description,projectId,a.id,old.estimated_hours,old.end_date?old.end_date+'T00:00:00Z':null]);
    if(data.applyDate)await c.query('update projects set end_date=$2,updated_at=now() where id=$1',[projectId,old.end_date+'T00:00:00Z']);
    const application={signature,appliedAt:new Date().toISOString(),appliedBy:a.id,taskId,dateApplied:data.applyDate,billingDraft:data.prepareBilling?{...(await prepareScopeBilling(c,a.organizationId!,id,row.revision)),state:'draft',amount:old.amount,currency:old.currency,description:row.title,clientId:p.clientId,projectId,changeId:id,revision:row.revision}:null};
    await c.query("update scope_change_requests set state='applied',application=$2,updated_at=now() where id=$1",[id,JSON.stringify(application)]);await audit(c,a,projectId,id,'applied',{state:row.state},{state:'applied',revision:row.revision,task_id:taskId,billing_draft_id:application.billingDraft?.id??null});
   }
   return{id,existing:false};
  });
 }
 return{create,list,transition};
}

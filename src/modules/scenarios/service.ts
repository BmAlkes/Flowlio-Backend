import {randomUUID} from 'node:crypto';import type {Pool,PoolClient} from 'pg';import {z} from 'zod';
import {canManageClients,type Actor} from '../../security/resource-policy';import {setAuditContext} from '../audit/context';
import {weekBounds} from '../capacity/calculation';import {compare,type Base,type Change} from './calculation';
import {ScenarioError,hash,createInput,saveInput,refreshInput,applyInput,absenceInput} from './policy';
export {ScenarioError} from './policy';
type Snapshot=Base&{projects:{id:string;name:string;public:boolean;eligible:string[]}[]};
export function createScenarios(pool:Pool){
 async function tx<T>(a:Actor,work:(c:PoolClient)=>Promise<T>,write=false){
  if(!a.organizationId||!canManageClients(a))throw new ScenarioError(403,'FORBIDDEN');const c=await pool.connect();
  try{await c.query(write?'begin isolation level serializable':'begin isolation level repeatable read read only');await c.query("set local statement_timeout='20s'");
   if(write){await c.query('select pg_advisory_xact_lock(hashtextextended($1,0))',['capacity-scenarios:'+a.organizationId]);await setAuditContext(c,{organizationId:a.organizationId,actorKind:'human',actorId:a.id});}
   const value=await work(c);await c.query('commit');return value;
  }catch(e){await c.query('rollback');if((e as any).code==='40001'||(e as any).code==='40P01')throw new ScenarioError(409,'PLAN_CHANGED');throw e;}finally{c.release();}
 }
 async function audit(c:PoolClient,a:Actor,id:string,action:string,changes:unknown){await c.query(`insert into business_audit_events(id,organization_id,actor_kind,actor_id,action,resource_type,resource_id,operation_id,changes) values($1,$2,'human',$3,$4,'capacity_scenario',$5,$6,$7)`,[randomUUID(),a.organizationId,a.id,'capacity.'+action,id,randomUUID(),JSON.stringify(changes)]);}
 async function capture(c:PoolClient,a:Actor,lock=false){
  const members=(await c.query(`select u.id,u.name,c.weekly_minutes as "weeklyMinutes",coalesce(c.team,'') team,m.updated_at membership_version,u.updated_at user_version
   from users u join user_organizations m on m.user_id=u.id left join member_capacity c on c.user_id=u.id and c.organization_id=m.organization_id
   where m.organization_id=$1 and m.status='active' and u.status='active' and u.role in ('user','operator','viewer') order by u.id limit 501 ${lock?'for share of u,m':''}`,[a.organizationId])).rows;
  if(members.length>500)throw new ScenarioError(400,'TEAM_TOO_LARGE');
  if(lock)await c.query('select user_id from member_capacity where organization_id=$1 for share',[a.organizationId]);
  const projects=(await c.query(`select id,name,created_by,assigned_to,visibility,updated_at from projects where organization_id=$1 order by id limit 2001 ${lock?'for share':''}`,[a.organizationId])).rows;
  if(projects.length>2000)throw new ScenarioError(400,'PLAN_TOO_LARGE');
  const tasks=(await c.query(`select t.id,t.title,t.project_id,t.assigned_to,t.created_by,t.visibility,t.status,t.estimated_hours,to_char(t.start_date,'YYYY-MM-DD') start_date,to_char(t.end_date,'YYYY-MM-DD') end_date,t.start_after,t.finish_before,t.updated_at,
   exists(select 1 from tasks child where child.parent_id=t.id) parent,
   ((nullif(t.start_after,'') is not null and not exists(select 1 from tasks d join projects p on p.id=d.project_id where d.id=t.start_after and p.organization_id=$1 and d.status='completed')) or exists(select 1 from tasks d join projects p on p.id=d.project_id where d.finish_before=t.id and p.organization_id=$1 and d.status is distinct from 'completed')) blocked
   from tasks t join projects p on p.id=t.project_id where p.organization_id=$1 and t.status is distinct from 'completed' order by t.id limit 2001 ${lock?'for update of t':''}`,[a.organizationId])).rows;
  if(tasks.length>2000)throw new ScenarioError(400,'PLAN_TOO_LARGE');
  const absences=(await c.query(`select id,user_id as "userId",start_date as "startDate",end_date as "endDate",kind,revision from capacity_absences where organization_id=$1 order by id ${lock?'for share':''}`,[a.organizationId])).rows;
  const visibleProjects=projects.filter(p=>p.created_by===a.id||p.assigned_to===a.id||p.visibility==='public');
  const visibleTasks=tasks.filter(t=>!t.parent&&visibleProjects.some(p=>p.id===t.project_id)&&(t.created_by===a.id||t.assigned_to===a.id||t.visibility==='public'));
  const base:Snapshot={members:members.map(({membership_version,user_version,...m})=>{void membership_version;void user_version;return m;}),projects:visibleProjects.map(p=>({id:p.id,name:p.name,public:p.visibility==='public',eligible:p.visibility==='public'?[]:members.filter(m=>p.created_by===m.id||p.assigned_to===m.id).map(m=>m.id)})),
   tasks:visibleTasks.map(t=>({id:t.id,title:t.title,projectId:t.project_id,projectName:projects.find(p=>p.id===t.project_id)!.name,assignedTo:t.assigned_to,startDate:t.start_date,endDate:t.end_date,estimatedHours:t.estimated_hours,blocked:t.blocked})),absences,hiddenTasks:tasks.filter(t=>!t.parent).length-visibleTasks.length,excludedParents:tasks.filter(t=>t.parent&&visibleProjects.some(p=>p.id===t.project_id)&&(t.created_by===a.id||t.assigned_to===a.id||t.visibility==='public')).length};
  return{base,fingerprint:hash({members,projects,tasks,absences})};
 }
 async function row(c:PoolClient,a:Actor,id:string,lock=false){const r=(await c.query(`select * from capacity_scenarios where id=$1 and organization_id=$2 and created_by=$3 ${lock?'for update':''}`,[id,a.organizationId,a.id])).rows[0];if(!r)throw new ScenarioError(404,'SCENARIO_NOT_FOUND');return r;}
 function access(base:Snapshot,current:Snapshot){if(base.tasks.some(t=>!current.tasks.some(v=>v.id===t.id)))throw new ScenarioError(409,'SCENARIO_ACCESS_CHANGED');}
 function validate(base:Snapshot,changes:Change[]){for(const v of changes){
  if(v.assignedTo&&!base.members.some(m=>m.id===v.assignedTo))throw new ScenarioError(400,'MEMBER_NOT_FOUND');
  if(v.type==='task'){const task=base.tasks.find(t=>t.id===v.taskId);if(!task)throw new ScenarioError(400,'TASK_UNAVAILABLE');
   const project=base.projects.find(p=>p.id===task.projectId);if(v.assignedTo&&!project?.public&&!project?.eligible.includes(v.assignedTo))throw new ScenarioError(400,'PROJECT_ACCESS_REQUIRED');}
 }}
 async function list(a:Actor){return tx(a,async c=>(await c.query('select id,title,week_start,weeks,state,revision,created_at,applied_at from capacity_scenarios where organization_id=$1 and created_by=$2 order by created_at desc,id limit 100',[a.organizationId,a.id])).rows);}
 async function create(a:Actor,raw:unknown){const q=createInput.safeParse(raw);if(!q.success)throw new ScenarioError(400,'INVALID_INPUT');const d=q.data;return tx(a,async c=>{
  const previous=(await c.query('select * from capacity_scenarios where id=$1',[d.id])).rows[0];if(previous){if(previous.created_by!==a.id||previous.organization_id!==a.organizationId||previous.creation_hash!==hash(d))throw new ScenarioError(409,'REQUEST_CONFLICT');return{id:d.id};}
  if((await c.query("select count(*)::int n from capacity_scenarios where organization_id=$1 and created_by=$2",[a.organizationId,a.id])).rows[0].n>=100)throw new ScenarioError(409,'SCENARIO_LIMIT');
  const current=await capture(c,a);await c.query('insert into capacity_scenarios(id,organization_id,created_by,title,week_start,weeks,base,base_hash,creation_hash) values($1,$2,$3,$4,$5,$6,$7,$8,$9)',[d.id,a.organizationId,a.id,d.title,weekBounds(d.week).from,d.weeks,JSON.stringify(current.base),current.fingerprint,hash(d)]);await audit(c,a,d.id,'scenario_created',{});return{id:d.id};
 },true);}
 async function detail(a:Actor,id:string){return tx(a,async c=>{const r=await row(c,a,id),current=await capture(c,a);access(r.base,current.base);
  return{id:r.id,title:r.title,week:r.week_start,weeks:r.weeks,revision:r.revision,state:r.state,stale:r.base_hash!==current.fingerprint,base:r.base,changes:r.changes,appliedIds:r.applied_ids,appliedAt:r.applied_at,comparison:compare(r.base,r.changes,r.week_start,r.weeks)};
 });}
 async function save(a:Actor,id:string,raw:unknown){const q=saveInput.safeParse(raw);if(!q.success)throw new ScenarioError(400,'INVALID_INPUT');return tx(a,async c=>{const r=await row(c,a,id,true);if(r.state!=='draft'||r.revision!==q.data.revision)throw new ScenarioError(409,'VERSION_CHANGED');const current=await capture(c,a);access(r.base,current.base);if(r.base_hash!==current.fingerprint)throw new ScenarioError(409,'PLAN_CHANGED');validate(r.base,q.data.changes);await c.query('update capacity_scenarios set changes=$2,revision=revision+1,updated_at=now() where id=$1',[id,JSON.stringify(q.data.changes)]);await audit(c,a,id,'scenario_saved',{count:{after:q.data.changes.length}});return{id};},true);}
 async function refresh(a:Actor,id:string,raw:unknown){const q=refreshInput.safeParse(raw);if(!q.success)throw new ScenarioError(400,'INVALID_INPUT');return tx(a,async c=>{const r=await row(c,a,id,true);if(r.state!=='draft'||r.revision!==q.data.revision)throw new ScenarioError(409,'VERSION_CHANGED');const current=await capture(c,a);await c.query("update capacity_scenarios set base=$2,base_hash=$3,changes='[]',revision=revision+1,updated_at=now() where id=$1",[id,JSON.stringify(current.base),current.fingerprint]);await audit(c,a,id,'scenario_refreshed',{});return{id};},true);}
 async function remove(a:Actor,id:string,raw:unknown){const q=z.object({revision:z.number().int().min(0)}).strict().safeParse(raw);if(!q.success)throw new ScenarioError(400,'INVALID_INPUT');return tx(a,async c=>{const r=await row(c,a,id,true);if(r.state!=='draft'||r.revision!==q.data.revision)throw new ScenarioError(409,'VERSION_CHANGED');await c.query('delete from capacity_scenarios where id=$1',[id]);await audit(c,a,id,'scenario_deleted',{});return{id};},true);}
 async function apply(a:Actor,id:string,raw:unknown){const q=applyInput.safeParse(raw);if(!q.success)throw new ScenarioError(400,'INVALID_INPUT');const d=q.data;return tx(a,async c=>{const r=await row(c,a,id,true);
  if(r.apply_key===d.key&&r.apply_hash===hash(d))return{id,appliedIds:r.applied_ids};
  if(r.state!=='draft'||r.revision!==d.revision)throw new ScenarioError(409,'VERSION_CHANGED');
  const current=await capture(c,a,true);access(r.base,current.base);if(r.base_hash!==current.fingerprint)throw new ScenarioError(409,'PLAN_CHANGED');
  const selected:Change[]=d.selected.map(key=>r.changes.find((v:Change)=>v.key===key));if(selected.some(v=>!v||v.type!=='task'))throw new ScenarioError(400,'INVALID_SELECTION');validate(current.base,selected);
  for(const v of selected){const result=await c.query(`update tasks set assigned_to=$2,start_date=case when to_char(start_date,'YYYY-MM-DD')=$3 then start_date else $3::date end,end_date=case when to_char(end_date,'YYYY-MM-DD')=$4 then end_date else $4::date end,updated_at=clock_timestamp() where id=$1`,[v.taskId,v.assignedTo,v.startDate,v.endDate]);if(result.rowCount!==1)throw new ScenarioError(409,'PLAN_CHANGED');}
  const ids=selected.map(v=>v.taskId);await c.query("update capacity_scenarios set state='applied',revision=revision+1,apply_key=$2,apply_hash=$3,applied_ids=$4,applied_at=now(),updated_at=now() where id=$1",[id,d.key,hash(d),JSON.stringify(ids)]);await audit(c,a,id,'scenario_applied',{tasks:{after:ids}});return{id,appliedIds:ids};
 },true);}
 async function absenceList(a:Actor){return tx(a,async c=>{
  const members=(await c.query("select u.id,u.name from users u join user_organizations m on m.user_id=u.id where m.organization_id=$1 and m.status='active' and u.status='active' and u.role in ('user','operator','viewer') order by u.name,u.id limit 501",[a.organizationId])).rows;if(members.length>500)throw new ScenarioError(400,'TEAM_TOO_LARGE');
  const items=(await c.query('select id,user_id as "userId",start_date as "startDate",end_date as "endDate",kind,revision from capacity_absences where organization_id=$1 order by start_date desc,id',[a.organizationId])).rows;return{members,items};
 });}
 async function absenceCreate(a:Actor,raw:unknown){const q=absenceInput.safeParse(raw);if(!q.success)throw new ScenarioError(400,'INVALID_INPUT');const d=q.data;return tx(a,async c=>{
  const member=await c.query("select u.id from users u join user_organizations m on m.user_id=u.id where u.id=$1 and m.organization_id=$2 and m.status='active' and u.status='active' and u.role in ('user','operator','viewer') for share of u,m",[d.userId,a.organizationId]);if(!member.rowCount)throw new ScenarioError(400,'MEMBER_NOT_FOUND');
  const old=(await c.query('select * from capacity_absences where id=$1',[d.id])).rows[0];if(old){if(old.organization_id!==a.organizationId||old.user_id!==d.userId||old.start_date!==d.startDate||old.end_date!==d.endDate||old.kind!==d.kind)throw new ScenarioError(409,'REQUEST_CONFLICT');return{id:d.id};}
  if((await c.query('select count(*)::int n from capacity_absences where organization_id=$1',[a.organizationId])).rows[0].n>=2000)throw new ScenarioError(409,'ABSENCE_LIMIT');
  await c.query('insert into capacity_absences(id,organization_id,user_id,start_date,end_date,kind,created_by) values($1,$2,$3,$4,$5,$6,$7)',[d.id,a.organizationId,d.userId,d.startDate,d.endDate,d.kind,a.id]);await audit(c,a,d.id,'absence_created',{userId:{after:d.userId},startDate:{after:d.startDate},endDate:{after:d.endDate}});return{id:d.id};
 },true);}
 async function absenceRemove(a:Actor,id:string,raw:unknown){const q=z.object({revision:z.number().int().min(0)}).strict().safeParse(raw);if(!q.success)throw new ScenarioError(400,'INVALID_INPUT');return tx(a,async c=>{const result=await c.query('delete from capacity_absences where id=$1 and organization_id=$2 and revision=$3 returning id',[id,a.organizationId,q.data.revision]);if(!result.rowCount)throw new ScenarioError(409,'VERSION_CHANGED');await audit(c,a,id,'absence_deleted',{});return{id};},true);}
 return{list,create,detail,save,refresh,remove,apply,absenceList,absenceCreate,absenceRemove};
}

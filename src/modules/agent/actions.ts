import type { PoolClient } from 'pg';
import { randomUUID } from 'node:crypto';
import { canManageClients,canPerform,canReadProject,canReadTask,type Actor } from '../../security/resource-policy';
import { computeProjectStatus,isAutoManagedProjectStatus } from '../../services/projectStatus.service';
import { setAuditContext } from '../audit/context';
import { AgentError,hash,type Action,type Context } from './policy';

export async function execute(c:PoolClient,a:Actor,actions:Action[],context:Context,runId:string){
 const receipts:{type:string;id:string;title:string;href:string}[]=[];const changedProjects=new Set<string>();
 await setAuditContext(c,{organizationId:a.organizationId!,actorKind:'human',actorId:a.id});
 await c.query('select id from organizations where id=$1 for update',[a.organizationId]);
 for(const action of actions){
  let resourceId='',title='',href='',projectId:string|null=null;
  if(action.type==='followup'){
   if(!canManageClients(a))throw new AgentError(403,'FORBIDDEN');
   const old=context.sources.find(s=>s.kind==='client'&&s.id===action.clientId);
   const row=(await c.query('select id,name,updated_at from clients where id=$1 and organization_id=$2 for update',[action.clientId,a.organizationId])).rows[0];
   if(!old||!row)throw new AgentError(404,'CONTEXT_NOT_FOUND');
   if(new Date(row.updated_at).toISOString()!==old.data.updated_at)throw new AgentError(409,'SOURCE_CHANGED');
   await c.query('update clients set follow_up_at=$1,follow_up_note=$2,updated_at=now() where id=$3',[action.date,action.note,row.id]);
   resourceId=row.id;title=row.name;href='/dashboard/leads';
  }else{
   let task:any;
   if(action.type==='plan_task'){
    if(!canPerform(a,'update'))throw new AgentError(403,'FORBIDDEN');
    task=(await c.query('select id,project_id as "projectId",title,created_by as "createdBy",assigned_to as "assignedTo",visibility,status,updated_at,parent_id,start_after,finish_before from tasks where id=$1 for update',[action.taskId])).rows[0];
    if(!task)throw new AgentError(404,'CONTEXT_NOT_FOUND');projectId=task.projectId;
   }else projectId=action.projectId;
   const p=(await c.query('select id,name,status,organization_id as "organizationId",created_by as "createdBy",assigned_to as "assignedTo",visibility,client_id as "clientId" from projects where id=$1 and organization_id=$2 for update',[projectId,a.organizationId])).rows[0];
   if(!p||!canReadProject(a,p))throw new AgentError(404,'CONTEXT_NOT_FOUND');
   if(task){
    if(!canReadTask(a,task,p))throw new AgentError(404,'CONTEXT_NOT_FOUND');
    const old=context.sources.find(s=>s.kind==='task'&&s.id===task.id);
    if(!old||new Date(task.updated_at).toISOString()!==old.data.updated_at)throw new AgentError(409,'SOURCE_CHANGED');
    // Complex dependency plans stay in the dedicated capacity/scenario flow.
    if(task.start_after||task.finish_before||task.parent_id||task.status==='completed'||(await c.query('select 1 from tasks where parent_id=$1 or start_after=$1 or finish_before=$1 limit 1',[task.id])).rowCount)throw new AgentError(409,'TASK_REQUIRES_PLANNING');
   }
   if('assignedTo'in action&&action.assignedTo){
    const row=(await c.query("select u.id from users u join user_organizations m on m.user_id=u.id where u.id=$1 and m.organization_id=$2 and m.status='active' and u.status='active' and u.role in ('user','operator','viewer') for share of u,m",[action.assignedTo,a.organizationId])).rows[0];
    if(!row||(p.visibility!=='public'&&p.createdBy!==row.id&&p.assignedTo!==row.id))throw new AgentError(409,'ASSIGNEE_UNAVAILABLE');
   }
   if(action.type==='create_task'){
    if(!canPerform(a,'create'))throw new AgentError(403,'FORBIDDEN');
    const quota=(await c.query(`select o.override_max_tasks,coalesce(s.features,p.features) features from organizations o left join subscription_plans p on p.id=o.subscription_plan_id left join lateral(select sp.features from subscriptions sub join subscription_plans sp on sp.id=sub.plan_id where sub.organization_id=o.id order by sub.created_at desc,sub.id desc limit 1)s on true where o.id=$1`,[a.organizationId])).rows[0];
    const limit=quota?.override_max_tasks??quota?.features?.maxTasks;
    if(limit!=null&&limit!==0){if(!Number.isInteger(limit)||limit<0)throw new AgentError(503,'PLAN_UNAVAILABLE');const count=(await c.query('select count(*)::int n from tasks t join projects p on p.id=t.project_id where p.organization_id=$1',[a.organizationId])).rows[0].n;if(count>=limit)throw new AgentError(403,'PLAN_LIMIT_REACHED');}
    resourceId=randomUUID();title=action.title;
    await c.query("insert into tasks(id,title,description,project_id,assigned_to,created_by,status,visibility,start_date,end_date,estimated_hours,created_at,updated_at) values($1,$2,$3,$4,$5,$6,'todo','private',$7::date,$8::date,$9,now(),now())",[resourceId,action.title,action.description,projectId,action.assignedTo,a.id,action.startDate,action.endDate,action.estimatedHours]);changedProjects.add(projectId!);
   }else if(action.type==='plan_task'){
    resourceId=task.id;title=task.title;
    await c.query("update tasks set assigned_to=$1,start_date=case when to_char(start_date,'YYYY-MM-DD') is not distinct from $2::text then start_date else $2::date end,end_date=case when to_char(end_date,'YYYY-MM-DD') is not distinct from $3::text then end_date else $3::date end,updated_at=now() where id=$4",[action.assignedTo,action.startDate,action.endDate,task.id]);changedProjects.add(projectId!);
   }else{
    if(!canManageClients(a))throw new AgentError(403,'FORBIDDEN');
    const original=context.sources.find(s=>s.kind==='project'&&s.id===projectId);
    if(!original||original.data.client_id!==p.clientId)throw new AgentError(409,'SOURCE_CHANGED');
    const client=(await c.query('select id from clients where id=$1 and organization_id=$2 and portal_access_enabled=true and user_id is not null for share',[p.clientId,a.organizationId])).rows[0];
    if(!client)throw new AgentError(409,'CLIENT_REQUIRED');
    const count=(await c.query("select count(*)::int n from client_requests where organization_id=$1 and state in ('open','answered')",[a.organizationId])).rows[0].n;if(count>=500)throw new AgentError(409,'REQUEST_LIMIT');
    resourceId=randomUUID();title=action.title;const questions=action.questions.map((label,i)=>({id:'q'+i,label,type:'text',required:true,options:[]}));
    await c.query("insert into client_requests(id,organization_id,project_id,client_id,kind,title,description,questions,dependencies,assigned_to,created_by,request_hash,timezone,reminder_hours,reminder_channel) values($1,$2,$3,$4,$5,$6,$7,$8,'{}',$9,$9,$10,'UTC',0,'internal')",[resourceId,a.organizationId,projectId,p.clientId,questions.length?'briefing':'question',title,action.description,JSON.stringify(questions),a.id,hash({runId,action})]);
    await c.query("insert into client_request_events(id,request_id,action,actor_id,reason) values($1,$2,'created',$3,'Created from reviewed AI draft')",[randomUUID(),resourceId,a.id]);
   }
   href='/dashboard/project/view/'+encodeURIComponent(projectId!)+(action.type==='client_request'?'/pending':'');
  }
  receipts.push({type:action.type,id:resourceId,title,href});
  await c.query("insert into business_audit_events(id,organization_id,actor_kind,actor_id,action,resource_type,resource_id,project_id,operation_id,changes) values($1,$2,'human',$3,$4,'ai_agent',$5,$6,$7,$8)",[randomUUID(),a.organizationId,a.id,'agent.'+action.type,resourceId,projectId,runId,JSON.stringify({agentRunId:{after:runId}})]);
 }
 for(const id of changedProjects){
  const rows=(await c.query('select status,end_date as "endDate" from tasks where project_id=$1',[id])).rows;
  const p=(await c.query('select status from projects where id=$1',[id])).rows[0];
  await c.query('update projects set progress=$1,status=$2,updated_at=now() where id=$3',[rows.length?Math.round(rows.filter(t=>t.status==='completed').length/rows.length*100):0,isAutoManagedProjectStatus(p.status)?computeProjectStatus(rows):p.status,id]);
 }
 return receipts;
}

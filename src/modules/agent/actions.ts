import type { PoolClient } from 'pg';
import { randomUUID } from 'node:crypto';
import { canManageClients,canPerform,canReadProject,canReadTask,type Actor } from '../../security/resource-policy';
import { computeProjectStatus,isAutoManagedProjectStatus } from '../../services/projectStatus.service';
import { setAuditContext } from '../audit/context';
import { AgentError,hash,type Action,type Context } from './policy';

const DEFAULT_MILESTONES=['Discovery','Design','Development','Launch & Handoff'];

// Plan limits follow the organization override first, then its current plan; 0 or none means unlimited.
async function withinPlan(c:PoolClient,a:Actor,override:'override_max_tasks'|'override_max_leads'|null,feature:'maxTasks'|'maxLeads'|'maxProjects',count:string){
 const quota=(await c.query(`select ${override?'o.'+override:'null::int'} as override,coalesce(s.features,p.features) features from organizations o left join subscription_plans p on p.id=o.subscription_plan_id left join lateral(select sp.features from subscriptions sub join subscription_plans sp on sp.id=sub.plan_id where sub.organization_id=o.id order by sub.created_at desc,sub.id desc limit 1)s on true where o.id=$1`,[a.organizationId])).rows[0];
 const limit=quota?.override??quota?.features?.[feature];
 if(limit==null||limit===0)return;if(!Number.isInteger(limit)||limit<0)throw new AgentError(503,'PLAN_UNAVAILABLE');
 if((await c.query(count,[a.organizationId])).rows[0].n>=limit)throw new AgentError(403,'PLAN_LIMIT_REACHED');
}

// Work that has to happen after the commit, outside the database: Google Calendar and client email.
export type Effects={updatedEvents:string[];deletedEvents:{googleEventId:string;googleCalendarId:string}[];messages:{to:string;name:string;subject:string;message:string;from:string}[]};
export const noEffects=():Effects=>({updatedEvents:[],deletedEvents:[],messages:[]});

// A calendar event of the person confirming, unchanged since the model read it.
async function ownEvent(c:PoolClient,a:Actor,context:Context,eventId:string){
 const old=context.sources.find(s=>s.kind==='calendar'&&s.id===eventId);
 const row=(await c.query('select id,title,updated_at,google_event_id,google_calendar_id from calendar_events where id=$1 and organization_id=$2 and user_id=$3 for update',[eventId,a.organizationId,a.id])).rows[0];
 if(!old||!row)throw new AgentError(404,'CONTEXT_NOT_FOUND');
 if(new Date(row.updated_at).toISOString()!==old.data.updated_at)throw new AgentError(409,'SOURCE_CHANGED');
 return row;
}
// A client or lead of this organization that the model was shown.
async function shownClient(c:PoolClient,a:Actor,context:Context,clientId:string){
 if(!canManageClients(a))throw new AgentError(403,'FORBIDDEN');
 const row=(await c.query('select id,name,email,type from clients where id=$1 and organization_id=$2 for update',[clientId,a.organizationId])).rows[0];
 if(!row||!context.sources.some(s=>s.kind==='client'&&s.id===clientId))throw new AgentError(404,'CONTEXT_NOT_FOUND');
 return row;
}

export async function execute(c:PoolClient,a:Actor,actions:Action[],context:Context,runId:string,timeZone='UTC',effects:Effects=noEffects()){
 const receipts:{type:string;id:string;title:string;href:string}[]=[];const changedProjects=new Set<string>();
 await setAuditContext(c,{organizationId:a.organizationId!,actorKind:'human',actorId:a.id});
 await c.query('select id from organizations where id=$1 for update',[a.organizationId]);
 // Calendar days are placed in the confirming person's time zone; unknown zones fall back to UTC.
 const tz=(await c.query('select coalesce((select name from pg_timezone_names where name=$1),$2) tz',[timeZone,'UTC'])).rows[0].tz as string;
 for(const action of actions){
  let resourceId='',title='',href='',projectId:string|null=null;
  if(action.type==='create_event'){
   resourceId=randomUUID();title=action.title;href='/dashboard/calendar';
   // Same shape as the Calendar page: the event day is stored as local midnight, hours are whole local hours.
   await c.query("insert into calendar_events(id,title,description,date,start_hour,end_hour,calendar_type,platform,organization_id,user_id,created_at,updated_at) values($1,$2,$3,($4::date::timestamp at time zone $5) at time zone 'UTC',$6,$7,$8,'none',$9,$10,now(),now())",[resourceId,action.title,action.description||null,action.date,tz,action.startHour,action.endHour,action.calendarType,a.organizationId,a.id]);
  }else if(action.type==='reschedule_event'){
   const row=await ownEvent(c,a,context,action.eventId);
   await c.query("update calendar_events set date=($2::date::timestamp at time zone $3) at time zone 'UTC',start_hour=$4,end_hour=$5,updated_at=now() where id=$1",[row.id,action.date,tz,action.startHour,action.endHour]);
   resourceId=row.id;title=row.title;href='/dashboard/calender';effects.updatedEvents.push(row.id);
  }else if(action.type==='delete_event'){
   // Only the person's own events can be found, so only those can be deleted.
   const row=await ownEvent(c,a,context,action.eventId);
   await c.query('delete from calendar_events where id=$1',[row.id]);
   resourceId=row.id;title=row.title;href='/dashboard/calender';
   if(row.google_event_id)effects.deletedEvents.push({googleEventId:row.google_event_id,googleCalendarId:row.google_calendar_id||'primary'});
  }else if(action.type==='create_project'){
   if(!canPerform(a,'create'))throw new AgentError(403,'FORBIDDEN');
   await withinPlan(c,a,null,'maxProjects','select count(*)::int n from projects where organization_id=$1');
   if((await c.query('select 1 from projects where organization_id=$1 and name=$2 limit 1',[a.organizationId,action.name])).rowCount)throw new AgentError(409,'DUPLICATE_PROJECT');
   if(action.clientId)await shownClient(c,a,context,action.clientId);
   resourceId=randomUUID();title=action.name;href='/dashboard/project/view/'+encodeURIComponent(resourceId);projectId=resourceId;
   // Same defaults as the Projects page: pending, private, no budget, and the default milestones.
   await c.query(`insert into projects(id,name,project_number,client_id,description,organization_id,created_by,start_date,end_date,status,visibility,progress,tags,settings,created_at,updated_at)
    values($1,$2,'',$3,$4,$5,$6,$7::date,$8::date,'pending','private',0,'[]','{"allowGuestAccess":false,"autoAssignTasks":false,"requireApproval":false}',now(),now())`,[resourceId,action.name,action.clientId,action.description||null,a.organizationId,a.id,action.startDate,action.endDate]);
   await c.query("insert into project_milestones(id,project_id,organization_id,title,status,position,created_at,updated_at) select t.id,$1,$2,t.title,'pending',t.position-1,now(),now() from unnest($3::text[],$4::text[]) with ordinality t(title,id,position)",[resourceId,a.organizationId,DEFAULT_MILESTONES,DEFAULT_MILESTONES.map(()=>randomUUID())]);
  }else if(action.type==='add_client_note'){
   const row=await shownClient(c,a,context,action.clientId);
   resourceId=randomUUID();title=row.name;href=row.type==='lead'?'/dashboard/leads':'/dashboard/client-management/'+encodeURIComponent(row.id);
   await c.query('insert into client_interactions(id,client_id,user_id,organization_id,type,content,created_at) values($1,$2,$3,$4,$5,$6,now())',[resourceId,row.id,a.id,a.organizationId,action.interactionType,action.content]);
   await c.query('update clients set last_interaction_at=now() where id=$1',[row.id]);
  }else if(action.type==='message_client'){
   // The Messages channel of the Comments page: recorded on the client and emailed to them.
   const row=await shownClient(c,a,context,action.clientId);
   if(!row.email)throw new AgentError(409,'CLIENT_EMAIL_REQUIRED');
   const from=(await c.query('select name from users where id=$1',[a.id])).rows[0]?.name||'Flowlio';
   resourceId=randomUUID();title=row.name;href='/dashboard/comments?tab=messages';
   await c.query("insert into client_interactions(id,client_id,user_id,organization_id,type,content,metadata,created_at) values($1,$2,$3,$4,'note',$5,$6,now())",[resourceId,row.id,a.id,a.organizationId,action.message,JSON.stringify({channel:'message',subject:action.subject,emailed:true})]);
   await c.query('update clients set last_interaction_at=now() where id=$1',[row.id]);
   effects.messages.push({to:row.email,name:row.name,subject:action.subject,message:action.message,from});
  }else if(action.type==='create_lead'){
   if(!canManageClients(a))throw new AgentError(403,'FORBIDDEN');
   if((await c.query('select 1 from clients where organization_id=$1 and lower(email)=$2 limit 1',[a.organizationId,action.email])).rowCount)throw new AgentError(409,'DUPLICATE_CONTACT');
   await withinPlan(c,a,'override_max_leads','maxLeads',"select count(*)::int n from clients where organization_id=$1 and type='lead'");
   resourceId=randomUUID();title=action.name;href='/dashboard/leads';
   await c.query("insert into clients(id,organization_id,name,email,phone,business_industry,status,type,created_by,position,follow_up_at,follow_up_note,created_at,updated_at) values($1,$2,$3,$4,$5,$6,'New Lead','lead',$7,0,$8,$9,now(),now())",[resourceId,a.organizationId,action.name,action.email,action.phone,action.businessIndustry,a.id,action.followUpAt,action.followUpAt?action.note:null]);
   if(action.note&&!action.followUpAt)await c.query("update clients set follow_up_note=$1 where id=$2",[action.note,resourceId]);
  }else if(action.type==='followup'){
   if(!canManageClients(a))throw new AgentError(403,'FORBIDDEN');
   const old=context.sources.find(s=>s.kind==='client'&&s.id===action.clientId);
   const row=(await c.query('select id,name,updated_at from clients where id=$1 and organization_id=$2 for update',[action.clientId,a.organizationId])).rows[0];
   if(!old||!row)throw new AgentError(404,'CONTEXT_NOT_FOUND');
   if(new Date(row.updated_at).toISOString()!==old.data.updated_at)throw new AgentError(409,'SOURCE_CHANGED');
   await c.query('update clients set follow_up_at=$1,follow_up_note=$2,updated_at=now() where id=$3',[action.date,action.note,row.id]);
   resourceId=row.id;title=row.name;href='/dashboard/leads';
  }else{
   let task:any;
   if('taskId'in action){
    if(!canPerform(a,action.type==='log_time'?'track':'update'))throw new AgentError(403,'FORBIDDEN');
    task=(await c.query('select id,project_id as "projectId",title,created_by as "createdBy",assigned_to as "assignedTo",visibility,status,updated_at,parent_id,start_after,finish_before from tasks where id=$1 for update',[action.taskId])).rows[0];
    if(!task)throw new AgentError(404,'CONTEXT_NOT_FOUND');projectId=task.projectId;
   }else projectId=action.projectId;
   const p=(await c.query('select id,name,status,organization_id as "organizationId",created_by as "createdBy",assigned_to as "assignedTo",visibility,client_id as "clientId" from projects where id=$1 and organization_id=$2 for update',[projectId,a.organizationId])).rows[0];
   if(!p||!canReadProject(a,p))throw new AgentError(404,'CONTEXT_NOT_FOUND');
   if(task){
    if(!canReadTask(a,task,p))throw new AgentError(404,'CONTEXT_NOT_FOUND');
    // Logging time does not change the task, so only changes need the task to be as the model saw it.
    const old=context.sources.find(s=>s.kind==='task'&&s.id===task.id);
    if(!old||(action.type!=='log_time'&&new Date(task.updated_at).toISOString()!==old.data.updated_at))throw new AgentError(409,'SOURCE_CHANGED');
    // Complex dependency plans stay in the dedicated capacity/scenario flow.
    if(action.type==='plan_task'&&(task.start_after||task.finish_before||task.parent_id||task.status==='completed'||(await c.query('select 1 from tasks where parent_id=$1 or start_after=$1 or finish_before=$1 limit 1',[task.id])).rowCount))throw new AgentError(409,'TASK_REQUIRES_PLANNING');
   }
   if('assignedTo'in action&&action.assignedTo){
    const row=(await c.query("select u.id from users u join user_organizations m on m.user_id=u.id where u.id=$1 and m.organization_id=$2 and m.status='active' and u.status='active' and u.role in ('user','operator','viewer') for share of u,m",[action.assignedTo,a.organizationId])).rows[0];
    if(!row||(p.visibility!=='public'&&p.createdBy!==row.id&&p.assignedTo!==row.id))throw new AgentError(409,'ASSIGNEE_UNAVAILABLE');
   }
   if(action.type==='create_task'){
    if(!canPerform(a,'create'))throw new AgentError(403,'FORBIDDEN');
    await withinPlan(c,a,'override_max_tasks','maxTasks','select count(*)::int n from tasks t join projects p on p.id=t.project_id where p.organization_id=$1');
    resourceId=randomUUID();title=action.title;
    await c.query("insert into tasks(id,title,description,project_id,assigned_to,created_by,status,visibility,start_date,end_date,estimated_hours,created_at,updated_at) values($1,$2,$3,$4,$5,$6,'todo','private',$7::date,$8::date,$9,now(),now())",[resourceId,action.title,action.description,projectId,action.assignedTo,a.id,action.startDate,action.endDate,action.estimatedHours]);changedProjects.add(projectId!);
   }else if(action.type==='plan_task'){
    resourceId=task.id;title=task.title;
    await c.query("update tasks set assigned_to=$1,start_date=case when to_char(start_date,'YYYY-MM-DD') is not distinct from $2::text then start_date else $2::date end,end_date=case when to_char(end_date,'YYYY-MM-DD') is not distinct from $3::text then end_date else $3::date end,updated_at=now() where id=$4",[action.assignedTo,action.startDate,action.endDate,task.id]);changedProjects.add(projectId!);
   }else if(action.type==='set_task_status'){
    // Same rule as the task board: a task completes only after the task it starts after, and the tasks that must finish before it.
    if(action.status==='completed'&&(await c.query("select 1 from tasks where (id=$1 or finish_before=$2) and status is distinct from 'completed' limit 1",[task.start_after||null,task.id])).rowCount)throw new AgentError(409,'TASK_BLOCKED');
    resourceId=task.id;title=task.title;
    await c.query('update tasks set status=$1,updated_at=now() where id=$2',[action.status,task.id]);changedProjects.add(projectId!);
   }else if(action.type==='log_time'){
    // A finished entry for the person confirming, starting 09:00 local on that day; never in the future.
    const at=(await c.query("select (($1::date+time '09:00') at time zone $2) at time zone 'UTC' as start,$1::date>(now() at time zone $2)::date as future",[action.date,tz])).rows[0];
    if(at.future)throw new AgentError(409,'FUTURE_TIME');
    resourceId=randomUUID();title=task.title;
    await c.query("insert into time_entries(id,user_id,project_id,task_id,description,start_time,end_time,duration,status,billable,created_at,updated_at) values($1,$2,$3,$4,$5,$6::timestamp,$6::timestamp+make_interval(mins=>$7::int),$7::int,'completed',true,now(),now())",[resourceId,a.id,projectId,task.id,action.description||null,at.start,action.minutes]);
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
   href=action.type==='log_time'?'/dashboard/time-tracking':'/dashboard/project/view/'+encodeURIComponent(projectId!)+(action.type==='client_request'?'/pending':'');
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

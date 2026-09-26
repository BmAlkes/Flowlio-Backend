import type { Pool,PoolClient } from 'pg';
import { canManageClients,canViewProjectFinancials,type Actor } from '../../security/resource-policy';
import { createCapacity } from '../capacity/service';
import { createProfitability } from '../profitability/service';
import { createRetainers } from '../retainers/service';
import { createAttention } from '../attention/service';
import { authorize,capabilities,AgentError,type Context,type Scope } from './policy';

export const projectVisible="p.organization_id=$1 and (p.created_by=$2 or p.assigned_to=$2 or p.visibility='public')";
export const taskVisible="(t.created_by=$2 or t.assigned_to=$2 or t.visibility='public')";
export async function requireMember(c:Pick<PoolClient,'query'>,a:Actor){
 authorize(a);
 const r=await c.query("select u.role,u.is_organization_owner,u.is_organization_manager from users u join user_organizations m on m.user_id=u.id join organizations o on o.id=m.organization_id where u.id=$1 and m.organization_id=$2 and u.status='active' and m.status='active' and o.status='active' and o.subscription_status in ('active','trialing') and (o.subscription_end_date is null or o.subscription_end_date>now())",[a.id,a.organizationId]);
 const u=r.rows[0];if(!u||u.role!==a.role||Boolean(u.is_organization_owner)!==Boolean(a.isOrganizationOwner)||Boolean(u.is_organization_manager)!==Boolean(a.isOrganizationManager))throw new AgentError(403,'ACCESS_CHANGED');
}
export async function capture(pool:Pool,a:Actor,scope:Scope):Promise<Context>{
 authorize(a);const c=await pool.connect();const result:Context={sources:[],members:[],limits:['Records are a bounded recent sample, not organization-wide totals. Text fields may be shortened. Document metadata does not contain the document body.'],capabilities:capabilities(a),date:new Date().toISOString().slice(0,10)};
 const add=(kind:string,rows:any[],href:(r:any)=>string)=>{if(rows.length>=30)result.limits.push(`${kind}: limited to ${rows.length} records.`);for(const row of rows){
  const data=JSON.parse(JSON.stringify(row,(_key,v)=>typeof v==='string'&&v.length>1600?v.slice(0,1600)+' [truncated]':v));
  result.sources.push({key:kind+':'+row.id,kind,id:row.id,title:String(row.name??row.title??row.id).slice(0,200),href:href(row),data});
 }};
 const projectHref=(r:any)=>'/dashboard/project/view/'+encodeURIComponent(r.project_id??r.id);
 const manager=canManageClients(a),financial=canViewProjectFinancials(a),area=scope.area;
 try{
  await c.query('begin isolation level repeatable read read only');await c.query("set local statement_timeout='10s'");await requireMember(c,a);
  if(scope.clientId&&!manager)throw new AgentError(403,'FORBIDDEN');
  if(scope.clientId&&!(await c.query('select 1 from clients where id=$1 and organization_id=$2',[scope.clientId,a.organizationId])).rowCount)throw new AgentError(404,'CONTEXT_NOT_FOUND');
  const params=[a.organizationId,a.id,scope.projectId??null,scope.clientId??null];
  const projects=(await c.query(`select p.id,p.name,p.description,p.status,p.progress,p.client_id,p.assigned_to,p.visibility,p.created_by,to_char(p.start_date,'YYYY-MM-DD') start_date,to_char(p.end_date,'YYYY-MM-DD') end_date,p.updated_at from projects p where ${projectVisible} and ($3::text is null or p.id=$3) and ($4::text is null or p.client_id=$4) order by p.updated_at desc,p.id limit 30`,params)).rows;
  if(scope.projectId&&!projects.length)throw new AgentError(404,'CONTEXT_NOT_FOUND');
  add('project',projects,projectHref);const ids=projects.map(p=>p.id);
  result.members=(await c.query("select distinct u.id,u.name from users u join user_organizations m on m.user_id=u.id where m.organization_id=$1 and m.status='active' and u.status='active' and u.role in ('user','operator','viewer') order by u.name,u.id limit 100",[a.organizationId])).rows;
  if(['dashboard','projects','tasks','capacity','attention','time','scope','pending'].includes(area)||scope.projectId){
   add('task',(await c.query(`select t.id,t.title,t.description,t.project_id,t.assigned_to,t.created_by,t.visibility,t.status,t.estimated_hours,t.parent_id,t.start_after,t.finish_before,to_char(t.start_date,'YYYY-MM-DD') start_date,to_char(t.end_date,'YYYY-MM-DD') end_date,t.updated_at from tasks t join projects p on p.id=t.project_id where ${projectVisible} and ${taskVisible} and p.id=any($3::text[]) order by t.updated_at desc,t.id limit 60`,[a.organizationId,a.id,ids])).rows,projectHref);
   add('milestone',(await c.query('select id,project_id,title,status,due_date from project_milestones where organization_id=$1 and project_id=any($2::text[]) order by due_date,id limit 30',[a.organizationId,ids])).rows,r=>projectHref(r)+'#delivery-reviews');
  }
  if(manager&&(['clients','leads','proposals','financial'].includes(area)||scope.clientId)){
   add('client',(await c.query("select id,name,type,status,business_industry,follow_up_at,follow_up_note,last_interaction_at,updated_at from clients where organization_id=$1 and ($2::text is null or id=$2) and ($3::text <> 'leads' or type='lead') order by updated_at desc,id limit 30",[a.organizationId,scope.clientId??null,area])).rows,r=>r.type==='lead'?'/dashboard/leads':'/dashboard/client-management/'+encodeURIComponent(r.id));
   const clientIds=result.sources.filter(s=>s.kind==='client').map(s=>s.id);
   add('interaction',(await c.query('select id,client_id,type as title,content,created_at from client_interactions where organization_id=$1 and client_id=any($2::text[]) order by created_at desc,id limit 30',[a.organizationId,clientIds])).rows,r=>'/dashboard/client-management/'+encodeURIComponent(r.client_id));
  }
  if(manager&&['projects','scope','pending','dashboard','attention'].includes(area)){
   add('request',(await c.query('select r.id,r.project_id,r.client_id,r.title,r.description,r.questions,r.state,r.due_date,r.revision from client_requests r join projects p on p.id=r.project_id and p.client_id=r.client_id where r.organization_id=$1 and p.id=any($2::text[]) order by r.updated_at desc,r.id limit 30',[a.organizationId,ids])).rows,r=>projectHref(r)+'/pending');
   add('response',(await c.query('select x.id,r.title,r.project_id,x.message,x.answers,x.created_at from client_request_responses x join client_requests r on r.id=x.request_id join projects p on p.id=r.project_id and p.client_id=r.client_id where r.organization_id=$1 and p.id=any($2::text[]) order by x.created_at desc,x.id limit 30',[a.organizationId,ids])).rows,r=>projectHref(r)+'/pending');
   add('scope',(await c.query('select s.id,s.project_id,s.title,s.description,s.state,s.revision,s.source from scope_change_requests s join projects p on p.id=s.project_id and p.client_id=s.client_id where s.organization_id=$1 and p.id=any($2::text[]) order by s.updated_at desc,s.id limit 30',[a.organizationId,ids])).rows,r=>projectHref(r)+'/changes?changeId='+encodeURIComponent(r.id));
  }
  if(manager&&['proposals','scope','clients'].includes(area)){
   add('proposal',(await c.query('select id,project_title as title,client_id,status,proposal_data,updated_at from proposals where organization_id=$1 and ($2::text is null or client_id=$2) order by updated_at desc,id limit 20',[a.organizationId,scope.clientId??projects.find(p=>p.id===scope.projectId)?.client_id??null])).rows,()=>'/dashboard/proposals');
  }
  if(financial&&area==='financial'){
   add('invoice',(await c.query('select id,invoice_number as title,client_id,amount,status,due_date from invoices where organization_id=$1 and ($2::text is null or client_id=$2) order by created_at desc,id limit 30',[a.organizationId,scope.clientId??null])).rows,()=>'/dashboard/invoice');
  }else if(area==='financial')result.limits.push('Financial access is not available to this user.');
  if(area==='calendar')add('calendar',(await c.query("select id,title,description,date,start_hour,end_hour,calendar_type from calendar_events where organization_id=$1 and user_id=$2 and date>=current_date-interval '7 days' and date<current_date+interval '30 days' order by date,id limit 30",[a.organizationId,a.id])).rows,()=>'/dashboard/calender');
  if(area==='time')add('time',(await c.query(`select e.id,e.description as title,e.project_id,e.task_id,e.start_time,e.end_time,e.duration,e.status from time_entries e join projects p on p.id=e.project_id left join tasks t on t.id=e.task_id and t.project_id=p.id where ${projectVisible} and e.user_id=$2 and (e.task_id is null or ${taskVisible}) and ($3::text is null or p.id=$3) order by e.start_time desc,e.id limit 30`,[a.organizationId,a.id,scope.projectId??null])).rows,()=>'/dashboard/time-tracking');
  if(area==='documents')add('file',(await c.query(`select f.id,f.name,f.project_id,f.task_id,f.client_id,f.updated_at from files f left join tasks t on t.id=f.task_id left join projects p on p.id=coalesce(t.project_id,f.project_id) where f.organization_id=$1 and ($3::text is null or p.id=$3) and ($4::text is null or f.client_id=$4) and (case when f.task_id is not null then ${projectVisible} and ${taskVisible} and (f.project_id is null or f.project_id=p.id) when f.project_id is not null then ${projectVisible} when f.client_id is not null then ($5::boolean or f.uploaded_by=$2) else f.uploaded_by=$2 end) order by f.updated_at desc,f.id limit 30`,[...params,manager])).rows,()=>'/dashboard/media-center');
  if(manager&&area==='settings'){
   add('workflow',(await c.query('select id,name,trigger,project_status,action_type,channel,enabled from workflow_rules where organization_id=$1 and created_by=$2 order by created_at desc,id limit 30',[a.organizationId,a.id])).rows,()=>'/dashboard/settings/workflows');
  }
  await c.query('commit');
 }catch(e){await c.query('rollback');throw e;}finally{c.release();}
 if(manager&&area==='capacity'){
  const report=await createCapacity(pool).report(a,{week:result.date});
  result.sources.push({key:'capacity:'+result.date,id:result.date,kind:'capacity',title:'Team capacity',href:'/dashboard/team-capacity',data:report});
 }
 if(financial&&area==='financial'&&scope.projectId){
  const from=result.date.slice(0,7)+'-01';const report=await createProfitability(pool).report(a,scope.projectId,{from,to:result.date});
  result.sources.push({key:'margin:'+scope.projectId,id:scope.projectId,kind:'margin',title:'Project margin',href:'/dashboard/project/view/'+encodeURIComponent(scope.projectId)+'/profitability',data:report});
 }
 if(manager&&area==='clients'&&scope.clientId){
  const report=await createRetainers(pool).list(a,scope.clientId,{});
  for(const r of report.items){const latest=r.latest;result.sources.push({key:'retainer:'+r.id,id:r.id,kind:'retainer',title:r.name,href:'/dashboard/client-management/'+encodeURIComponent(scope.clientId)+'/contracts',data:{name:r.name,state:r.state,includedMinutes:r.included_minutes,latest:latest?{month:latest.month,state:latest.state,totals:latest.totals}:null,...(financial?{currency:r.currency,monthlyAmount:r.monthly_amount}:{})}});}
 }
 if(manager&&area==='attention'){
  const report=await createAttention(pool).list(a,{from:result.date.slice(0,7)+'-01',to:result.date,week:result.date});
  result.sources.push({key:'attention:'+result.date,id:result.date,kind:'attention',title:'Attention center',href:'/dashboard/attention',data:report});
 }
 if(['settings','support'].includes(area))result.limits.push('Only the listed workflow settings were loaded. No credentials or support conversations were loaded. Do not claim to inspect unavailable account configuration.');
 if(a.role==='viewer')for(const source of result.sources){if(source.kind==='project'||source.kind==='task'||source.kind==='milestone')source.href='/viewer/projects/'+encodeURIComponent(String(source.data.project_id??source.id));else if(source.kind==='calendar')source.href='/viewer/calendar';else if(source.kind==='time')source.href='/viewer/time-tracking';else source.href='/viewer';}
 else for(const source of result.sources)if(source.kind==='file')source.href='/dashboard/client-management/media-center';
 if(Buffer.byteLength(JSON.stringify(result),'utf8')>100_000)throw new AgentError(413,'CONTEXT_TOO_LARGE');
 return result;
}

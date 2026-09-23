import type { Pool, PoolClient } from "pg";
import { z } from "zod";
import { canManageClients, canViewProjectFinancials, type Actor } from "../../security/resource-policy";
import { calendarDate, weekBounds } from "../capacity/calculation";
import { setAuditContext } from "../audit/context";
export class AttentionError extends Error { constructor(public status: number, public code: string) { super(code); } }
export const preferencesInput = z.object({ approvalDays:z.number().int().min(0).max(365), proposalDays:z.number().int().min(1).max(365), unbilledMinutes:z.number().int().min(1).max(60000), budgetPercent:z.number().int().min(1).max(500) }).strict();
const periodInput = z.object({from:calendarDate,to:calendarDate,week:calendarDate}).strict().refine(v=>v.from<=v.to&&(Date.parse(v.to)-Date.parse(v.from))/86400000<=366);
const queryInput = z.object({from:calendarDate,to:calendarDate,week:calendarDate,page:z.coerce.number().int().min(1).max(10000).default(1),type:z.enum(['all','approval','unbilled','capacity','proposal','budget']).default('all'),state:z.enum(['active','snoozed','all']).default('active'),assigned:z.enum(['all','mine','unassigned']).default('all')}).strict().refine(v=>periodInput.safeParse({from:v.from,to:v.to,week:v.week}).success);
const triageInput = z.object({period:periodInput,key:z.string().min(1).max(300),revision:z.string().regex(/^[a-f0-9]{32}$/),assigneeId:z.string().min(1).max(128).nullable(),snoozedUntil:z.string().datetime().nullable()}).strict();
const defaults = {approvalDays:7,proposalDays:14,unbilledMinutes:60,budgetPercent:80};
function authorize(actor:Actor){if(!actor.organizationId||!canManageClients(actor))throw new AttentionError(403,'FORBIDDEN');}
async function prefs(client:PoolClient,organizationId:string){const row=(await client.query('select approval_days as "approvalDays",proposal_days as "proposalDays",unbilled_minutes as "unbilledMinutes",budget_percent as "budgetPercent" from attention_preferences where organization_id=$1',[organizationId])).rows[0];return row??defaults;}

// Same UTC date boundaries, per-entry cent rounding and task visibility as T19.
// Capacity uses the same inclusive calendar-day allocation as T21, aggregated in SQL.
const candidates = `with visible_projects as (
 select p.* from projects p where p.organization_id=$1 and (p.created_by=$2 or p.assigned_to=$2 or p.visibility='public')
), hours as (
 select p.id,count(*) filter(where t.end_time is null or t.status is distinct from 'completed' or t.duration is null or t.duration<0 or
   (t.task_id is not null and not coalesce(k.created_by=$2 or k.assigned_to=$2 or k.visibility='public',false)))::int as incomplete,
 coalesce(sum(case when t.end_time is not null and t.status='completed' and t.duration>=0 and (t.task_id is null or k.created_by=$2 or k.assigned_to=$2 or k.visibility='public') then t.duration else 0 end),0)::bigint as minutes,
 coalesce(sum(case when t.end_time is not null and t.status='completed' and t.duration>=0 and t.billable and (t.task_id is null or k.created_by=$2 or k.assigned_to=$2 or k.visibility='public') and not exists(select 1 from invoice_time_items i where i.time_entry_id=t.id) then t.duration else 0 end),0)::bigint as unbilled,
 coalesce(sum(case when t.end_time is not null and t.status='completed' and t.duration>=0 and s.hourly_cost>=0 and (t.task_id is null or k.created_by=$2 or k.assigned_to=$2 or k.visibility='public') then floor((t.duration*s.hourly_cost*100+30)/60) else 0 end),0)::numeric as labor
 from visible_projects p join time_entries t on t.project_id=p.id left join tasks k on k.id=t.task_id and k.project_id=t.project_id
 left join project_financial_settings s on s.project_id=p.id
 where $3::boolean and t.start_time >= $4::date and t.start_time < $5::date+interval '1 day' group by p.id
), costs as (
 select p.id,p.name,p.budget,s.currency,s.hourly_cost,coalesce(h.minutes,0) minutes,coalesce(h.incomplete,0) incomplete,
 coalesce(h.labor,0)+coalesce(e.expense,0)*100 as known_cents
 from visible_projects p left join project_financial_settings s on s.project_id=p.id left join hours h on h.id=p.id
 left join (select e.project_id,sum(e.amount) expense from project_expenses e join visible_projects p on p.id=e.project_id where $3::boolean and e.date >= $4::date and e.date < $5::date+interval '1 day' group by e.project_id) e on e.project_id=p.id
 where $3::boolean
), loads as (
 select m.user_id,u.name,c.weekly_minutes,
 coalesce(sum(case when t.estimated_hours>=0 and t.start_date is not null and t.end_date is not null and t.start_date::date<=t.end_date::date
 then round(t.estimated_hours::numeric*60*greatest(0,least(t.end_date::date,$7::date)-greatest(t.start_date::date,$6::date)+1)/(t.end_date::date-t.start_date::date+1)) else 0 end),0)::bigint planned,
 count(t.id) filter(where t.estimated_hours is null or t.start_date is null or t.end_date is null or t.start_date>t.end_date)::int incomplete
 from (select distinct user_id,organization_id,status from user_organizations) m join users u on u.id=m.user_id join member_capacity c on c.organization_id=m.organization_id and c.user_id=m.user_id
 left join (select t.* from tasks t join visible_projects p on p.id=t.project_id where t.status is distinct from 'completed' and (t.created_by=$2 or t.assigned_to=$2 or t.visibility='public')
 and (t.start_date is null or t.end_date is null or t.start_date>t.end_date or (t.start_date<$7::date+interval '1 day' and t.end_date>=$6::date))) t on t.assigned_to=u.id
 where m.organization_id=$1 and m.status='active' and u.status='active' and u.role in ('user','operator','viewer') and c.weekly_minutes is not null
 group by m.user_id,u.name,c.weekly_minutes
), sources as (
 select 'approval:'||r.id as key,'approval' as type,p.name as title,p.id as resource_id,r.requested_at as since,
 jsonb_build_object('days',floor(extract(epoch from(now()-r.requested_at))/86400),'threshold',$8::int,'reviewId',r.id,'state',r.state,'version',r.source_version) as details
 from delivery_reviews r join visible_projects p on p.id=r.project_id and p.organization_id=r.organization_id where r.state='pending' and r.client_id=p.client_id and exists(select 1 from project_milestones m where m.id=r.milestone_id and m.project_id=p.id and m.organization_id=$1 and m.updated_at<=r.requested_at and m.title=r.title and m.due_date is not distinct from r.due_date) and r.requested_at<=now()-$8::int*interval '1 day'
 union all select 'unbilled:'||p.id||':'||$4||':'||$5,'unbilled',p.name,p.id,$4::date::timestamptz,jsonb_build_object('minutes',h.unbilled,'threshold',$10::int,'incomplete',h.incomplete)
 from visible_projects p join hours h on h.id=p.id where $3::boolean and h.unbilled >= $10::int
 union all select 'capacity:'||l.user_id||':'||$6,'capacity',l.name,l.user_id,$6::date::timestamptz,jsonb_build_object('minutes',l.planned,'available',l.weekly_minutes,'incomplete',l.incomplete)
 from loads l where l.planned>l.weekly_minutes
 union all select 'proposal:'||p.id,'proposal',p.project_title,p.id,p.updated_at,jsonb_build_object('days',floor(extract(epoch from(now()-p.updated_at))/86400),'threshold',$9::int,'updatedAt',p.updated_at)
 from proposals p where p.organization_id=$1 and p.status='pending' and p.updated_at<=now()-$9::int*interval '1 day'
 union all select 'budget:'||p.id||':'||$4||':'||$5,'budget',p.name,p.id,$4::date::timestamptz,jsonb_build_object('cost',(p.known_cents/100)::text,'budget',p.budget::text,'currency',p.currency,'percent',round(p.known_cents/p.budget),'threshold',$11::int,'incomplete',p.incomplete+case when p.hourly_cost is null and p.minutes>0 then 1 else 0 end)
 from costs p where p.currency is not null and p.budget>0 and p.known_cents>=p.budget*$11::int
), versioned as (
 select s.*,md5((s.details-'days')::text) revision from sources s
), items as (
 select s.*,t.assignee_id,u.name as assignee_name,case when t.source_revision=s.revision and t.snoozed_until>now() then t.snoozed_until else null end snoozed_until
 from versioned s left join attention_triage t on t.organization_id=$1 and t.source_key=s.key left join users u on u.id=t.assignee_id and exists(select 1 from user_organizations m where m.user_id=u.id and m.organization_id=$1 and m.status='active')
)`;
type Period={from:string;to:string;week:string};
async function parameters(client:PoolClient,actor:Actor,period:Period){const settings=await prefs(client,actor.organizationId!);const week=weekBounds(period.week);return{settings,week,values:[actor.organizationId,actor.id,canViewProjectFinancials(actor),period.from,period.to,week.from,week.to,settings.approvalDays,settings.proposalDays,settings.unbilledMinutes,settings.budgetPercent]};}
export function createAttention(pool:Pool){
 async function list(actor:Actor,raw:unknown){authorize(actor);const parsed=queryInput.safeParse(raw);if(!parsed.success)throw new AttentionError(400,'INVALID_QUERY');const input=parsed.data,c=await pool.connect();try{
  await c.query('begin isolation level repeatable read read only');const p=await parameters(c,actor,input);
  const filter=` where ($12='all' or type=$12) and ($13='all' or ($13='snoozed' and snoozed_until>now()) or ($13='active' and (snoozed_until is null or snoozed_until<=now()))) and ($14='all' or ($14='mine' and assignee_id=$2) or ($14='unassigned' and assignee_id is null))`;
  const rows=(await c.query(candidates+`select * from items`+filter+` order by since,key limit 26 offset $15`,[...p.values,input.type,input.state,input.assigned,(input.page-1)*25])).rows;
  const gaps=(await c.query(candidates+`select (select count(*)::int from costs where currency is null or budget is null or budget<=0 or (hourly_cost is null and minutes>0) or incomplete>0) as "financialProjects",(select count(*)::int from user_organizations m join users u on u.id=m.user_id left join member_capacity c on c.organization_id=m.organization_id and c.user_id=m.user_id where m.organization_id=$1 and m.status='active' and u.status='active' and u.role in ('user','operator','viewer') and c.weekly_minutes is null) as "unknownCapacity"`,p.values)).rows[0];
  await c.query('commit');return{items:rows.slice(0,25),hasMore:rows.length>25,page:input.page,settings:p.settings,gaps,week:p.week,financial:canViewProjectFinancials(actor),timezone:'UTC'};
 }catch(error){await c.query('rollback');throw error;}finally{c.release();}}
 async function members(actor:Actor,search:unknown){authorize(actor);const parsed=z.string().max(80).default('').safeParse(search);if(!parsed.success)throw new AttentionError(400,'INVALID_QUERY');return(await pool.query(`select distinct u.id,u.name from users u join user_organizations m on m.user_id=u.id where m.organization_id=$1 and m.status='active' and u.status='active' and u.role in ('user','operator','viewer') and u.name ilike $2 order by u.name,u.id limit 30`,[actor.organizationId,'%'+parsed.data+'%'])).rows;}
 async function settings(actor:Actor,raw:unknown){authorize(actor);const parsed=preferencesInput.safeParse(raw);if(!parsed.success)throw new AttentionError(400,'INVALID_SETTINGS');const p=parsed.data,c=await pool.connect();try{await c.query('begin');await setAuditContext(c,{organizationId:actor.organizationId!,actorKind:'human',actorId:actor.id});await c.query(`insert into attention_preferences(organization_id,approval_days,proposal_days,unbilled_minutes,budget_percent,updated_by) values($1,$2,$3,$4,$5,$6) on conflict(organization_id) do update set approval_days=$2,proposal_days=$3,unbilled_minutes=$4,budget_percent=$5,updated_by=$6,updated_at=now()`,[actor.organizationId,p.approvalDays,p.proposalDays,p.unbilledMinutes,p.budgetPercent,actor.id]);await c.query('commit');return p;}catch(error){await c.query('rollback');throw error;}finally{c.release();}}
 async function triage(actor:Actor,raw:unknown){authorize(actor);const parsed=triageInput.safeParse(raw);if(!parsed.success)throw new AttentionError(400,'INVALID_TRIAGE');const input=parsed.data;
  if(input.snoozedUntil&&(Date.parse(input.snoozedUntil)<=Date.now()||Date.parse(input.snoozedUntil)>Date.now()+90*86400000))throw new AttentionError(400,'INVALID_SNOOZE');
  const c=await pool.connect();try{await c.query('begin');const p=await parameters(c,actor,input.period);const row=(await c.query(candidates+'select * from items where key=$12',[...p.values,input.key])).rows[0];if(!row)throw new AttentionError(404,'ITEM_NOT_FOUND');if(row.revision!==input.revision)throw new AttentionError(409,'SOURCE_CHANGED');
   if(input.assigneeId&&!(await c.query("select u.id from users u join user_organizations m on m.user_id=u.id where m.organization_id=$1 and u.id=$2 and m.status='active' and u.status='active' and u.role in ('user','operator','viewer') for share of u,m",[actor.organizationId,input.assigneeId])).rowCount)throw new AttentionError(400,'INVALID_ASSIGNEE');
   await c.query(`insert into attention_triage(organization_id,source_key,source_revision,assignee_id,snoozed_until,updated_by) values($1,$2,$3,$4,$5,$6) on conflict(organization_id,source_key) do update set source_revision=$3,assignee_id=$4,snoozed_until=$5,updated_by=$6,updated_at=now()`,[actor.organizationId,input.key,input.revision,input.assigneeId,input.snoozedUntil,actor.id]);await c.query('commit');return{saved:true};
  }catch(error){await c.query('rollback');throw error;}finally{c.release();}
 }
 return{list,members,settings,triage};
}

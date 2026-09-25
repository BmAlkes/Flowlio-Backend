import type { Pool } from "pg";
import { z } from "zod";
import { canManageClients, canViewProjectFinancials, type Actor } from "../../security/resource-policy";
import { calendarDate } from "../capacity/calculation";
export class AuditReadError extends Error { constructor(public status:number,public code:string){super(code);} }
const identifier=z.string().max(128);
export const auditQuery=z.object({from:calendarDate,to:calendarDate,actorId:identifier.optional(),person:z.string().trim().max(80).optional(),action:z.string().max(100).optional(),resourceType:z.enum(['project','delivery_review','organization_membership','organization_member','change_request','retainer']).optional(),resourceId:identifier.optional(),projectId:identifier.optional(),cursor:z.string().max(512).optional()}).strict().refine(p=>p.from<=p.to&&(Date.parse(p.to)-Date.parse(p.from))/86400000<=366);
const cursorSchema=z.object({time:z.string().datetime(),id:z.string().min(1).max(128)}).strict();
export function csvCell(value:unknown){let s=typeof value==='object'&&value!==null?JSON.stringify(value):String(value??'');if(/^[\s]*[=+@-]/.test(s))s="'"+s;return '"'+s.replace(/"/g,'""')+'"';}
const authorized=`with permitted as (
 select e.id,e.actor_kind,e.actor_id,e.action,e.resource_type,e.resource_id,e.project_id,e.operation_id,e.occurred_at,to_char(e.occurred_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as cursor_time,
 case when e.actor_kind='human' and exists(select 1 from user_organizations m where m.user_id=u.id and m.organization_id=$1 and m.status='active') then u.name else null end as actor_name,
 p.name as project_name,masked.changes
 from business_audit_events e
 left join projects p on p.id=e.project_id and p.organization_id=e.organization_id
 left join users u on u.id=e.actor_id
 cross join lateral (select coalesce(jsonb_object_agg(d.key,d.value),'{}'::jsonb) changes from jsonb_each(e.changes) d where
  (e.resource_type='retainer' and $3::boolean and d.key=any(array['state','included_minutes','currency','monthly_amount','month','period_id','minutes','source_entry_id','overage_amount','decision','reason']))
  or (e.resource_type='change_request' and (d.key=any(array['state','revision','end_date','task_id','billing_draft_id']) or ($3::boolean and d.key=any(array['amount','currency']))))
  or (e.resource_type='project' and (d.key=any(array['start_date','end_date','status','visibility','assigned_to']) or ($3::boolean and d.key='budget')))
  or (e.resource_type='delivery_review' and d.key=any(array['state','source_version','milestone_id','client_id']))
  or ($3::boolean and e.resource_type='organization_membership' and d.key=any(array['role','status','permissions']))
  or ($3::boolean and e.resource_type='organization_member' and d.key='userrole')) masked
 where e.organization_id=$1 and e.occurred_at >= $4::date and e.occurred_at < $5::date+interval '1 day'
 and ((e.resource_type in ('project','delivery_review','change_request') and p.id is not null and (p.created_by=$2 or p.assigned_to=$2 or p.visibility='public'))
  or ($3::boolean and e.resource_type in ('organization_membership','organization_member','retainer')))
 and masked.changes<>'{}'::jsonb
 and ($6::text is null or e.actor_id=$6) and ($7::text is null or e.action=$7) and ($8::text is null or e.resource_type=$8)
 and ($9::text is null or e.resource_id=$9) and ($10::text is null or e.project_id=$10)
)`;
export function createAuditRead(pool:Pool){
 async function read(actor:Actor,raw:unknown,exporting=false){
  if(!actor.organizationId||!canManageClients(actor))throw new AuditReadError(403,'FORBIDDEN');
  const parsed=auditQuery.safeParse(raw);if(!parsed.success)throw new AuditReadError(400,'INVALID_FILTERS');
  const input=parsed.data;let cursor:{time:string;id:string}|undefined;
  if(input.cursor&&!exporting){try{cursor=cursorSchema.parse(JSON.parse(Buffer.from(input.cursor,'base64url').toString('utf8')));}catch{throw new AuditReadError(400,'INVALID_CURSOR');}}
  const client=await pool.connect();try{
   await client.query('begin isolation level repeatable read read only');
   await client.query("set local time zone 'UTC'");
   await client.query("set local statement_timeout = '15s'");
   const rows=(await client.query(authorized+`select * from permitted where ($11::timestamptz is null or (occurred_at,id)<($11::timestamptz,$12::text)) and ($14::text is null or actor_name ilike $14 or actor_id=$15) order by occurred_at desc,id desc limit $13`,[actor.organizationId,actor.id,canViewProjectFinancials(actor),input.from,input.to,input.actorId||null,input.action||null,input.resourceType||null,input.resourceId||null,input.projectId||null,cursor?.time??null,cursor?.id??null,exporting?5001:51,input.person?'%'+input.person+'%':null,input.person??null])).rows;
   if(exporting&&rows.length>5000)throw new AuditReadError(400,'EXPORT_TOO_LARGE');
   await client.query('commit');
   if(exporting)return{csv:'\uFEFF'+[['time_utc','actor_kind','actor_id','actor_name','action','resource_type','resource_id','project_id','operation_id','changes'].map(csvCell).join(','),...rows.map(r=>[r.occurred_at.toISOString(),r.actor_kind,r.actor_id,r.actor_name,r.action,r.resource_type,r.resource_id,r.project_id,r.operation_id,r.changes].map(csvCell).join(','))].join('\r\n')};
   const events=rows.slice(0,50),last=events[events.length-1];return{events,nextCursor:rows.length>50&&last?Buffer.from(JSON.stringify({time:last.cursor_time,id:last.id})).toString('base64url'):null};
  }catch(error){await client.query('rollback');throw error;}finally{client.release();}
 }
 return{read};
}

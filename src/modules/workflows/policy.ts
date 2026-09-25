import type { PoolClient } from 'pg';
import { z } from 'zod';
import { milestoneVersion } from '../delivery/service';
export class WorkflowError extends Error { constructor(public status:number,public code:string){super(code);} }
export const triggers=['proposal_project','delivery_approved','delivery_changes_requested','milestone_completed','scope_approved','retainer_80','retainer_100','retainer_closed','retainer_overage_approved'] as const;
const identifier=z.string().min(1).max(128);
export const ruleInput=z.object({name:z.string().trim().min(1).max(100),trigger:z.enum(triggers),projectStatus:z.enum(['pending','ongoing','completed']).nullable(),
 title:z.string().trim().min(1).max(150),message:z.string().trim().min(1).max(1000),
 actionType:z.enum(['notify','create_task','assign_project','prepare_billing']).default('notify'),recipientId:identifier.optional(),
 channel:z.enum(['internal','email','push']).default('internal'),targetProjectId:identifier.nullable().default(null),
}).strict().superRefine((v,c)=>{
 if(v.actionType!=='notify'&&v.channel!=='internal')c.addIssue({code:'custom',message:'Invalid channel'});
 if(v.actionType!=='prepare_billing'&&!v.recipientId&&v.actionType!=='notify')c.addIssue({code:'custom',message:'Recipient required'});
 if(v.actionType==='prepare_billing'&&!['scope_approved','retainer_overage_approved'].includes(v.trigger))c.addIssue({code:'custom',message:'Approved commercial source required'});
 if(v.trigger.startsWith('retainer_')&&['create_task','assign_project'].includes(v.actionType)&&!v.targetProjectId)c.addIssue({code:'custom',message:'Project required'});
 if(!v.trigger.startsWith('retainer_')&&v.targetProjectId)c.addIssue({code:'custom',message:'Project comes from event'});
 if(v.trigger.startsWith('retainer_')&&v.projectStatus&&!v.targetProjectId)c.addIssue({code:'custom',message:'Project required for condition'});
});
export type Rule={id:string;organization_id:string;created_by:string;trigger:string;project_status:string|null;title:string;message:string;activated_at:Date;enabled:boolean;action_type:string;recipient_id:string;channel:string;target_project_id:string|null};
export type Event={id:string;resource_id:string|null;source_id:string;client_id:string|null;revision:number|null;status:string|null;visible:boolean;occurred_at:Date};
export async function member(c:PoolClient,organizationId:string,id:string){
 return(await c.query(`select u.id,u.name,u.email,u.role,u.notification_preferences,u.is_organization_owner,u.is_organization_manager from users u
 join user_organizations m on m.user_id=u.id join organizations o on o.id=m.organization_id
 where u.id=$1 and m.organization_id=$2 and m.status='active' and u.status='active' and u.role in ('user','operator','viewer')
 and o.status='active' and o.subscription_status in ('active','trialing') and (o.subscription_end_date is null or o.subscription_end_date>now())`,[id,organizationId])).rows[0];
}
export async function creatorActive(c:PoolClient,r:Rule){const u=await member(c,r.organization_id,r.created_by);return u?.role==='user'&&(u.is_organization_owner||u.is_organization_manager)?u:null;}
export async function events(c:PoolClient,r:Rule,simulation=false,eventId:string|null=null):Promise<Event[]>{
 return(await c.query(`with source as (
 select a.id,a.resource_id project_id,null::text client_id,case when a.type='delivery' then coalesce(a.metadata->>'reviewId',a.resource_id) else a.resource_id end source_id,null::integer revision,a.created_at at time zone 'UTC' occurred_at
 from recent_activities a where a.organization_id=$1 and a.resource='project' and
 (($3='proposal_project' and a.type='project' and a.action='create' and a.metadata->>'proposalId' is not null)
 or ($3 in ('delivery_approved','delivery_changes_requested') and a.type='delivery' and a.action=$3))
 union all select e.id,e.project_id,e.client_id,e.source_id,e.revision,e.occurred_at from workflow_events e where e.organization_id=$1 and e.trigger=$3
 ) select s.*,coalesce(s.project_id,$8) resource_id,p.status,
 case when s.project_id is null and $8::text is null then exists(select 1 from clients cl where cl.id=s.client_id and cl.organization_id=$1)
 else coalesce(p.created_by=$2 or p.assigned_to=$2 or p.visibility='public',false) and (s.client_id is null or p.client_id=s.client_id) end visible
 from source s left join projects p on p.id=coalesce(s.project_id,$8) and p.organization_id=$1
 where ($5::boolean or s.occurred_at>=$4::timestamptz) and ($7::text is null or s.id=$7)
 and ($5::boolean or $7::text is not null or not exists(select 1 from workflow_executions x where x.rule_id=$6 and x.event_id=s.id))
 order by s.occurred_at,s.id limit 100`,[r.organization_id,r.created_by,r.trigger,r.activated_at,simulation,r.id,eventId,r.target_project_id])).rows;
}
export async function quota(c:PoolClient,org:string){
 const row=(await c.query(`select o.override_max_tasks,coalesce(s.features,p.features) features from organizations o left join subscription_plans p on p.id=o.subscription_plan_id
 left join lateral(select sp.features from subscriptions sub join subscription_plans sp on sp.id=sub.plan_id where sub.organization_id=o.id order by sub.created_at desc,sub.id desc limit 1)s on true where o.id=$1`,[org])).rows[0];
 const limit=row?.override_max_tasks??row?.features?.maxTasks;if(limit==null||limit===0)return null;
 if(!Number.isInteger(limit)||limit<0)return 'plan_unavailable';
 const n=(await c.query('select count(*)::int n from tasks t join projects p on p.id=t.project_id where p.organization_id=$1',[org])).rows[0].n;
 return n>=limit?'plan_limit':null;
}
export async function sourceValid(c:PoolClient,r:Rule,e:Event){
 if(r.trigger.startsWith('delivery_')&&e.source_id!==e.resource_id){
  const d=(await c.query(`select d.source_version,m.* from delivery_reviews d join projects p on p.id=d.project_id and p.organization_id=d.organization_id join project_milestones m on m.id=d.milestone_id and m.project_id=d.project_id and m.organization_id=d.organization_id where d.id=$1 and d.project_id=$2 and d.organization_id=$3 and d.state=$4 and d.client_id=p.client_id`,[e.source_id,e.resource_id,r.organization_id,r.trigger.slice(9)])).rows[0];
  return !!d&&milestoneVersion(d)===d.source_version;
 }
 if(r.trigger==='milestone_completed')return !!(await c.query("select 1 from project_milestones where id=$1 and project_id=$2 and organization_id=$3 and status='completed'",[e.source_id,e.resource_id,r.organization_id])).rowCount;
 if(r.trigger==='scope_approved')return !!(await c.query(`select 1 from scope_change_requests s join scope_change_versions v on v.change_id=s.id and v.revision=s.revision
 where s.id=$1 and s.organization_id=$2 and s.project_id=$3 and s.client_id=$4 and s.revision=$5 and s.state in ('approved','applied') and v.decision='approved'`,[e.source_id,r.organization_id,e.resource_id,e.client_id,e.revision])).rowCount;
 if(r.trigger.startsWith('retainer_')){
  const p=(await c.query(`select p.*,r.state contract_state from retainer_periods p join retainers r on r.id=p.retainer_id where p.id=$1 and r.organization_id=$2 and r.client_id=$3`,[e.source_id,r.organization_id,e.client_id])).rows[0];
  if(!p)return false;
  if(r.trigger==='retainer_overage_approved')return p.state==='closed'&&p.decision==='approved';
  if(r.trigger==='retainer_closed')return p.state==='closed';
  if(p.state!=='open'||p.contract_state!=='active')return false;
  const used=Number((await c.query('select coalesce(sum(minutes),0) n from retainer_entries where period_id=$1',[p.id])).rows[0].n);
  const allowance=p.included_minutes+p.carry.reduce((n:number,l:{minutes:number})=>n+l.minutes,0);
  return allowance>0&&used*100>=allowance*Number(r.trigger.slice(9));
 }
 return true;
}
export async function plan(c:PoolClient,r:Rule,e:Event){
 if(!e.visible)return 'inaccessible';
 if(r.project_status&&e.status!==r.project_status)return 'condition_not_met';
 if(!await sourceValid(c,r,e))return 'source_changed';
 const owner=await creatorActive(c,r);if(!owner)return 'permission_revoked';
 if(r.action_type==='prepare_billing'){
  if(!owner.is_organization_owner)return 'financial_access_required';
  if(r.trigger==='scope_approved'){
   const v=(await c.query('select amount,classification from scope_change_versions where change_id=$1 and revision=$2',[e.source_id,e.revision])).rows[0];
   if(v?.classification!=='additional'||Number(v.amount)<=0)return 'no_charge';
  }else{const p=(await c.query('select statement from retainer_periods where id=$1',[e.source_id])).rows[0];if(!p?.statement?.billing?.id||Number(p.statement.billing.overageAmount)<=0)return 'no_charge';}
  return 'ready';
 }
 const recipient=await member(c,r.organization_id,r.recipient_id);
 if(!recipient)return 'recipient_unavailable';
 if(['create_task','assign_project'].includes(r.action_type)&&!['user','operator'].includes(recipient.role))return 'recipient_unavailable';
 if(r.action_type!=='assign_project'){
  if(e.resource_id){const p=(await c.query('select created_by,assigned_to,visibility from projects where id=$1 and organization_id=$2',[e.resource_id,r.organization_id])).rows[0];if(!p||!(p.visibility==='public'||p.created_by===recipient.id||p.assigned_to===recipient.id))return 'recipient_inaccessible';}
  else if(recipient.role!=='user'||!(recipient.is_organization_owner||recipient.is_organization_manager))return 'recipient_inaccessible';
 }
 if(r.action_type==='create_task')return(await quota(c,r.organization_id))??'ready';
 if(r.action_type==='notify'&&r.channel!=='internal'){
  const pref=recipient.notification_preferences;
  if(pref?.[r.channel==='email'?'emailNotifications':'pushNotifications']!==true||pref?.projectActivityUpdates===false)return 'preferences_disabled';
  if(r.channel==='email'&&(!process.env.BREVO_API_KEY||!process.env.BREVO_SENDER))return 'channel_unavailable';
  if(r.channel==='push'&&(!process.env.VAPID_PUBLIC_KEY||!process.env.VAPID_PRIVATE_KEY||!(await c.query('select 1 from push_subscriptions where user_id=$1 limit 1',[recipient.id])).rowCount))return 'channel_unavailable';
 }
 return 'ready';
}
export const retryable=new Set(['recipient_unavailable','recipient_inaccessible','plan_limit','plan_unavailable','preferences_disabled','channel_unavailable','financial_access_required']);

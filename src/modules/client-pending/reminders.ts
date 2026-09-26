import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { enqueue } from '../../services/jobs/queue';
import { blocked } from './policy';
export async function scheduleClientReminders(c:PoolClient,org:string){
 await c.query('select pg_advisory_xact_lock(hashtextextended($1,0))',['client-requests:'+org]);
 const rows=(await c.query(`select r.* from client_requests r where r.organization_id=$1 and r.state='open' and r.reminder_hours>0 and r.reminder_count<3 and r.reminder_next_at<=now()
  and not exists(select 1 from unnest(r.dependencies) dep where not exists(select 1 from client_requests d where d.id=dep and d.organization_id=r.organization_id and d.project_id=r.project_id and d.client_id=r.client_id and d.state='completed')) order by r.reminder_next_at,r.id limit 100 for update`,[org])).rows;
 for(const r of rows){
  const id=randomUUID(),sequence=r.reminder_count+1;
  const inserted=await c.query('insert into client_request_reminders(id,request_id,cycle,sequence) values($1,$2,$3,$4) on conflict(request_id,cycle,sequence) do nothing returning id',[id,r.id,r.cycle,sequence]);
  if(inserted.rowCount){const key='client-request-reminder:'+id;await enqueue(c,'client-request-reminder',key,{reminderId:id});const job=(await c.query('select id from durable_jobs where dedupe_key=$1',[key])).rows[0];await c.query('update client_request_reminders set job_id=$2 where id=$1',[id,job.id]);}
  await c.query('update client_requests set reminder_count=$2,reminder_next_at=case when $2>=3 then null else now()+make_interval(hours=>reminder_hours) end where id=$1',[r.id,sequence]);
 }
}
export type ReminderSender=(channel:string,recipient:{id:string;name:string;email:string},content:{title:string;message:string;url:string})=>Promise<boolean>;
export async function deliverClientReminder(c:PoolClient,id:string,send:ReminderSender){
 const entry=(await c.query('select * from client_request_reminders where id=$1',[id])).rows[0];if(!entry||entry.outcome!=='queued')return;
 const r=(await c.query('select * from client_requests where id=$1',[entry.request_id])).rows[0];if(!r)return;
 const cancel=async(reason:string)=>{await c.query('update client_request_reminders set outcome=$2 where id=$1',[id,reason]);};
 if(r.state!=='open'||r.cycle!==entry.cycle||await blocked(c,r)){await cancel('cancelled');return;}
 const recipient=(await c.query(`select u.id,u.name,u.email,u.notification_preferences from projects p join clients cl on cl.id=p.client_id and cl.organization_id=p.organization_id join users u on u.id=cl.user_id join organizations o on o.id=p.organization_id
 join users author on author.id=$4 join user_organizations membership on membership.user_id=author.id and membership.organization_id=p.organization_id
 where p.id=$1 and p.organization_id=$2 and p.client_id=$3 and cl.portal_access_enabled=true and u.role='client' and u.status='active'
 and author.status='active' and author.role='user' and (author.is_organization_owner=true or author.is_organization_manager=true) and membership.status='active'
 and (p.created_by=author.id or p.assigned_to=author.id or p.visibility='public') and o.status='active' and o.subscription_status in ('active','trialing') and (o.subscription_end_date is null or o.subscription_end_date>now()) limit 1`,[r.project_id,r.organization_id,r.client_id,r.created_by])).rows[0];
 if(!recipient){await cancel('permission_revoked');return;}
 const url='https://flowlioapp.com/clients/pending?requestId='+encodeURIComponent(r.id);
 const content={title:r.title,message:r.description+'\n'+r.due_date+' ('+r.timezone+')\n'+url,url};
 if(r.reminder_channel==='internal'){
  const inserted=await c.query(`insert into notifications(id,user_id,organization_id,type,title,message,data,read,created_at)
   select $1,$2,$3,'system',$4,$5,$6,false,now() from client_requests where id=$7 and state='open' and cycle=$8 on conflict(id) do nothing returning id`,[id,recipient.id,r.organization_id,r.title,content.message,JSON.stringify({projectId:r.project_id,clientRequestId:r.id,url}),r.id,r.cycle]);
  if(!inserted.rowCount)await cancel('cancelled');return;
 }
 const pref=recipient.notification_preferences;
 if(pref?.[r.reminder_channel==='email'?'emailNotifications':'pushNotifications']!==true||pref?.projectActivityUpdates===false){await cancel('preferences_disabled');return;}
 if(r.reminder_channel==='email'&&(!process.env.BREVO_API_KEY||!process.env.BREVO_SENDER)||r.reminder_channel==='push'&&(!process.env.VAPID_PUBLIC_KEY||!process.env.VAPID_PRIVATE_KEY||!(await c.query('select 1 from push_subscriptions where user_id=$1 limit 1',[recipient.id])).rowCount)){await cancel('channel_unavailable');return;}
 if(!await send(r.reminder_channel,recipient,content))throw new Error('Client reminder delivery unconfirmed');
}

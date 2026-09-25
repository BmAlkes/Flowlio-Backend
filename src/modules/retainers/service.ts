import { createHash, randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { z } from 'zod';
import { canManageClients, canReadProject, canReadTask, canViewProjectFinancials, type Actor } from '../../security/resource-policy';
import { creation, command, month, nextMonth, totals, transfer, cents, money, RetainerError } from './policy';
export { RetainerError } from './policy';
const hash=(v:unknown)=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
const paging=z.coerce.number().int().min(1).max(10000).default(1);
const query=z.object({page:paging,periodPage:paging,entryPage:paging,periodId:z.string().max(128).optional()}).strict();
const financial=(a:Actor)=>a.role==='client'||canViewProjectFinancials(a);
const requireWrite=(a:Actor)=>{if(!canViewProjectFinancials(a))throw new RetainerError(403,'FORBIDDEN');};
export function createRetainers(pool:Pool){
 async function client(c:PoolClient,a:Actor,id:string,lock=false){
  if(!a.organizationId||(a.role!=='client'&&!canManageClients(a)))throw new RetainerError(403,'FORBIDDEN');
  const row=(await c.query(`select id,name,user_id from clients where organization_id=$1 and ${id==='me'&&a.role==='client'?'user_id=$2':'id=$2'} ${lock?'for share':''}`,[a.organizationId,id==='me'&&a.role==='client'?a.id:id])).rows[0];
  if(!row||(a.role==='client'&&row.user_id!==a.id))throw new RetainerError(404,'CLIENT_NOT_FOUND');return row;
 }
 async function transaction<T>(a:Actor,clientId:string,work:(c:PoolClient,cl:any)=>Promise<T>,write=true){
  const c=await pool.connect();try{await c.query(write?'begin':'begin isolation level repeatable read read only');await c.query("set local time zone 'UTC'");await c.query("set local statement_timeout='15s'");
   if(write)await c.query('select pg_advisory_xact_lock(hashtextextended($1,0))',['time-invoice:'+a.organizationId]);
   const cl=await client(c,a,clientId,write);const result=await work(c,cl);await c.query('commit');return result;
  }catch(e){await c.query('rollback');throw e;}finally{c.release();}
 }
 async function audit(c:PoolClient,a:Actor,id:string,action:string,changes:Record<string,unknown>){
  await c.query(`insert into business_audit_events(id,organization_id,actor_kind,actor_id,action,resource_type,resource_id,operation_id,changes) values($1,$2,'human',$3,$4,'retainer',$5,$6,$7)`,[randomUUID(),a.organizationId,a.id,'retainer.'+action,id,randomUUID(),JSON.stringify(Object.fromEntries(Object.entries(changes).map(([k,v])=>[k,{before:null,after:v}])))]);
 }
 async function contract(c:PoolClient,a:Actor,cl:any,id:string,lock=false){const r=(await c.query(`select * from retainers where id=$1 and organization_id=$2 and client_id=$3 ${lock?'for update':''}`,[id,a.organizationId,cl.id])).rows[0];if(!r)throw new RetainerError(404,'NOT_FOUND');return r;}
 async function used(c:PoolClient,id:string){return(await c.query('select coalesce(sum(minutes),0)::bigint as minutes from retainer_entries where period_id=$1',[id])).rows[0].minutes*1;}
 async function openPeriod(c:PoolClient,r:any,key:string){
  if(r.state!=='active'||key<r.start_month||(r.end_month&&key>r.end_month))throw new RetainerError(409,'CONTRACT_INACTIVE');
  const last=(await c.query('select * from retainer_periods where retainer_id=$1 order by month desc limit 1',[r.id])).rows[0];
  if(last&&(last.state!=='closed'||key!==nextMonth(last.month)))throw new RetainerError(409,'CLOSE_PREVIOUS');
  if(!last&&key!==r.start_month)throw new RetainerError(409,'INVALID_PERIOD');
  const carry=last?.statement?.carryOut??[];
  const id=randomUUID();await c.query(`insert into retainer_periods(id,retainer_id,month,starts_at,ends_at,included_minutes,carry)
   values($1,$2,$3,($3||'-01')::timestamp at time zone $4,(($3||'-01')::date+interval '1 month') at time zone $4,$5,$6)`,[id,r.id,key,r.timezone,r.included_minutes,JSON.stringify(carry)]);return id;
 }
 async function create(a:Actor,clientId:string,raw:unknown){requireWrite(a);const parsed=creation.safeParse(raw);if(!parsed.success)throw new RetainerError(400,'INVALID_INPUT');const d=parsed.data;
  return transaction(a,clientId,async(c,cl)=>{
   const fingerprint=hash(d),prior=(await c.query('select * from retainers where id=$1',[d.id])).rows[0];if(prior){if(prior.organization_id!==a.organizationId||prior.client_id!==cl.id||prior.created_by!==a.id||prior.request_hash!==fingerprint)throw new RetainerError(409,'REQUEST_CONFLICT');return{id:prior.id};}
   if(!(await c.query('select 1 from pg_timezone_names where name=$1',[d.timezone])).rowCount)throw new RetainerError(400,'INVALID_INPUT');
   if(d.recurringId){const t=(await c.query('select * from recurring_invoices where id=$1 and organization_id=$2 and client_id=$3 for update',[d.recurringId,a.organizationId,cl.id])).rows[0];if(!t||t.frequency!=='monthly'||t.status!=='active'||cents(t.amount)!==cents(d.monthlyAmount))throw new RetainerError(409,'RECURRING_CHANGED');
    if((await c.query('select 1 from retainers where recurring_id=$1',[d.recurringId])).rowCount)throw new RetainerError(409,'RECURRING_ASSIGNED');}
   await c.query(`insert into retainers(id,organization_id,client_id,created_by,name,currency,monthly_amount,included_minutes,timezone,start_month,end_month,renewal,carry_policy,carry_cap,carry_months,overage_policy,overage_rate,recurring_id,request_hash)
    values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)`,[d.id,a.organizationId,cl.id,a.id,d.name,d.currency,d.monthlyAmount,d.includedMinutes,d.timezone,d.startMonth,d.endMonth,d.renewal,d.carryPolicy,d.carryCap,d.carryMonths,d.overagePolicy,d.overageRate,d.recurringId,fingerprint]);
   const r=await contract(c,a,cl,d.id);await openPeriod(c,r,d.startMonth);await audit(c,a,r.id,'created',{state:'active',included_minutes:d.includedMinutes,currency:d.currency,monthly_amount:d.monthlyAmount});return{id:r.id};
  });
 }
 function safeContract(a:Actor,r:any){const{request_hash,created_by,...out}=r;void request_hash;void created_by;if(!financial(a)){delete out.monthly_amount;delete out.currency;delete out.overage_rate;delete out.recurring_id;}return out;}
 function safePeriod(a:Actor,p:any){const out={...p};if(out.statement){out.statement={...out.statement};if(!financial(a)){delete out.statement.billing;delete out.statement.overageAmount;}}delete out.closed_by;delete out.decided_by;return out;}
 async function list(a:Actor,clientId:string,raw:unknown){const q=query.safeParse(raw);if(!q.success)throw new RetainerError(400,'INVALID_QUERY');return transaction(a,clientId,async(c,cl)=>{
  const rows=(await c.query('select * from retainers where organization_id=$1 and client_id=$2 order by created_at desc,id desc limit 11 offset $3',[a.organizationId,cl.id,(q.data.page-1)*10])).rows;
  const items=[];for(const r of rows.slice(0,10)){const p=(await c.query('select * from retainer_periods where retainer_id=$1 order by month desc limit 1',[r.id])).rows[0];items.push({...safeContract(a,r),latest:p?{...safePeriod(a,p),totals:totals(p.included_minutes,p.carry,await used(c,p.id))}:null});}
  const templates=canViewProjectFinancials(a)?(await c.query(`select id,template_name,amount,status from recurring_invoices t where organization_id=$1 and client_id=$2 and frequency='monthly' and status='active' and not exists(select 1 from retainers r where r.recurring_id=t.id) order by template_name limit 100`,[a.organizationId,cl.id])).rows:[];
  return{client:{id:cl.id,name:cl.name},items,hasMore:rows.length>10,canManage:canViewProjectFinancials(a),canDecide:a.role==='client',templates};
 },false);}
 async function detail(a:Actor,clientId:string,id:string,raw:unknown){const q=query.safeParse(raw);if(!q.success)throw new RetainerError(400,'INVALID_QUERY');return transaction(a,clientId,async(c,cl)=>{
  const r=await contract(c,a,cl,id),periods=(await c.query('select * from retainer_periods where retainer_id=$1 order by month desc limit 13 offset $2',[id,(q.data.periodPage-1)*12])).rows;
  const p=q.data.periodId?(await c.query('select * from retainer_periods where id=$1 and retainer_id=$2',[q.data.periodId,id])).rows[0]:periods[0];if(!p)throw new RetainerError(404,'NOT_FOUND');
  const entries=(await c.query('select id,time_entry_id,source_entry_id,minutes,kind,label,started_at,created_at from retainer_entries where period_id=$1 order by created_at,id limit 26 offset $2',[p.id,(q.data.entryPage-1)*25])).rows;
  return{contract:safeContract(a,r),periods:periods.slice(0,12).map(v=>({id:v.id,month:v.month,state:v.state})),hasMorePeriods:periods.length>12,period:{...safePeriod(a,p),totals:totals(p.included_minutes,p.carry,await used(c,p.id))},entries:entries.slice(0,25),hasMoreEntries:entries.length>25};
 },false);}
 async function eligible(c:PoolClient,a:Actor,cl:any,p:any,ids?:string[],page=1){
  const rows=(await c.query(`select t.id,t.duration,t.start_time::text,t.end_time::text,t.description,t.project_id,t.task_id,t.billable,t.hourly_rate,t.status,
   pr.name as project_name,pr.organization_id as "organizationId",pr.created_by as "createdBy",pr.assigned_to as "assignedTo",pr.visibility,pr.client_id as "clientId",
   tk.created_by as task_creator,tk.assigned_to as task_assignee,tk.visibility as task_visibility
   from time_entries t join projects pr on pr.id=t.project_id left join tasks tk on tk.id=t.task_id
   where pr.organization_id=$1 and pr.client_id=$2 and (t.client_id is null or t.client_id=$2) and t.status='completed' and t.billable=true and t.duration>0 and t.end_time is not null
   and t.start_time at time zone 'UTC'>=$3 and t.start_time at time zone 'UTC'<$4 and t.end_time at time zone 'UTC'<=$4
   and (pr.created_by=$5 or pr.assigned_to=$5 or pr.visibility='public') and (t.task_id is null or (tk.project_id=pr.id and (tk.created_by=$5 or tk.assigned_to=$5 or tk.visibility='public')))
   and not exists(select 1 from invoice_time_items i where i.time_entry_id=t.id) and not exists(select 1 from retainer_entries e where e.time_entry_id=t.id)
   and ($6::text[] is null or t.id=any($6)) order by t.id limit 101 offset $7 ${ids?'for update of t,pr':''}`,[a.organizationId,cl.id,p.starts_at,p.ends_at,a.id,ids??null,ids?0:(page-1)*100])).rows;
  return rows.filter(t=>canReadProject(a,{...t,id:t.project_id})&&(!t.task_id||canReadTask(a,{id:t.task_id,projectId:t.project_id,createdBy:t.task_creator,assignedTo:t.task_assignee,visibility:t.task_visibility},{...t,id:t.project_id}))).map(t=>({id:t.id,minutes:t.duration,project:t.project_name,startedAt:t.start_time.replace(' ','T')+'Z',endedAt:t.end_time.replace(' ','T')+'Z',version:hash(t)}));
 }
 async function candidates(a:Actor,clientId:string,id:string,periodId:string,raw:unknown){requireWrite(a);const q=z.object({page:paging}).strict().safeParse(raw);if(!q.success)throw new RetainerError(400,'INVALID_QUERY');return transaction(a,clientId,async(c,cl)=>{await contract(c,a,cl,id);const p=(await c.query('select * from retainer_periods where id=$1 and retainer_id=$2',[periodId,id])).rows[0];if(!p)throw new RetainerError(404,'NOT_FOUND');const rows=await eligible(c,a,cl,p,undefined,q.data.page);return{items:rows.slice(0,100),hasMore:rows.length>100};},false);}
 async function mutate(a:Actor,clientId:string,id:string,raw:unknown){const parsed=command.safeParse(raw);if(!parsed.success)throw new RetainerError(400,'INVALID_INPUT');const d=parsed.data;if(d.action!=='decide')requireWrite(a);else if(a.role!=='client')throw new RetainerError(403,'CLIENT_ONLY');
  return transaction(a,clientId,async(c,cl)=>{
   const r=await contract(c,a,cl,id,true),fingerprint=hash(d);const prior=(await c.query('select * from retainer_commands where id=$1',[d.key])).rows[0];if(prior){if(prior.retainer_id!==id||prior.actor_id!==a.id||prior.fingerprint!==fingerprint)throw new RetainerError(409,'REQUEST_CONFLICT');return{replayed:true};}
   if(d.action==='state'){
    if(r.revision!==d.revision)throw new RetainerError(409,'VERSION_CHANGED');if(r.state==='cancelled'||r.state===d.state)throw new RetainerError(409,'CONTRACT_INACTIVE');
    // Pausing consumption also stops the linked monthly billing; resuming that schedule remains an explicit billing action.
    if(r.recurring_id&&d.state!=='active')await c.query("update recurring_invoices set status='paused',updated_at=now() where id=$1",[r.recurring_id]);
    await c.query('update retainers set state=$2,revision=revision+1 where id=$1',[id,d.state]);await audit(c,a,id,'state',{state:d.state,reason:d.reason});
   }else if(d.action==='open'){month.parse(d.month);await openPeriod(c,r,d.month);await audit(c,a,id,'opened',{month:d.month});}
   else{
    const p=(await c.query('select * from retainer_periods where id=$1 and retainer_id=$2 for update',[d.periodId,id])).rows[0];if(!p)throw new RetainerError(404,'NOT_FOUND');if(p.revision!==d.revision)throw new RetainerError(409,'VERSION_CHANGED');
    if(d.action==='decide'){
     if(p.state!=='closed'||p.decision!=='awaiting')throw new RetainerError(409,'INVALID_STATE');await c.query('update retainer_periods set decision=$2,decided_by=$3,decided_at=now(),decision_note=$4,revision=revision+1 where id=$1',[p.id,d.decision,a.id,d.note]);await audit(c,a,id,'decided',{period_id:p.id,decision:d.decision});
    }else{
     if(p.state!=='open')throw new RetainerError(409,'PERIOD_CLOSED');
     if(['allocate','adjust'].includes(d.action)&&r.state!=='active')throw new RetainerError(409,'CONTRACT_INACTIVE');
     if(d.action==='allocate'){
      if(new Set(d.entries.map(e=>e.id)).size!==d.entries.length)throw new RetainerError(400,'INVALID_INPUT');const rows=await eligible(c,a,cl,p,d.entries.map(e=>e.id));if(rows.length!==d.entries.length||rows.some(t=>d.entries.find(e=>e.id===t.id)?.version!==t.version))throw new RetainerError(409,'TIME_CHANGED');
      for(const t of rows)await c.query(`insert into retainer_entries(id,period_id,time_entry_id,minutes,kind,label,started_at,created_by) values($1,$2,$3,$4,'time',$5,$6,$7)`,[randomUUID(),p.id,t.id,t.minutes,t.project,t.startedAt,a.id]);
      await audit(c,a,id,'allocated',{period_id:p.id,minutes:rows.reduce((n,t)=>n+t.minutes,0)});
     }else if(d.action==='remove'){
      const deleted=await c.query("delete from retainer_entries where id=$1 and period_id=$2 and kind='time' returning minutes",[d.entryId,p.id]);if(!deleted.rowCount)throw new RetainerError(409,'TIME_CHANGED');if(await used(c,p.id)<0)throw new RetainerError(409,'INVALID_ADJUSTMENT');await audit(c,a,id,'removed',{period_id:p.id,minutes:deleted.rows[0].minutes});
     }else if(d.action==='adjust'){
      const source=(await c.query(`select e.* from retainer_entries e join retainer_periods p on p.id=e.period_id where e.id=$1 and p.retainer_id=$2 and p.state='closed' and p.month<$3 and e.kind='time'`,[d.sourceEntryId,id,p.month])).rows[0];if(!source)throw new RetainerError(409,'INVALID_ADJUSTMENT');
      const priorMinutes=(await c.query('select coalesce(sum(minutes),0)::int n from retainer_entries where source_entry_id=$1',[source.id])).rows[0].n;
      if(source.minutes+priorMinutes+d.minutes<0||await used(c,p.id)+d.minutes<0)throw new RetainerError(409,'INVALID_ADJUSTMENT');
      await c.query(`insert into retainer_entries(id,period_id,source_entry_id,minutes,kind,label,created_by) values($1,$2,$3,$4,'adjustment',$5,$6)`,[randomUUID(),p.id,source.id,d.minutes,d.reason,a.id]);await audit(c,a,id,'adjusted',{period_id:p.id,source_entry_id:source.id,minutes:d.minutes});
     }else if(d.action==='close'){
      if(new Date(p.ends_at).getTime()>Date.now())throw new RetainerError(409,'PERIOD_NOT_ENDED');
      const active=await c.query(`select 1 from time_entries t join projects pr on pr.id=t.project_id where pr.organization_id=$1 and pr.client_id=$2 and t.status='active' and t.start_time at time zone 'UTC'<$3 limit 1`,[a.organizationId,cl.id,p.ends_at]);if(active.rowCount)throw new RetainerError(409,'ACTIVE_TIMER');
      if(r.recurring_id){const template=(await c.query('select * from recurring_invoices where id=$1 for share',[r.recurring_id])).rows[0];if(!template||template.organization_id!==a.organizationId||template.client_id!==cl.id||template.frequency!=='monthly'||cents(template.amount)!==cents(r.monthly_amount))throw new RetainerError(409,'RECURRING_CHANGED');}
      const consumption=await used(c,p.id),summary=totals(p.included_minutes,p.carry,consumption),carryOut=transfer(r,p,consumption);
      const extra=r.overage_policy==='approval'?(BigInt(summary.overage)*cents(r.overage_rate)+BigInt(30))/BigInt(60):BigInt(0);if(extra>BigInt(9999999999))throw new RetainerError(400,'AMOUNT_TOO_LARGE');
      const statement={...summary,carryOut,overageAmount:money(extra),billing:{id:randomUUID(),currency:r.currency,monthlyAmount:r.recurring_id?'0.00':r.monthly_amount,overageAmount:money(extra),recurringId:r.recurring_id,kind:'commercial_draft'}};
      await c.query("update retainer_periods set state='closed',statement=$2,decision=$3,closed_at=now(),closed_by=$4 where id=$1",[p.id,JSON.stringify(statement),extra>BigInt(0)?'awaiting':'not_required',a.id]);await audit(c,a,id,'closed',{period_id:p.id,minutes:consumption,overage_amount:money(extra),currency:r.currency});
      if(r.renewal==='automatic'&&r.state==='active'&&(!r.end_month||nextMonth(p.month)<=r.end_month))await openPeriod(c,r,nextMonth(p.month));
     }
     await c.query('update retainer_periods set revision=revision+1 where id=$1',[p.id]);
    }
   }
   await c.query('insert into retainer_commands(id,retainer_id,actor_id,fingerprint) values($1,$2,$3,$4)',[d.key,id,a.id,fingerprint]);return{replayed:false};
  });
 }
 return{create,list,detail,candidates,mutate};
}

import { createHash, randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { z } from 'zod';
import { canViewProjectFinancials, type Actor } from '../../security/resource-policy';
import { RetainerError } from './policy';

const sources = `with sources as (
 select 'scope:'||s.id key,s.title,cl.name client_name,cl.id client_id,s.project_id,v.amount,v.currency,
 s.revision::text version,s.created_at
 from scope_change_requests s join scope_change_versions v on v.change_id=s.id and v.revision=s.revision
 join projects pr on pr.id=s.project_id and pr.organization_id=s.organization_id and pr.client_id=s.client_id
 join clients cl on cl.id=s.client_id and cl.organization_id=s.organization_id
 where s.organization_id=$1 and s.state in ('approved','applied') and v.decision='approved' and v.classification='additional' and v.amount>0
 and (pr.created_by=$2 or pr.assigned_to=$2 or pr.visibility='public')
 union all
 select 'monthly:'||p.id,r.name||' · '||p.month,cl.name,cl.id,null::text,r.monthly_amount,r.currency,p.revision::text,p.closed_at
 from retainer_periods p join retainers r on r.id=p.retainer_id join clients cl on cl.id=r.client_id and cl.organization_id=r.organization_id
 where r.organization_id=$1 and p.state='closed' and r.recurring_id is null and r.monthly_amount>0
 union all
 select 'overage:'||p.id,r.name||' · '||p.month,cl.name,cl.id,null::text,(p.statement->>'overageAmount')::numeric,r.currency,p.revision::text,p.closed_at
 from retainer_periods p join retainers r on r.id=p.retainer_id join clients cl on cl.id=r.client_id and cl.organization_id=r.organization_id
 where r.organization_id=$1 and p.state='closed' and p.decision='approved' and (p.statement->>'overageAmount')::numeric>0
 ) select s.* from sources s where not exists(select 1 from invoices i where i.organization_id=$1 and i.commercial_source=s.key)`;
const fingerprint=(row:unknown)=>createHash('sha256').update(JSON.stringify(row)).digest('hex');
export function createBillingSources(pool:Pool, quota:(org:string)=>Promise<{hasAccess:boolean}>) {
 const requireActor=(a:Actor)=>{if(!a.organizationId||!canViewProjectFinancials(a))throw new RetainerError(403,'FORBIDDEN');};
 async function read(c:PoolClient,a:Actor,key?:string,page=1) {
  return (await c.query(sources+(key?' and s.key=$3':' order by s.created_at,s.key limit 21 offset $3'),[a.organizationId,a.id,key??(page-1)*20])).rows;
 }
 async function list(a:Actor,raw:unknown) {
  requireActor(a);const {page}=z.object({page:z.coerce.number().int().min(1).max(10000).default(1)}).parse(raw);
  const c=await pool.connect();try{const rows=await read(c,a,undefined,page);return{items:rows.slice(0,20).map(r=>({...r,version:fingerprint(r)})),hasMore:rows.length>20};}finally{c.release();}
 }
 async function prepare(a:Actor,raw:unknown) {
  requireActor(a);const d=z.object({key:z.string().max(180),version:z.string().length(64)}).strict().parse(raw);
  const c=await pool.connect();try{
   await c.query('begin');await c.query('select pg_advisory_xact_lock(hashtextextended($1,0))',['time-invoice:'+a.organizationId]);
   // Lock the original approval before reading its current amount and client.
   const [kind,id]=d.key.split(':');
   if(kind==='scope'){
    const source=(await c.query('select project_id from scope_change_requests where id=$1 and organization_id=$2',[id,a.organizationId])).rows[0];
    if(!source)throw new RetainerError(404,'NOT_FOUND');
    await c.query('select id from projects where id=$1 for update',[source.project_id]);
    await c.query('select id from scope_change_requests where id=$1 for update',[id]);
   }else if(kind==='monthly'||kind==='overage'){
    await c.query('select p.id from retainer_periods p join retainers r on r.id=p.retainer_id where p.id=$1 and r.organization_id=$2 for update of p',[id,a.organizationId]);
   }else throw new RetainerError(400,'INVALID_INPUT');
   const existing=(await c.query('select id from invoices where organization_id=$1 and commercial_source=$2',[a.organizationId,d.key])).rows[0];
   if(existing){await c.query('commit');return existing;}
   const row=(await read(c,a,d.key))[0];if(!row||fingerprint(row)!==d.version)throw new RetainerError(409,'VERSION_CHANGED');
   if(!(await quota(a.organizationId!)).hasAccess)throw new RetainerError(403,'PLAN_LIMIT');
   const invoice=(await c.query(`insert into invoices(id,organization_id,client_id,created_by,client_name,invoice_number,amount,currency_code,status,description,commercial_source,project_id,created_at,updated_at)
    values($1,$2,$3,$4,$5,'S1-',$6,$7,'draft',$8,$9,$10,now(),now()) returning id`,[randomUUID(),a.organizationId,row.client_id,a.id,row.client_name,row.amount,row.currency,row.title,row.key,row.project_id])).rows[0];
   await c.query(`insert into business_audit_events(id,organization_id,actor_kind,actor_id,action,resource_type,resource_id,operation_id,changes)
    values($1,$2,'human',$3,'invoice.prepared','invoice',$4,$5,$6)`,[randomUUID(),a.organizationId,a.id,invoice.id,randomUUID(),JSON.stringify({source:{before:null,after:d.key}})]);
   await c.query('commit');return invoice;
  }catch(e){await c.query('rollback');throw e;}finally{c.release();}
 }
 return{list,prepare};
}

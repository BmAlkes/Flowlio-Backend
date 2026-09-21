import type { Pool, PoolClient } from "pg";
import { z } from "zod";
import { canReadProject, canViewProjectFinancials, type Actor } from "../../security/resource-policy";
const calendarDate=z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value=>{
 const date=new Date(value+"T00:00:00Z");return Number.isFinite(date.getTime())&&date.toISOString().slice(0,10)===value;
});
export const reportPeriod=z.object({from:calendarDate,to:calendarDate}).strict().refine(({from,to})=>from<=to&&(Date.parse(to)-Date.parse(from))/86400000<=366);
export const financialSettings=z.object({
 currency:z.string().regex(/^[A-Z]{3}$/).refine(value=>(Intl as typeof Intl & {supportedValuesOf(key:string):string[]}).supportedValuesOf("currency").includes(value)),
 hourlyCost:z.string().regex(/^\d{1,8}(\.\d{1,2})?$/).nullable(),confirmCurrency:z.literal(true),
}).strict();
export class ProfitabilityError extends Error {constructor(public status:number,public code:string){super(code);}}
export function toCents(value:string):bigint {
 if(!/^-?\d+(\.\d{1,2})?$/.test(value))throw new ProfitabilityError(422,"INVALID_FINANCIAL_DATA");
 const sign=value.startsWith("-")?-BigInt(1):BigInt(1);const [whole,fraction=""]=value.replace("-","").split(".");
 return sign*(BigInt(whole)*BigInt(100)+BigInt(fraction.padEnd(2,"0")));
}
export function fromCents(value:bigint){const sign=value<BigInt(0)?"-":"";const abs=value<BigInt(0)?-value:value;return sign+(abs/BigInt(100)).toString()+"."+(abs%BigInt(100)).toString().padStart(2,"0");}
export function timeValue(minutes:number,rate:string){if(!Number.isSafeInteger(minutes)||minutes<0||toCents(rate)<BigInt(0))throw new ProfitabilityError(422,"INVALID_FINANCIAL_DATA");return(BigInt(minutes)*toCents(rate)+BigInt(30))/BigInt(60);}
export function createProfitability(pool:Pool){
 async function project(client:PoolClient,actor:Actor,id:string){
  if(!actor.organizationId||!canViewProjectFinancials(actor))throw new ProfitabilityError(403,"FORBIDDEN");
  const p=(await client.query('select id,name,organization_id as "organizationId",created_by as "createdBy",assigned_to as "assignedTo",visibility from projects where id=$1 and organization_id=$2',[id,actor.organizationId])).rows[0];
  if(!p||!canReadProject(actor,p))throw new ProfitabilityError(404,"PROJECT_NOT_FOUND");return p;
 }
 async function save(actor:Actor,id:string,raw:unknown){
  const parsed=financialSettings.safeParse(raw);if(!parsed.success)throw new ProfitabilityError(400,"INVALID_SETTINGS");
  const client=await pool.connect();try{
   await client.query('begin');await project(client,actor,id);const data=parsed.data;
   await client.query('insert into project_financial_settings(project_id,currency,hourly_cost,updated_by) values($1,$2,$3,$4) on conflict(project_id) do update set currency=excluded.currency,hourly_cost=excluded.hourly_cost,updated_by=excluded.updated_by,updated_at=now()',[id,data.currency,data.hourlyCost,actor.id]);
   await client.query('commit');return{currency:data.currency,hourlyCost:data.hourlyCost};
  }catch(error){await client.query('rollback');throw error;}finally{client.release();}
 }
 async function report(actor:Actor,id:string,raw:unknown){
  const parsed=reportPeriod.safeParse(raw);if(!parsed.success)throw new ProfitabilityError(400,"INVALID_PERIOD");
  const client=await pool.connect();try{
   await client.query('begin isolation level repeatable read read only');const p=await project(client,actor,id);const{from,to}=parsed.data;
   const settings=(await client.query('select currency,hourly_cost as "hourlyCost" from project_financial_settings where project_id=$1',[id])).rows[0]??null;
   if(!settings){await client.query('commit');return{projectName:p.name,settings:null};}
   const revenues=(await client.query('select currency,sum(amount)::text amount,count(*)::int count from revenue_entries where project_id=$1 and organization_id=$2 and date >= $3 and date <= $4 group by currency',[id,actor.organizationId,from,to])).rows;
   const expenses=(await client.query("select coalesce(sum(amount),0)::text amount from project_expenses where project_id=$1 and date >= $2::date and date < $3::date + interval '1 day'",[id,from,to])).rows[0];
   const entries=(await client.query(`select t.duration,t.hourly_rate,t.billable,t.end_time,t.status,
    (t.task_id is null or k.created_by=$4 or k.assigned_to=$4 or k.visibility='public') as visible,
    exists(select 1 from invoice_time_items i where i.time_entry_id=t.id) as billed
    from time_entries t left join tasks k on k.id=t.task_id and k.project_id=t.project_id
    where t.project_id=$1 and t.start_time >= $2::date and t.start_time < $3::date + interval '1 day' limit 10001`,[id,from,to,actor.id])).rows;
   if(entries.length>10000)throw new ProfitabilityError(400,"PERIOD_TOO_LARGE");
   let minutes=0,unbilledMinutes=0,unpricedMinutes=0,incompleteEntries=0,hiddenEntries=0,labor=BigInt(0),unbilled=BigInt(0);
   for(const entry of entries){
    if(!entry.visible){hiddenEntries++;continue;}
    if(!entry.end_time||entry.status!=='completed'||!Number.isSafeInteger(entry.duration)||entry.duration<0){incompleteEntries++;continue;}
    minutes+=entry.duration;if(settings.hourlyCost!=null)labor+=timeValue(entry.duration,settings.hourlyCost);
    if(entry.billable&&!entry.billed){unbilledMinutes+=entry.duration;if(entry.hourly_rate==null)unpricedMinutes+=entry.duration;else unbilled+=timeValue(entry.duration,entry.hourly_rate);}
   }
   const revenue=toCents(revenues.find(row=>row.currency===settings.currency)?.amount??'0');const expense=toCents(expenses.amount);
   const otherCurrencies=revenues.filter(row=>row.currency!==settings.currency).map(row=>({currency:row.currency,amount:row.amount}));
   const complete=!hiddenEntries&&!incompleteEntries&&!otherCurrencies.length&&(minutes===0||settings.hourlyCost!=null);
   await client.query('commit');return{projectName:p.name,settings,from,to,timezone:'UTC',revenue:fromCents(revenue),expenses:fromCents(expense),laborCost:settings.hourlyCost==null&&minutes>0?null:fromCents(labor),estimatedProfit:complete?fromCents(revenue-expense-labor):null,minutes,unbilledMinutes,unpricedMinutes,unbilledValue:fromCents(unbilled),incompleteEntries,hiddenEntries,otherCurrencies,complete};
  }catch(error){await client.query('rollback');throw error;}finally{client.release();}
 }
 return{report,save};
}

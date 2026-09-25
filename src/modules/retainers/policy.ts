import { z } from 'zod';
import { financialSettings } from '../profitability/service';
export class RetainerError extends Error { constructor(public status:number,public code:string){super(code);} }
export const month=z.string().regex(/^20\d{2}-(0[1-9]|1[0-2])$/);
const amount=z.string().regex(/^\d{1,8}(\.\d{1,2})?$/), id=z.string().min(1).max(128);
export const creation=z.object({id:z.string().uuid(),name:z.string().trim().min(1).max(160),currency:financialSettings.shape.currency,monthlyAmount:amount,
 includedMinutes:z.number().int().min(1).max(1000000),timezone:z.string().max(80).refine(s=>{try{new Intl.DateTimeFormat('en',{timeZone:s});return true;}catch{return false;}}),startMonth:month,endMonth:month.nullable(),renewal:z.enum(['manual','automatic']),
 carryPolicy:z.enum(['expire','carry']),carryCap:z.number().int().min(0).max(1000000),carryMonths:z.number().int().min(0).max(12),overagePolicy:z.enum(['waive','approval']),overageRate:amount,recurringId:id.nullable(),confirm:z.literal(true)
}).strict().refine(v=>(!v.endMonth||v.endMonth>=v.startMonth)&&(v.carryPolicy==='carry'?v.carryCap>0&&v.carryMonths>0:v.carryCap===0&&v.carryMonths===0)&&(v.overagePolicy==='approval'?Number(v.overageRate)>0:Number(v.overageRate)===0));
const common={key:z.string().uuid()};const period={...common,periodId:id,revision:z.number().int().min(0)};
export const command=z.discriminatedUnion('action',[
 z.object({...common,action:z.literal('state'),state:z.enum(['active','paused','cancelled']),revision:z.number().int().min(0),reason:z.string().trim().min(1).max(1000)}).strict(),
 z.object({...common,action:z.literal('open'),month}).strict(),
 z.object({...period,action:z.literal('allocate'),entries:z.array(z.object({id,version:z.string().length(64)}).strict()).min(1).max(100)}).strict(),
 z.object({...period,action:z.literal('remove'),entryId:id}).strict(),
 z.object({...period,action:z.literal('adjust'),sourceEntryId:id,minutes:z.number().int().min(-1000000).max(1000000).refine(n=>n!==0),reason:z.string().trim().min(1).max(1000)}).strict(),
 z.object({...period,action:z.literal('close'),confirm:z.literal(true)}).strict(),
 z.object({...period,action:z.literal('decide'),decision:z.enum(['approved','rejected']),note:z.string().trim().min(1).max(1000),confirm:z.literal(true)}).strict(),
]);
export type Carry={source:string;minutes:number;expires:string};
export function nextMonth(value:string,step=1){const d=new Date(value+'-01T12:00:00Z');d.setUTCMonth(d.getUTCMonth()+step);return d.toISOString().slice(0,7);}
export function cents(value:string){const[a,b='']=value.split('.');return BigInt(a)*BigInt(100)+BigInt(b.padEnd(2,'0'));}
export function money(value:bigint){return `${value/BigInt(100)}.${String(value%BigInt(100)).padStart(2,'0')}`;}
export function totals(included:number,carry:Carry[],used:number){const carried=carry.reduce((n,l)=>n+l.minutes,0);return{included,carried,used,remaining:Math.max(0,included+carried-used),overage:Math.max(0,used-included-carried)};}
// Consume oldest carried minutes first; new allowance expires independently.
export function transfer(contract:{carry_policy:string;carry_cap:number;carry_months:number},period:{id:string;month:string;included_minutes:number;carry:Carry[]},used:number):Carry[]{
 if(contract.carry_policy==='expire')return[];
 let left=used;const surviving:Carry[]=[];
 for(const lot of [...period.carry].sort((a,b)=>a.expires.localeCompare(b.expires)||a.source.localeCompare(b.source))){const consumed=Math.min(left,lot.minutes);left-=consumed;if(lot.minutes>consumed&&lot.expires>nextMonth(period.month))surviving.push({...lot,minutes:lot.minutes-consumed});}
 const unused=Math.max(0,period.included_minutes-left);if(unused)surviving.push({source:period.id,minutes:unused,expires:nextMonth(period.month,contract.carry_months+1)});
 let capacity=contract.carry_cap;return surviving.map(lot=>{const minutes=Math.min(capacity,lot.minutes);capacity-=minutes;return{...lot,minutes};}).filter(lot=>lot.minutes>0);
}

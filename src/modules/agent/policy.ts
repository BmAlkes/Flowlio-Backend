import { z } from 'zod';
import { createHash } from 'node:crypto';
import { canManageClients, canPerform, type Actor } from '../../security/resource-policy';
import { calendarDate } from '../capacity/calculation';

export class AgentError extends Error { constructor(public status:number, public code:string){super(code);} }
export const hash=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const id=z.string().min(1).max(128);
const date=calendarDate.refine(v=>v>='2000-01-01'&&v<='2100-12-31');
export const areas=['dashboard','projects','tasks','clients','leads','proposals','scope','pending','capacity','financial','time','calendar','documents','attention','settings','support'] as const;
export const scopeInput=z.object({area:z.enum(areas),projectId:id.optional(),clientId:id.optional()}).strict();
export const generationInput=z.object({id:z.string().uuid(),scope:scopeInput,prompt:z.string().trim().min(3).max(8000),language:z.enum(['en','pt','es','he']),mode:z.enum(['review','internal']).default('review')}).strict();
const taskFields={projectId:id,title:z.string().trim().min(1).max(160),description:z.string().max(4000),assignedTo:id.nullable(),startDate:date.nullable(),endDate:date.nullable(),estimatedHours:z.number().min(0).max(10000).nullable()};
export const actionInput=z.discriminatedUnion('type',[
 z.object({type:z.literal('create_task'),...taskFields}).strict(),
 z.object({type:z.literal('plan_task'),taskId:id,assignedTo:id.nullable(),startDate:date.nullable(),endDate:date.nullable()}).strict(),
 z.object({type:z.literal('followup'),clientId:id,date:z.string().datetime(),note:z.string().trim().min(1).max(2000)}).strict(),
 z.object({type:z.literal('client_request'),projectId:id,title:z.string().trim().min(1).max(160),description:z.string().trim().min(1).max(4000),questions:z.array(z.string().trim().min(1).max(200)).max(10)}).strict(),
]).superRefine((v,c)=>{if('startDate'in v&&v.startDate&&v.endDate&&v.startDate>v.endDate)c.addIssue({code:'custom',message:'Invalid date order'});});
export type Action=z.infer<typeof actionInput>;
export type Scope=z.infer<typeof scopeInput>;
export type Generation=z.infer<typeof generationInput>;
export type Source={key:string;kind:string;id:string;title:string;href:string;data:Record<string,unknown>};
export type Context={sources:Source[];members:{id:string;name:string}[];limits:string[];capabilities:string[];date:string};
export const outputInput=z.object({answer:z.string().min(1).max(16000),citations:z.array(z.string().max(160)).max(30),actions:z.array(actionInput).max(12),missing:z.array(z.string().max(300)).max(15)}).strict();
export const applyInput=z.object({selected:z.array(z.number().int().min(0).max(11)).min(1).max(12),confirm:z.literal(true),shareWithClient:z.boolean().default(false),edits:z.record(z.string(),actionInput).default({})}).strict().refine(v=>new Set(v.selected).size===v.selected.length);
export function authorize(a:Actor){if(!a.organizationId||!['user','operator','viewer','subadmin','superadmin'].includes(a.role))throw new AgentError(403,'AGENT_INTERNAL_ONLY');}
export function capabilities(a:Actor){authorize(a);return[...(canPerform(a,'create')?['create_task']:[]),...(canPerform(a,'update')?['plan_task']:[]),...(canManageClients(a)?['followup','client_request']:[])];}
export function validateOutput(raw:unknown,context:Context){
 const parsed=outputInput.safeParse(raw);if(!parsed.success)throw new AgentError(502,'INVALID_AI_OUTPUT');const result=parsed.data;
 const keys=new Set(context.sources.map(v=>v.key));
 if(result.citations.some(v=>!keys.has(v)))throw new AgentError(502,'INVALID_AI_SOURCES');
 for(const action of result.actions){
  if(!context.capabilities.includes(action.type))throw new AgentError(502,'INVALID_AI_ACTION');
  const kind='taskId'in action?'task':'clientId'in action?'client':'project';const resource='taskId'in action?action.taskId:'clientId'in action?action.clientId:action.projectId;
  if(!context.sources.some(s=>s.kind===kind&&s.id===resource))throw new AgentError(502,'INVALID_AI_ACTION');
  if('assignedTo'in action&&action.assignedTo&&!context.members.some(m=>m.id===action.assignedTo))throw new AgentError(502,'INVALID_AI_ACTION');
 }
 return result;
}

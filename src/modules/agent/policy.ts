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
export const generationInput=z.object({id:z.string().uuid(),scope:scopeInput,prompt:z.string().trim().min(3).max(8000),language:z.enum(['en','pt','es','he']),conversationId:z.string().uuid().optional(),mode:z.enum(['review','internal']).default('review')}).strict();
export const taskStatuses=['todo','in_progress','completed','delay','changes'] as const;
const taskFields={projectId:id,title:z.string().trim().min(1).max(160),description:z.string().max(4000),assignedTo:id.nullable(),startDate:date.nullable(),endDate:date.nullable(),estimatedHours:z.number().min(0).max(10000).nullable()};
export const actionInput=z.discriminatedUnion('type',[
 z.object({type:z.literal('create_task'),...taskFields}).strict(),
 z.object({type:z.literal('plan_task'),taskId:id,assignedTo:id.nullable(),startDate:date.nullable(),endDate:date.nullable()}).strict(),
 z.object({type:z.literal('followup'),clientId:id,date:z.string().datetime(),note:z.string().trim().min(1).max(2000)}).strict(),
 z.object({type:z.literal('client_request'),projectId:id,title:z.string().trim().min(1).max(160),description:z.string().trim().min(1).max(4000),questions:z.array(z.string().trim().min(1).max(200)).max(10)}).strict(),
 z.object({type:z.literal('set_task_status'),taskId:id,status:z.enum(taskStatuses)}).strict(),
 z.object({type:z.literal('create_event'),title:z.string().trim().min(1).max(160),description:z.string().max(2000),date,startHour:z.number().int().min(0).max(23),endHour:z.number().int().min(0).max(23),calendarType:z.enum(['meeting','education','personal'])}).strict(),
 z.object({type:z.literal('create_lead'),name:z.string().trim().min(1).max(160),email:z.string().trim().toLowerCase().email().max(254),phone:z.string().trim().max(40).nullable(),businessIndustry:z.string().trim().max(120).nullable(),note:z.string().trim().max(2000).nullable(),followUpAt:z.string().datetime().nullable()}).strict(),
 z.object({type:z.literal('log_time'),taskId:id,date,minutes:z.number().int().min(1).max(1440),description:z.string().trim().max(500)}).strict(),
]).superRefine((v,c)=>{if('startDate'in v&&v.startDate&&v.endDate&&v.startDate>v.endDate)c.addIssue({code:'custom',message:'Invalid date order'});if(v.type==='create_event'&&v.endHour<=v.startHour)c.addIssue({code:'custom',message:'Invalid hours'});});
export type Action=z.infer<typeof actionInput>;
export type Scope=z.infer<typeof scopeInput>;
export type Generation=z.infer<typeof generationInput>;
// tool=true marks records fetched on demand by a query tool; they are re-authorized individually.
export type Source={key:string;kind:string;id:string;title:string;href:string;data:Record<string,unknown>;tool?:true};
export type Turn={request:string;answer:string;executed:boolean};
export type Context={sources:Source[];members:{id:string;name:string}[];limits:string[];capabilities:string[];date:string};
export const outputInput=z.object({answer:z.string().min(1).max(16000),citations:z.array(z.string().max(160)).max(30),actions:z.array(actionInput).max(12),missing:z.array(z.string().max(300)).max(15)}).strict();
export const applyInput=z.object({selected:z.array(z.number().int().min(0).max(11)).min(1).max(12),confirm:z.literal(true),shareWithClient:z.boolean().default(false),edits:z.record(z.string(),actionInput).default({}),timeZone:z.string().min(1).max(64).regex(/^[A-Za-z0-9_+\-/]+$/).default('UTC')}).strict().refine(v=>new Set(v.selected).size===v.selected.length);
export function authorize(a:Actor){if(!a.organizationId||!['user','operator','viewer','subadmin','superadmin'].includes(a.role))throw new AgentError(403,'AGENT_INTERNAL_ONLY');}
export function capabilities(a:Actor){authorize(a);return[...(canPerform(a,'create')?['create_task']:[]),...(canPerform(a,'update')?['plan_task','set_task_status']:[]),...(canPerform(a,'track')?['log_time']:[]),'create_event',...(canManageClients(a)?['followup','client_request','create_lead']:[])];}
export function validateOutput(raw:unknown,context:Context){
 const parsed=outputInput.safeParse(raw);if(!parsed.success)throw new AgentError(502,'INVALID_AI_OUTPUT');const result=parsed.data;
 const keys=new Set(context.sources.map(v=>v.key));
 if(result.citations.some(v=>!keys.has(v)))throw new AgentError(502,'INVALID_AI_SOURCES');
 for(const action of result.actions){
  if(!context.capabilities.includes(action.type))throw new AgentError(502,'INVALID_AI_ACTION');
  // Events and leads are new records; every other action must target a record the model was shown.
  const target='taskId'in action?['task',action.taskId]:'clientId'in action?['client',action.clientId]:'projectId'in action?['project',action.projectId]:null;
  if(target&&!context.sources.some(s=>s.kind===target[0]&&s.id===target[1]))throw new AgentError(502,'INVALID_AI_ACTION');
  if('assignedTo'in action&&action.assignedTo&&!context.members.some(m=>m.id===action.assignedTo))throw new AgentError(502,'INVALID_AI_ACTION');
 }
 return result;
}

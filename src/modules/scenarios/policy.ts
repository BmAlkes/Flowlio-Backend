import {z} from 'zod';import {createHash} from 'node:crypto';import {calendarDate} from '../capacity/calculation';
export class ScenarioError extends Error{constructor(public status:number,public code:string){super(code);}}
export const hash=(v:unknown)=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
const id=z.string().min(1).max(128),date=calendarDate.refine(v=>v>='2000-01-01'&&v<='2100-12-31');
export const createInput=z.object({id:z.string().uuid(),title:z.string().trim().min(1).max(160),week:date,weeks:z.number().int().min(1).max(12)}).strict();
const assignment={key:z.string().uuid(),assignedTo:id.nullable(),startDate:date,endDate:date};
const change=z.discriminatedUnion('type',[
 z.object({...assignment,type:z.literal('task'),taskId:id}).strict(),
 z.object({...assignment,type:z.literal('proposal'),title:z.string().trim().min(1).max(160),estimatedMinutes:z.number().int().min(0).max(600000).nullable()}).strict()
]).refine(v=>v.startDate<=v.endDate&&Date.parse(v.endDate)-Date.parse(v.startDate)<=366*86400000);
export const saveInput=z.object({revision:z.number().int().min(0),changes:z.array(change).max(100)}).strict().refine(v=>new Set(v.changes.map(c=>c.key)).size===v.changes.length&&new Set(v.changes.filter(c=>c.type==='task').map(c=>c.taskId)).size===v.changes.filter(c=>c.type==='task').length);
export const refreshInput=z.object({revision:z.number().int().min(0),confirm:z.literal(true)}).strict();
export const applyInput=z.object({key:z.string().uuid(),revision:z.number().int().min(0),selected:z.array(z.string().uuid()).min(1).max(100),confirm:z.literal(true)}).strict().refine(v=>new Set(v.selected).size===v.selected.length);
export const absenceInput=z.object({id:z.string().uuid(),userId:id,startDate:date,endDate:date,kind:z.enum(['vacation','unavailable'])}).strict().refine(v=>v.startDate<=v.endDate&&Date.parse(v.endDate)-Date.parse(v.startDate)<=366*86400000);

import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { PoolClient } from 'pg';
import { canManageClients, canReadProject, type Actor } from '../../security/resource-policy';
export class PendingError extends Error {constructor(public status:number,public code:string){super(code);}}
export const hash=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const id=z.string().min(1).max(128);
const date=z.string().regex(/^20\d{2}-\d{2}-\d{2}$/).refine(v=>{const d=new Date(v+'T12:00:00Z');return !Number.isNaN(d.getTime())&&d.toISOString().slice(0,10)===v;});
export const creation=z.object({id:z.string().uuid(),projectId:id,kind:z.enum(['briefing','question','file']),title:z.string().trim().min(1).max(160),description:z.string().trim().min(1).max(4000),
 questions:z.array(z.object({id:z.string().min(1).max(64).regex(/^[a-zA-Z0-9_-]+$/).refine(v=>!['__proto__','constructor','prototype'].includes(v)),label:z.string().trim().min(1).max(200),type:z.enum(['text','choice']),required:z.boolean(),options:z.array(z.string().trim().min(1).max(160)).max(12)}).strict()).max(10),
 dependencies:z.array(id).max(10),assignedTo:id,dueDate:date.nullable(),timezone:z.string().max(80),reminderHours:z.union([z.literal(0),z.literal(24),z.literal(48),z.literal(72),z.literal(168)]),reminderChannel:z.enum(['internal','email','push']),
}).strict().superRefine((v,c)=>{
 if(v.kind==='briefing'&&!v.questions.length)c.addIssue({code:'custom',message:'Questions required'});
 if(v.kind!=='briefing'&&v.questions.length)c.addIssue({code:'custom',message:'Unexpected questions'});
 if(new Set(v.questions.map(q=>q.id)).size!==v.questions.length||new Set(v.dependencies).size!==v.dependencies.length||v.dependencies.includes(v.id))c.addIssue({code:'custom',message:'Duplicate reference'});
 for(const q of v.questions)if(q.type==='choice'?(q.options.length<2||new Set(q.options).size!==q.options.length):q.options.length>0)c.addIssue({code:'custom',message:'Invalid choices'});
 if(v.reminderHours&&!v.dueDate)c.addIssue({code:'custom',message:'Deadline required for reminders'});
});
export const command=z.discriminatedUnion('action',[
 z.object({key:z.string().uuid(),revision:z.number().int().min(0),action:z.literal('respond'),message:z.string().trim().max(4000),answers:z.record(z.string().max(64),z.string().trim().max(4000)),fileIds:z.array(id).max(10)}).strict(),
 z.object({key:z.string().uuid(),revision:z.number().int().min(0),action:z.enum(['complete','cancel','reopen']),reason:z.string().trim().max(2000)}).strict(),
]);
export async function project(c:PoolClient,a:Actor,projectId:string,lock=false){
 if(!a.organizationId||a.role!=='client'&&!canManageClients(a))throw new PendingError(403,'FORBIDDEN');
 const row=(await c.query(`select p.id,p.name,p.organization_id as "organizationId",p.created_by as "createdBy",p.assigned_to as "assignedTo",p.visibility,p.client_id as "clientId",cl.user_id as "clientUserId",cl.name as "clientName",cl.portal_access_enabled as "portalEnabled" from projects p left join clients cl on cl.id=p.client_id and cl.organization_id=p.organization_id where p.id=$1 and p.organization_id=$2 ${lock?'for share of p':''}`,[projectId,a.organizationId])).rows[0];
 if(!row||!canReadProject(a,row,row.clientUserId===a.id&&row.portalEnabled?row.clientId:undefined))throw new PendingError(404,'PROJECT_NOT_FOUND');return row;
}
export async function dependencies(c:PoolClient,r:any){
 if(!r.dependencies.length)return[];
 return(await c.query('select id,title,state from client_requests where id=any($1::text[]) and organization_id=$2 and project_id=$3 and client_id=$4 order by created_at,id',[r.dependencies,r.organization_id,r.project_id,r.client_id])).rows;
}
export async function blocked(c:PoolClient,r:any){const rows=await dependencies(c,r);return rows.length!==r.dependencies.length||rows.some(v=>v.state!=='completed');}

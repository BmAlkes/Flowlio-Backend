import type { Pool } from 'pg';
import type { Actor } from '../../security/resource-policy';
import { capture,requireMember } from './context';
import { execute } from './actions';
import { createToolbox,stillVisible,type Toolbox } from './tools';
import { AIAccessError } from '../../utils/ai-context.util';
import { logger } from '../../utils/logger.util';
import { authorize,hash,generationInput,applyInput,validateOutput,AgentError,type Context,type Generation,type Action,type Turn } from './policy';

type Provider=(input:Generation,context:Context,signal:AbortSignal,history:Turn[],tools:Toolbox)=>Promise<unknown>;
const permissionKey=(a:Actor)=>hash([a.role,!!a.isOrganizationOwner,!!a.isOrganizationManager]);
// JSONB does not preserve object-key order; compare values, including nested reports.
// JSON serialization also normalizes Date objects from fresh PostgreSQL queries.
const snapshotHash=(value:unknown)=>hash(JSON.parse(JSON.stringify(value??null,(_key,item)=>{
 if(item&&typeof item==='object'&&!Array.isArray(item))return Object.fromEntries(Object.entries(item).sort(([left],[right])=>left.localeCompare(right)));
 return item;
})));
// eventsCreated runs after a confirmation is committed, e.g. to push new calendar events to Google.
export function createAgent(pool:Pool,provider:Provider,hooks:{eventsCreated?:(userId:string,eventIds:string[])=>Promise<void>}={}){
 async function row(a:Actor,id:string){authorize(a);await requireMember(pool,a);const r=(await pool.query('select * from ai_agent_runs where id=$1 and organization_id=$2 and actor_id=$3',[id,a.organizationId,a.id])).rows[0];if(!r)throw new AgentError(404,'RUN_NOT_FOUND');if(r.actor_scope!==permissionKey(a))throw new AgentError(403,'ACCESS_CHANGED');return r;}
 async function visible(a:Actor,r:any){
  const current=await capture(pool,a,r.input.scope);const keys=new Set(current.sources.map(v=>v.key));
  if((r.context as Context).sources.some(s=>!s.tool&&!keys.has(s.key)))throw new AgentError(403,'ACCESS_CHANGED');
  // Aggregate sources can embed task names and financial details. Their entire snapshot
  // must still match, so revoked nested resources cannot survive behind a stable report key.
  for(const source of (r.context as Context).sources)if(!source.tool&&['capacity','margin','attention','retainer'].includes(source.kind)&&snapshotHash(source.data)!==snapshotHash(current.sources.find(s=>s.key===source.key)?.data))throw new AgentError(403,'ACCESS_CHANGED');
  // Records fetched on demand are not part of the area sample: recheck each against current access.
  await stillVisible(pool,a,(r.context as Context).sources.filter(s=>s.tool));
 }
 function view(r:any){return{id:r.id,state:r.state,createdAt:r.created_at,conversationId:r.conversation_id??null,input:r.input,error:r.error_code,result:r.result,receipts:r.receipts,sources:(r.context as Context).sources.map(({key,kind,id,title,href})=>({key,kind,id,title,href})),limits:r.context.limits,members:r.context.members};}
 async function detail(a:Actor,id:string){const r=await row(a,id);await visible(a,r);return view(r);}
 async function list(a:Actor){authorize(a);await requireMember(pool,a);return(await pool.query("select id,state,input->'scope'->>'area' area,created_at from ai_agent_runs where organization_id=$1 and actor_id=$2 and actor_scope=$3 order by created_at desc,id desc limit 30",[a.organizationId,a.id,permissionKey(a)])).rows;}
 async function apply(a:Actor,id:string,raw:unknown){
  const p=applyInput.safeParse(raw);if(!p.success)throw new AgentError(400,'INVALID_INPUT');const command=p.data;
  const initial=await row(a,id);await visible(a,initial);
  const fingerprint=hash(command);const c=await pool.connect();
  try{
   await c.query('begin isolation level serializable');await c.query("set local statement_timeout='15s'");await c.query("set local time zone 'UTC'");
   // Logged time touches invoicing: take its lock first, in the same order as the other billing flows.
   if(command.selected.some(i=>initial.result?.actions?.[i]?.type==='log_time'))await c.query('select pg_advisory_xact_lock(hashtextextended($1,0))',['time-invoice:'+a.organizationId]);
   await c.query('select pg_advisory_xact_lock(hashtextextended($1,0))',['proposal-conversion:'+a.organizationId]);await requireMember(c,a);
   const r=(await c.query('select * from ai_agent_runs where id=$1 and actor_id=$2 and organization_id=$3 for update',[id,a.id,a.organizationId])).rows[0];
   if(!r||r.actor_scope!==permissionKey(a))throw new AgentError(403,'ACCESS_CHANGED');
   // Actions can be confirmed one at a time: receipts remember which proposal index each one executed.
   const done=new Set<number>((r.receipts??[]).map((x:any)=>x.index).filter((v:unknown):v is number=>Number.isInteger(v)));
   if(r.state==='applied'&&!done.size){if(r.apply_hash!==fingerprint)throw new AgentError(409,'ALREADY_APPLIED');await c.query('commit');return view(r);}
   if(command.selected.some(i=>done.has(i))){if(!command.selected.every(i=>done.has(i)))throw new AgentError(409,'ALREADY_APPLIED');await c.query('commit');return view(r);}
   if(r.state!=='ready')throw new AgentError(409,'RUN_NOT_READY');
   if(Date.now()-new Date(r.created_at).getTime()>86400000)throw new AgentError(409,'DRAFT_EXPIRED');
   const actions:Action[]=command.selected.map(i=>{const original=r.result.actions[i];if(!original)throw new AgentError(400,'INVALID_SELECTION');const edited=command.edits[String(i)]??original;
    if(edited.type!==original.type||('projectId'in edited&&edited.projectId!==original.projectId)||('taskId'in edited&&edited.taskId!==original.taskId)||('clientId'in edited&&edited.clientId!==original.clientId))throw new AgentError(400,'INVALID_SELECTION');return edited;});
   if(Object.keys(command.edits).some(k=>!command.selected.includes(Number(k))))throw new AgentError(400,'INVALID_SELECTION');
   validateOutput({...r.result,actions},r.context);
   if(actions.some(v=>v.type==='client_request')&&!command.shareWithClient)throw new AgentError(400,'SHARING_CONFIRMATION_REQUIRED');
   const executed=(await execute(c,a,actions,r.context,id,command.timeZone)).map((x,i)=>({...x,index:command.selected[i]}));
   const receipts=[...(r.receipts??[]),...executed];
   const complete=(r.result.actions as Action[]).every((_,i)=>receipts.some(x=>x.index===i));
   const updated=(await c.query("update ai_agent_runs set state=$4,apply_hash=$2,receipts=$3,updated_at=now() where id=$1 returning *",[id,fingerprint,JSON.stringify(receipts),complete?'applied':'ready'])).rows[0];
   await c.query('commit');
   // Outside the transaction and never blocking the answer: a failed sync leaves the event in Flowlio, as on the Calendar page.
   const events=executed.filter(x=>x.type==='create_event').map(x=>x.id);
   if(events.length&&hooks.eventsCreated)void hooks.eventsCreated(a.id,events).catch(()=>{});
   return view(updated);
  }catch(e){await c.query('rollback');if((e as any).code==='40001')throw new AgentError(409,'SOURCE_CHANGED');throw e;}finally{c.release();}
 }
 async function create(a:Actor,raw:unknown,signal:AbortSignal){
  authorize(a);const p=generationInput.safeParse(raw);if(!p.success)throw new AgentError(400,'INVALID_INPUT');const input=p.data;
  const existing=(await pool.query('select id from ai_agent_runs where id=$1',[input.id])).rows[0];
  if(existing){const prior=await row(a,input.id);if(prior.input_hash!==hash(input))throw new AgentError(409,'RUN_CONFLICT');return detail(a,input.id);}
  const context=await capture(pool,a,input.scope);if(signal.aborted)throw new AgentError(409,'CANCELLED');
  const inserted=await pool.query("insert into ai_agent_runs(id,organization_id,actor_id,actor_scope,input_hash,input,context,state,conversation_id) values($1,$2,$3,$4,$5,$6,$7,'running',$8) on conflict(id) do nothing returning id",[input.id,a.organizationId,a.id,permissionKey(a),hash(input),JSON.stringify(input),JSON.stringify(context),input.conversationId??null]);
  if(!inserted.rowCount){const prior=await row(a,input.id);if(prior.input_hash!==hash(input))throw new AgentError(409,'RUN_CONFLICT');return detail(a,input.id);}
  try{
   const rawResult=await provider(input,context,signal,input.conversationId?await turns(a,input.conversationId,input.id):[],createToolbox(pool,a,context));
   if(signal.aborted)throw new AgentError(409,'CANCELLED');
   const result=validateOutput(rawResult,context);
   const saved=await pool.query("update ai_agent_runs set state='ready',result=$2,context=$3,updated_at=now() where id=$1 and state='running' returning id",[input.id,JSON.stringify(result),JSON.stringify(context)]);
   if(!saved.rowCount)throw new AgentError(409,'CANCELLED');
   // Automatic execution is opt-in for this request only, and limited to internal task planning.
   if(input.mode==='internal'&&result.actions.length&&result.actions.every(v=>v.type==='create_task'||v.type==='plan_task')){
    try{return await apply(a,input.id,{selected:result.actions.map((_,i)=>i),confirm:true,shareWithClient:false,edits:{}});}catch(e){await pool.query("update ai_agent_runs set error_code=$2 where id=$1 and state='ready'",[input.id,e instanceof AgentError?e.code:'ACTION_FAILED']);}
   }
   return detail(a,input.id);
  }catch(e){if(!(e instanceof AgentError))logger.error({name:(e as Error)?.name,code:(e as any)?.code,status:(e as any)?.status},'Agent generation failed');await pool.query("update ai_agent_runs set state=$2,error_code=$3,updated_at=now() where id=$1 and state='running'",[input.id,signal.aborted?'cancelled':'failed',e instanceof AgentError||e instanceof AIAccessError?e.code:'AI_PROVIDER_UNAVAILABLE']);throw e;}
 }
 // Earlier turns of the same author, permission scope and conversation; stale conversations are not replayed.
 async function turns(a:Actor,conversationId:string,currentId:string):Promise<Turn[]>{
  const rows=(await pool.query("select input->>'prompt' request,result->>'answer' answer,state,jsonb_array_length(receipts) executed_count from ai_agent_runs where organization_id=$1 and actor_id=$2 and actor_scope=$3 and conversation_id=$4 and id<>$5 and state in ('ready','applied') and result is not null and created_at>now()-interval '24 hours' order by created_at desc,id desc limit 6",[a.organizationId,a.id,permissionKey(a),conversationId,currentId])).rows;
  return rows.reverse().map(r=>({request:String(r.request??'').slice(0,1000),answer:String(r.answer??'').slice(0,1500),executed:r.state==='applied'||r.executed_count>0}));
 }
 async function cancel(a:Actor,id:string){await row(a,id);await pool.query("update ai_agent_runs set state='cancelled',updated_at=now() where id=$1 and state in ('running','ready')",[id]);const r=await row(a,id);return{id,state:r.state};}
 return{create,detail,list,apply,cancel};
}

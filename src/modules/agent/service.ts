import type { Pool } from 'pg';
import type { Actor } from '../../security/resource-policy';
import { capture,requireMember } from './context';
import { execute } from './actions';
import { authorize,hash,generationInput,applyInput,validateOutput,AgentError,type Context,type Generation,type Action } from './policy';

type Provider=(input:Generation,context:Context,signal:AbortSignal)=>Promise<unknown>;
const permissionKey=(a:Actor)=>hash([a.role,!!a.isOrganizationOwner,!!a.isOrganizationManager]);
export function createAgent(pool:Pool,provider:Provider){
 async function row(a:Actor,id:string){authorize(a);await requireMember(pool,a);const r=(await pool.query('select * from ai_agent_runs where id=$1 and organization_id=$2 and actor_id=$3',[id,a.organizationId,a.id])).rows[0];if(!r)throw new AgentError(404,'RUN_NOT_FOUND');if(r.actor_scope!==permissionKey(a))throw new AgentError(403,'ACCESS_CHANGED');return r;}
 async function visible(a:Actor,r:any){
  const current=await capture(pool,a,r.input.scope);const keys=new Set(current.sources.map(v=>v.key));
  if((r.context as Context).sources.some(s=>!keys.has(s.key)))throw new AgentError(403,'ACCESS_CHANGED');
  // Aggregate sources can embed task names and financial details. Their entire snapshot
  // must still match, so revoked nested resources cannot survive behind a stable report key.
  for(const source of (r.context as Context).sources)if(['capacity','margin','attention','retainer'].includes(source.kind)&&hash(source.data)!==hash(current.sources.find(s=>s.key===source.key)?.data))throw new AgentError(403,'ACCESS_CHANGED');
 }
 function view(r:any){return{id:r.id,state:r.state,createdAt:r.created_at,input:r.input,error:r.error_code,result:r.result,receipts:r.receipts,sources:(r.context as Context).sources.map(({key,kind,id,title,href})=>({key,kind,id,title,href})),limits:r.context.limits,members:r.context.members};}
 async function detail(a:Actor,id:string){const r=await row(a,id);await visible(a,r);return view(r);}
 async function list(a:Actor){authorize(a);await requireMember(pool,a);return(await pool.query("select id,state,input->'scope'->>'area' area,created_at from ai_agent_runs where organization_id=$1 and actor_id=$2 and actor_scope=$3 order by created_at desc,id desc limit 30",[a.organizationId,a.id,permissionKey(a)])).rows;}
 async function apply(a:Actor,id:string,raw:unknown){
  const p=applyInput.safeParse(raw);if(!p.success)throw new AgentError(400,'INVALID_INPUT');const command=p.data;
  const initial=await row(a,id);await visible(a,initial);
  const fingerprint=hash(command);const c=await pool.connect();
  try{
   await c.query('begin isolation level serializable');await c.query("set local statement_timeout='15s'");await c.query("set local time zone 'UTC'");
   await c.query('select pg_advisory_xact_lock(hashtextextended($1,0))',['proposal-conversion:'+a.organizationId]);await requireMember(c,a);
   const r=(await c.query('select * from ai_agent_runs where id=$1 and actor_id=$2 and organization_id=$3 for update',[id,a.id,a.organizationId])).rows[0];
   if(!r||r.actor_scope!==permissionKey(a))throw new AgentError(403,'ACCESS_CHANGED');
   if(r.state==='applied'){if(r.apply_hash!==fingerprint)throw new AgentError(409,'ALREADY_APPLIED');await c.query('commit');return view(r);}
   if(r.state!=='ready')throw new AgentError(409,'RUN_NOT_READY');
   if(Date.now()-new Date(r.created_at).getTime()>86400000)throw new AgentError(409,'DRAFT_EXPIRED');
   const actions:Action[]=command.selected.map(i=>{const original=r.result.actions[i];if(!original)throw new AgentError(400,'INVALID_SELECTION');const edited=command.edits[String(i)]??original;
    if(edited.type!==original.type||('projectId'in edited&&edited.projectId!==original.projectId)||('taskId'in edited&&edited.taskId!==original.taskId)||('clientId'in edited&&edited.clientId!==original.clientId))throw new AgentError(400,'INVALID_SELECTION');return edited;});
   if(Object.keys(command.edits).some(k=>!command.selected.includes(Number(k))))throw new AgentError(400,'INVALID_SELECTION');
   validateOutput({...r.result,actions},r.context);
   if(actions.some(v=>v.type==='client_request')&&!command.shareWithClient)throw new AgentError(400,'SHARING_CONFIRMATION_REQUIRED');
   const receipts=await execute(c,a,actions,r.context,id);
   const updated=(await c.query("update ai_agent_runs set state='applied',apply_hash=$2,receipts=$3,updated_at=now() where id=$1 returning *",[id,fingerprint,JSON.stringify(receipts)])).rows[0];
   await c.query('commit');return view(updated);
  }catch(e){await c.query('rollback');if((e as any).code==='40001')throw new AgentError(409,'SOURCE_CHANGED');throw e;}finally{c.release();}
 }
 async function create(a:Actor,raw:unknown,signal:AbortSignal){
  authorize(a);const p=generationInput.safeParse(raw);if(!p.success)throw new AgentError(400,'INVALID_INPUT');const input=p.data;
  const existing=(await pool.query('select id from ai_agent_runs where id=$1',[input.id])).rows[0];
  if(existing){const prior=await row(a,input.id);if(prior.input_hash!==hash(input))throw new AgentError(409,'RUN_CONFLICT');return detail(a,input.id);}
  const context=await capture(pool,a,input.scope);if(signal.aborted)throw new AgentError(409,'CANCELLED');
  const inserted=await pool.query("insert into ai_agent_runs(id,organization_id,actor_id,actor_scope,input_hash,input,context,state) values($1,$2,$3,$4,$5,$6,$7,'running') on conflict(id) do nothing returning id",[input.id,a.organizationId,a.id,permissionKey(a),hash(input),JSON.stringify(input),JSON.stringify(context)]);
  if(!inserted.rowCount){const prior=await row(a,input.id);if(prior.input_hash!==hash(input))throw new AgentError(409,'RUN_CONFLICT');return detail(a,input.id);}
  try{
   const rawResult=await provider(input,context,signal);
   if(signal.aborted)throw new AgentError(409,'CANCELLED');
   const result=validateOutput(rawResult,context);
   const saved=await pool.query("update ai_agent_runs set state='ready',result=$2,updated_at=now() where id=$1 and state='running' returning id",[input.id,JSON.stringify(result)]);
   if(!saved.rowCount)throw new AgentError(409,'CANCELLED');
   // Automatic execution is opt-in for this request only, and limited to internal task planning.
   if(input.mode==='internal'&&result.actions.length&&result.actions.every(v=>v.type==='create_task'||v.type==='plan_task')){
    try{return await apply(a,input.id,{selected:result.actions.map((_,i)=>i),confirm:true,shareWithClient:false,edits:{}});}catch(e){await pool.query("update ai_agent_runs set error_code=$2 where id=$1 and state='ready'",[input.id,e instanceof AgentError?e.code:'ACTION_FAILED']);}
   }
   return detail(a,input.id);
  }catch(e){await pool.query("update ai_agent_runs set state=$2,error_code=$3,updated_at=now() where id=$1 and state='running'",[input.id,signal.aborted?'cancelled':'failed',e instanceof AgentError?e.code:'AI_PROVIDER_UNAVAILABLE']);throw e;}
 }
 async function cancel(a:Actor,id:string){await row(a,id);await pool.query("update ai_agent_runs set state='cancelled',updated_at=now() where id=$1 and state in ('running','ready')",[id]);const r=await row(a,id);return{id,state:r.state};}
 return{create,detail,list,apply,cancel};
}

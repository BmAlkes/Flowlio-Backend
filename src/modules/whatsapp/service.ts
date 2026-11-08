import type { Pool } from 'pg';
import { createHash,randomBytes,randomUUID } from 'node:crypto';
import type { Actor } from '../../security/resource-policy';
import { aiContext } from '../../utils/ai-context.util';
import { logger } from '../../utils/logger.util';
import { authorize,type Action } from '../agent/policy';
import type { Audio } from '../agent/transcribe';
import type { CloudApi,Inbound } from './cloud-api';
import { fill,languages,quicks,textFor,type Language,type Quick } from './messages';

type Source={key:string;kind:string;id:string;title:string};
type Run={id:string;state:string;result:{answer:string;missing:string[];actions:Action[]}|null;sources:Source[]};
export type WhatsAppActor=Actor&{name?:string|null;timezone?:string|null};
export type Deps={
 api:CloudApi;
 agent:{create(a:Actor,raw:unknown,signal:AbortSignal):Promise<Run>;apply(a:Actor,id:string,raw:unknown):Promise<Run>};
 transcribe(audio:Audio):Promise<{text:string}>;
 // Resolves the user exactly like a signed-in request; throws when access was revoked.
 actor(userId:string):Promise<WhatsAppActor>;
 hasAssistant(organizationId:string):Promise<boolean>;
 now?:()=>number;
};
type Link={user_id:string;organization_id:string;phone:string|null;language:string;conversation_id:string|null};

const ALPHABET='ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const CODE_MINUTES=15;
const codeHash=(code:string)=>createHash('sha256').update('whatsapp:'+code).digest('hex');
const CODE=/FLOWLIO\s*[-:]?\s*([A-Z2-9]{4})\s*-?\s*([A-Z2-9]{4})/i;
const NEW=/^\s*\/?(new|novo|nova conversa|nuevo|nueva conversación|חדש)\s*[.!]?\s*$/i;
const BUTTON=/^(ok|no):([0-9a-f-]{36}):(\d{1,2})$/;
const QUICK=/^q:(\w+)$/;
// A message that only greets (or asks for the menu) gets the welcome menu without an AI call.
const GREETING=/^\s*(oi+|ol[aá]|e a[ií]|eai|bom dia|boa tarde|boa noite|ajuda|hi|hello|hey|help|hola|buen[oa]s(?: d[ií]as| tardes| noches)?|ayuda|שלום|היי|עזרה|men[uú]|תפריט)(?:\s+lio)?\s*[!.,?]*\s*$/iu;
// Words that only one supported language uses, to answer in the language the person writes in.
const words=(list:string)=>new RegExp(`(?<!\\p{L})(?:${list})(?!\\p{L})`,'giu');
const WORDS:Record<Exclude<Language,'he'>,RegExp>={
 pt:words('oi|ol[aá]|voc[eê]|n[aã]o|tenho|minha|meu|hoje|amanh[aã]|tarefas?|quais|obrigad[oa]|bom dia|boa tarde|boa noite|ajuda|preciso|semana'),
 es:words('hola|qu[eé]|tengo|mi|hoy|ma[nñ]ana|tareas?|cu[aá]les|gracias|buen[oa]s|ayuda|necesito|usted|semana que viene'),
 en:words('hi|hello|hey|what|my|the|today|tomorrow|tasks?|which|please|thanks|help|need|week|overdue|have'),
};
export function detectLanguage(text:string):Language|null{
 if(/[֐-׿]/.test(text))return 'he';
 const scores=(Object.keys(WORDS) as (keyof typeof WORDS)[]).map(l=>[l,text.match(WORDS[l])?.length??0] as const).sort((x,y)=>y[1]-x[1]);
 return scores[0][1]>0&&scores[0][1]>scores[1][1]?scores[0][0]:null;
}
const QUOTA=['ORG_TOKEN_LIMIT_EXCEEDED','USER_TOKEN_LIMIT_EXCEEDED','AI_QUOTA_DISABLED'];
const ACCESS=['ACCESS_CHANGED','AGENT_INTERNAL_ONLY','SESSION_INVALID','USER_DEACTIVATED','SUBADMIN_DEACTIVATED','MEMBERSHIP_INACTIVE','ORGANIZATION_DEACTIVATED','TRIAL_EXPIRED','SUBSCRIPTION_EXPIRED','PORTAL_ACCESS_DISABLED','WHATSAPP_ORG_CHANGED'];
export const maskPhone=(phone:string)=>`+${phone.slice(0,phone.length>11?3:2)} •••• ${phone.slice(-4)}`;
export function newCode(){const bytes=randomBytes(8);const raw=Array.from(bytes,b=>ALPHABET[b%ALPHABET.length]).join('');return `${raw.slice(0,4)}-${raw.slice(4)}`;}

// WhatsApp formatting: single-asterisk bold, record keys replaced by their names.
export function formatAnswer(run:Run,missingLabel:string){
 const titles=new Map(run.sources.map(s=>[s.key,s.title]));
 let text=(run.result?.answer??'').replace(/\[\[([^\]]+)\]\]/g,(_,key:string)=>titles.get(key)??'').replace(/\*\*(.+?)\*\*/g,'*$1*').replace(/[ \t]+\n/g,'\n').trim();
 if(run.result?.missing.length)text+=`\n\n${missingLabel}\n${run.result.missing.map(m=>`• ${m}`).join('\n')}`;
 return text.slice(0,4000);
}
export function describe(action:Action,sources:Source[],language:string){
 const t=textFor(language);const title=(kind:string,id:string)=>sources.find(s=>s.kind===kind&&s.id===id)?.title??'';const hour=(h:number)=>String(h).padStart(2,'0');
 switch(action.type){
  case 'create_task':{const project=title('project',action.projectId);return fill(t.task,{title:action.title,project:project?` · ${project}`:'',due:action.endDate?` · ${action.endDate}`:''});}
  case 'plan_task':return fill(t.plan_task,{title:title('task',action.taskId),dates:action.startDate||action.endDate?` · ${action.startDate??'?'} → ${action.endDate??'?'}`:''});
  case 'set_task_status':return fill(t.status,{title:title('task',action.taskId),status:t.statuses[action.status]??action.status});
  case 'create_event':return fill(t.event,{title:action.title,date:action.date,start:hour(action.startHour),end:hour(action.endHour)});
  case 'create_lead':return fill(t.lead,{name:action.name,email:action.email});
  case 'log_time':return fill(t.time,{minutes:action.minutes,title:title('task',action.taskId),date:action.date});
  case 'followup':return fill(t.followup,{title:title('client',action.clientId),date:action.date.slice(0,10)});
  case 'client_request':return action.title;
 }
}

export function createWhatsApp(pool:Pool,deps:Deps){
 const now=()=>deps.now?.()??Date.now();
 const withAI=<T>(a:Actor,fn:()=>Promise<T>)=>aiContext.run({userId:a.id,organizationId:a.organizationId!,feature:'whatsapp_assistant',endpoint:'whatsapp'},fn);

 async function startLink(a:Actor,language:string){
  authorize(a);const lang=(languages as string[]).includes(language)?language:'pt';
  for(let attempt=0;;attempt++){
   const code=newCode();const expiresAt=new Date(now()+CODE_MINUTES*60000);
   try{
    await pool.query(`insert into whatsapp_links(user_id,organization_id,language,code_hash,code_expires_at) values($1,$2,$3,$4,$5)
     on conflict(user_id) do update set organization_id=excluded.organization_id,language=excluded.language,code_hash=excluded.code_hash,code_expires_at=excluded.code_expires_at,updated_at=now()`,[a.id,a.organizationId,lang,codeHash(code),expiresAt]);
    return{code,expiresAt:expiresAt.toISOString()};
   }catch(e){if((e as any)?.code!=='23505'||attempt>=3)throw e;}
  }
 }
 async function status(a:Actor){
  authorize(a);const r=(await pool.query('select phone,verified_at,code_expires_at from whatsapp_links where user_id=$1 and organization_id=$2',[a.id,a.organizationId])).rows[0];
  return{linked:r?.phone&&r.verified_at?{phone:maskPhone(r.phone),since:r.verified_at}:null,pending:r?.code_expires_at&&new Date(r.code_expires_at).getTime()>now()?{expiresAt:r.code_expires_at}:null};
 }
 async function unlink(a:Actor){authorize(a);await pool.query('delete from whatsapp_links where user_id=$1',[a.id]);return{linked:null,pending:null};}

 // The code proves the sender owns the number: it was shown only to the signed-in user.
 async function verify(m:Inbound,code:string){
  const c=await pool.connect();
  try{
   await c.query('begin');
   const row=(await c.query('select * from whatsapp_links where code_hash=$1 and code_expires_at>$2 for update',[codeHash(code),new Date(now())])).rows[0] as Link|undefined;
   if(!row){await c.query('rollback');return null;}
   await c.query('update whatsapp_links set phone=null,verified_at=null,updated_at=now() where phone=$1 and user_id<>$2',[m.from,row.user_id]);
   await c.query('update whatsapp_links set phone=$2,verified_at=now(),code_hash=null,code_expires_at=null,conversation_id=$3,updated_at=now() where user_id=$1',[row.user_id,m.from,randomUUID()]);
   await c.query('commit');return row;
  }catch(e){await c.query('rollback');throw e;}finally{c.release();}
 }
 async function actorFor(link:Link){
  const a=await deps.actor(link.user_id);authorize(a);
  if(a.organizationId!==link.organization_id)throw Object.assign(new Error('WHATSAPP_ORG_CHANGED'),{code:'WHATSAPP_ORG_CHANGED'});
  if(!await deps.hasAssistant(link.organization_id))throw Object.assign(new Error('FEATURE_NOT_AVAILABLE'),{code:'FEATURE_NOT_AVAILABLE'});
  return a;
 }
 function problem(e:unknown,language:string){
  const t=textFor(language);const code=(e as any)?.code;
  if(QUOTA.includes(code))return t.quota;if(code==='FEATURE_NOT_AVAILABLE')return t.plan;if(ACCESS.includes(code))return t.access;
  if(code==='DRAFT_EXPIRED'||code==='RUN_NOT_READY'||code==='RUN_NOT_FOUND')return t.expired;if(code==='ALREADY_APPLIED')return t.already;
  return t.failed;
 }
 async function ask(m:Inbound,link:Link,a:Actor,prompt:string){
  const t=textFor(link.language);
  if(prompt.trim().length<3){await deps.api.sendText(m.from,t.short);return;}
  let conversationId=link.conversation_id;
  if(!conversationId){conversationId=randomUUID();await pool.query('update whatsapp_links set conversation_id=$2 where user_id=$1',[link.user_id,conversationId]);}
  const run=await withAI(a,()=>deps.agent.create(a,{id:randomUUID(),scope:{area:'dashboard'},prompt:prompt.slice(0,8000),language:link.language,conversationId,mode:'review'},AbortSignal.timeout(110_000)));
  const answer=formatAnswer(run,t.missing);if(answer)await deps.api.sendText(m.from,answer);
  if(run.state!=='ready')return;
  for(const [index,action] of (run.result?.actions??[]).slice(0,6).entries()){
   const summary=describe(action,run.sources,link.language);
   if(action.type==='client_request')await deps.api.sendText(m.from,fill(t.inApp,{action:summary}));
   else await deps.api.sendButtons(m.from,summary,[{id:`ok:${run.id}:${index}`,title:t.confirm},{id:`no:${run.id}:${index}`,title:t.skip}]);
  }
 }
 function menu(to:string,language:string,body:string){
  const t=textFor(language);return deps.api.sendButtons(to,body,quicks.map(q=>({id:`q:${q}`,title:t.quick[q]})));
 }
 async function tap(m:Inbound,link:Link,a:WhatsAppActor){
  const t=textFor(link.language);const match=BUTTON.exec(m.reply??'');if(!match){await deps.api.sendText(m.from,t.unsupported);return;}
  const [,choice,runId,raw]=match;const index=Number(raw);
  if(choice==='no'){await deps.api.sendText(m.from,t.skipped);return;}
  const run=await deps.agent.apply(a,runId,{selected:[index],confirm:true,edits:{},timeZone:a.timezone||'UTC'});
  const action=run.result?.actions[index];
  await deps.api.sendText(m.from,action?fill(t.done,{action:describe(action,run.sources,link.language)}):t.already);
 }

 async function handle(m:Inbound){
  const link=(await pool.query('select * from whatsapp_links where phone=$1 and verified_at is not null',[m.from])).rows[0] as Link|undefined;
  // A code is checked even from a linked number, so a number can move to another account.
  const code=m.kind==='text'?CODE.exec(m.text??''):null;
  if(!link&&!code){await deps.api.sendText(m.from,textFor('pt').notLinked);return;}
  if(code){
   const verified=await verify(m,`${code[1]}-${code[2]}`.toUpperCase());
   if(!verified){await deps.api.sendText(m.from,textFor(link?.language??'pt').invalidCode);return;}
   let name='';try{name=(await deps.actor(verified.user_id)).name?.split(' ')[0]??'';}catch{/* The link stands; access is checked on every message. */}
   await deps.api.sendText(m.from,fill(textFor(verified.language).connected,{name}).replace(', !','!'));
   await menu(m.from,verified.language,textFor(verified.language).menuPrompt);return;
  }
  if(!link)return;
  // Answer in the language the person writes in, and remember it for the next messages.
  const spoken=m.kind==='text'?detectLanguage(m.text??''):null;
  if(spoken&&spoken!==link.language){link.language=spoken;await pool.query('update whatsapp_links set language=$2,updated_at=now() where user_id=$1',[link.user_id,spoken]);}
  const t=textFor(link.language);
  try{
   const a=await actorFor(link);
   if(m.kind==='button'&&QUICK.test(m.reply??'')){
    const quick=QUICK.exec(m.reply??'')![1] as Quick;
    if((quicks as readonly string[]).includes(quick))await ask(m,link,a,t.prompts[quick]);else await deps.api.sendText(m.from,t.unsupported);
    return;
   }
   if(m.kind==='button'){await tap(m,link,a);return;}
   if(m.kind==='text'&&GREETING.test(m.text??'')){const first=(a as WhatsAppActor).name?.split(' ')[0];await menu(m.from,link.language,fill(t.welcome,{name:first?`, ${first}`:''}));return;}
   if(m.kind==='text'&&NEW.test(m.text??'')){await pool.query('update whatsapp_links set conversation_id=$2,updated_at=now() where user_id=$1',[link.user_id,randomUUID()]);await deps.api.sendText(m.from,t.newConversation);return;}
   if(m.kind==='audio'){
    let text:string;
    try{const audio=await deps.api.downloadMedia(m.mediaId!);text=(await withAI(a,()=>deps.transcribe(audio))).text;}
    catch(e){if(QUOTA.includes((e as any)?.code))throw e;logger.warn({code:(e as any)?.code??(e as Error)?.message},'WhatsApp voice note failed');await deps.api.sendText(m.from,t.audioFailed);return;}
    await deps.api.sendText(m.from,fill(t.heard,{text}));await ask(m,link,a,text);return;
   }
   if(m.kind==='text'){await ask(m,link,a,m.text??'');return;}
   await deps.api.sendText(m.from,t.unsupported);
  }catch(e){
   const code=(e as any)?.code;if(!QUOTA.includes(code)&&!ACCESS.includes(code)&&code!=='FEATURE_NOT_AVAILABLE')logger.error({code,name:(e as Error)?.name},'WhatsApp message failed');
   await deps.api.sendText(m.from,problem(e,link.language));
  }
 }
 return{startLink,status,unlink,handle};
}

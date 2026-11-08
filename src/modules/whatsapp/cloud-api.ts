import { createHmac,timingSafeEqual } from 'node:crypto';
import { env } from '../../utils/env.util';
import { MAX_AUDIO_BYTES } from '../agent/transcribe';

const GRAPH='https://graph.facebook.com/v25.0';
export type Button={id:string;title:string};
export type CloudApi={
 sendText(to:string,body:string):Promise<void>;
 sendButtons(to:string,body:string,buttons:Button[]):Promise<void>;
 downloadMedia(id:string):Promise<{buffer:Buffer;mimetype:string}>;
 displayNumber():Promise<string|null>;
};
// Parsed from the webhook. Anything that is not text, a voice note or a button tap arrives as 'other'.
export type Inbound={id:string;from:string;timestamp:number;kind:'text'|'audio'|'button'|'other';text?:string;mediaId?:string;reply?:string};

export const whatsappConfigured=()=>!!(env.WHATSAPP_PHONE_NUMBER_ID&&env.WHATSAPP_ACCESS_TOKEN&&env.WHATSAPP_APP_SECRET&&env.WHATSAPP_VERIFY_TOKEN);

// Meta signs the exact request bytes with the app secret.
export function validSignature(raw:Buffer,header:string|undefined,secret:string){
 if(!header?.startsWith('sha256='))return false;
 const expected=Buffer.from('sha256='+createHmac('sha256',secret).update(raw).digest('hex'));const given=Buffer.from(header);
 return expected.length===given.length&&timingSafeEqual(expected,given);
}

export function inboundMessages(body:any,phoneNumberId:string):Inbound[]{
 const found:Inbound[]=[];
 for(const entry of Array.isArray(body?.entry)?body.entry:[])for(const change of Array.isArray(entry?.changes)?entry.changes:[]){
  const value=change?.value;if(change?.field!=='messages'||value?.metadata?.phone_number_id!==phoneNumberId)continue;
  for(const m of Array.isArray(value.messages)?value.messages:[]){
   if(typeof m?.id!=='string'||typeof m?.from!=='string'||!/^\d{6,15}$/.test(m.from))continue;
   const base={id:m.id,from:m.from,timestamp:Number(m.timestamp)||0};
   if(m.type==='text'&&typeof m.text?.body==='string')found.push({...base,kind:'text',text:m.text.body.slice(0,4000)});
   else if(m.type==='audio'&&typeof m.audio?.id==='string')found.push({...base,kind:'audio',mediaId:m.audio.id});
   else if(m.type==='interactive'&&typeof m.interactive?.button_reply?.id==='string')found.push({...base,kind:'button',reply:m.interactive.button_reply.id});
   else if(m.type==='button'&&typeof m.button?.payload==='string')found.push({...base,kind:'button',reply:m.button.payload});
   else found.push({...base,kind:'other'});
  }
 }
 return found;
}

async function graph(path:string,init:RequestInit={}){
 const response=await fetch(path.startsWith('https://')?path:`${GRAPH}/${path}`,{...init,headers:{Authorization:`Bearer ${env.WHATSAPP_ACCESS_TOKEN}`,...(init.body?{'Content-Type':'application/json'}:{}),...init.headers},signal:AbortSignal.timeout(20_000)});
 if(!response.ok)throw new Error(`WHATSAPP_HTTP_${response.status}`);
 return response;
}
const send=(to:string,message:Record<string,unknown>)=>graph(`${env.WHATSAPP_PHONE_NUMBER_ID}/messages`,{method:'POST',body:JSON.stringify({messaging_product:'whatsapp',recipient_type:'individual',to,...message})}).then(()=>undefined);
let cachedNumber:{value:string|null;at:number}|null=null;

export const cloudApi:CloudApi={
 sendText:(to,body)=>send(to,{type:'text',text:{body:body.slice(0,4096),preview_url:false}}),
 // Reply buttons: at most 3, titles up to 20 characters, body up to 1024.
 sendButtons:(to,body,buttons)=>send(to,{type:'interactive',interactive:{type:'button',body:{text:body.slice(0,1024)},action:{buttons:buttons.slice(0,3).map(b=>({type:'reply',reply:{id:b.id,title:b.title.slice(0,20)}}))}}}),
 async downloadMedia(id){
  const meta=await (await graph(encodeURIComponent(id))).json() as {url?:string;mime_type?:string;file_size?:number};
  if(!meta.url)throw new Error('WHATSAPP_MEDIA_MISSING');
  if(Number(meta.file_size)>MAX_AUDIO_BYTES)throw Object.assign(new Error('AUDIO_TOO_LARGE'),{code:'AUDIO_TOO_LARGE'});
  const buffer=Buffer.from(await (await graph(meta.url)).arrayBuffer());
  return{buffer,mimetype:meta.mime_type??'audio/ogg'};
 },
 // The number people message, shown on the settings page; cached because it rarely changes.
 async displayNumber(){
  if(cachedNumber&&Date.now()-cachedNumber.at<3600_000)return cachedNumber.value;
  try{const data=await (await graph(`${env.WHATSAPP_PHONE_NUMBER_ID}?fields=display_phone_number`)).json() as {display_phone_number?:string};
   cachedNumber={value:data.display_phone_number?.replace(/\D/g,'')||null,at:Date.now()};}catch{cachedNumber={value:null,at:Date.now()-3300_000};}
  return cachedNumber.value;
 },
};

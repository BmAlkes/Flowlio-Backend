import OpenAI,{toFile} from 'openai';
import { env } from '../../utils/env.util';
import { meterAI } from '../../services/ai-metering.service';
import { AgentError } from './policy';

export const MAX_AUDIO_BYTES=5*1024*1024;
const MODEL='gpt-4o-mini-transcribe';
// The provider detects the format from the file name, so the extension must match the recorded container.
const extensions:Record<string,string>={'audio/webm':'webm','video/webm':'webm','audio/ogg':'ogg','audio/opus':'ogg','audio/mp4':'m4a','audio/x-m4a':'m4a','audio/m4a':'m4a','audio/aac':'m4a','audio/mpeg':'mp3','audio/mp3':'mp3','audio/wav':'wav','audio/x-wav':'wav','audio/wave':'wav'};
export function audioFileName(mimetype:string){const ext=extensions[mimetype.split(';')[0].trim().toLowerCase()];if(!ext)throw new AgentError(415,'AUDIO_UNSUPPORTED');return `voice.${ext}`;}
type Usage={type:'tokens';input_tokens:number;output_tokens:number;total_tokens:number}|{type:'duration';seconds:number};
// Duration-billed responses are converted at a conservative 25 tokens per second.
export function transcriptionUsage(usage:Usage|undefined,text:string){
 if(usage?.type==='tokens')return{promptTokens:usage.input_tokens,completionTokens:usage.output_tokens,totalTokens:usage.total_tokens};
 const prompt=usage?.type==='duration'?Math.ceil(usage.seconds*25):3000;const completion=Math.ceil(Buffer.byteLength(text,'utf8')/2);
 return{promptTokens:prompt,completionTokens:completion,totalTokens:prompt+completion};
}
export type Audio={buffer:Buffer;mimetype:string};
type Call=(file:Awaited<ReturnType<typeof toFile>>,signal?:AbortSignal)=>Promise<{text:string;usage?:Usage}>;
// Turns a short voice note into text. Every call is metered against the organization's AI quota.
export async function transcribe(audio:Audio,signal?:AbortSignal,call?:Call){
 if(!audio.buffer.length)throw new AgentError(400,'AUDIO_EMPTY');
 if(audio.buffer.length>MAX_AUDIO_BYTES)throw new AgentError(413,'AUDIO_TOO_LARGE');
 const file=await toFile(audio.buffer,audioFileName(audio.mimetype),{type:audio.mimetype.split(';')[0]});
 const invoke=call??(()=>{if(!env.OPEN_AI)throw new AgentError(503,'AI_PROVIDER_UNAVAILABLE');const client=new OpenAI({apiKey:env.OPEN_AI,maxRetries:0,timeout:60_000});
  return (f:typeof file,s?:AbortSignal)=>client.audio.transcriptions.create({file:f,model:MODEL},{signal:s}) as Promise<{text:string;usage?:Usage}>;})();
 const result=await meterAI(MODEL,4000,()=>invoke(file,signal),r=>transcriptionUsage(r.usage,r.text??''),{accounting:'transcription'});
 const text=(result.text??'').trim();if(!text)throw new AgentError(422,'NO_SPEECH');
 return{text:text.slice(0,8000)};
}

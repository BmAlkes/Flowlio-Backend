import { Router,type Request,type RequestHandler,type Response } from 'express';
import { connection } from '../../configs/connection.config';
import { env } from '../../utils/env.util';
import { logger } from '../../utils/logger.util';
import { isAuthenticated } from '../../middlewares/auth.middleware';
import { requirePlanFeature } from '../../middlewares/plan-feature.middleware';
import { resolveSessionUser } from '../../security/session-access';
import { hasFeatureAccess } from '../../utils/plan-access.util';
import { enqueue } from '../../services/jobs/queue';
import { AgentError,authorize } from '../agent/policy';
import { createAgent } from '../agent/service';
import { generate } from '../agent/provider';
import { syncEventsToGoogle } from '../agent/calendar-sync';
import { transcribe } from '../agent/transcribe';
import { cloudApi,inboundMessages,validSignature,whatsappConfigured,type Inbound } from './cloud-api';
import { createWhatsApp,type WhatsAppActor } from './service';

export const whatsapp=createWhatsApp(connection,{
 api:cloudApi,
 agent:createAgent(connection,generate,{eventsCreated:syncEventsToGoogle}) as any,
 transcribe:audio=>transcribe(audio),
 actor:async userId=>await resolveSessionUser(userId) as unknown as WhatsAppActor,
 hasAssistant:async organizationId=>(await hasFeatureAccess(organizationId,'aiAssist' as any)).hasAccess,
});
// Worker entry point for one queued message.
export const handleWhatsAppMessage=(payload:Inbound)=>whatsapp.handle(payload);

// Meta calls GET once to verify the URL, then POSTs signed message batches.
// Each message is queued under its WhatsApp id, so Meta's retries are not processed twice.
export function whatsappWebhookVerify(req:Request,res:Response){
 if(whatsappConfigured()&&req.query['hub.mode']==='subscribe'&&req.query['hub.verify_token']===env.WHATSAPP_VERIFY_TOKEN&&typeof req.query['hub.challenge']==='string'){res.status(200).type('text/plain').send(req.query['hub.challenge']);return;}
 res.sendStatus(403);
}
export async function whatsappWebhook(req:Request,res:Response){
 if(!whatsappConfigured()){res.sendStatus(404);return;}
 const raw=Buffer.isBuffer(req.body)?req.body:Buffer.alloc(0);
 if(!validSignature(raw,req.get('x-hub-signature-256'),env.WHATSAPP_APP_SECRET!)){res.sendStatus(401);return;}
 let body:unknown;try{body=JSON.parse(raw.toString('utf8'));}catch{res.sendStatus(400);return;}
 try{
  for(const message of inboundMessages(body,env.WHATSAPP_PHONE_NUMBER_ID!))await enqueue(connection,'whatsapp-message','whatsapp:'+message.id,message);
  res.sendStatus(200);
 }catch(e){logger.error({name:(e as Error)?.name},'WhatsApp webhook could not queue messages');res.sendStatus(500);}
}

export const whatsappRoutes=Router();
const internal:RequestHandler=(req,res,next)=>{try{authorize(req.user as any);next();}catch{res.status(403).json({success:false,code:'AGENT_INTERNAL_ONLY'});}};
whatsappRoutes.use(isAuthenticated,internal,requirePlanFeature('aiAssist'));
const route=(fn:(req:Request)=>Promise<unknown>):RequestHandler=>async(req,res)=>{
 res.setHeader('Cache-Control','no-store');
 if(!whatsappConfigured()){res.json({success:true,data:{configured:false}});return;}
 try{res.json({success:true,data:{configured:true,number:await cloudApi.displayNumber(),...await fn(req) as object}});}
 catch(e){if(e instanceof AgentError){res.status(e.status).json({success:false,code:e.code});return;}logger.error({name:(e as Error)?.name},'WhatsApp link request failed');res.status(500).json({success:false,code:'WHATSAPP_FAILED'});}
};
whatsappRoutes.get('/link',route(req=>whatsapp.status(req.user as any)));
whatsappRoutes.post('/link',route(async req=>{const started=await whatsapp.startLink(req.user as any,String(req.body?.language??''));return{...await whatsapp.status(req.user as any),code:started.code,pending:{expiresAt:started.expiresAt}};}));
whatsappRoutes.delete('/link',route(req=>whatsapp.unlink(req.user as any)));

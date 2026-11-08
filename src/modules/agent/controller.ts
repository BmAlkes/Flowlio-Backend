import { Router,type RequestHandler } from 'express';
import { connection } from '../../configs/connection.config';
import { isAuthenticated } from '../../middlewares/auth.middleware';
import { requirePlanFeature } from '../../middlewares/plan-feature.middleware';
import { checkAITokenLimit } from '../../middlewares/ai-limit.middleware';
import { logAIUsage } from '../../middlewares/ai-usage-log.middleware';
import { aiRateLimit } from '../../middlewares/ai-rate-limit.middleware';
import { logger } from '../../utils/logger.util';
import { AgentError,authorize,scopeInput } from './policy';
import { capture,projectVisible } from './context';
import { createAgent } from './service';
import { generate } from './provider';
import { syncEventsToGoogle } from './calendar-sync';
import multer from 'multer';
import { MAX_AUDIO_BYTES,transcribe } from './transcribe';
export const agentRoutes=Router();const service=createAgent(connection,generate,{eventsCreated:syncEventsToGoogle});
const internal:RequestHandler=(req,res,next)=>{try{authorize(req.user!);next();}catch{res.status(403).json({success:false,code:'AGENT_INTERNAL_ONLY'});}};
agentRoutes.use(isAuthenticated,internal,requirePlanFeature('aiAssist'));
const route=(fn:(req:any,signal:AbortSignal)=>Promise<unknown>):RequestHandler=>async(req,res)=>{
 res.setHeader('Cache-Control','no-store');const controller=new AbortController();const abort=()=>{if(!res.writableEnded)controller.abort();};res.on('close',abort);
 try{res.json({success:true,data:await fn(req,controller.signal)});}catch(e){if(e instanceof AgentError){res.status(e.status).json({success:false,code:e.code});return;}logger.error({code:(e as any)?.code},'Agent request failed');res.status(503).json({success:false,code:'AGENT_FAILED'});}finally{res.off('close',abort);}
};
// Voice notes stay in memory: they are forwarded to the transcription model and never stored.
const audio=multer({storage:multer.memoryStorage(),limits:{fileSize:MAX_AUDIO_BYTES,files:1,fields:0}}).single('audio');
const voiceUpload:RequestHandler=(req,res,next)=>audio(req,res,(e:unknown)=>{if(!e){next();return;}const large=e instanceof multer.MulterError&&e.code==='LIMIT_FILE_SIZE';res.status(large?413:400).json({success:false,code:large?'AUDIO_TOO_LARGE':'INVALID_INPUT'});});
agentRoutes.post('/transcribe',aiRateLimit,checkAITokenLimit,voiceUpload,logAIUsage,route((req,signal)=>{const file=req.file;if(!file)throw new AgentError(400,'AUDIO_EMPTY');return transcribe({buffer:file.buffer,mimetype:file.mimetype},signal);}));
agentRoutes.get('/',route(req=>service.list(req.user)));
agentRoutes.get('/context',route(async req=>{const parsed=scopeInput.safeParse(req.query);if(!parsed.success)throw new AgentError(400,'INVALID_INPUT');const ctx=await capture(connection,req.user,parsed.data);// Broad areas preload no records, so the project picker gets its own short list of visible projects.
 const projects=(await connection.query(`select p.id,p.name title from projects p where ${projectVisible} order by p.updated_at desc,p.id limit 30`,[req.user.organizationId,req.user.id])).rows;
 return{sources:ctx.sources.map(({key,kind,id,title,href})=>({key,kind,id,title,href})),projects,members:ctx.members,capabilities:ctx.capabilities,limits:ctx.limits};}));
agentRoutes.get('/:id',route(req=>service.detail(req.user,req.params.id)));
agentRoutes.post('/',aiRateLimit,checkAITokenLimit,logAIUsage,route((req,signal)=>service.create(req.user,req.body,signal)));
agentRoutes.post('/:id/apply',route(req=>service.apply(req.user,req.params.id,req.body)));
agentRoutes.post('/:id/cancel',route(req=>service.cancel(req.user,req.params.id)));

import { Router,type RequestHandler } from 'express';
import { connection } from '../../configs/connection.config';
import { isAuthenticated } from '../../middlewares/auth.middleware';
import { requirePlanFeature } from '../../middlewares/plan-feature.middleware';
import { checkAITokenLimit } from '../../middlewares/ai-limit.middleware';
import { logAIUsage } from '../../middlewares/ai-usage-log.middleware';
import { aiRateLimit } from '../../middlewares/ai-rate-limit.middleware';
import { logger } from '../../utils/logger.util';
import { AgentError,authorize,scopeInput } from './policy';
import { capture } from './context';
import { createAgent } from './service';
import { generate } from './provider';
export const agentRoutes=Router();const service=createAgent(connection,generate);
const internal:RequestHandler=(req,res,next)=>{try{authorize(req.user!);next();}catch{res.status(403).json({success:false,code:'AGENT_INTERNAL_ONLY'});}};
agentRoutes.use(isAuthenticated,internal,requirePlanFeature('aiAssist'));
const route=(fn:(req:any,signal:AbortSignal)=>Promise<unknown>):RequestHandler=>async(req,res)=>{
 res.setHeader('Cache-Control','no-store');const controller=new AbortController();const abort=()=>{if(!res.writableEnded)controller.abort();};res.on('close',abort);
 try{res.json({success:true,data:await fn(req,controller.signal)});}catch(e){if(e instanceof AgentError){res.status(e.status).json({success:false,code:e.code});return;}logger.error({code:(e as any)?.code},'Agent request failed');res.status(503).json({success:false,code:'AGENT_FAILED'});}finally{res.off('close',abort);}
};
agentRoutes.get('/',route(req=>service.list(req.user)));
agentRoutes.get('/context',route(async req=>{const parsed=scopeInput.safeParse(req.query);if(!parsed.success)throw new AgentError(400,'INVALID_INPUT');const ctx=await capture(connection,req.user,parsed.data);return{sources:ctx.sources.map(({key,kind,id,title,href})=>({key,kind,id,title,href})),members:ctx.members,capabilities:ctx.capabilities,limits:ctx.limits};}));
agentRoutes.get('/:id',route(req=>service.detail(req.user,req.params.id)));
agentRoutes.post('/',aiRateLimit,checkAITokenLimit,logAIUsage,route((req,signal)=>service.create(req.user,req.body,signal)));
agentRoutes.post('/:id/apply',route(req=>service.apply(req.user,req.params.id,req.body)));
agentRoutes.post('/:id/cancel',route(req=>service.cancel(req.user,req.params.id)));

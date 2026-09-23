import { Router, type RequestHandler } from "express";
import { connection } from "../configs/connection.config";
import { isAuthenticated } from "../middlewares/auth.middleware";
import { requireOrgOwnerAccess } from "../middlewares/role.middleware";
import { createAttention, AttentionError } from "../modules/attention/service";
import { logger } from "../utils/logger.util";
const service=createAttention(connection),router=Router();
const handle=(action:'list'|'members'|'settings'|'triage'):RequestHandler=>async(req,res)=>{try{
 const data=action==='list'?await service.list(req.user!,req.query):action==='members'?await service.members(req.user!,req.query.search):await service[action](req.user!,req.body);
 res.json({success:true,data});
}catch(error){if(error instanceof AttentionError){res.status(error.status).json({success:false,code:error.code});return;}logger.error({error},'Attention request failed');res.status(500).json({success:false,code:'ATTENTION_FAILED'});}};
router.use(isAuthenticated,requireOrgOwnerAccess);router.get('/',handle('list'));router.get('/members',handle('members'));router.put('/settings',handle('settings'));router.put('/triage',handle('triage'));export default router;

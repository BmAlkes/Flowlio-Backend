import { Router, type RequestHandler } from "express";
import { connection } from "../../configs/connection.config";
import { createScopeChanges, ScopeError } from "./service";
import { logger } from "../../utils/logger.util";
const service=createScopeChanges(connection);
export const scopeChangesRoutes=Router({mergeParams:true});
const handler=(action:'list'|'create'|'transition'):RequestHandler=>async(req,res)=>{
 res.setHeader('Cache-Control','no-store');
 try{const result=action==='list'?await service.list(req.user!,req.params.projectId,req.query):action==='create'?await service.create(req.user!,req.params.projectId,req.body):await service.transition(req.user!,req.params.projectId,req.params.changeId,req.body);res.json({success:true,data:result});}
 catch(error){if(error instanceof ScopeError){res.status(error.status).json({success:false,code:error.code});return;}logger.error({error},'Scope change failed');res.status(500).json({success:false,code:'SCOPE_FAILED'});}
};
scopeChangesRoutes.get('/',handler('list'));
scopeChangesRoutes.post('/',handler('create'));
scopeChangesRoutes.post('/:changeId',handler('transition'));

import { Router, type RequestHandler } from 'express';
import { connection } from '../../configs/connection.config';
import { createRetainers, RetainerError } from './service';
import { logger } from '../../utils/logger.util';
const service=createRetainers(connection);
export const retainerRoutes=Router({mergeParams:true});
const handler=(action:'list'|'create'|'detail'|'candidates'|'mutate'):RequestHandler=>async(req,res)=>{
 res.setHeader('Cache-Control','no-store');
 try{const a=req.user!,cl=req.params.clientId,id=req.params.retainerId;
  const data=action==='list'?await service.list(a,cl,req.query):action==='create'?await service.create(a,cl,req.body):action==='detail'?await service.detail(a,cl,id,req.query):action==='candidates'?await service.candidates(a,cl,id,req.params.periodId,req.query):await service.mutate(a,cl,id,req.body);res.json({success:true,data});
 }catch(error){if(error instanceof RetainerError){res.status(error.status).json({success:false,code:error.code});return;}const e=error as {code?:string};if(['23505','23503','23514','40001','40P01'].includes(e.code??'')){res.status(409).json({success:false,code:'DATA_CHANGED'});return;}logger.error({error},'Retainer operation failed');res.status(500).json({success:false,code:'RETAINER_FAILED'});}
};
retainerRoutes.get('/',handler('list'));retainerRoutes.post('/',handler('create'));
retainerRoutes.get('/:retainerId',handler('detail'));retainerRoutes.post('/:retainerId',handler('mutate'));
retainerRoutes.get('/:retainerId/periods/:periodId/time',handler('candidates'));

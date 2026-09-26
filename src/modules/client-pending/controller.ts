import { Router,type RequestHandler } from 'express';
import { connection } from '../../configs/connection.config';
import { isAuthenticated } from '../../middlewares/auth.middleware';
import { logger } from '../../utils/logger.util';
import { createClientPending,PendingError } from './service';
const service=createClientPending(connection);export const clientPendingRoutes=Router();clientPendingRoutes.use(isAuthenticated);
const handler=(action:'list'|'create'|'options'|'detail'|'files'|'mutate'):RequestHandler=>async(req,res)=>{
 res.setHeader('Cache-Control','no-store');try{const a=req.user!,id=String(req.params.id);
  const data=action==='list'?await service.list(a,req.query):action==='create'?await service.create(a,req.body):action==='options'?await service.options(a,String(req.params.projectId)):action==='detail'?await service.detail(a,id,req.query):action==='files'?await service.files(a,id):await service.mutate(a,id,req.body);res.json({success:true,data});
 }catch(error){if(error instanceof PendingError){res.status(error.status).json({success:false,code:error.code});return;}logger.error({error},'Client pending request failed');res.status(500).json({success:false,code:'PENDING_FAILED'});}
};
clientPendingRoutes.get('/',handler('list'));clientPendingRoutes.post('/',handler('create'));clientPendingRoutes.get('/options/:projectId',handler('options'));
clientPendingRoutes.get('/:id/files',handler('files'));clientPendingRoutes.get('/:id',handler('detail'));clientPendingRoutes.post('/:id',handler('mutate'));

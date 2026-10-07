import type { RequestHandler } from 'express';
import { ZodError } from 'zod';
import { connection } from '../../configs/connection.config';
import { canCreateInvoice } from '../../utils/plan-access.util';
import { logger } from '../../utils/logger.util';
import { createBillingSources } from './billing';
import { RetainerError } from './policy';
const service=createBillingSources(connection,canCreateInvoice);
export const billingSources=(action:'list'|'prepare'):RequestHandler=>async(req,res)=>{
 try{const data=action==='list'?await service.list(req.user!,req.query):await service.prepare(req.user!,req.body);res.json({success:true,data});}
 catch(error){if(error instanceof RetainerError){res.status(error.status).json({success:false,code:error.code});return;}
  if(error instanceof ZodError){res.status(400).json({success:false,code:'INVALID_INPUT'});return;}
  logger.error({error},'Could not prepare invoice');res.status(500).json({success:false,code:'BILLING_FAILED'});
 }
};

import type { RequestHandler } from "express";
import { connection } from "../../configs/connection.config";
import { createProfitability, ProfitabilityError } from "./service";
import { logger } from "../../utils/logger.util";
const service=createProfitability(connection);
const handler=(save:boolean):RequestHandler=>async(req,res)=>{
 try{const id=String(req.params.projectId);const data=save?await service.save(req.user!,id,req.body):await service.report(req.user!,id,req.query);res.json({success:true,data});}
 catch(error){if(error instanceof ProfitabilityError){res.status(error.status).json({success:false,code:error.code});return;}logger.error({error},"Profitability request failed");res.status(500).json({success:false,code:"PROFITABILITY_FAILED"});}
};
export const getProfitability=handler(false);
export const saveFinancialSettings=handler(true);

import type {RequestHandler} from "express";
import {connection} from "../../configs/connection.config";
import {logger} from "../../utils/logger.util";
import {createDeliveryReviews,DeliveryError} from "./service";
const service=createDeliveryReviews(connection);
const handler=(action:'list'|'request'|'decide'):RequestHandler=>async(req,res)=>{
 try{
  const projectId=String(req.params.projectId);
  const data=action==='list'?await service.list(req.user!,projectId,req.query.page??1,req.query.reviewId):action==='request'?await service.request(req.user!,projectId,req.body):await service.decide(req.user!,projectId,String(req.params.reviewId),req.body);
  res.json({success:true,data});
 }catch(error){if(error instanceof DeliveryError){res.status(error.status).json({success:false,code:error.code});return;}logger.error({error},'Delivery review failed');res.status(500).json({success:false,code:'DELIVERY_FAILED'});}
};
export const listDeliveryReviews=handler('list');export const requestDeliveryReview=handler('request');export const decideDeliveryReview=handler('decide');

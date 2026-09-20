import { Router } from "express";
import { z } from "zod";
import { isAuthenticated } from "@/middlewares/auth.middleware";
import { requireOrgOwnerAccess } from "@/middlewares/role.middleware";
import { observability } from "@/modules/observability/runtime";

const router=Router();
const buckets=new Map<string,{ until:number; count:number }>();
const eventSchema=z.object({code:z.enum(["UI_ERROR","REACT_ERROR","NETWORK_ERROR"]),
  route:z.enum(["auth","dashboard","projects","clients","tasks","time","billing","settings","public","unknown"]),
  release:z.string().regex(/^[a-zA-Z0-9._-]{1,64}$/)}).strict();
router.post("/events",isAuthenticated,async(req,res)=>{
  const now=Date.now();
  for(const [key,bucket] of buckets) if(bucket.until<=now) buckets.delete(key);
  const key=req.user!.id;
  const bucket=buckets.get(key) ?? {until:now+60000,count:0};
  if(bucket.count>=10 || (!buckets.has(key) && buckets.size>=10000)) { res.status(429).json({success:false,code:"RATE_LIMITED"});return; }
  bucket.count++; buckets.set(key,bucket);
  const input=eventSchema.safeParse(req.body);
  if(!input.success) {res.status(400).json({success:false,code:"INVALID_TELEMETRY"});return;}
  const saved=await observability.record({...input.data,source:"ui",organizationId:req.user?.organizationId,correlationId:res.locals.correlationId});
  res.status(saved?202:503).json({success:saved,correlationId:res.locals.correlationId});
});
router.get("/summary",isAuthenticated,requireOrgOwnerAccess,async(req,res)=>{
  if(!req.user?.organizationId && !req.user?.isSuperAdmin) {res.status(400).json({success:false,message:"Organization context required"});return;}
  try {res.json({success:true,data:await observability.summary(req.user!.isSuperAdmin && req.query.scope === "global" ? null : req.user!.organizationId ?? null)});}
  catch {res.status(503).json({success:false,message:"Operational history is temporarily unavailable"});}
});
export default router;

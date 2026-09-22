import { setAuditContext } from "../audit/context";
import { createHash, randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { z } from "zod";
import { canReadProject, canManageClients, type Actor } from "../../security/resource-policy";
export class DeliveryError extends Error { constructor(public status:number,public code:string){super(code);} }
const identifier=z.string().min(1).max(128);
const version=z.string().regex(/^[a-f0-9]{64}$/);
export const requestInput=z.object({milestoneId:identifier,version,note:z.string().trim().min(1).max(4000)}).strict();
export const decisionInput=z.object({version,state:z.enum(["approved","changes_requested"]),comment:z.string().trim().max(2000).default("")}).strict().refine(data=>data.state!=="changes_requested"||data.comment.length>0);
export function milestoneVersion(row:Record<string,unknown>){return createHash("sha256").update(JSON.stringify([row.id,row.title,row.status,row.due_date,row.updated_at])).digest("hex");}
export function createDeliveryReviews(pool:Pool){
 async function authorize(client:PoolClient,actor:Actor,projectId:string,lock=false){
  if(!actor.organizationId)throw new DeliveryError(403,"FORBIDDEN");
  const project=(await client.query(`select p.id,p.name,p.organization_id as "organizationId",p.created_by as "createdBy",p.assigned_to as "assignedTo",p.visibility,p.client_id as "clientId",c.user_id as "clientUserId"
   from projects p left join clients c on c.id=p.client_id and c.organization_id=p.organization_id where p.id=$1 and p.organization_id=$2 ${lock?'for share of p':''}`,[projectId,actor.organizationId])).rows[0];
  const ownClient=project?.clientUserId===actor.id?project.clientId:undefined;
  if(!project||!canReadProject(actor,project,ownClient))throw new DeliveryError(404,"PROJECT_NOT_FOUND");
  return project;
 }
 async function milestone(client:PoolClient,actor:Actor,projectId:string,id:string|null,lock=false){
  const row=(await client.query(`select * from project_milestones where id=$1 and project_id=$2 and organization_id=$3 ${lock?'for update':''}`,[id,projectId,actor.organizationId])).rows[0];
  return row;
 }
 async function activity(client:PoolClient,actor:Actor,projectId:string,id:string,action:string){
  await client.query(`insert into recent_activities(id,organization_id,user_id,actor_id,type,action,resource,resource_id,message,metadata,created_at)
   values($1,$2,$3,$3,'delivery',$4,'project',$5,'Delivery review updated',$6,now())`,[randomUUID(),actor.organizationId,actor.id,action,projectId,JSON.stringify({reviewId:id,projectId})]);
 }
 async function list(actor:Actor,projectId:string,pageRaw:unknown=1){
  const page=z.coerce.number().int().min(1).max(100000).safeParse(pageRaw);if(!page.success)throw new DeliveryError(400,"INVALID_PAGE");
  const client=await pool.connect();try{
   const project=await authorize(client,actor,projectId);const canRequest=canManageClients(actor);
   const filter=actor.role==='client'?project.clientId:null;
   const rows=(await client.query(`select r.*,u.name as decided_name from delivery_reviews r left join users u on u.id=r.decided_by where r.project_id=$1 and r.organization_id=$2 and ($3::text is null or r.client_id=$3) order by r.requested_at desc,r.id desc limit 26 offset $4`,[projectId,actor.organizationId,filter,(page.data-1)*25])).rows;
   const milestones=(await client.query('select * from project_milestones where project_id=$1 and organization_id=$2 order by position,id limit 201',[projectId,actor.organizationId])).rows;
   const reviews=[];
   for(const row of rows.slice(0,25)){
    const current=milestones.find(m=>m.id===row.milestone_id)??await milestone(client,actor,projectId,row.milestone_id);
    const stale=!current||milestoneVersion(current)!==row.source_version||row.client_id!==project.clientId;
    reviews.push({id:row.id,milestoneId:row.milestone_id,title:row.title,dueDate:row.due_date,note:row.note,version:row.source_version,state:row.state,requestedAt:row.requested_at,decidedAt:row.decided_at,decidedBy:row.decided_name,comment:row.comment,stale:row.state==='pending'&&stale,canDecide:actor.role==='client'&&row.state==='pending'&&!stale});
   }
   return {reviews,page:page.data,hasMore:rows.length>25,canRequest,hasClient:!!project.clientId,milestonesTruncated:canRequest&&milestones.length>200,milestones:canRequest?milestones.slice(0,200).map(m=>({id:m.id,title:m.title,version:milestoneVersion(m)})):[]};
  }finally{client.release();}
 }
 async function request(actor:Actor,projectId:string,raw:unknown){
  if(!canManageClients(actor))throw new DeliveryError(403,"FORBIDDEN");
  const parsed=requestInput.safeParse(raw);if(!parsed.success)throw new DeliveryError(400,"INVALID_REVIEW");
  const input=parsed.data,client=await pool.connect();try{
   await client.query('begin');await setAuditContext(client,{organizationId:actor.organizationId!,actorKind:'human',actorId:actor.id});const project=await authorize(client,actor,projectId,true);
   if(!project.clientId)throw new DeliveryError(409,"CLIENT_REQUIRED");
   const current=await milestone(client,actor,projectId,input.milestoneId,true);
   if(!current)throw new DeliveryError(404,"MILESTONE_NOT_FOUND");
   if(milestoneVersion(current)!==input.version)throw new DeliveryError(409,"SOURCE_CHANGED");
   const existing=(await client.query('select id from delivery_reviews where project_id=$1 and milestone_id=$2 and client_id=$3 and source_version=$4',[projectId,input.milestoneId,project.clientId,input.version])).rows[0];
   if(existing){await client.query('commit');return{id:existing.id,existing:true};}
   const id=randomUUID();await client.query(`insert into delivery_reviews(id,project_id,organization_id,milestone_id,client_id,source_version,title,due_date,note,requested_by)
    values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,[id,projectId,actor.organizationId,input.milestoneId,project.clientId,input.version,current.title,current.due_date,input.note,actor.id]);
   await activity(client,actor,projectId,id,'review_requested');await client.query('commit');return{id,existing:false};
  }catch(error){await client.query('rollback');throw error;}finally{client.release();}
 }
 async function decide(actor:Actor,projectId:string,reviewId:string,raw:unknown){
  if(actor.role!=='client')throw new DeliveryError(403,"CLIENT_ONLY");
  const parsed=decisionInput.safeParse(raw);if(!parsed.success)throw new DeliveryError(400,"INVALID_DECISION");
  const input=parsed.data,client=await pool.connect();try{
   await client.query('begin');await setAuditContext(client,{organizationId:actor.organizationId!,actorKind:'human',actorId:actor.id});const project=await authorize(client,actor,projectId,true);
   const row=(await client.query('select * from delivery_reviews where id=$1 and project_id=$2 and organization_id=$3 and client_id=$4',[reviewId,projectId,actor.organizationId,project.clientId])).rows[0];
   if(!row)throw new DeliveryError(404,"REVIEW_NOT_FOUND");
   const current=await milestone(client,actor,projectId,row.milestone_id,true);
   const locked=(await client.query('select * from delivery_reviews where id=$1 for update',[reviewId])).rows[0];
   if(locked.source_version!==input.version)throw new DeliveryError(409,"SOURCE_CHANGED");
   if(locked.state!=='pending'){
    if(locked.state===input.state&&locked.comment===input.comment&&locked.decided_by===actor.id){await client.query('commit');return{id:reviewId,existing:true};}
    throw new DeliveryError(409,"ALREADY_DECIDED");
   }
   if(!current||milestoneVersion(current)!==input.version)throw new DeliveryError(409,"SOURCE_CHANGED");
   await client.query('update delivery_reviews set state=$2,comment=$3,decided_by=$4,decided_at=now() where id=$1',[reviewId,input.state,input.comment,actor.id]);
   await activity(client,actor,projectId,reviewId,input.state==='approved'?'delivery_approved':'delivery_changes_requested');
   await client.query('commit');return{id:reviewId,existing:false};
  }catch(error){await client.query('rollback');throw error;}finally{client.release();}
 }
 return{list,request,decide};
}

import type { PoolClient } from 'pg';
import { creatorActive, events, member, plan, type Rule } from './policy';
export type WorkflowSender=(channel:string,recipient:{id:string;email:string;name:string},content:{title:string;message:string})=>Promise<boolean>;
// Called only by a non-transactional durable job. Unconfirmed provider results are never automatically resent.
export async function deliverWorkflow(c:PoolClient,executionId:string,send:WorkflowSender){
 const x=(await c.query('select * from workflow_executions where id=$1',[executionId])).rows[0];if(!x||x.outcome!=='queued')return;
 const r=(await c.query('select * from workflow_rules where id=$1',[x.rule_id])).rows[0] as Rule|undefined;
 if(!r)return;
 const e=(await events(c,r,false,x.event_id))[0];
 const reason=!r.enabled?'delivery_cancelled':!await creatorActive(c,r)?'permission_revoked':!e?'source_changed':await plan(c,r,e);
 if(reason!=='ready'){await c.query('update workflow_executions set outcome=$2 where id=$1',[x.id,reason]);return;}
 const recipient=await member(c,r.organization_id,r.recipient_id);
 if(!recipient){await c.query("update workflow_executions set outcome='recipient_unavailable' where id=$1",[x.id]);return;}
 if(!await send(r.channel,recipient,{title:r.title,message:r.message}))throw new Error('Workflow delivery unconfirmed');
 // The queue commits completed after this returns. History does not report sent before that acknowledgement.
}

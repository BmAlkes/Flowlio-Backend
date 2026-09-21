import type {Pool} from "pg";
import {z} from "zod";
import {canManageClients,type Actor} from "../../security/resource-policy";
import {allocateMinutes,calendarDate,weekBounds} from "./calculation";
export class CapacityError extends Error{constructor(public status:number,public code:string){super(code);}}
const queryInput=z.object({week:calendarDate,team:z.string().max(80).optional(),userId:z.string().max(128).optional()}).strict();
const settingsInput=z.object({weeklyMinutes:z.number().int().min(0).max(10080).nullable(),team:z.string().trim().max(80)}).strict();
function authorize(actor:Actor){if(!actor.organizationId||!canManageClients(actor))throw new CapacityError(403,'FORBIDDEN');}
type TaskSummary={id:string;title:string;projectId:string;projectName:string;blocked:boolean;minutes:number;unestimated:boolean;unscheduled:boolean};
export function createCapacity(pool:Pool){
 async function save(actor:Actor,userId:string,raw:unknown){
  authorize(actor);const parsed=settingsInput.safeParse(raw);if(!parsed.success)throw new CapacityError(400,'INVALID_CAPACITY');
  const client=await pool.connect();try{await client.query('begin');
   const member=await client.query("select u.id from users u join user_organizations m on m.user_id=u.id where m.organization_id=$1 and u.id=$2 and m.status='active' and u.status='active' and u.role in ('user','operator','viewer') for share of u,m",[actor.organizationId,userId]);
   if(!member.rowCount)throw new CapacityError(404,'MEMBER_NOT_FOUND');
   await client.query('insert into member_capacity(organization_id,user_id,weekly_minutes,team,updated_by) values($1,$2,$3,$4,$5) on conflict(organization_id,user_id) do update set weekly_minutes=excluded.weekly_minutes,team=excluded.team,updated_by=excluded.updated_by,updated_at=now()',[actor.organizationId,userId,parsed.data.weeklyMinutes,parsed.data.team,actor.id]);
   await client.query('commit');return parsed.data;
  }catch(error){await client.query('rollback');throw error;}finally{client.release();}
 }
 async function report(actor:Actor,raw:unknown){
  authorize(actor);const parsed=queryInput.safeParse(raw);if(!parsed.success)throw new CapacityError(400,'INVALID_WEEK');
  const input=parsed.data,{from,to}=weekBounds(input.week),client=await pool.connect();try{
   await client.query('begin isolation level repeatable read read only');
   const members=(await client.query(`select distinct u.id,u.name,c.weekly_minutes,coalesce(c.team,'') as team from users u join user_organizations m on m.user_id=u.id
    left join member_capacity c on c.user_id=u.id and c.organization_id=m.organization_id
    where m.organization_id=$1 and m.status='active' and u.status='active' and u.role in ('user','operator','viewer') order by u.name,u.id limit 501`,[actor.organizationId])).rows;
   if(members.length>500)throw new CapacityError(400,'TEAM_TOO_LARGE');
   const tasks=(await client.query(`select t.id,t.title,t.assigned_to,t.estimated_hours,to_char(t.start_date,'YYYY-MM-DD') as start_date,to_char(t.end_date,'YYYY-MM-DD') as end_date,p.id as project_id,p.name as project_name,
    ((p.created_by=$2 or p.assigned_to=$2 or p.visibility='public') and (t.created_by=$2 or t.assigned_to=$2 or t.visibility='public')) as visible,
    ((nullif(t.start_after,'') is not null and not exists(select 1 from tasks d join projects dp on dp.id=d.project_id where d.id=t.start_after and dp.organization_id=$1 and d.status='completed'))
     or exists(select 1 from tasks d join projects dp on dp.id=d.project_id where d.finish_before=t.id and dp.organization_id=$1 and d.status is distinct from 'completed')) as blocked
    from tasks t join projects p on p.id=t.project_id where p.organization_id=$1 and t.status is distinct from 'completed'
    and (t.start_date is null or t.end_date is null or t.start_date>t.end_date or (t.start_date<$4::date+interval '1 day' and t.end_date>=$3::date)) order by t.end_date nulls last,t.id limit 10001`,[actor.organizationId,actor.id,from,to])).rows;
   if(tasks.length>10000)throw new CapacityError(400,'WORKLOAD_TOO_LARGE');
   const summaries=new Map<string,TaskSummary[]>();let hiddenTasks=0,unassigned=0;
   for(const task of tasks){if(!task.visible){hiddenTasks++;continue;}const member=members.find(m=>m.id===task.assigned_to);if(!member){unassigned++;continue;}
    const value={id:task.id,title:task.title,projectId:task.project_id,projectName:task.project_name,blocked:task.blocked,...allocateMinutes(task.estimated_hours,task.start_date,task.end_date,from)};
    const list=summaries.get(member.id)??[];list.push(value);summaries.set(member.id,list);
   }
   const rows=members.map(member=>{
    const list=summaries.get(member.id)??[],plannedMinutes=list.reduce((sum,t)=>sum+t.minutes,0),unestimated=list.filter(t=>t.unestimated).length,unscheduled=list.filter(t=>t.unscheduled).length;
    const availableMinutes=member.weekly_minutes??null,partial=hiddenTasks>0||unestimated>0||unscheduled>0;
    return{id:member.id,name:member.name,team:member.team,availableMinutes,plannedMinutes,unestimated,unscheduled,blocked:list.filter(t=>t.blocked).length,taskCount:list.length,tasks:list.slice(0,10),partial,overloaded:availableMinutes!=null&&plannedMinutes>availableMinutes,remainingMinutes:!partial&&availableMinutes!=null?availableMinutes-plannedMinutes:null};
   }).filter(member=>(!input.team||member.team===input.team)&&(!input.userId||member.id===input.userId));
   await client.query('commit');return{weekStart:from,weekEnd:to,timezone:'UTC',teams:[...new Set(members.map(m=>m.team).filter(Boolean))].sort(),members:rows,hiddenTasks,unassigned};
  }catch(error){await client.query('rollback');throw error;}finally{client.release();}
 }
 return{report,save};
}

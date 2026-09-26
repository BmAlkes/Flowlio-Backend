import {allocateMinutes,weekBounds} from '../capacity/calculation';
export const addDays=(date:string,n:number)=>new Date(Date.parse(date+'T00:00:00Z')+n*86400000).toISOString().slice(0,10);
export type Absence={id:string;userId:string;startDate:string;endDate:string;kind:string;revision:number};
export function availability(weekly:number|null,rows:Absence[],week:string){
 if(weekly==null)return{availableMinutes:null,absenceMinutes:null};
 const {from,to}=weekBounds(week),days=new Set<string>();
 for(const r of rows)for(let d=r.startDate<from?from:r.startDate;d<=r.endDate&&d<=to;d=addDays(d,1))days.add(d);
 const absenceMinutes=Math.round(weekly*days.size/7);return{availableMinutes:weekly-absenceMinutes,absenceMinutes};
}
export type Member={id:string;name:string;weeklyMinutes:number|null;team:string};
export type Work={id:string;title:string;projectId:string;projectName:string;assignedTo:string|null;startDate:string|null;endDate:string|null;estimatedHours:string|null;blocked:boolean};
export type Base={members:Member[];tasks:Work[];absences:Absence[];hiddenTasks:number;excludedParents:number};
export type Change={key:string;type:'task'|'proposal';taskId?:string;title?:string;assignedTo:string|null;startDate:string;endDate:string;estimatedMinutes?:number|null};
function measure(base:Base,tasks:Work[],week:string){
 let unassigned=0;const groups=new Map<string,Work[]>();
 for(const t of tasks){if(t.startDate&&t.endDate&&t.startDate<=t.endDate&&(t.endDate<week||t.startDate>addDays(week,6)))continue;
  if(!base.members.some(m=>m.id===t.assignedTo)){unassigned++;continue;}const list=groups.get(t.assignedTo!)??[];list.push(t);groups.set(t.assignedTo!,list);
 }
 return{unassigned,members:base.members.map(m=>{const list=groups.get(m.id)??[],values=list.map(t=>allocateMinutes(t.estimatedHours,t.startDate,t.endDate,week));
  const plannedMinutes=values.reduce((sum,v)=>sum+v.minutes,0),unestimated=values.filter(v=>v.unestimated).length,unscheduled=values.filter(v=>v.unscheduled).length;
  const {availableMinutes,absenceMinutes}=availability(m.weeklyMinutes,base.absences.filter(a=>a.userId===m.id),week),partial=base.hiddenTasks>0||unassigned>0||unestimated>0||unscheduled>0;
  return{id:m.id,name:m.name,team:m.team,plannedMinutes,availableMinutes,absenceMinutes,partial,unestimated,unscheduled,blocked:list.filter(t=>t.blocked).length,remainingMinutes:partial||availableMinutes==null?null:availableMinutes-plannedMinutes,overloaded:availableMinutes!=null&&plannedMinutes>availableMinutes};
 })};
}
export function compare(base:Base,changes:Change[],week:string,weeks:number){
 const tasks=base.tasks.map(t=>{const change=changes.find(c=>c.type==='task'&&c.taskId===t.id);return change?{...t,assignedTo:change.assignedTo,startDate:change.startDate,endDate:change.endDate}:t;});
 for(const c of changes.filter(c=>c.type==='proposal'))tasks.push({id:c.key,title:c.title!,projectId:'',projectName:c.title!,assignedTo:c.assignedTo,startDate:c.startDate,endDate:c.endDate,estimatedHours:c.estimatedMinutes==null?null:String(c.estimatedMinutes/60),blocked:false});
 return Array.from({length:weeks},(_,i)=>{const from=addDays(week,i*7);return{week:from,before:measure(base,base.tasks,from),after:measure(base,tasks,from)};});
}

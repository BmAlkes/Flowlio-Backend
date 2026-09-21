import {z} from "zod";
const day=86400000;
export const calendarDate=z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value=>{const d=new Date(value+'T00:00:00Z');return Number.isFinite(d.getTime())&&d.toISOString().slice(0,10)===value;});
export function weekBounds(value:string){const date=new Date(value+'T00:00:00Z');const weekday=(date.getUTCDay()+6)%7;const from=new Date(date.getTime()-weekday*day);return{from:from.toISOString().slice(0,10),to:new Date(from.getTime()+6*day).toISOString().slice(0,10)};}
export function allocateMinutes(estimate:string|null,start:string|null,end:string|null,week:string){
 const numeric=estimate==null?null:Number(estimate);const estimated=numeric!=null&&Number.isFinite(numeric)&&numeric>=0;
 const scheduled=!!start&&!!end&&calendarDate.safeParse(start).success&&calendarDate.safeParse(end).success&&start<=end;
 if(!estimated||!scheduled)return{minutes:0,unestimated:!estimated,unscheduled:!scheduled};
 const from=Date.parse(start!),to=Date.parse(end!),window=weekBounds(week);const overlap=Math.max(0,(Math.min(to,Date.parse(window.to))-Math.max(from,Date.parse(window.from)))/day+1);
 return{minutes:Math.round(numeric!*60*overlap/((to-from)/day+1)),unestimated:false,unscheduled:false};
}

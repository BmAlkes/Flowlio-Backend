import { z } from 'zod';
import type { Pool } from 'pg';
import { canManageClients,canViewProjectFinancials,type Actor } from '../../security/resource-policy';
import { clientCols,clientHref,makeSources,projectCols,projectHref,projectVisible,requireMember,taskCols,taskVisible } from './context';
import { AgentError,type Context,type Source } from './policy';

// Read-only query tools. Each one applies the same organization, role and visibility predicates as
// the preloaded context, so the model can never see more than the signed-in user can.
const MAX_ROWS=25,MAX_TOOL_SOURCES=250;
const id=z.string().min(1).max(128);
const text=z.string().trim().min(1).max(100);
const limit=z.number().int().min(1).max(MAX_ROWS).default(15);
const schemas={
 list_projects:z.object({status:z.enum(['pending','ongoing','delayed','completed']).optional(),overdue:z.boolean().optional(),query:text.optional(),limit}).strict(),
 list_tasks:z.object({status:z.enum(['todo','in_progress','completed']).optional(),overdue:z.boolean().optional(),due_within_days:z.number().int().min(0).max(90).optional(),assigned_to_me:z.boolean().optional(),unassigned:z.boolean().optional(),project_id:id.optional(),query:text.optional(),limit}).strict(),
 list_clients:z.object({type:z.enum(['lead','client']).optional(),status:text.optional(),follow_up_due:z.boolean().optional(),query:text.optional(),limit}).strict(),
 list_invoices:z.object({status:z.enum(['draft','sent','paid','overdue','cancelled']).optional(),client_id:id.optional(),limit}).strict(),
 get_overview_counts:z.object({}).strict(),
};
type ToolName=keyof typeof schemas;
const fn=(name:ToolName,description:string,properties:Record<string,unknown>={})=>({type:'function' as const,function:{name,description,parameters:{type:'object',properties,additionalProperties:false}}});
const limitProp={limit:{type:'integer',minimum:1,maximum:MAX_ROWS,description:`Rows to return (default 15, max ${MAX_ROWS}).`}};
const definitions:Record<ToolName,ReturnType<typeof fn>>={
 get_overview_counts:fn('get_overview_counts','Exact totals visible to the user: projects by status, tasks by status with overdue and unassigned counts, and for managers clients/leads by status and due follow-ups. Use this for any "how many" question instead of counting list results.'),
 list_projects:fn('list_projects','List projects the user can see, soonest end date first. Reports total_matching.',{status:{type:'string',enum:['pending','ongoing','delayed','completed']},overdue:{type:'boolean',description:'Only unfinished projects whose end date has passed.'},query:{type:'string',description:'Name contains.'},...limitProp}),
 list_tasks:fn('list_tasks','List tasks the user can see, soonest end date first. Reports total_matching.',{status:{type:'string',enum:['todo','in_progress','completed']},overdue:{type:'boolean',description:'Only unfinished tasks whose end date has passed.'},due_within_days:{type:'integer',minimum:0,maximum:90,description:'Unfinished tasks ending from today within N days.'},assigned_to_me:{type:'boolean'},unassigned:{type:'boolean'},project_id:{type:'string'},query:{type:'string',description:'Title contains.'},...limitProp}),
 list_clients:fn('list_clients','List clients and leads (managers only). Reports total_matching.',{type:{type:'string',enum:['lead','client']},status:{type:'string'},follow_up_due:{type:'boolean',description:'Only records whose follow-up date has arrived.'},query:{type:'string',description:'Name contains.'},...limitProp}),
 list_invoices:fn('list_invoices','List invoices (owners and admins only). overdue means sent past the due date. Reports total_matching.',{status:{type:'string',enum:['draft','sent','paid','overdue','cancelled']},client_id:{type:'string'},...limitProp}),
};
export type Toolbox={definitions:unknown[];execute:(name:string,args:unknown)=>Promise<unknown>};
const like=(v:string)=>v.replace(/[\\%_]/g,'\\$&');
const hidden=new Set(['created_by','visibility','updated_at','parent_id','start_after','finish_before','total']);
// Compact projection for the model: drop internals and shorten long text.
const view=(s:Source)=>({key:s.key,title:s.title,...Object.fromEntries(Object.entries(s.data).filter(([k])=>!hidden.has(k)).map(([k,v])=>[k,typeof v==='string'&&v.length>300?v.slice(0,300)+'…':v]))});

export function toolNamesFor(a:Actor):ToolName[]{
 return['get_overview_counts','list_projects','list_tasks',...(canManageClients(a)?['list_clients' as const]:[]),...(canViewProjectFinancials(a)?['list_invoices' as const]:[])];
}

export function createToolbox(pool:Pool,a:Actor,context:Context):Toolbox{
 const allowed=new Set<string>(toolNamesFor(a));const org=a.organizationId!;
 async function query(name:ToolName,args:any):Promise<{rows:any[];kind:string;href:(r:any)=>string}|{summary:unknown}>{
  if(name==='list_projects'){
   const rows=(await pool.query(`select ${projectCols},(count(*) over())::int total from projects p where ${projectVisible} and ($3::text is null or p.status=$3) and ($4::boolean is not true or (p.end_date<current_date and p.status<>'completed')) and ($5::text is null or p.name ilike '%'||$5||'%') order by p.end_date asc nulls last,p.updated_at desc,p.id limit $6`,[org,a.id,args.status??null,args.overdue??null,args.query?like(args.query):null,args.limit])).rows;
   return{rows,kind:'project',href:projectHref};
  }
  if(name==='list_tasks'){
   const rows=(await pool.query(`select ${taskCols},p.name project_name,(count(*) over())::int total from tasks t join projects p on p.id=t.project_id where ${projectVisible} and ${taskVisible} and ($3::text is null or t.status=$3) and ($4::boolean is not true or (t.end_date<current_date and t.status<>'completed')) and ($5::int is null or (t.status<>'completed' and t.end_date>=current_date and t.end_date<=current_date+$5::int)) and ($6::boolean is not true or t.assigned_to=$2) and ($7::boolean is not true or t.assigned_to is null) and ($8::text is null or t.project_id=$8) and ($9::text is null or t.title ilike '%'||$9||'%') order by t.end_date asc nulls last,t.updated_at desc,t.id limit $10`,[org,a.id,args.status??null,args.overdue??null,args.due_within_days??null,args.assigned_to_me??null,args.unassigned??null,args.project_id??null,args.query?like(args.query):null,args.limit])).rows;
   return{rows,kind:'task',href:projectHref};
  }
  if(name==='list_clients'){
   const rows=(await pool.query(`select ${clientCols},(count(*) over())::int total from clients where organization_id=$1 and ($2::text is null or type=$2) and ($3::text is null or status=$3) and ($4::boolean is not true or (follow_up_at is not null and follow_up_at<=now())) and ($5::text is null or name ilike '%'||$5||'%') order by follow_up_at asc nulls last,updated_at desc,id limit $6`,[org,args.type??null,args.status??null,args.follow_up_due??null,args.query?like(args.query):null,args.limit])).rows;
   return{rows,kind:'client',href:clientHref};
  }
  if(name==='list_invoices'){
   const status=args.status==='overdue'?"($3::text is null and (status='overdue' or (status='sent' and due_date<now())))":args.status?'status=$3':'$3::text is null';
   const rows=(await pool.query(`select id,invoice_number as title,client_id,amount,currency_code,status,due_date,(count(*) over())::int total from invoices where organization_id=$1 and ($2::text is null or client_id=$2) and ${status} order by due_date asc nulls last,created_at desc,id limit $4`,[org,args.client_id??null,args.status&&args.status!=='overdue'?args.status:null,args.limit])).rows;
   return{rows,kind:'invoice',href:()=>'/dashboard/invoice'};
  }
  const own=[org,a.id];
  const projects=(await pool.query(`select p.status,count(*)::int n from projects p where ${projectVisible} group by 1 order by 1`,own)).rows;
  const tasks=(await pool.query(`select t.status,count(*)::int n,(count(*) filter (where t.end_date<current_date and t.status<>'completed'))::int overdue,(count(*) filter (where t.assigned_to is null))::int unassigned from tasks t join projects p on p.id=t.project_id where ${projectVisible} and ${taskVisible} group by 1 order by 1`,own)).rows;
  const summary:Record<string,unknown>={projects_by_status:Object.fromEntries(projects.map(r=>[r.status,r.n])),tasks_by_status:Object.fromEntries(tasks.map(r=>[r.status,{count:r.n,overdue:r.overdue,unassigned:r.unassigned}]))};
  if(canManageClients(a)){
   const clients=(await pool.query("select type,status,count(*)::int n,(count(*) filter (where follow_up_at is not null and follow_up_at<=now()))::int follow_up_due from clients where organization_id=$1 group by 1,2 order by 1,2",[org])).rows;
   summary.clients_by_type_and_status=clients.map(r=>({type:r.type,status:r.status,count:r.n,follow_up_due:r.follow_up_due}));
  }
  return{summary};
 }
 async function execute(name:string,args:unknown){
  if(!allowed.has(name))return{error:'UNKNOWN_TOOL'};
  const parsed=schemas[name as ToolName].safeParse(args??{});
  if(!parsed.success)return{error:'INVALID_ARGUMENTS',details:parsed.error.issues.slice(0,3).map(i=>`${i.path.join('.')||'arguments'}: ${i.message}`)};
  await requireMember(pool,a);
  const out=await query(name as ToolName,parsed.data);
  const fresh:Source[]=[];
  if('summary' in out)fresh.push({key:'summary:overview',kind:'summary',id:'overview',title:'Organization totals',href:'/dashboard',data:out.summary as Record<string,unknown>});
  else fresh.push(...makeSources(out.kind,out.rows,out.href));
  const known=new Set(context.sources.map(s=>s.key));const added=fresh.filter(s=>!known.has(s.key));
  if(context.sources.filter(s=>s.tool).length+added.length>MAX_TOOL_SOURCES)return{error:'SOURCE_LIMIT',message:'Too many records fetched for one answer. Answer with what you already have or narrow the filters.'};
  for(const s of added)context.sources.push({...s,tool:true});
  if('summary' in out)return{key:'summary:overview',...(out.summary as object)};
  const total=out.rows[0]?.total??0;
  return{total_matching:total,returned:out.rows.length,truncated:total>out.rows.length,records:fresh.map(view)};
 }
 return{definitions:toolNamesFor(a).map(n=>definitions[n]),execute};
}

// Rechecks, with the user's current access, every record a tool fetched earlier.
// Totals carry no per-record data and are covered by the run's permission scope instead.
export async function stillVisible(pool:Pool,a:Actor,sources:Source[]){
 const ids=(kind:string)=>sources.filter(s=>s.kind===kind).map(s=>s.id);
 const same=(found:{id:string}[],expected:string[])=>{if(new Set(found.map(r=>r.id)).size!==new Set(expected).size)throw new AgentError(403,'ACCESS_CHANGED');};
 const org=a.organizationId!;
 const projects=ids('project'),tasks=ids('task'),clients=ids('client'),invoices=ids('invoice');
 if(projects.length)same((await pool.query(`select p.id from projects p where ${projectVisible} and p.id=any($3::text[])`,[org,a.id,projects])).rows,projects);
 if(tasks.length)same((await pool.query(`select t.id from tasks t join projects p on p.id=t.project_id where ${projectVisible} and ${taskVisible} and t.id=any($3::text[])`,[org,a.id,tasks])).rows,tasks);
 if(clients.length){if(!canManageClients(a))throw new AgentError(403,'ACCESS_CHANGED');same((await pool.query('select id from clients where organization_id=$1 and id=any($2::text[])',[org,clients])).rows,clients);}
 if(invoices.length){if(!canViewProjectFinancials(a))throw new AgentError(403,'ACCESS_CHANGED');same((await pool.query('select id from invoices where organization_id=$1 and id=any($2::text[])',[org,invoices])).rows,invoices);}
}

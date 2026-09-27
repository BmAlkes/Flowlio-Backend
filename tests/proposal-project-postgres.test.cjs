const {test,before,beforeEach,after}=require("node:test");
const assert=require("node:assert/strict");
if(!process.env.PROPOSAL_PROJECT_TEST_DATABASE_URL){test("Proposal conversion PostgreSQL (set PROPOSAL_PROJECT_TEST_DATABASE_URL)",{skip:true},()=>{});}
else {
 const url=new URL(process.env.PROPOSAL_PROJECT_TEST_DATABASE_URL);
 assert.ok(["localhost","127.0.0.1"].includes(url.hostname)&&url.port==="55442"&&url.pathname==="/flowlio_proposal_project_test","Dedicated local database only");
 const {Pool}=require("pg");const pool=new Pool({connectionString:url.toString()});
 const service=require("../src/modules/proposals/project-conversion").createProposalConversion(pool);
 const Module=require('node:module');const load=Module._load;
 const database=require('drizzle-orm/node-postgres').drizzle(pool,{schema:require('../src/schema/schema'),casing:'snake_case'});
 Module._load=function(id,...args){
  if(id.includes('configs/connection.config'))return {database,connection:pool};
  if(id.includes('utils/logger.util'))return {logger:{info(){},error(){},warn(){}}};
  if(id.includes('utils/cloudinary.util'))return {uploadToCloudinary:async()=>{throw Error('No external upload in regression');}};
  if(id.includes('utils/activity.util'))return {logActivity:async()=>{}};
  if(id.includes('utils/superadmin-notification.util'))return {notifySuperAdmins:async()=>{}};
  return load.call(this,id,...args);
 };
 const {updateProject}=require('../src/controllers/organization/projects/updateproject.controller');
 const {listProjects}=require('../src/modules/projects/read-projects');
 const {getFinancialOverview}=require('../src/controllers/reports/financial-overview.controller');
 Module._load=load;
 const actor={id:"owner",role:"user",organizationId:"org-a",isOrganizationOwner:true};
 const count=async table=>Number((await pool.query("select count(*) n from "+table)).rows[0].n);
 before(async()=>{await pool.query("drop schema public cascade;create schema public;drop schema if exists flowlio_releases cascade;drop schema if exists drizzle cascade");await require("../src/utils/release-migrations.util").runReleaseMigrations(pool)});
 beforeEach(async()=>{
  await pool.query("truncate users,organizations cascade");
  await pool.query(`insert into users(id,name,email,email_verified,two_factor_enabled,is_super_admin,timezone,created_at,updated_at) values
   ('owner','Owner','owner@example.test',true,false,false,'UTC',now(),now()),('manager','Manager','manager@example.test',true,false,false,'UTC',now(),now());
   insert into organizations(id,name,slug,created_at,updated_at) values ('org-a','A','a',now(),now()),('org-b','B','b',now(),now());
   insert into clients(id,name,email,organization_id,created_by,created_at,updated_at) values ('client','Client','client@example.test','org-a','owner',now(),now());
   insert into proposals(id,organization_id,client_id,created_by,project_title,client_name,status,approved_at,proposal_data,created_at,updated_at)
   values ('proposal','org-a','client','owner','Website','Client','approved',now(),'{}',now(),now());
   insert into project_templates(id,name,organization_id,is_global,created_at,updated_at) values ('template','Template','org-a',false,now(),now()),('foreign-template','Other','org-b',false,now(),now());
   insert into project_template_tasks(id,template_id,title,estimated_hours,"order",created_at,updated_at) values ('tt','template','Template task',3.5,0,now(),now());`);
  await pool.query("update proposals set proposal_data=$1 where id='proposal'",[JSON.stringify({projectOverview:"A real scope",scopeOfWork:["Design","Build"],timeline:{phases:[{phase:"Review"},{phase:"Launch"}]},investment:{totalBudget:"1000.00"}})]);
 });
 after(()=>pool.end());
 async function input(templateId){const p=await service.preview(actor,"proposal",templateId);return {version:p.version,templateId:templateId??null,name:p.name,description:p.description,budget:p.budget,tasks:p.tasks,milestones:p.milestones}}
 for(const currencyCode of ['ILS','USD','EUR']) test('conversion records proposal currency '+currencyCode+' and zero budget',async()=>{
   await pool.query("update organizations set settings=$1 where id='org-a'",[JSON.stringify({currency:'EUR'})]);await pool.query("update proposals set proposal_data=$1 where id='proposal'",[JSON.stringify({investment:{totalBudget:'4000',currencyCode}})]);
   const preview=await service.preview(actor,'proposal');assert.equal(preview.currencyCode,currencyCode);const result=await service.convert(actor,'proposal',{...await input(),budget:'4000'});
   const res={code:200,status(code){this.code=code;return this;},json(body){this.body=body;return this;}};
   await updateProject({user:actor,params:{id:result.projectId},body:{budget:0}},res);assert.equal(res.code,200,JSON.stringify(res.body));
   const reloaded=(await listProjects(actor)).find(p=>p.id===result.projectId);assert.equal(Number(reloaded.budget),0);assert.equal(reloaded.currencyCode,currencyCode);
   const report=await require('../src/modules/profitability/service').createProfitability(pool).report(actor,result.projectId,{from:'2026-09-01',to:'2026-09-30'});assert.equal(report.settings.currency,currencyCode);
   const row=(await pool.query('select budget,currency_code from projects where id=$1',[result.projectId])).rows[0];assert.equal(row.budget,'0.00');assert.equal(row.currency_code,currencyCode);
 });
 test('consolidated reports reject missing and mixed currencies',async()=>{
   const response=()=>({code:200,status(code){this.code=code;return this;},json(body){this.body=body;return this;}});
   let res=response();await getFinancialOverview({user:actor,query:{}},res);assert.equal(res.code,400);assert.equal(res.body.code,'CURRENCY_REQUIRED');
   await pool.query("update organizations set settings='{\"currency\":\"ILS\"}' where id='org-a'");
   res=response();await getFinancialOverview({user:actor,query:{}},res);assert.equal(res.code,200,JSON.stringify(res.body));assert.equal(res.body.data.currencyCode,'ILS');
   await pool.query("insert into revenue_entries(id,organization_id,date,amount,currency,category,source,created_by,created_at,updated_at) values('rev','org-a','2026-09-27',10,'USD','service','manual','owner',now(),now())");
   res=response();await getFinancialOverview({user:actor,query:{}},res);assert.equal(res.code,422);assert.equal(res.body.code,'CURRENCY_MISMATCH');
 });
 test('organization currency is explicit fallback and later settings cannot relabel a project',async()=>{
   await pool.query("update organizations set settings=$1 where id='org-a'",[JSON.stringify({currency:'ILS'})]);const result=await service.convert(actor,'proposal',await input());await pool.query("update organizations set settings=$1 where id='org-a'",[JSON.stringify({currency:'USD'})]);assert.equal((await pool.query('select currency_code from projects where id=$1',[result.projectId])).rows[0].currency_code,'ILS');
   await assert.rejects(pool.query("insert into project_financial_settings(project_id,currency) values($1,'USD')",[result.projectId]));
 });
 test("preview uses approved source and an authorized template without writing",async()=>{
  const p=await service.preview(actor,"proposal","template");assert.equal(p.tasks[0].title,"Template task");assert.equal(p.tasks[0].estimatedHours,"3.50");assert.equal(p.budget,"1000.00");assert.equal(p.milestones.length,2);assert.ok(!p.templates.some(t=>t.id==="foreign-template"));assert.equal(await count("projects"),0);
 });
 test("concurrent retries create one project, task set, milestone set and activity",async()=>{
  const body=await input();const results=await Promise.all(Array.from({length:12},()=>service.convert(actor,"proposal",body)));
  assert.equal(new Set(results.map(r=>r.projectId)).size,1);assert.equal(results.filter(r=>!r.existing).length,1);
  for(const [table,n] of [["projects",1],["tasks",2],["project_milestones",2],["recent_activities",1],["proposal_project_conversions",1]])assert.equal(await count(table),n,table);
  const row=(await pool.query("select client_id,budget,visibility from projects")).rows[0];assert.equal(row.client_id,"client");assert.equal(row.budget,"1000.00");assert.equal(row.visibility,"private");
 });
 test("foreign organizations, roles, templates and restricted budgets cannot convert",async()=>{
  const body=await input();await assert.rejects(service.convert({...actor,organizationId:"org-b"},"proposal",body),{code:"PROPOSAL_NOT_FOUND"});
  await assert.rejects(service.preview(actor,"proposal","foreign-template"),{code:"TEMPLATE_NOT_FOUND"});
  await assert.rejects(service.convert({...actor,isOrganizationOwner:false},"proposal",body),{code:"FORBIDDEN"});
  const manager={...actor,id:"manager",isOrganizationOwner:false,isOrganizationManager:true};assert.equal((await service.preview(manager,"proposal")).canSetBudget,false);
  await assert.rejects(service.convert(manager,"proposal",body),{code:"BUDGET_FORBIDDEN"});assert.equal(await count("projects"),0);
 });
 test("a second organization manager cannot read the first author's private converted project",async()=>{
  await service.convert(actor,"proposal",await input());const manager={...actor,id:"manager",isOrganizationOwner:false,isOrganizationManager:true};
  await assert.rejects(service.preview(manager,"proposal"),{code:"PROJECT_FORBIDDEN"});
 });
 test("changed approval or template requires a fresh review",async()=>{
  const body=await input("template");await pool.query("update project_template_tasks set title='Changed' where id='tt'");
  await assert.rejects(service.convert(actor,"proposal",body),{code:"SOURCE_CHANGED"});
  const refreshed=await input();await pool.query("update proposals set status='rejected' where id='proposal'");
  await assert.rejects(service.convert(actor,"proposal",refreshed),{code:"PROPOSAL_NOT_APPROVED"});assert.equal(await count("projects"),0);
 });
 test("a milestone storage failure rolls back the complete conversion",async()=>{
  await pool.query("create function reject_milestone() returns trigger language plpgsql as $$ begin raise exception 'test failure'; end $$;create trigger fail_milestone before insert on project_milestones for each row execute function reject_milestone()");
  try{await assert.rejects(service.convert(actor,"proposal",await input()));for(const table of ["projects","tasks","proposal_project_conversions","recent_activities"])assert.equal(await count(table),0,table);}
  finally{await pool.query("drop trigger fail_milestone on project_milestones;drop function reject_milestone()")}
 });
 test("bulk tasks respect organization limits and failures do not create partial projects",async()=>{
  await pool.query("update organizations set override_max_tasks=1 where id='org-a'");
  await assert.rejects(service.convert(actor,"proposal",await input()),{code:"PLAN_LIMIT_REACHED"});assert.equal(await count("projects"),0);
  const result=await service.convert(actor,"proposal",await input("template"));assert.ok(result.projectId);
 });
 test("deleting the converted project keeps a tombstone and never recreates it on retry",async()=>{
  const body=await input();const result=await service.convert(actor,"proposal",body);await pool.query("delete from projects where id=$1",[result.projectId]);
  await assert.rejects(service.convert(actor,"proposal",body),{code:"PROJECT_REMOVED"});assert.equal(await count("projects"),0);assert.equal(await count("proposal_project_conversions"),1);
 });
 test("forged context and malformed budgets are rejected before writes",async()=>{
  const body=await input();for(const changed of [{...body,organizationId:"org-b"},{...body,budget:"1000 USD"},{...body,tasks:Array(101).fill({title:"Task"})}])await assert.rejects(service.convert(actor,"proposal",changed),{code:"INVALID_PROJECT_DRAFT"});assert.equal(await count("projects"),0);
 });
}

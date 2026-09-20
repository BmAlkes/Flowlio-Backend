const {test,before,after}=require("node:test");
const assert=require("node:assert/strict");
const Module=require("node:module");
if(!process.env.OBSERVABILITY_TEST_DATABASE_URL){test("Observability PostgreSQL integration (set OBSERVABILITY_TEST_DATABASE_URL)",{skip:true},()=>{});}
else {
 const url=new URL(process.env.OBSERVABILITY_TEST_DATABASE_URL);
 assert.ok(["localhost","127.0.0.1"].includes(url.hostname)&&url.port==="55442"&&url.pathname==="/flowlio_observability_test","Dedicated local database only");
 const {Pool}=require("pg");const pool=new Pool({connectionString:url.toString()});
 const {createObservability}=require("../src/modules/observability/store");const store=createObservability(pool);
 const {enqueue,runOne}=require("../src/services/jobs/queue");
 const original=Module._load;
 Module._load=function(request,parent,main){
  if(request.includes("modules/observability/runtime"))return {observability:store};
  if(request.includes("middlewares/auth.middleware"))return {isAuthenticated:(req,res,next)=>{
   if(!req.headers["x-test-role"]){res.status(401).json({success:false});return;}
   req.user={id:req.headers["x-test-user"]||"owner",role:req.headers["x-test-role"]==="superadmin"?"superadmin":"user",organizationId:req.headers["x-test-org"]||"org-a",isOrganizationOwner:req.headers["x-test-role"]==="owner",isSuperAdmin:req.headers["x-test-role"]==="superadmin"};next();
  }};
  if(request.includes("utils/logger.util"))return {logger:{info(){},warn(){},error(){}}};
  return original.call(this,request,parent,main);
 };
 const routes=require("../src/routes/observability.routes").default;
 const {observeRequest}=require("../src/middlewares/observability.middleware");
 Module._load=original;
 const express=require("express");let server,origin;
 const ref="11111111-1111-1111-1111-111111111111";
 before(async()=>{
  await pool.query("drop schema public cascade;create schema public;drop schema if exists flowlio_releases cascade;drop schema if exists drizzle cascade");
  await require("../src/utils/release-migrations.util").runReleaseMigrations(pool);
  await pool.query("insert into organizations(id,name,slug,created_at,updated_at) values ('org-a','A','a',now(),now()),('org-b','B','b',now(),now())");
  const app=express();app.use(express.json());app.use(observeRequest);app.use("/api/observability",routes);
  app.get("/broken",(req,res)=>{req.user={organizationId:"org-a"};res.status(500).json({message:"private@example.test"});});
  server=app.listen(0,"127.0.0.1");await new Promise(resolve=>server.once("listening",resolve));origin="http://127.0.0.1:"+server.address().port;
 });
 after(async()=>{await new Promise(resolve=>server.close(resolve));await pool.end();});
 const request=(path,role="owner",options={})=>fetch(origin+path,{...options,headers:{"x-test-role":role,...options.headers}});
 test("failure reference persists and tenant summaries cannot read another organization",async()=>{
  for(const organizationId of ["org-a","org-b"])await store.record({organizationId,source:"ui",code:"REACT_ERROR",route:"dashboard",correlationId:ref,release:"abc123"});
  store.metric("api","org-a",true,120);store.metric("api","org-b",false,50);await store.flush();
  const a=await store.summary("org-a");assert.equal(a.events.length,1);assert.equal(a.metrics[0].errors,1);
  assert.equal((await store.summary(null)).events.length,2);
  const scoped=await (await request("/api/observability/summary?scope=global")).json();assert.equal(scoped.data.events.length,1);
  assert.equal((await request("/api/observability/summary","member")).status,403);
  const global=await(await request("/api/observability/summary?scope=global","superadmin")).json();assert.equal(global.data.events.length,2);
 });
 test("UI ingest rejects extra private fields, rate limits reports, and returns the persisted reference",async()=>{
  const send=body=>request("/api/observability/events","owner",{method:"POST",headers:{"Content-Type":"application/json","x-test-user":"rate-test"},body:JSON.stringify(body)});
  assert.equal((await send({code:"UI_ERROR",route:"dashboard",release:"abc123",password:"secret"})).status,400);
  let res=await send({code:"UI_ERROR",route:"dashboard",release:"abc123"});assert.equal(res.status,202);
  const reference=(await res.json()).correlationId;assert.match(reference,/^[a-f0-9-]{36}$/);
  assert.equal((await pool.query("select count(*)::int n from operational_events where correlation_id=$1",[reference])).rows[0].n,1);
  for(let n=0;n<8;n++)await send({code:"UI_ERROR",route:"dashboard",release:"abc123"});
  assert.equal((await send({code:"UI_ERROR",route:"dashboard",release:"abc123"})).status,429);
 });
 test("HTTP failures are captured without persisting response messages",async()=>{
  const res=await fetch(origin+"/broken");const reference=res.headers.get("x-request-id");assert.match(reference,/^[a-f0-9-]{36}$/);
  for(let n=0;n<20;n++){const rows=(await pool.query("select * from operational_events where correlation_id=$1",[reference])).rows;if(rows.length){assert.ok(!JSON.stringify(rows).includes("private@example.test"));return;}await new Promise(resolve=>setTimeout(resolve,10));}
  assert.fail("HTTP event was not persisted");
 });
 test("job failure persists an event and a broken observer cannot duplicate the job",async()=>{
  await enqueue(pool,"probe","probe",{organizationId:"org-a"});let runs=0;
  const handlers={probe:{transactional:true,run:async()=>{runs++;throw Error("private error");}}};
  await runOne(pool,handlers,()=>{},async(job,outcome,durationMs)=>{await store.record({organizationId:"org-a",source:"job",code:"JOB_"+outcome.toUpperCase(),route:job.kind,correlationId:job.id,durationMs});throw Error("observer failure");});
  assert.equal(runs,1);assert.equal((await pool.query("select status from durable_jobs where kind='probe'")).rows[0].status,"retry");
  assert.ok((await store.summary("org-a")).events.some(event=>event.code==="JOB_RETRY"));
 });
 test("repeated failures and slow operations raise actionable alerts",async()=>{
  for(let n=0;n<5;n++)store.metric("api","org-a",true,20);
  store.metric("job","org-a",false,10001);await store.flush();
  const result=await store.summary("org-a");
  assert.ok(result.alerts.some(row=>row.source==="api"&&row.code==="REPEATED_FAILURES"));
  assert.ok(result.alerts.some(row=>row.source==="job"&&row.code==="SLOW_OPERATION"));
 });
 test("retention removes old events and metrics without removing current failures",async()=>{
  await pool.query("update operational_events set occurred_at=now()-interval '31 days' where source='job'");
  await store.prune();assert.ok(!(await store.summary("org-a")).events.some(event=>event.source==="job"));
  assert.ok((await store.summary("org-a")).events.length>0);
 });
}

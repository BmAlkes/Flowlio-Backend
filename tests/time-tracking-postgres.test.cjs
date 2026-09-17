const {test,before,after,beforeEach}=require('node:test');
const assert=require('node:assert/strict');
const {randomUUID}=require('node:crypto');
if (!process.env.TIMER_TEST_DATABASE_URL) {
 test('Timer PostgreSQL integration (set TIMER_TEST_DATABASE_URL)',{skip:true},()=>{});
} else {
 const url=new URL(process.env.TIMER_TEST_DATABASE_URL);
 assert.ok(['localhost','127.0.0.1'].includes(url.hostname)&&url.pathname==='/flowlio_timer_test');
 const {Pool}=require('pg');const {drizzle}=require('drizzle-orm/node-postgres');
 const schema=require('../src/schema/schema');const Module=require('node:module');
 const pool=new Pool({connectionString:url.toString(),max:20});const db=drizzle(pool,{schema,casing:'snake_case'});
 const original=Module._load;
 Module._load=function(id,...args){
  if(id.endsWith('configs/connection.config'))return {database:db,connection:pool};
  if(id.includes('utils/logger.util'))return {logger:{error(){},info(){},warn(){}}};
  return original.call(this,id,...args);
 };
 const {trackTime}=require('../src/services/time-tracking.service');
 const {startTask,endTask}=require('../src/controllers/organization/tasks/time-tracking.controller');
 const {prepareTimeTracking}=require('../src/utils/time-tracking-migration.util');
 Module._load=original;
 const actor={id:'alice',role:'user',organizationId:'org-a'};
 const start=(key=randomUUID(),task='t',user=actor)=>trackTime(user,task,'start',key);
 const stop=(id,task='t',user=actor)=>trackTime(user,task,'stop',id);
 const count=async(table)=>Number((await pool.query('select count(*) from '+table)).rows[0].count);
 before(async()=>{await pool.query(`      create table organizations (id text primary key);
      create table users (id text primary key, name text not null);
      create table clients (id text primary key, organization_id text not null references organizations(id), name text not null);
      create table invoices (
        id text primary key, organization_id text not null references organizations(id),
        client_id text not null references clients(id), created_by text not null references users(id),
        invoice_number text not null, client_name text not null, amount numeric(10,2) not null,
        status text not null, date_paid timestamp, due_date timestamp, description text,
        pdf_url text, pdf_file_name text, pdf_file_size integer, payment_url text, overdue_notified_at timestamp,
        created_at timestamp not null, updated_at timestamp not null,
        constraint unique_invoice_number_per_org unique(invoice_number, organization_id)
      );
      create table recent_activities (id text primary key, organization_id text, actor_id text, user_id text, type text, resource text, resource_id text, action text, message text, metadata json, created_at timestamp);

      create table projects (id text primary key, name text, organization_id text references organizations(id), client_id text references clients(id), created_by text, assigned_to text, visibility text);
      create table tasks (id text primary key, title text, project_id text references projects(id), created_by text, assigned_to text, visibility text);
      create table time_entries (id text primary key, user_id text references users(id), project_id text references projects(id), task_id text references tasks(id), client_id text references clients(id), description text, start_time timestamp, end_time timestamp, duration integer, billable boolean, hourly_rate numeric(10,2), status text, tags json, created_at timestamp not null default now(), updated_at timestamp not null default now());
`);await prepareTimeTracking(pool);});
 beforeEach(async()=>{
  await pool.query('truncate organizations,users,clients,projects,tasks,time_entries,recent_activities,invoices cascade');
  await pool.query(`insert into organizations values ('org-a'),('org-b');
   insert into users values ('alice','Alice'),('bob','Bob');
   insert into clients values ('c','org-a','Client');
   insert into projects values ('p','Project','org-a','c','alice',null,'public'),('private','Private','org-a','c','bob',null,'private'),('foreign','Foreign','org-b',null,'bob',null,'public');
   insert into tasks values ('t','Design','p','alice',null,'public'),('t2','Review','p','bob',null,'public'),('secret','Secret','private','bob',null,'public'),('other','Other','foreign','bob',null,'public');`);
 });
 after(async()=>{try{await pool.query('drop table time_entries,tasks,projects,recent_activities,invoices,clients,users,organizations cascade; drop function guard_active_timer()');}finally{await pool.end();}});
 test('simultaneous retries create one timer and one activity',async()=>{
  const key=randomUUID();const results=await Promise.all(Array.from({length:15},()=>start(key)));
  assert.equal(new Set(results.map(r=>r.timeEntryId)).size,1);assert.equal(results.filter(r=>!r.replayed).length,1);
  assert.equal(await count('time_entries'),1);assert.equal(await count('recent_activities'),1);
 });
 test('different tasks compete for one user timer; another user remains independent',async()=>{
  const results=await Promise.allSettled([start(),start(randomUUID(),'t2')]);
  assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
  assert.equal(results.find(r=>r.status==='rejected').reason.status,409);
  await start(randomUUID(),'t2',{...actor,id:'bob',role:'viewer'});assert.equal(await count('time_entries'),2);
 });
 test('concurrent stops persist one end timestamp and one end activity',async()=>{
  const timer=await start();await pool.query("update time_entries set start_time=now()-interval '90 seconds' where id=$1",[timer.timeEntryId]);
  const results=await Promise.all(Array.from({length:15},()=>stop(timer.timeEntryId)));
  assert.equal(new Set(results.map(r=>r.endTime.toISOString())).size,1);
  assert.ok(results.every(r=>r.duration===1));assert.equal(results.filter(r=>!r.replayed).length,1);
  assert.equal(await count('recent_activities'),2);
 });
 test('delayed stop and start retries never stop or restart a newer session',async()=>{
  const key=randomUUID();const old=await start(key);await stop(old.timeEntryId);const current=await start();
  assert.equal((await stop(old.timeEntryId)).replayed,true);
  assert.equal((await start(key)).status,'completed');
  assert.equal((await pool.query('select status from time_entries where id=$1',[current.timeEntryId])).rows[0].status,'active');
  assert.equal(await count('time_entries'),2);
 });
 test('entry IDs, task visibility and organization protect other users and tenants',async()=>{
  const timer=await start();
  await assert.rejects(stop(timer.timeEntryId,'t',{...actor,id:'bob'}),e=>e.status===404);
  await assert.rejects(stop(timer.timeEntryId,'t2'),e=>e.status===404);
  for(const task of ['secret','other'])await assert.rejects(start(randomUUID(),task),e=>e.status===404);
  await assert.rejects(start(randomUUID(),'t',{...actor,role:'client'}),e=>e.status===403);
  await assert.rejects(trackTime(undefined,'t','start'),e=>e.status===401);
 });
 test('a failed activity write rolls back the timer operation',async()=>{
  await pool.query(`create function fail_timer_activity() returns trigger language plpgsql as $$ begin raise exception 'test failure'; end; $$; create trigger test_failure before insert on recent_activities for each row execute function fail_timer_activity()`);
  try{await assert.rejects(start());assert.equal(await count('time_entries'),0);}finally{await pool.query('drop trigger test_failure on recent_activities; drop function fail_timer_activity()');}
 });
 test('database guard also prevents concurrent legacy writers',async()=>{
  const insert=()=>db.insert(schema.timeEntries).values({id:randomUUID(),userId:'alice',projectId:'p',taskId:'t',startTime:new Date(),status:'active'});
  const results=await Promise.allSettled(Array.from({length:8},()=>insert()));
  assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(await count('time_entries'),1);
 });
 test('migration preserves legacy duplicates and they can be stopped individually',async()=>{
  await pool.query('alter table time_entries disable trigger time_entries_guard_active');
  const ids=[randomUUID(),randomUUID()];
  for(const id of ids)await db.insert(schema.timeEntries).values({id,userId:'alice',projectId:'p',taskId:'t',startTime:new Date(),status:'active'});
  await prepareTimeTracking(pool);assert.equal(await count('time_entries'),2);
  await assert.rejects(start(),e=>e.status===409);await stop(ids[0]);
  assert.equal((await pool.query('select status from time_entries where id=$1',[ids[1]])).rows[0].status,'active');
  await stop(ids[1]);await start();await prepareTimeTracking(pool);
 });
 test('future start timestamps never produce a negative duration',async()=>{
  const timer=await start();await pool.query("update time_entries set start_time=now()+interval '1 minute' where id=$1",[timer.timeEntryId]);
  const ended=await stop(timer.timeEntryId);assert.equal(ended.duration,0);assert.ok(ended.endTime>=ended.startTime);
 });
 test('controllers require an explicit stop target and validate replay keys',async()=>{
  const response=()=>({code:200,status(code){this.code=code;return this;},json(body){this.body=body;return this;}});
  const invalid=response();await startTask({user:actor,params:{id:'t'},body:{requestKey:'invalid'}},invalid);assert.equal(invalid.code,400);
  const missing=response();await endTask({user:actor,params:{id:'t'},body:{}},missing);assert.equal(missing.code,400);
  const begun=response();await startTask({user:actor,params:{id:'t'},body:{requestKey:randomUUID()}},begun);assert.equal(begun.code,200);
  const ended=response();await endTask({user:actor,params:{id:'t'},body:{timeEntryId:begun.body.data.timeEntryId}},ended);assert.equal(ended.code,200);
 });
}

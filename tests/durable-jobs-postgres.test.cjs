const {test,before,beforeEach,after}=require('node:test');
const assert=require('node:assert/strict');
const {fork}=require('node:child_process');
const path=require('node:path');
const {setTimeout:delay}=require('node:timers/promises');
if(!process.env.JOBS_TEST_DATABASE_URL){test('Durable jobs PostgreSQL integration (set JOBS_TEST_DATABASE_URL)',{skip:true},()=>{});}
else {
 const url=new URL(process.env.JOBS_TEST_DATABASE_URL);
 assert.ok(['127.0.0.1','localhost'].includes(url.hostname)&&url.port==='55440'&&url.pathname==='/flowlio_jobs_test','Only the dedicated local jobs database is allowed');
 const {Pool}=require('pg');const pool=new Pool({connectionString:url.toString(),max:15});
 const {runReleaseMigrations}=require('../src/utils/release-migrations.util');
 const {enqueue,scheduleDue,runOne}=require('../src/services/jobs/queue');
 const {jobContext}=require('../src/services/jobs/context');
 const {followupReminders,retryWebhooks}=require('../src/services/jobs/database-handlers');
 const {drizzle}=require('drizzle-orm/node-postgres');
 const {schema,RecurringInvoiceService,automationService,retryWebhookLog,recordAutomationRun}=require('./fixtures/durable-services.cjs').load(pool);
 const fail=error=>{throw error;};
 const wrap=run=>({transactional:true,run:(job,client)=>jobContext.run({job,client,database:drizzle(client,{schema,casing:'snake_case'})},()=>run(client,job))});
 const handlers={recurring:wrap(()=>RecurringInvoiceService.processRecurringInvoices()),followup:wrap(followupReminders),webhook:wrap(retryWebhooks)};
 const rows=async table=>(await pool.query('select * from '+table)).rows;
 const reset=async()=>{await pool.query('TRUNCATE users,organizations,durable_jobs,job_schedules CASCADE');};
 before(async()=>{await runReleaseMigrations(pool);});
 beforeEach(async()=>{await reset();await pool.query(`
  INSERT INTO users(id,name,email,email_verified,two_factor_enabled,is_super_admin,timezone,created_at,updated_at) VALUES ('owner','Owner','owner@example.test',true,false,false,'UTC',now(),now());
  INSERT INTO organizations(id,name,slug,created_at,updated_at) VALUES ('org','Test','test',now(),now());
  INSERT INTO user_organizations(id,user_id,organization_id,role,status,created_at,updated_at) VALUES ('membership','owner','org','owner','active',now(),now());
  INSERT INTO clients(id,organization_id,name,email,created_by,status,type,follow_up_at,created_at,updated_at) VALUES ('client','org','Client','client@example.test','owner','Active','client',now()-interval '2 days',now(),now());
 `);});
 after(async()=>{try{await reset();}finally{await pool.end();}});
 async function seed(kind){
  if(kind==='recurring')await pool.query(`INSERT INTO recurring_invoices(id,organization_id,client_id,created_by,template_name,client_name,amount,frequency,start_date,next_run_date,status,created_at,updated_at) VALUES ('template','org','client','owner','Template','Client',25,'monthly',now()-interval '1 day',now()-interval '1 day','active',now(),now())`);
  if(kind==='webhook')await pool.query(`INSERT INTO lead_webhooks(id,org_id,name,source,token,active,created_at,updated_at) VALUES ('wh','org','Webhook','generic','hash',true,now(),now()); INSERT INTO lead_webhook_logs(id,webhook_id,status,payload,retry_count,max_retries,next_retry_at,created_at) VALUES ('log','wh','pending_retry','{"name":"Retry lead","email":"lead@example.test"}',0,3,now(),now())`);
  await enqueue(pool,kind,kind,{},new Date(Date.now()-1000));
 }
 test('two schedulers produce one occurrence and recover every persisted missed hourly slot',async()=>{
  const schedule=[{kind:'hourly',minutes:60}];const start=new Date('2025-01-01T08:00:00Z');
  await Promise.all([scheduleDue(pool,schedule,start),scheduleDue(pool,schedule,start)]);
  await scheduleDue(pool,schedule,new Date('2025-01-01T11:00:00Z'));
  assert.deepEqual((await rows('durable_jobs')).map(j=>j.scheduled_at.toISOString()).sort(),[8,9,10,11].map(h=>`2025-01-01T${String(h).padStart(2,'0')}:00:00.000Z`));
 });
 test('two workers never overlap the same handler even for separate occurrences',async()=>{
  await enqueue(pool,'exclusive','a');await enqueue(pool,'exclusive','b');let active=0,max=0,calls=0;
  const handler={exclusive:wrap(async()=>{active++;max=Math.max(max,active);await delay(60);calls++;active--;})};
  await Promise.all([runOne(pool,handler,fail),runOne(pool,handler,fail)]);
  while(await runOne(pool,handler,fail)){}
  assert.equal(max,1);assert.equal(calls,2);
 });
 for(const kind of ['recurring','followup','webhook']){
  test(kind+': two workers commit one result',async()=>{
   await seed(kind);await Promise.all([runOne(pool,handlers,fail),runOne(pool,handlers,fail)]);
   assert.equal((await rows('durable_jobs'))[0].status,'completed');
   if(kind==='recurring')assert.equal((await rows('invoices')).length,1);
   if(kind==='followup')assert.equal((await rows('notifications')).length,1);
   if(kind==='webhook'){assert.equal((await rows('clients')).length,2);assert.equal((await rows('lead_webhook_logs'))[0].status,'retried_success');}
  });
  test(kind+': killed process rolls back its work and another worker recovers the job',async()=>{
   await seed(kind);
   const child=fork(path.resolve('tests/fixtures/durable-worker.cjs'),[kind],{execArgv:['-r','ts-node/register/transpile-only','-r','tsconfig-paths/register'],env:{...process.env,JOBS_TEST_DATABASE_URL:url.toString()},windowsHide:true,stdio:['ignore','ignore','pipe','ipc']});
   let stderr='';child.stderr.on('data',data=>stderr+=data);
   try{
    await new Promise((resolve,reject)=>{const timeout=setTimeout(()=>reject(Error('Child timeout '+stderr)),20000);child.once('message',()=>{clearTimeout(timeout);resolve();});child.once('exit',code=>{clearTimeout(timeout);reject(Error('Child exited '+code+' '+stderr));});});
    const exited=new Promise(resolve=>child.once('exit',resolve));child.kill('SIGKILL');await exited;
    await runOne(pool,handlers,fail);
    assert.equal((await rows('durable_jobs'))[0].status,'completed');
    assert.equal((await rows('durable_jobs'))[0].attempts,2);
    if(kind==='recurring')assert.equal((await rows('invoices')).length,1);
    if(kind==='followup')assert.equal((await rows('notifications')).length,1);
    if(kind==='webhook')assert.equal((await rows('clients')).length,2);
   }finally{if(child.exitCode===null)child.kill('SIGKILL');}
  });
 }
 test('failed notification transaction rolls back its marker, retries with backoff and eventually stops',async()=>{
  await seed('followup');const broken={followup:wrap(async client=>{await followupReminders(client);throw Error('Injected failure');})};
  for(let attempt=1;attempt<=5;attempt++){
   await runOne(pool,broken,fail);const job=(await rows('durable_jobs'))[0];assert.equal(job.attempts,attempt);assert.equal(job.status,attempt===5?'failed':'retry');
   assert.equal((await rows('notifications')).length,0);assert.equal((await rows('clients'))[0].followup_notified_at,null);
   assert.ok(job.available_at>new Date());await pool.query("UPDATE durable_jobs SET available_at=now()");
  }
  assert.equal(await runOne(pool,handlers,fail),false);
 });
 test('abandoned external delivery becomes uncertain and is never sent again automatically',async()=>{
  await enqueue(pool,'email','mail');await pool.query("UPDATE durable_jobs SET status='running',attempts=1");let calls=0;
  const handler={email:{transactional:false,run:async()=>{calls++;}}};
  await runOne(pool,handler,fail);assert.equal(calls,0);assert.equal((await rows('durable_jobs'))[0].status,'uncertain');
  assert.equal(await runOne(pool,handler,fail),false);
 });
 test('automation commits its notification, marker and outbound email together without contacting providers',async()=>{
  await pool.query("INSERT INTO invoices(id,organization_id,client_id,created_by,invoice_number,client_name,amount,status,due_date,created_at,updated_at) VALUES ('invoice','org','client','owner','S1-00001','Client',25,'unpaid',now()-interval '3 days',now(),now())");
  await enqueue(pool,'invoice-reminder','reminder');
  const handler={'invoice-reminder':wrap(async()=>{const result=await automationService.handleInvoiceOverdue({organizationId:'org'});assert.equal(result.emailsFailed,0);await recordAutomationRun("invoice-overdue",result,"cron","org");})};
  await runOne(pool,handler,fail);
  assert.equal((await rows('durable_jobs')).filter(j=>j.kind==='email-delivery').length,1);
  assert.equal((await rows('notifications')).length,1);
  assert.ok((await rows('invoices'))[0].overdue_notified_at);
  assert.equal((await rows('automation_runs'))[0].emails_sent,0);
 });
 test('paused schedules stay paused after another scheduler starts, and custom intervals persist',async()=>{
  const schedules=[{kind:'calendar-sync',minutes:60}];
  await pool.query("INSERT INTO job_schedules(kind,next_run_at,enabled,interval_minutes) VALUES ('calendar-sync','2025-01-01T08:00:00Z',false,15)");
  await scheduleDue(pool,schedules,new Date('2025-01-01T09:00:00Z'));assert.equal((await rows('durable_jobs')).length,0);
  await pool.query("UPDATE job_schedules SET enabled=true");await scheduleDue(pool,schedules,new Date('2025-01-01T09:00:00Z'));
  assert.equal((await rows('durable_jobs')).length,5);
 });
 test('manual webhook retry cannot cross tenants or reopen a completed log',async()=>{
  await seed('webhook');
  const request=async organizationId=>{const response={status(code){this.code=code;return this;},json(body){this.body=body;return this;}};await retryWebhookLog({params:{logId:'log'},user:{id:'owner',organizationId}},response);return response;};
  assert.equal((await request('foreign-org')).code,404);
  await runOne(pool,handlers,fail);assert.equal((await request('org')).code,400);
  assert.equal((await rows('clients')).length,2);assert.equal((await rows('lead_webhook_logs'))[0].status,'retried_success');
 });
 test('a bad webhook is isolated by a savepoint and exhausts retries without inserting leads',async()=>{
  await seed('webhook');await pool.query("UPDATE lead_webhooks SET active=false");
  for(let index=0;index<3;index++){
   if(index)await enqueue(pool,'webhook','retry-'+index);
   await runOne(pool,handlers,fail);await pool.query("UPDATE lead_webhook_logs SET next_retry_at=now() WHERE status='pending_retry'");
  }
  assert.equal((await rows('clients')).length,1);assert.equal((await rows('lead_webhook_logs'))[0].status,'permanently_failed');
 });

 test('a busy job kind does not hide another kind behind its backlog',async()=>{
  const lock=await pool.connect();
  try{
   await lock.query("SELECT pg_advisory_lock(601000,hashtext('busy'))");
   for(let index=0;index<35;index++)await enqueue(pool,'busy','busy-'+index,{},new Date(Date.now()-60000));
   await enqueue(pool,'ready','ready');let calls=0;
   await runOne(pool,{busy:wrap(async()=>{throw Error('Busy kind must stay locked');}),ready:wrap(async()=>{calls++;})},fail);
   assert.equal(calls,1);
  }finally{await lock.query("SELECT pg_advisory_unlock(601000,hashtext('busy'))");lock.release();}
 });

}

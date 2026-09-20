const assert=require('node:assert/strict');
const url=new URL(process.env.JOBS_TEST_DATABASE_URL);
assert.ok(['localhost','127.0.0.1'].includes(url.hostname)&&url.port==='55440'&&url.pathname==='/flowlio_jobs_test');
const {Pool}=require('pg');const pool=new Pool({connectionString:url.toString()});
const {db,RecurringInvoiceService}=require('./durable-services.cjs').load(pool);
const {drizzle}=require('drizzle-orm/node-postgres');
const schema=require('../../src/schema/schema');
const {jobContext}=require('../../src/services/jobs/context');
const {runOne}=require('../../src/services/jobs/queue');
const {followupReminders,retryWebhooks}=require('../../src/services/jobs/database-handlers');
const kind=process.argv[2];
const handlers={ [kind]:{transactional:true,run:async(job,client)=>{
 await jobContext.run({job,client,database:drizzle(client,{schema,casing:'snake_case'})},async()=>{
  if(kind==='recurring')await RecurringInvoiceService.processRecurringInvoices();
  if(kind==='followup')await followupReminders(client);
  if(kind==='webhook')await retryWebhooks(client);
 });
 process.send('executed-uncommitted');
 await new Promise(()=>{});
}}};
runOne(pool,handlers,()=>process.exit(2)).catch(error=>{console.error(error);process.exit(1);});

const {test,beforeEach,after}=require('node:test');
const assert=require('node:assert/strict');
if(!process.env.SUBSCRIPTION_TEST_DATABASE_URL){test('Subscription PostgreSQL integration (set SUBSCRIPTION_TEST_DATABASE_URL)',{skip:true},()=>{});}
else{
 const url=new URL(process.env.SUBSCRIPTION_TEST_DATABASE_URL);
 assert.ok(['127.0.0.1','localhost'].includes(url.hostname)&&url.port==='55441'&&url.pathname==='/flowlio_subscription_test','Dedicated local subscription database required');
 const {Pool}=require('pg');const pool=new Pool({connectionString:url.toString()});
 const {runReleaseMigrations}=require('../src/utils/release-migrations.util');
 const {drizzle}=require('drizzle-orm/node-postgres');
 const schema=require('../src/schema/schema');
 const db=drizzle(pool,{schema,casing:'snake_case'});
 const Module=require('node:module');const original=Module._load;
 Module._load=function(id,...args){
  if(id.endsWith('/superadmin-notification.util'))return {notifySuperAdmins:async()=>{}};
  if(id.endsWith('/env.util'))return {env:{PAYPAL_MODE:'sandbox',PAYPAL_CLIENT_ID:'test',PAYPAL_CLIENT_SECRET:'test',PAYPAL_WEBHOOK_ID:'test'}};
  if(id.endsWith('configs/connection.config'))return {connection:pool,database:db};
  if(id.endsWith('/logger.util'))return {logger:{info(){},error(){},warn(){},debug(){}}};
  return original.call(this,id,...args);
 };
 const service=require('../src/services/subscription-reconciliation.service');
 const paypalController=require('../src/controllers/user/paypalSubscriptions.controller');
 const {cancelSubscription}=require('../src/controllers/user/subscription.controller');
 Module._load=original;
 const axios=require('axios');const oldGet=axios.get,oldPost=axios.post;
 const response=()=>({code:200,status(n){this.code=n;return this;},json(body){this.body=body;return this;}});
 const {runOne}=require('../src/services/jobs/queue');
 const {transaction,reconcileSubscription,acceptSubscriptionEvent,scheduleSubscriptionReconciliation}=service;
 const periodEnd=()=>new Date(Date.now()+30*86400000);
 const paid=()=>({id:'I-test',plan_id:'P-test',status:'ACTIVE',billing_info:{next_billing_time:periodEnd().toISOString(),last_payment:{time:new Date().toISOString()}}});
 const read=async()=> (await pool.query("SELECT * FROM subscriptions WHERE id='sub'")).rows[0];
 beforeEach(async()=>{
  axios.get=async()=>({data:paid()});
  axios.post=async()=>({data:{access_token:'fake',verification_status:'SUCCESS'}});
  await pool.query('drop schema public cascade;create schema public;drop schema if exists flowlio_releases cascade');
  await runReleaseMigrations(pool);
  await pool.query(`INSERT INTO subscription_plans(id,name,slug,price,currency,billing_cycle,duration_type,duration_value,is_active,sort_order,paypal_plan_id,created_at,updated_at)
    VALUES('plan','Plan','plan',12,'USD','monthly','monthly',1,true,0,'P-test',now(),now());
    INSERT INTO organizations(id,name,slug,subscription_plan_id,subscription_status,created_at,updated_at) VALUES('org','Test','org','plan','active',now(),now());
    INSERT INTO subscriptions(id,organization_id,plan_id,status,current_period_start,current_period_end,paypal_subscription_id,created_at,updated_at)
    VALUES('sub','org','plan','active',now()-interval '1 month',now()-interval '1 hour','I-test',now(),now());`);
 });
 after(()=>{axios.get=oldGet;axios.post=oldPost;return pool.end();});
 test('concurrent duplicate notifications create one inbox record and one job',async()=>{
  await Promise.all(Array.from({length:6},()=>transaction(pool,c=>acceptSubscriptionEvent(c,'EV-1','PAYMENT.SALE.COMPLETED','I-test'))));
  assert.equal((await pool.query('SELECT count(*) FROM subscription_events')).rows[0].count,'1');
  assert.equal((await pool.query('SELECT count(*) FROM durable_jobs')).rows[0].count,'1');
 });
 test('inbox rolls back if queue insertion fails; provider can redeliver',async()=>{
  await pool.query("ALTER TABLE durable_jobs ADD CONSTRAINT reject_test CHECK(kind <> 'subscription-reconcile')");
  await assert.rejects(transaction(pool,c=>acceptSubscriptionEvent(c,'EV-1','BILLING.SUBSCRIPTION.ACTIVATED','I-test')));
  assert.equal((await pool.query('SELECT count(*) FROM subscription_events')).rows[0].count,'0');
 });
 test('provider failure persists retry and keeps entitlement unchanged, then recovers',async()=>{
  await transaction(pool,c=>acceptSubscriptionEvent(c,'EV-1','BILLING.SUBSCRIPTION.ACTIVATED','I-test'));
  const before=await read();let unavailable=true;
  const handlers={'subscription-reconcile':{transactional:true,run:async(job,c)=>{
   await reconcileSubscription(c,job.payload.providerId,async()=>{if(unavailable)throw Error('Unavailable');return paid();});
   await c.query('UPDATE subscription_events SET processed_at=now() WHERE id=$1',[job.payload.eventId]);
  }}};
  await runOne(pool,handlers,()=>{});
  assert.equal((await pool.query('SELECT status FROM durable_jobs')).rows[0].status,'retry');
  assert.deepEqual((await read()).current_period_end,before.current_period_end);
  assert.equal((await pool.query('SELECT processed_at FROM subscription_events')).rows[0].processed_at,null);
  unavailable=false;await pool.query("UPDATE durable_jobs SET available_at=now()");await runOne(pool,handlers,()=>{});
  assert.equal((await pool.query('SELECT status FROM durable_jobs')).rows[0].status,'completed');
  assert.equal((await read()).status,'active');
  const org=(await pool.query("SELECT * FROM organizations WHERE id='org'")).rows[0];
  assert.deepEqual(org.subscription_end_date,(await read()).current_period_end);
 });
 test('organization failure rolls back subscription update',async()=>{
  await pool.query("ALTER TABLE organizations ADD CONSTRAINT reject_date CHECK(subscription_end_date IS NULL)");
  const before=await read();await assert.rejects(transaction(pool,c=>reconcileSubscription(c,'I-test',async()=>paid())));
  assert.deepEqual((await read()).current_period_end,before.current_period_end);
 });
 test('late cancellation event follows current provider state; concurrent replay cannot extend twice',async()=>{
  const snapshot=paid();await Promise.all([1,2].map(()=>transaction(pool,c=>reconcileSubscription(c,'I-test',async()=>snapshot))));
  assert.equal((await read()).current_period_end.toISOString(),snapshot.billing_info.next_billing_time);
  assert.equal((await read()).status,'active');
 });
 test('cancellation survives crash after provider success and does not cancel twice',async()=>{
  const future=periodEnd();await pool.query("UPDATE subscriptions SET current_period_end=$1,metadata=$2",[future,JSON.stringify({cancellationRequestedAt:new Date().toISOString()})]);
  let providerStatus='ACTIVE',cancellations=0;
  const fetch=async()=>({...paid(),status:providerStatus});
  const cancel=async()=>{cancellations++;providerStatus='CANCELLED';};
  await assert.rejects(transaction(pool,async c=>{await reconcileSubscription(c,'I-test',fetch,cancel);throw Error('Process died before commit');}));
  await transaction(pool,c=>reconcileSubscription(c,'I-test',fetch,cancel));
  const sub=await read();assert.equal(cancellations,1);assert.equal(sub.cancel_at_period_end,true);assert.equal(sub.status,'active');assert.deepEqual(sub.current_period_end,future);
 });
 test('plan mismatch and unknown agreement cannot modify another subscription',async()=>{
  const before=await read();await assert.rejects(transaction(pool,c=>reconcileSubscription(c,'I-test',async()=>({...paid(),plan_id:'OTHER'}))));
  await assert.rejects(transaction(pool,c=>reconcileSubscription(c,'I-other',async()=>paid())));
  assert.deepEqual(await read(),before);
 });
 test('missed weeks are recovered, free plans retain calendar anchor and cancelled accounts expire',async()=>{
  await pool.query("UPDATE subscriptions SET paypal_subscription_id=null,current_period_start='2026-01-31T00:00:00Z',current_period_end='2026-02-28T00:00:00Z'; UPDATE subscription_plans SET price=0");
  const job={id:'sweep',payload:{},scheduled_at:new Date(),attempts:1,kind:'subscription-renewal'};
  await transaction(pool,c=>scheduleSubscriptionReconciliation(job,c));const free=await read();assert.equal(free.status,'active');assert.ok(free.current_period_end>new Date());
  const day=free.current_period_end.getUTCDate();assert.ok(day>=28);
  await pool.query("UPDATE subscriptions SET current_period_end=now()-interval '10 days',cancel_at_period_end=true");
  await transaction(pool,c=>scheduleSubscriptionReconciliation({...job,id:'sweep2'},c));assert.equal((await read()).status,'cancelled');
 });
 test('paid legacy plans without an agreement are never renewed without payment',async()=>{
  await pool.query("UPDATE subscriptions SET paypal_subscription_id=null,current_period_end=now()-interval '10 days'");
  await transaction(pool,c=>scheduleSubscriptionReconciliation({id:'sweep'},c));assert.equal((await read()).status,'past_due');
 });
 test('past-due agreements are included in the recovery sweep',async()=>{
  await pool.query("UPDATE subscriptions SET status='past_due'");
  await transaction(pool,c=>scheduleSubscriptionReconciliation({id:'sweep'},c));
  assert.equal((await pool.query('SELECT payload FROM durable_jobs')).rows[0].payload.providerId,'I-test');
 });
 test('provider identifier has a database uniqueness guard',async()=>{
  await assert.rejects(pool.query(`INSERT INTO subscriptions SELECT 'duplicate',organization_id,plan_id,status,current_period_start,current_period_end,cancel_at_period_end,cancelled_at,trial_start,trial_end,stripe_subscription_id,stripe_customer_id,metadata,created_at,updated_at,paypal_subscription_id FROM subscriptions WHERE id='sub'`),error=>error.code==='23505');
 });
 test('webhook signature rejection and verification outage never acknowledge receipt',async()=>{
  const req={body:{id:'EV-http',event_type:'BILLING.SUBSCRIPTION.ACTIVATED',resource:{id:'I-test'}},headers:{}};
  axios.post=async url=>({data:url.includes('oauth2')?{access_token:'fake'}:{verification_status:'FAILURE'}});
  let res=response();await paypalController.handlePayPalWebhook(req,res);assert.equal(res.code,401);
  axios.post=async()=>{throw Error('Provider offline');};res=response();await paypalController.handlePayPalWebhook(req,res);assert.equal(res.code,503);
  assert.equal((await pool.query('SELECT count(*) FROM subscription_events')).rows[0].count,'0');
 });
 test('verified HTTP delivery is durable and accepts Buffer bodies',async()=>{
  const res=response();await paypalController.handlePayPalWebhook({body:Buffer.from(JSON.stringify({id:'EV-http',event_type:'PAYMENT.SALE.COMPLETED',resource:{id:'SALE',billing_agreement_id:'I-test'}})),headers:{}},res);
  assert.equal(res.code,200);assert.equal((await pool.query('SELECT paypal_subscription_id FROM subscription_events')).rows[0].paypal_subscription_id,'I-test');
 });
 async function owner(){
  await pool.query(`INSERT INTO users(id,name,email,email_verified,two_factor_enabled,is_super_admin,timezone,created_at,updated_at) VALUES('owner','Owner','owner@example.test',true,false,false,'UTC',now(),now());
   INSERT INTO user_organizations(id,user_id,organization_id,role,status,created_at,updated_at) VALUES('membership','owner','org','owner','active',now(),now());`);
 }
 test('activation replay returns the original subscription without changing dates or quota',async()=>{
  await owner();const before=await read();const res=response();
  await paypalController.activatePayPalSubscription({user:{id:'owner'},body:{subscriptionId:'I-test',planId:'plan'}},res);
  assert.equal(res.code,200);assert.equal(res.body.data.subscription.id,'sub');assert.deepEqual(await read(),before);
 });
 test('activation rejects another account even if it knows the PayPal identifier',async()=>{
  const res=response();await paypalController.activatePayPalSubscription({user:{id:'attacker'},body:{subscriptionId:'I-test',planId:'plan'}},res);assert.equal(res.code,403);
 });
 test('new activation checks account binding and provider plan before writing',async()=>{
  await owner();await pool.query('DELETE FROM subscriptions');
  let res=response();await paypalController.activatePayPalSubscription({user:{id:'owner'},body:{subscriptionId:'I-test',planId:'plan'}},res);assert.equal(res.code,403);
  axios.get=async()=>({data:{...paid(),custom_id:'owner',plan_id:'OTHER'}});res=response();
  await paypalController.activatePayPalSubscription({user:{id:'owner'},body:{subscriptionId:'I-test',planId:'plan'}},res);assert.equal(res.code,400);
  assert.equal((await pool.query('SELECT count(*) FROM subscriptions')).rows[0].count,'0');
 });
 test('new activation commits membership, entitlement and AI quota together',async()=>{
  await owner();await pool.query('DELETE FROM subscriptions');axios.get=async()=>({data:{...paid(),custom_id:'owner'}});
  const res=response();await paypalController.activatePayPalSubscription({user:{id:'owner',organizationId:'org'},body:{subscriptionId:'I-test',planId:'plan'}},res);
  assert.equal(res.code,200,JSON.stringify(res.body));assert.equal((await pool.query('SELECT paypal_subscription_id FROM subscriptions')).rows[0].paypal_subscription_id,'I-test');
  assert.equal((await pool.query('SELECT count(*) FROM ai_token_limits')).rows[0].count,'1');
 });
 test('non-owner cancellation cannot change entitlement or contact the provider',async()=>{
  const before=await read();let called=false;axios.get=async()=>{called=true;throw Error('Forbidden provider call');};
  const res=response();await cancelSubscription({user:{id:'attacker',organizationId:'org'}},res);
  assert.equal(res.code,403);assert.equal(called,false);assert.deepEqual(await read(),before);
 });

 test('migration indexes legacy agreements and preserves previously requested cancellations',async()=>{
  await pool.query(`UPDATE subscriptions SET metadata='{"paypalSubscriptionId":"I-legacy"}',cancel_at_period_end=true,cancelled_at=now();
    ALTER TABLE subscriptions DROP COLUMN paypal_subscription_id; DROP TABLE subscription_events;`);
  const migration=require('node:fs').readFileSync('drizzle/releases/0004_tired_leper_queen.sql','utf8');
  await transaction(pool,c=>c.query(migration));const sub=await read();
  assert.equal(sub.paypal_subscription_id,'I-legacy');assert.ok(sub.metadata.cancellationRequestedAt);
 });
 test('legacy duplicate agreements fail migration atomically instead of assigning another account',async()=>{
  await pool.query(`ALTER TABLE subscriptions DROP COLUMN paypal_subscription_id; DROP TABLE subscription_events;
    UPDATE subscriptions SET metadata='{"paypalSubscriptionId":"I-duplicate"}';
    INSERT INTO subscriptions SELECT 'duplicate',organization_id,plan_id,status,current_period_start,current_period_end,cancel_at_period_end,cancelled_at,trial_start,trial_end,stripe_subscription_id,stripe_customer_id,metadata,created_at,updated_at FROM subscriptions WHERE id='sub';`);
  const migration=require('node:fs').readFileSync('drizzle/releases/0004_tired_leper_queen.sql','utf8');
  await assert.rejects(transaction(pool,c=>c.query(migration)),error=>error.code==='23505');
  assert.equal((await pool.query("SELECT count(*) FROM information_schema.columns WHERE table_name='subscriptions' AND column_name='paypal_subscription_id'")).rows[0].count,'0');
 });
 test('failed activation rolls back entitlement and organization changes together',async()=>{
  await owner();await pool.query("DELETE FROM subscriptions; UPDATE organizations SET subscription_status='unpaid'; ALTER TABLE ai_token_limits ADD CONSTRAINT reject_test CHECK(organization_id <> 'org')");
  axios.get=async()=>({data:{...paid(),custom_id:'owner'}});const res=response();
  await paypalController.activatePayPalSubscription({user:{id:'owner',organizationId:'org'},body:{subscriptionId:'I-test',planId:'plan'}},res);
  assert.equal(res.code,500);assert.equal((await pool.query('SELECT count(*) FROM subscriptions')).rows[0].count,'0');
  assert.equal((await pool.query('SELECT subscription_status FROM organizations')).rows[0].subscription_status,'unpaid');
 });
 test('cancellation API persists intent for recovery when provider is unavailable',async()=>{
  await owner();axios.get=async()=>{throw Error('PayPal unavailable');};const res=response();
  await cancelSubscription({user:{id:'owner',organizationId:'org'}},res);
  assert.equal(res.code,503);assert.ok((await read()).metadata.cancellationRequestedAt);
  assert.equal((await pool.query('SELECT kind FROM durable_jobs')).rows[0].kind,'subscription-reconcile');
 });

}

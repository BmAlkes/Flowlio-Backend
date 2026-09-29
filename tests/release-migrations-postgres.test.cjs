const {test,beforeEach,after}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');const os=require('node:os');const path=require('node:path');
const {spawn}=require('node:child_process');
if(!process.env.RELEASE_TEST_DATABASE_URL){test('Release PostgreSQL integration (set RELEASE_TEST_DATABASE_URL)',{skip:true},()=>{});}
else{
 const url=new URL(process.env.RELEASE_TEST_DATABASE_URL);
 assert.ok(['127.0.0.1','localhost'].includes(url.hostname)&&url.pathname==='/flowlio_migration_test'&&url.port==='55439','Only the dedicated local migration test database is allowed');
 const {Pool}=require('pg');const pool=new Pool({connectionString:url.toString(),max:10});
 const {runReleaseMigrations}=require('../src/utils/release-migrations.util');
 const {generateDrizzleJson,generateMigration}=require('drizzle-kit/api');
 const folder=path.resolve('drizzle/releases');const tempFolders=[];
 const migrationCount=JSON.parse(require('node:fs').readFileSync(path.join(folder,'meta/_journal.json'),'utf8')).entries.length;
 const reset=()=>pool.query('drop schema public cascade; create schema public; drop schema if exists flowlio_releases cascade; drop schema if exists drizzle cascade');
 beforeEach(reset);
 after(async()=>{try{await reset();for(const temp of tempFolders){assert.equal(path.dirname(temp),os.tmpdir());await fs.rm(temp,{recursive:true});}}finally{await pool.end();}});
 const history=async()=>(await pool.query('select * from flowlio_releases.migrations order by position')).rows;
 const copy=async()=>{const temp=await fs.mkdtemp(path.join(os.tmpdir(),'flowlio-release-test-'));tempFolders.push(temp);await fs.cp(folder,temp,{recursive:true});return temp;};
 const addMigration=async(temp,sql)=>{
  const file=path.join(temp,'meta/_journal.json');const journal=JSON.parse(await fs.readFile(file,'utf8'));
  journal.entries.push({idx:journal.entries.length,version:'7',when:journal.entries.at(-1).when+1,tag:'9999_test',breakpoints:true});
  await fs.writeFile(file,JSON.stringify(journal));await fs.writeFile(path.join(temp,'9999_test.sql'),sql);
 };
 async function seed(){await pool.query(`
  insert into users (id,name,email,email_verified,two_factor_enabled,is_super_admin,timezone,created_at,updated_at) values ('owner','Owner','owner@example.test',true,false,false,'UTC',now(),now());
  insert into organizations(id,name,slug,created_at,updated_at) values ('org','Test','test',now(),now());
  insert into clients(id,organization_id,name,email,created_by,created_at,updated_at) values ('client','org','Client','client@example.test','owner',now(),now());
  insert into invoices(id,organization_id,client_id,created_by,invoice_number,client_name,amount,status,created_at,updated_at) values ('invoice','org','client','owner','S1-00042','Client',123.45,'draft',now(),now());
 `);}
 test('empty database becomes complete, with billing and timer guards; repeated startup is read-only',async()=>{
  await runReleaseMigrations(pool);const first=await history();assert.equal(first.length,migrationCount);
  const tables=(await pool.query("select count(*) from pg_tables where schemaname='public'")).rows[0].count;assert.equal(Number(tables),Object.keys(generateDrizzleJson(require('../src/schema/schema'),undefined,['public'],'snake_case').tables).length);
  const triggers=(await pool.query("select tgname from pg_trigger where not tgisinternal order by tgname")).rows.map(r=>r.tgname);
  assert.deepEqual(triggers,["clients_currency_guard","recurring_currency_guard","payment_links_currency_guard","financial_settings_currency_guard","projects_currency_guard","audit_workflow_event","milestones_workflow_event","business_audit_immutable","delivery_reviews_business_audit","invoices_assign_number","projects_business_audit","scope_version_immutable", "retainer_entries_guard", "time_entries_retainer_guard", "invoice_time_retainer_guard", "retainer_periods_guard", "retainers_terms_guard", "recurring_retainer_guard","time_entries_guard_active","time_entries_protect_billing","user_management_business_audit","user_organizations_business_audit"].sort());
  await runReleaseMigrations(pool);assert.deepEqual(await history(),first);
 });
 test('organization currency snapshots survive setting changes and legacy rows stay unknown',async()=>{
  await runReleaseMigrations(pool);await seed();
  assert.equal((await pool.query("select currency_code from clients where id='client'")).rows[0].currency_code,null);
  await pool.query("update organizations set settings='{\"currency\":\"ILS\"}' where id='org'");
  await pool.query("insert into clients(id,organization_id,name,email,created_by,created_at,updated_at) values ('ils','org','ILS','ils@example.test','owner',now(),now())");
  assert.equal((await pool.query("select currency_code from clients where id='ils'")).rows[0].currency_code,'ILS');
  await pool.query("update organizations set settings='{\"currency\":\"EUR\"}' where id='org'");
  assert.equal((await pool.query("select currency_code from clients where id='ils'")).rows[0].currency_code,'ILS');
  await assert.rejects(pool.query("update clients set currency_code='EUR' where id='ils'"),/reconciliation/);
  assert.equal((await pool.query("select currency_code from clients where id='client'")).rows[0].currency_code,null);
 });
 test('currency settings enforce owner, tenant, confirmation and stale-write boundaries',async()=>{
  await runReleaseMigrations(pool);await seed();
  await pool.query("update organizations set settings='{\"keep\":true}' where id='org'; insert into organizations(id,name,slug,settings,created_at,updated_at) values ('other','Other','other','{\"currency\":\"USD\"}',now(),now())");
  const Module=require('node:module'),original=Module._load;
  const db=require('drizzle-orm/node-postgres').drizzle(pool,{schema:require('../src/schema/schema'),casing:'snake_case'});
  Module._load=function(id,...args){if(id.endsWith('configs/connection.config'))return{database:db,connection:pool};return original.call(this,id,...args);};
  const controller=require('../src/controllers/organization/financial-settings.controller');const revenue=require('../src/controllers/organization/revenue/revenue.controller');Module._load=original;
  const response=()=>({code:200,status(code){this.code=code;return this},json(body){this.body=body;return this}});
  const user={id:'owner',organizationId:'org',role:'user',isOrganizationOwner:true};
  for(const currencyCode of ['ILS','EUR','BRL']){
   const previousCurrencyCode=(await pool.query("select settings->>'currency' as code from organizations where id='org'")).rows[0].code;
   const res=response();await controller.updateFinancialSettings({user,body:{currencyCode,previousCurrencyCode,confirm:true}},res);assert.equal(res.code,200);
  }
  for(const [actor,body,expected]of [[{...user,isOrganizationOwner:false},{currencyCode:'USD',previousCurrencyCode:'BRL',confirm:true},403],[{...user,role:'client'},{currencyCode:'USD',previousCurrencyCode:'BRL',confirm:true},403],[user,{currencyCode:'USD',previousCurrencyCode:'ILS',confirm:true},409],[user,{currencyCode:'USD',previousCurrencyCode:'BRL',confirm:false},400],[user,{currencyCode:'XYZ',previousCurrencyCode:'BRL',confirm:true},400],[user,{currencyCode:'USD',previousCurrencyCode:'BRL',confirm:true,organizationId:'other'},400]]){
   const res=response();await controller.updateFinancialSettings({user:actor,body},res);assert.equal(res.code,expected);
  }
  assert.deepEqual((await pool.query("select settings from organizations where id='org'")).rows[0].settings,{keep:true,currency:'BRL'});
  await db.insert(require('../src/schema/schema').revenueEntries).values(['BRL','ILS',''].map((currency,i)=>({id:'revenue-'+i,organizationId:'org',date:'2026-09-28',amount:'10.00',currency,category:'service',source:'manual',createdBy:'owner'})));
  const report=response();await revenue.getRevenue({user,query:{from:'2026-09-01',to:'2026-10-01'}},report);assert.equal(report.code,200);assert.equal(report.body.data.summary.total,10);assert.equal(report.body.data.summary.currencyCode,'BRL');assert.equal(report.body.data.summary.excludedEntries,2);assert.equal(report.body.data.entries.length,3);
  const mismatched=response();await revenue.createRevenueEntry({user,body:{date:'2026-09-28',amount:20,currency:'ILS'}},mismatched);assert.equal(mismatched.code,400);
  const relabel=response();await revenue.updateRevenueEntry({user,params:{entryId:'revenue-0'},body:{currency:'ILS'}},relabel);assert.equal(relabel.code,409);
  assert.equal((await pool.query("select count(*) from recent_activities where resource='financial-settings'")).rows[0].count,'3');
  const unresolved=response();await controller.unresolvedFinancialCurrencies({user},unresolved);assert.equal(unresolved.code,200);
  const invoice=unresolved.body.data.records.find(r=>r.type==='invoice'&&r.id==='invoice');assert.equal(invoice.amount,'123.45');
  const record={type:invoice.type,id:invoice.id,amount:invoice.amount,version:invoice.version};
  const forbidden=response();await controller.reconcileFinancialCurrencies({user:{...user,role:'client'},body:{currencyCode:'BRL',confirm:true,records:[record]}},forbidden);assert.equal(forbidden.code,403);
  const partial=response();await controller.reconcileFinancialCurrencies({user,body:{currencyCode:'BRL',confirm:true,records:[record,{...record,id:'zz-unavailable'}]}},partial);assert.equal(partial.code,409);assert.equal((await pool.query("select currency_code from invoices where id='invoice'")).rows[0].currency_code,null);
  const stale=response();await controller.reconcileFinancialCurrencies({user,body:{currencyCode:'BRL',confirm:true,records:[{...record,amount:'999.00'}]}},stale);assert.equal(stale.code,409);
  const reviewed=response();await controller.reconcileFinancialCurrencies({user,body:{currencyCode:'BRL',confirm:true,records:[record]}},reviewed);assert.equal(reviewed.code,200);
  assert.deepEqual((await pool.query("select amount::text,currency_code from invoices where id='invoice'")).rows[0],{amount:'123.45',currency_code:'BRL'});
  const repeated=response();await controller.reconcileFinancialCurrencies({user,body:{currencyCode:'EUR',confirm:true,records:[record]}},repeated);assert.equal(repeated.code,409);
  assert.equal((await pool.query("select settings->>'currency' as code from organizations where id='other'")).rows[0].code,'USD');
 });
 function financialController(){
  const Module=require('node:module'),original=Module._load;
  const db=require('drizzle-orm/node-postgres').drizzle(pool,{schema:require('../src/schema/schema'),casing:'snake_case'});
  Module._load=function(id,...args){if(id.endsWith('configs/connection.config'))return{database:db,connection:pool};return original.call(this,id,...args);};
  try{return require('../src/controllers/organization/financial-settings.controller');}finally{Module._load=original;}
 }
 const financialOwner={id:'owner',organizationId:'org',role:'user',isOrganizationOwner:true};
 const financialResponse=()=>({code:200,status(code){this.code=code;return this},json(body){this.body=body;return this}});
 async function reviewCurrencies(controller){
  const res=financialResponse();await controller.unresolvedFinancialCurrencies({user:financialOwner},res);assert.equal(res.code,200);return res.body.data.records;
 }
 const reviewRecord=({type,id,amount,version,linkedRevenue})=>({type,id,amount,version,...(linkedRevenue?{linkedRevenue:(({id,amount,version,currency})=>({id,amount,version,currency}))(linkedRevenue)}:{})});
 async function confirmCurrencies(controller,records,extra={},user=financialOwner){
  const res=financialResponse();await controller.reconcileFinancialCurrencies({user,body:{currencyCode:'ILS',confirm:true,records,...extra}},res);return res;
 }
 async function seedLegacyPaidRevenue(){
  await runReleaseMigrations(pool);await seed();
  await pool.query("update invoices set status='paid',date_paid='2026-09-20',updated_at='2026-09-20 12:34:56.123456' where id='invoice'; update clients set lead_value=3000 where id='client'");
  await pool.query("insert into revenue_entries(id,organization_id,date,amount,currency,category,source,description,client_id,invoice_id,created_by,created_at,updated_at) values ('legacy-revenue','org','2026-09-20',123.45,'USD','service','invoice','Historical payment','client','invoice','owner',now(),'2026-09-20 12:34:56.654321')");
 }
 test('historical paid invoice correction requires reviewed linked revenue and keeps the batch atomic',async()=>{
  await seedLegacyPaidRevenue();const controller=financialController();
  await pool.query("insert into invoices(id,organization_id,client_id,created_by,invoice_number,client_name,amount,status,created_at,updated_at) values ('a-unlinked','org','client','owner','S1-00043','Client',3000,'draft',now(),now())");
  await pool.query("insert into projects(id,name,project_number,organization_id,client_id,created_by,created_at,updated_at) values ('project','Project','P1','org','client','owner',now(),now())");
  await pool.query("insert into payment_links(id,organization_id,client_id,project_id,created_by,description,project,submitted_by,client_name,amount,status,payment_link,external_payment_url,created_at,updated_at) values ('link','org','client','project','owner','Check again','Project','Owner','Client',3000,'paid','legacy-link','https://payments.example.test/existing',now(),now())");
  const records=await reviewCurrencies(controller),invoice=records.find(r=>r.id==='invoice'&&r.type==='invoice');
  assert.equal(invoice.linkedRevenue.currency,'USD');assert.equal(invoice.linkedRevenue.amount,'123.45');assert.equal(invoice.linkedRevenue.canCorrect,true);
  assert.match(invoice.version,/123456$/);assert.match(invoice.linkedRevenue.version,/654321$/);
  const selected=records.filter(r=>['a-unlinked','invoice','client','link'].includes(r.id)).map(reviewRecord);assert.equal(selected.length,4);
  const noConsent=await confirmCurrencies(controller,selected);assert.equal(noConsent.code,409);
  assert.ok(noConsent.body.conflicts.some(c=>c.type==='invoice'&&c.id==='invoice'&&c.reason==='LINKED_REVENUE_CONFIRMATION_REQUIRED'));
  assert.deepEqual((await pool.query("select currency_code from invoices order by id")).rows,[{currency_code:null},{currency_code:null}]);
  assert.equal((await pool.query("select currency from revenue_entries where id='legacy-revenue'")).rows[0].currency,'USD');
  assert.equal((await pool.query("select count(*) from recent_activities where resource='financial-settings'")).rows[0].count,'0');
  const missingSnapshot=await confirmCurrencies(controller,selected.map(({linkedRevenue,...r})=>r),{confirmLinkedRevenue:true});
  assert.equal(missingSnapshot.code,409);
  const saved=await confirmCurrencies(controller,selected,{confirmLinkedRevenue:true});assert.equal(saved.code,200);assert.equal(saved.body.data.updated,4);
  assert.deepEqual((await pool.query("select amount::text,currency_code,status,date_paid::text from invoices where id='invoice'")).rows[0],{amount:'123.45',currency_code:'ILS',status:'paid',date_paid:'2026-09-20 00:00:00'});
  assert.deepEqual((await pool.query("select amount::text,currency,date,source,description from revenue_entries where id='legacy-revenue'")).rows[0],{amount:'123.45',currency:'ILS',date:'2026-09-20',source:'invoice',description:'Historical payment'});
  assert.deepEqual((await pool.query("select amount::text,currency_code,status,external_payment_url from payment_links where id='link'")).rows[0],{amount:'3000.00',currency_code:'ILS',status:'paid',external_payment_url:'https://payments.example.test/existing'});
  assert.equal((await pool.query("select currency_code from clients where id='client'")).rows[0].currency_code,'ILS');
  const audits=(await pool.query("select metadata from recent_activities where resource='financial-settings'")).rows;assert.equal(audits.length,1);
  const audit=JSON.stringify(audits[0].metadata);for(const value of ['legacy-revenue','USD','ILS'])assert.ok(audit.includes(value),'Audit must retain '+value);
  const duplicate=await confirmCurrencies(controller,selected,{currencyCode:'EUR',confirmLinkedRevenue:true});assert.equal(duplicate.code,409);
  assert.equal((await pool.query("select currency from revenue_entries where id='legacy-revenue'")).rows[0].currency,'ILS');
 });
 test('historical linked revenue correction rejects stale, malformed, foreign and ineligible snapshots',async()=>{
  await seedLegacyPaidRevenue();const controller=financialController();
  const invoice=()=>reviewCurrencies(controller).then(rows=>rows.find(r=>r.id==='invoice'&&r.type==='invoice'));
  const first=reviewRecord(await invoice());
  const denied=await confirmCurrencies(controller,[first],{confirmLinkedRevenue:true},{...financialOwner,isOrganizationOwner:false});assert.equal(denied.code,403);
  const malformed=await confirmCurrencies(controller,[{...first,linkedRevenue:{...first.linkedRevenue,amount:'not-money'}}],{confirmLinkedRevenue:true});assert.equal(malformed.code,400);
  const wrongId=await confirmCurrencies(controller,[{...first,linkedRevenue:{...first.linkedRevenue,id:'unrelated-revenue'}}],{confirmLinkedRevenue:true});assert.equal(wrongId.code,409);
  await pool.query("update revenue_entries set updated_at=updated_at+interval '1 second' where id='legacy-revenue'");
  const stale=await confirmCurrencies(controller,[first],{confirmLinkedRevenue:true});assert.equal(stale.code,409);
  assert.ok(stale.body.conflicts.some(c=>c.reason==='LINKED_RECORD_CHANGED'));
  await pool.query("insert into organizations(id,name,slug,created_at,updated_at) values ('other','Other','other',now(),now())");
  await pool.query("insert into revenue_entries(id,organization_id,date,amount,currency,category,source,created_by,created_at,updated_at) values ('foreign','other','2026-09-20',123.45,'USD','service','manual','owner',now(),now())");
  const foreign=(await pool.query("select id,amount::text,currency,updated_at::text as version from revenue_entries where id='foreign'")).rows[0];
  assert.equal((await reviewCurrencies(controller)).some(r=>r.id==='foreign'||r.linkedRevenue?.id==='foreign'),false);
  const foreignRequest=await confirmCurrencies(controller,[{...reviewRecord(await invoice()),linkedRevenue:foreign}],{confirmLinkedRevenue:true});assert.equal(foreignRequest.code,409);
  assert.equal((await pool.query("select currency from revenue_entries where id='foreign'")).rows[0].currency,'USD');
  for(const sql of [
   "update revenue_entries set client_id=null,updated_at=now() where id='legacy-revenue'",
   "update revenue_entries set client_id='client',source='manual',updated_at=now() where id='legacy-revenue'",
   "update revenue_entries set source='invoice',amount=120,updated_at=now() where id='legacy-revenue'",
   "update revenue_entries set amount=123.45,updated_at=now() where id='legacy-revenue'; update invoices set status='draft',updated_at=now() where id='invoice'"
  ]){
   await pool.query(sql);const row=await invoice();assert.equal(row.linkedRevenue.canCorrect,false);
   const blocked=await confirmCurrencies(controller,[reviewRecord(row)],{confirmLinkedRevenue:true});assert.equal(blocked.code,409);
   assert.ok(blocked.body.conflicts.some(c=>c.reason==='LINKED_CURRENCY_CONFLICT'));
   assert.equal((await pool.query("select currency_code from invoices where id='invoice'")).rows[0].currency_code,null);
   assert.equal((await pool.query("select currency from revenue_entries where id='legacy-revenue'")).rows[0].currency,'USD');
  }
  await pool.query("update invoices set status='paid',currency_code='USD',updated_at=now() where id='invoice'");
  assert.equal(await invoice(),undefined);
  const known=await confirmCurrencies(controller,[first],{confirmLinkedRevenue:true});assert.equal(known.code,409);
  assert.equal((await pool.query("select currency_code from invoices where id='invoice'")).rows[0].currency_code,'USD');
  assert.equal((await pool.query("select count(*) from recent_activities where resource='financial-settings'")).rows[0].count,'0');
 });
 test('matching linked revenue currency needs no correction consent',async()=>{
  await seedLegacyPaidRevenue();const controller=financialController();
  await pool.query("update revenue_entries set currency='ILS',updated_at=now() where id='legacy-revenue'");
  const record=reviewRecord((await reviewCurrencies(controller)).find(r=>r.id==='invoice'&&r.type==='invoice'));
  const saved=await confirmCurrencies(controller,[record]);assert.equal(saved.code,200);
  assert.deepEqual((await pool.query("select amount::text,currency from revenue_entries where id='legacy-revenue'")).rows[0],{amount:'123.45',currency:'ILS'});
 });
 test('historical invoice reconciliation respects already recorded tracked-time currency',async()=>{
  await seedLegacyPaidRevenue();const controller=financialController();
  await pool.query("insert into projects(id,name,project_number,organization_id,client_id,created_by,currency_code,created_at,updated_at) values ('time-project','Time project','P1','org','client','owner','USD',now(),now())");
  await pool.query("insert into time_entries(id,user_id,project_id,client_id,start_time,end_time,duration,billable,hourly_rate,status,created_at,updated_at) values ('time','owner','time-project','client','2026-09-20 10:00:00','2026-09-20 11:00:00',60,true,123.45,'completed',now(),now())");
  await pool.query("insert into invoice_time_items(id,invoice_id,time_entry_id,user_name,project_name,started_at,minutes,hourly_rate,amount,currency_code) values ('item','invoice','time','Owner','Time project','2026-09-20 10:00:00',60,123.45,123.45,'USD')");
  const row=(await reviewCurrencies(controller)).find(r=>r.id==='invoice'&&r.type==='invoice');assert.deepEqual(row.linkedCurrencies,['USD']);
  const denied=await confirmCurrencies(controller,[reviewRecord(row)],{confirmLinkedRevenue:true});assert.equal(denied.code,409);
  assert.ok(denied.body.conflicts.some(c=>c.reason==='LINKED_CURRENCY_CONFLICT'&&c.currencies.includes('USD')));
  assert.equal((await pool.query("select currency_code from invoices where id='invoice'")).rows[0].currency_code,null);
  assert.deepEqual((await pool.query("select amount::text,currency from revenue_entries where id='legacy-revenue'")).rows[0],{amount:'123.45',currency:'USD'});
  const accepted=await confirmCurrencies(controller,[reviewRecord(row)],{currencyCode:'USD'});assert.equal(accepted.code,200);
  assert.equal((await pool.query("select currency_code from invoice_time_items where id='item'")).rows[0].currency_code,'USD');
 });
 async function seedLegacyRecurring(){
  await runReleaseMigrations(pool);await seed();
  await pool.query("update clients set lead_value=3000 where id='client'");
  await pool.query("insert into recurring_invoices(id,organization_id,client_id,created_by,template_name,client_name,amount,frequency,start_date,next_run_date,status,created_at,updated_at) values ('recurring','org','client','owner','Monthly service','Client',123.45,'monthly','2026-09-01','2026-10-01','active',now(),now())");
  await pool.query("insert into retainers(id,organization_id,client_id,created_by,name,currency,monthly_amount,included_minutes,timezone,start_month,renewal,carry_policy,carry_cap,carry_months,overage_policy,overage_rate,recurring_id,request_hash) values ('retainer','org','client','owner','Monthly contract','ILS',123.45,60,'UTC','2026-09','manual','expire',0,0,'waive',0,'recurring','fixture')");
 }
 test('recurring currency reconciliation preserves linked contract terms and requires its recorded currency',async()=>{
  await seedLegacyRecurring();const controller=financialController();
  const before=(await pool.query("select * from retainers where id='retainer'")).rows[0];
  const row=(await reviewCurrencies(controller)).find(r=>r.id==='recurring'&&r.type==='recurring');assert.deepEqual(row.linkedCurrencies,['ILS']);
  const mismatch=await confirmCurrencies(controller,[reviewRecord(row)],{currencyCode:'EUR'});assert.equal(mismatch.code,409);
  assert.ok(mismatch.body.conflicts.some(c=>c.id==='recurring'&&c.reason==='LINKED_CURRENCY_CONFLICT'&&c.currencies.includes('ILS')));
  assert.equal((await pool.query("select currency_code from recurring_invoices where id='recurring'")).rows[0].currency_code,null);
  assert.deepEqual((await pool.query("select * from retainers where id='retainer'")).rows[0],before);
  const saved=await confirmCurrencies(controller,[reviewRecord(row)]);assert.equal(saved.code,200);
  assert.deepEqual((await pool.query("select amount::text,currency_code,status from recurring_invoices where id='recurring'")).rows[0],{amount:'123.45',currency_code:'ILS',status:'active'});
  assert.deepEqual((await pool.query("select * from retainers where id='retainer'")).rows[0],before);
 });
 test('recurring reconciliation waits for contract operations before taking any source row locks',{timeout:20000},async()=>{
  await seedLegacyRecurring();const controller=financialController();
  const rows=await reviewCurrencies(controller),selected=rows.filter(r=>['client','recurring'].includes(r.id)).map(reviewRecord);assert.equal(selected.length,2);
  const holder=await pool.connect();let pending;
  try{
   await holder.query('begin');await holder.query("set local lock_timeout='2s'");
   await holder.query("select pg_advisory_xact_lock(hashtextextended('time-invoice:org',0))");
   await holder.query("select id from clients where id='client' for share");
   await holder.query("select id from retainers where id='retainer' for update");
   pending=confirmCurrencies(controller,selected);
   const deadline=Date.now()+3000;let waiting=false;
   while(Date.now()<deadline){
    waiting=(await pool.query("select exists(select 1 from pg_locks l join pg_stat_activity a on a.pid=l.pid where l.locktype='advisory' and not l.granted and a.datname=current_database()) as waiting")).rows[0].waiting;
    if(waiting)break;
    await new Promise(resolve=>setTimeout(resolve,20));
   }
   assert.equal(waiting,true,'Reconciliation must wait for the contract advisory lock before client or recurring row locks');
   // This is the same lock order used when a contract is paused. Without the
   // shared advisory lock, recurring -> retainer versus retainer -> recurring deadlocks.
   await holder.query("update recurring_invoices set status='paused',updated_at=updated_at+interval '1 second' where id='recurring'");
   await holder.query("update retainers set state='paused',revision=revision+1 where id='retainer'");
   await holder.query('commit');
   const stale=await pending;assert.equal(stale.code,409);
   assert.ok(stale.body.conflicts.some(c=>c.id==='recurring'&&c.reason==='RECORD_CHANGED'));
   assert.equal((await pool.query("select currency_code from clients where id='client'")).rows[0].currency_code,null);
   assert.deepEqual((await pool.query("select currency_code,status from recurring_invoices where id='recurring'")).rows[0],{currency_code:null,status:'paused'});
   assert.deepEqual((await pool.query("select currency,state,revision from retainers where id='retainer'")).rows[0],{currency:'ILS',state:'paused',revision:1});
   const refreshed=(await reviewCurrencies(controller)).filter(r=>['client','recurring'].includes(r.id)).map(reviewRecord);
   assert.equal((await confirmCurrencies(controller,refreshed)).code,200);
  }finally{await holder.query('rollback');holder.release();if(pending)await pending;}
 });
 test('five instances starting together apply each migration once',async()=>{
  await Promise.all(Array.from({length:5},()=>runReleaseMigrations(pool)));assert.equal((await history()).length,migrationCount);
 });
 test('upgrades the real legacy snapshot with data and malformed old history without renumbering invoices',async()=>{
  const snapshot=JSON.parse(await fs.readFile('drizzle/meta/0012_snapshot.json','utf8'));
  const empty=generateDrizzleJson({},undefined,['public'],'snake_case');
  for(const sql of await generateMigration(empty,snapshot))await pool.query(sql);
  await seed();await pool.query("update clients set status='Completed'; create schema drizzle; create table drizzle.__drizzle_migrations (hash text, created_at bigint); insert into drizzle.__drizzle_migrations values ('legacy',9999999999999)");
  await runReleaseMigrations(pool);
  assert.equal((await pool.query("select invoice_number from invoices where id='invoice'")).rows[0].invoice_number,'S1-00042');
  assert.equal((await pool.query('select last_value from invoice_number_counters')).rows[0].last_value,'42');
  assert.deepEqual((await pool.query('select type,portal_access_enabled from clients')).rows[0],{type:'client',portal_access_enabled:true});
  assert.equal((await pool.query('select hash from drizzle.__drizzle_migrations')).rows[0].hash,'legacy');
  assert.equal((await history()).length,migrationCount);
 });
 test('adopts a current database preserving portal restrictions, notes, counter and legacy primary key names',async()=>{
  await pool.query(await fs.readFile(path.join(folder,'0000_baseline.sql'),'utf8'));
  await pool.query(await fs.readFile(path.join(folder,'0001_required_guards.sql'),'utf8'));await seed();
  await pool.query("update clients set portal_access_enabled=false,follow_up_note='Keep me'; update invoice_number_counters set last_value=80; alter table invoice_number_counters rename constraint invoice_number_counters_pkey to legacy_counter_pk; alter table users drop column billing_email; drop schema if exists flowlio_releases cascade");
  await runReleaseMigrations(pool);
  assert.deepEqual((await pool.query('select portal_access_enabled,follow_up_note from clients')).rows[0],{portal_access_enabled:false,follow_up_note:'Keep me'});
  assert.equal((await pool.query('select last_value from invoice_number_counters')).rows[0].last_value,'80');
  assert.equal((await pool.query("select count(*) from information_schema.columns where table_name='users' and column_name='billing_email'")).rows[0].count,'1');
 });
 test('failed migration rolls back its DDL and history, leaving a retry possible',async()=>{
  await runReleaseMigrations(pool);const temp=await copy();await addMigration(temp,'alter table users add column rollback_probe text; select 1/0;');
  await assert.rejects(runReleaseMigrations(pool,temp));assert.equal((await history()).length,migrationCount);
  assert.equal((await pool.query("select count(*) from information_schema.columns where table_name='users' and column_name='rollback_probe'")).rows[0].count,'0');
  await fs.writeFile(path.join(temp,'9999_test.sql'),'alter table users add column rollback_probe text;');
  await runReleaseMigrations(pool,temp);assert.equal((await history()).length,migrationCount+1);
 });
 test('rewriting or omitting an applied migration prevents startup',async()=>{
  await runReleaseMigrations(pool);const temp=await copy();await fs.appendFile(path.join(temp,'0000_baseline.sql'),'\n-- changed');
  await assert.rejects(runReleaseMigrations(pool,temp),/history mismatch/);
  assert.equal((await history()).length,migrationCount);
 });
 test('disabled billing or timer guards prevent startup even with a complete ledger',async()=>{
  await runReleaseMigrations(pool);
  await pool.query('alter table time_entries disable trigger time_entries_guard_active');
  await assert.rejects(runReleaseMigrations(pool),/Required database guards unavailable/);
 });
 test('CLI exits nonzero on SQL failure and zero only on successful completion',async()=>{
  const temp=await fs.mkdtemp(path.join(os.tmpdir(),'flowlio-release-cli-'));tempFolders.push(temp);
  await fs.mkdir(path.join(temp,'drizzle'),{recursive:true});await fs.cp(folder,path.join(temp,'drizzle/releases'),{recursive:true});
  await addMigration(path.join(temp,'drizzle/releases'),'select 1/0;');
  const cli=()=>new Promise((resolve,reject)=>{
   const child=spawn(process.execPath,[path.resolve('dist/src/migrate.js')],{cwd:temp,env:{...process.env,CONNECTION_URL:url.toString()},windowsHide:true,stdio:'ignore'});
   child.on('error',reject);child.on('exit',resolve);
  });
  assert.equal(await cli(),1);
  assert.equal((await pool.query("select to_regclass('flowlio_releases.migrations') as table_name")).rows[0].table_name,null);
  await fs.writeFile(path.join(temp,'drizzle/releases/9999_test.sql'),'select 1;');
  assert.equal(await cli(),0);assert.equal((await history()).length,migrationCount+1);
 });
}

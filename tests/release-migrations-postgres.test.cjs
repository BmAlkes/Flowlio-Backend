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

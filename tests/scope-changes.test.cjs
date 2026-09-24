const {test,before,beforeEach,after}=require('node:test');const assert=require('node:assert/strict');const {randomUUID}=require('node:crypto');
if(!process.env.SCOPE_TEST_DATABASE_URL)test('Scope changes PostgreSQL',{skip:true},()=>{});
else{
 const url=new URL(process.env.SCOPE_TEST_DATABASE_URL);assert.ok(url.hostname==='127.0.0.1'&&url.port==='55442'&&url.pathname==='/flowlio_scope_test');
 const {Pool}=require('pg');const pool=new Pool({connectionString:url.toString()});const service=require('../src/modules/scope/service').createScopeChanges(pool);
 const owner={id:'owner',role:'user',organizationId:'org',isOrganizationOwner:true};const client={id:'client-user',role:'client',organizationId:'org'};
 const manager={...owner,isOrganizationOwner:false,isOrganizationManager:true};
 const estimate={action:'estimate',revision:0,classification:'additional',estimatedHours:'12.50',amount:'250.00',currency:'BRL',endDate:'2026-10-20',note:'New landing page'};
 const apply={action:'apply',revision:1,createTask:true,prepareBilling:true,applyDate:true,confirm:true};
 before(async()=>{await pool.query('drop schema public cascade;create schema public;drop schema if exists flowlio_releases cascade;drop schema if exists drizzle cascade');await require('../src/utils/release-migrations.util').runReleaseMigrations(pool);});
 beforeEach(async()=>{await pool.query(`truncate business_audit_events,users,organizations cascade;
 insert into users(id,name,email,role,status,email_verified,two_factor_enabled,is_super_admin,timezone,created_at,updated_at) values ('owner','Owner','owner@example.test','user','active',true,false,false,'UTC',now(),now()),('client-user','Client','client@example.test','client','active',true,false,false,'UTC',now(),now()),('foreign','Other','other@example.test','client','active',true,false,false,'UTC',now(),now());
 insert into organizations(id,name,slug,created_at,updated_at) values('org','Org','org',now(),now()),('other','Other','other',now(),now());
 insert into user_organizations(id,user_id,organization_id,role,status,created_at,updated_at) values('member','owner','org','owner','active',now(),now());
 insert into clients(id,name,email,organization_id,created_by,user_id,created_at,updated_at) values('client','Client','client@example.test','org','owner','client-user',now(),now()),('other-client','Other','other@example.test','org','owner','foreign',now(),now());
 insert into projects(id,name,project_number,organization_id,client_id,created_by,visibility,budget,start_date,end_date,created_at,updated_at) values('project','Project','1','org','client','owner','private',1000,'2026-09-01','2026-10-01',now(),now());`);});
 after(()=>pool.end());
 async function request(actor=owner,extra={}){const data={id:randomUUID(),title:'Landing page',description:'Additional page',fileIds:[],...extra};await service.create(actor,'project',data);return data;}
 async function approved(){const r=await request();await service.transition(owner,'project',r.id,estimate);await service.transition(client,'project',r.id,{action:'decide',revision:1,state:'approved',comment:''});return r;}
 test('full flow keeps original budget and produces one task and one commercial draft on retry',async()=>{
  const r=await approved();await Promise.all([service.transition(owner,'project',r.id,apply),service.transition(owner,'project',r.id,apply)]);
  const row=(await service.list(owner,'project',{})).items[0];assert.equal(row.state,'applied');assert.equal(row.application.billingDraft.amount,'250.00');assert.equal(row.application.billingDraft.currency,'BRL');
  assert.equal((await pool.query('select count(*)::int n from tasks')).rows[0].n,1);assert.equal((await pool.query('select count(*)::int n from invoices')).rows[0].n,0);
  assert.equal(Number((await pool.query('select budget from projects')).rows[0].budget),1000);assert.equal((await pool.query("select to_char(end_date, 'YYYY-MM-DD') as end_date from projects")).rows[0].end_date,'2026-10-20');
  assert.equal((await pool.query("select count(*)::int n from business_audit_events where action='change_request.applied'")).rows[0].n,1);
  await assert.rejects(service.transition(owner,'project',r.id,{...apply,createTask:false}),{code:'ALREADY_APPLIED'});
 });
 test('creation keys prevent duplicated requests and cannot be reused for changed content',async()=>{
  const r=await request();assert.equal((await service.create(owner,'project',r)).existing,true);await assert.rejects(service.create(owner,'project',{...r,title:'Different'}),{code:'REQUEST_CONFLICT'});
  assert.equal((await service.list(owner,'project',{})).items.length,1);
 });
 test('old versions cannot be approved, rejected versions can be revised, history stays immutable',async()=>{
  const r=await request(client);await service.transition(owner,'project',r.id,estimate);await service.transition(owner,'project',r.id,{...estimate,revision:1,amount:'300.00'});
  await assert.rejects(service.transition(client,'project',r.id,{action:'decide',revision:1,state:'approved',comment:''}),{code:'VERSION_CHANGED'});
  await service.transition(client,'project',r.id,{action:'decide',revision:2,state:'rejected',comment:'Too expensive'});
  await service.transition(owner,'project',r.id,{...estimate,revision:2,amount:'280.00'});
  const row=(await service.list(client,'project',{changeId:r.id})).items[0];assert.equal(row.history.length,3);assert.equal(row.history[1].comment,'Too expensive');assert.equal(row.latest.amount,'280.00');
  await assert.rejects(pool.query("update scope_change_versions set amount=1"));
 });
 test('racing revision and approval never approve the replacement estimate',async()=>{
  const r=await request();await service.transition(owner,'project',r.id,estimate);
  const results=await Promise.allSettled([service.transition(owner,'project',r.id,{...estimate,revision:1,amount:'800.00'}),service.transition(client,'project',r.id,{action:'decide',revision:1,state:'approved',comment:''})]);assert.equal(results[0].status,'fulfilled');
  const row=(await service.list(owner,'project',{})).items[0];assert.equal(row.revision,2);assert.equal(row.state,'awaiting');assert.equal(row.latest.decision,null);
 });
 test('tenant, client and private project isolation apply to every write and read',async()=>{
  const r=await request();for(const a of [{...owner,organizationId:'other'},{...client,id:'foreign'},{...owner,id:'foreign'}]){await assert.rejects(service.list(a,'project',{}),{code:'PROJECT_NOT_FOUND'});await assert.rejects(service.transition(a,'project',r.id,estimate),{code:'PROJECT_NOT_FOUND'});}
  for(const role of ['viewer','operator'])await assert.rejects(service.list({...owner,role},'project',{}),{code:'FORBIDDEN'});
 });
 test('manager cannot publish money estimates or see prices; clients cannot self-approve internal work',async()=>{
  const r=await request(manager);await service.transition(manager,'project',r.id,{action:'analysis',revision:0});await assert.rejects(service.transition(manager,'project',r.id,estimate),{code:'FINANCIAL_ACCESS_REQUIRED'});
  await service.transition(owner,'project',r.id,estimate);assert.ok(!('amount' in (await service.list(manager,'project',{})).items[0].latest));
  await assert.rejects(service.transition(owner,'project',r.id,{action:'decide',revision:1,state:'approved',comment:''}),{code:'CLIENT_ONLY'});
  await assert.rejects(service.transition(client,'project',r.id,apply),{code:'FINANCIAL_ACCESS_REQUIRED'});
 });
 test('changed clients cannot inherit previous requests or approvals',async()=>{
  const r=await approved();await pool.query("update projects set client_id='other-client'");assert.equal((await service.list({...client,id:'foreign'},'project',{})).items.length,0);await assert.rejects(service.transition(owner,'project',r.id,apply),{code:'CLIENT_CHANGED'});
  await service.transition(owner,'project',r.id,{action:'cancel',revision:1,reason:'Client changed'});
 });
 test('changed deadlines require a revised plan; optional date application leaves official dates intact',async()=>{
  const r=await approved();await pool.query("update projects set end_date='2026-11-01'");await assert.rejects(service.transition(owner,'project',r.id,apply),{code:'DEADLINE_CHANGED'});
  await service.transition(owner,'project',r.id,{...apply,applyDate:false});assert.equal((await pool.query("select to_char(end_date, 'YYYY-MM-DD') as end_date from projects")).rows[0].end_date,'2026-11-01');
 });
 test('included changes require zero price and cannot prepare additional billing',async()=>{
  const r=await request();await assert.rejects(service.transition(owner,'project',r.id,{...estimate,classification:'included'}),{code:'INCLUDED_MUST_BE_FREE'});
  await service.transition(owner,'project',r.id,{...estimate,classification:'included',amount:'0'});await service.transition(client,'project',r.id,{action:'decide',revision:1,state:'approved',comment:''});await assert.rejects(service.transition(owner,'project',r.id,apply),{code:'NO_ADDITIONAL_CHARGE'});
 });
 test('cancellation requires a reason, prevents application and never changes the budget',async()=>{
  const r=await request(client);await assert.rejects(service.transition(client,'project',r.id,{action:'cancel',revision:0,reason:''}),{code:'INVALID_INPUT'});await service.transition(client,'project',r.id,{action:'cancel',revision:0,reason:'No longer needed'});await assert.rejects(service.transition(owner,'project',r.id,estimate),{code:'INVALID_STATE'});
 });
 test('attachments must belong to the project and client; stored versions do not follow later replacements',async()=>{
  await pool.query(`insert into files(id,name,organization_id,project_id,client_id,uploaded_by,created_at,updated_at) values('file','Brief','org','project','client','owner',now(),now());insert into file_versions(id,file_id,url,name,size,type,version_number,uploaded_by,created_at) values('v1','file','https://example.test/brief.pdf','Brief',12,'application/pdf',1,'owner',now())`);
  const r=await request(client,{fileIds:['file']});await pool.query(`insert into file_versions(id,file_id,url,name,size,type,version_number,uploaded_by,created_at) values('v2','file','https://example.test/revised.pdf','Revised',20,'application/pdf',2,'owner',now())`);assert.equal((await service.list(client,'project',{changeId:r.id})).items[0].attachments[0].versionId,'v1');
  await assert.rejects(request(client,{fileIds:['unknown']}),{code:'INVALID_FILES'});await pool.query("update files set client_id='other-client'");await assert.rejects(request(owner,{fileIds:['file']}),{code:'INVALID_FILES'});
 });
 test('revision of an approved request invalidates the earlier approval and captures the current deadline',async()=>{
  const r=await approved();await pool.query("update projects set end_date='2026-11-01'");await service.transition(owner,'project',r.id,{...estimate,revision:1,endDate:'2026-11-15'});
  await assert.rejects(service.transition(owner,'project',r.id,{...apply,revision:2}),{code:'INVALID_STATE'});
  await service.transition(client,'project',r.id,{action:'decide',revision:2,state:'approved',comment:''});await service.transition(owner,'project',r.id,{...apply,revision:2});
  assert.equal((await pool.query("select to_char(end_date,'YYYY-MM-DD') d from projects")).rows[0].d,'2026-11-15');
 });
 test('scope changes are visible in audit while prices remain hidden from managers',async()=>{
  const r=await request();await service.transition(owner,'project',r.id,estimate);const reader=require('../src/modules/audit/read').createAuditRead(pool),day=new Date().toISOString().slice(0,10),filter={from:day,to:day,resourceType:'change_request'};
  const financial=await reader.read(owner,filter),restricted=await reader.read(manager,filter);
  assert.ok(financial.events.some(e=>e.changes.amount));assert.ok(restricted.events.length>0);assert.ok(restricted.events.every(e=>!e.changes.amount&&!e.changes.currency));assert.ok(!(await reader.read(manager,filter,true)).csv.includes('BRL'));
 });
 test('requests and version history are paginated; original proposal references are scoped to the client',async()=>{
  await pool.query(`insert into proposals(id,organization_id,client_id,created_by,project_title,client_name,status,created_at,updated_at) values('proposal','org','client','owner','Original scope','Client','approved',now(),now());insert into proposal_project_conversions(source_id,proposal_id,project_id,organization_id,created_by,source_version,source_title) values('proposal','proposal','project','org','owner','snapshot','Original scope')`);
  const r=await request();assert.equal((await service.list(owner,'project',{})).items[0].source.version,'snapshot');
  for(let i=0;i<11;i++)await request();const first=await service.list(owner,'project',{}),second=await service.list(owner,'project',{page:2});assert.equal(first.items.length,10);assert.equal(second.items.length,2);assert.equal(new Set([...first.items,...second.items].map(i=>i.id)).size,12);
  for(let i=0;i<12;i++)await service.transition(owner,'project',r.id,{...estimate,revision:i});const versions=await service.list(owner,'project',{changeId:r.id});assert.equal(versions.items[0].history.length,10);assert.equal(versions.items[0].hasMoreVersions,true);
  assert.equal((await service.list(owner,'project',{changeId:r.id,versionPage:2})).items[0].history.length,2);
  await pool.query("update proposals set client_id='other-client'");const other=await request();assert.equal((await service.list(owner,'project',{changeId:other.id})).items[0].source,null);
 });
 test('disabled estimate guard prevents startup',async()=>{
  await pool.query('alter table scope_change_versions disable trigger scope_version_immutable');try{await assert.rejects(require('../src/utils/release-migrations.util').runReleaseMigrations(pool),/Required database guards unavailable/);}finally{await pool.query('alter table scope_change_versions enable trigger scope_version_immutable');}
 });
 test('concurrent applications respect the plan task limit and failed quota applies nothing',async()=>{
  const a=await approved(),b=await approved();await pool.query('update organizations set override_max_tasks=1');
  const options={...apply,applyDate:false};const results=await Promise.allSettled([service.transition(owner,'project',a.id,options),service.transition(owner,'project',b.id,options)]);assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(results.find(r=>r.status==='rejected').reason.code,'PLAN_LIMIT_REACHED');
  const rows=(await service.list(owner,'project',{})).items;assert.equal(rows.filter(r=>r.state==='applied').length,1);assert.equal(rows.find(r=>r.state==='approved').application,null);
  const applied=rows.find(r=>r.state==='applied');assert.equal((await service.transition(owner,'project',applied.id,options)).existing,true);
 });
 test('audit failure rolls back all application effects and can safely retry',async()=>{
  const r=await approved();await pool.query("create function fail_scope_audit() returns trigger language plpgsql as $$begin if NEW.action='change_request.applied' then raise exception 'test'; end if; return NEW;end$$;create trigger fail_scope before insert on business_audit_events for each row execute function fail_scope_audit()");
  try{await assert.rejects(service.transition(owner,'project',r.id,apply));assert.equal((await pool.query('select count(*)::int n from tasks')).rows[0].n,0);assert.equal((await service.list(owner,'project',{})).items[0].state,'approved');}finally{await pool.query('drop trigger fail_scope on business_audit_events;drop function fail_scope_audit()');}
  await service.transition(owner,'project',r.id,apply);
 });
}

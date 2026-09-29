const {test,before,beforeEach,after}=require('node:test');const assert=require('node:assert/strict');
if(!process.env.ONBOARDING_TEST_DATABASE_URL)test('Onboarding PostgreSQL',{skip:true},()=>{});
else{
 const url=new URL(process.env.ONBOARDING_TEST_DATABASE_URL);assert.ok(url.hostname==='127.0.0.1'&&url.port==='55442'&&url.pathname==='/flowlio_onboarding_test');
 const {Pool}=require('pg'),pool=new Pool({connectionString:url.toString()}),service=require('../src/modules/onboarding/service').createOnboarding(pool);
 const actor={id:'owner',role:'user',organizationId:'org-a',isOrganizationOwner:true};
 before(async()=>{await pool.query('drop schema public cascade;create schema public;drop schema if exists flowlio_releases cascade;drop schema if exists drizzle cascade');await require('../src/utils/release-migrations.util').runReleaseMigrations(pool)});
 beforeEach(async()=>{await pool.query(`truncate users,organizations cascade;
 insert into users(id,name,email,role,status,email_verified,two_factor_enabled,is_super_admin,timezone,created_at,updated_at) values('owner','Owner','owner@example.test','user','active',true,false,false,'UTC',now(),now()),('other','Other','other@example.test','user','active',true,false,false,'UTC',now(),now());
 insert into organizations(id,name,slug,created_at,updated_at) values('org-a','A','a',now(),now()),('org-b','B','b',now(),now());`);});
 after(()=>pool.end());
 async function project(){await pool.query("insert into projects(id,name,project_number,organization_id,created_by,visibility,created_at,updated_at) values('project','Project','1','org-a','owner','private',now(),now())")}
 test('legacy manual checks and step clicks cannot fabricate core activation',async()=>{await pool.query(`insert into user_onboarding(id,user_id,role,dismissed,steps,created_at,updated_at) values('legacy','owner','admin',true,'{"create_client":{"completedAt":"2026-09-21"}}',now(),now())`);const r=await service.refresh(actor);assert.equal(r.metrics.completed,0);assert.equal(r.dismissed,false);await assert.rejects(service.refresh(actor,{step:'create_client'}),{code:'STEP_NOT_COMPLETE'});await assert.rejects(service.refresh(actor,{step:'invented'}),{code:'INVALID_STEP'});});
 test('real client, accessible project and client decision activate the core and retain milestones',async()=>{await pool.query("update organizations set settings=$1 where id='org-a'",[JSON.stringify({currency:'ILS'})]);await pool.query("insert into clients(id,name,email,organization_id,created_by,created_at,updated_at) values('client','Client','client@example.test','org-a','owner',now(),now())");await project();let r=await service.refresh(actor);assert.equal(r.metrics.completed,3);assert.equal(r.completedAt,null);await pool.query("insert into delivery_reviews(id,project_id,organization_id,source_version,title,note,state,decided_by,decided_at) values('review','project','org-a','version','Design','Review','approved','other',now())");r=await service.refresh(actor);assert.equal(r.metrics.completed,4);assert.ok(r.completedAt);const completed=new Date(r.completedAt).toISOString();await service.refresh(actor,{dismissed:true});await pool.query('delete from delivery_reviews');r=await service.refresh(actor,{dismissed:false});assert.equal(new Date(r.completedAt).toISOString(),completed);assert.equal(r.metrics.completed,4);});
 test('organization and role switches have independent progress and dismissals',async()=>{await project();await service.refresh(actor,{dismissed:true});const b=await service.refresh({...actor,organizationId:'org-b'});assert.equal(b.metrics.completed,0);assert.equal(b.dismissed,false);const member=await service.refresh({...actor,isOrganizationOwner:false});assert.deepEqual(Object.keys(member.steps),['complete_task','log_time','update_profile']);assert.equal(member.metrics.completed,0);assert.equal(member.dismissed,false);assert.equal((await service.refresh(actor)).dismissed,true);});
 test('private foreign-authored projects do not count towards manager progress',async()=>{await project();await pool.query("update projects set created_by='other'");const r=await service.refresh({...actor,isOrganizationOwner:false,isOrganizationManager:true});assert.equal(r.steps.create_project,null);});
 test('member steps require own completed work in the active organization',async()=>{await project();await pool.query("insert into tasks(id,title,project_id,created_by,assigned_to,visibility,status,created_at,updated_at) values('task','Task','project','owner','owner','private','completed',now(),now());insert into time_entries(id,user_id,project_id,task_id,start_time,end_time,duration,status,created_at,updated_at) values('time','owner','project','task',now()-interval '1 hour',now(),60,'completed',now(),now());update users set image='profile.png' where id='owner'");const member={...actor,isOrganizationOwner:false};const r=await service.refresh(member);assert.equal(r.metrics.completed,3);const b=await service.refresh({...member,organizationId:'org-b'});assert.equal(b.steps.log_time,null);assert.equal(b.steps.complete_task,null);assert.ok(b.steps.update_profile);});
 test('concurrent reads create one scoped record and preserve progress',async()=>{await project();await Promise.all(Array.from({length:8},()=>service.refresh(actor)));assert.equal((await pool.query('select count(*)::int n from onboarding_progress')).rows[0].n,1);assert.ok((await service.refresh(actor)).steps.create_project);});
 test('portal and platform roles cannot create organization onboarding',async()=>{for(const role of ['client','superadmin','subadmin','unknown'])await assert.rejects(service.refresh({...actor,role}),{code:'FORBIDDEN'});await assert.rejects(service.refresh({...actor,organizationId:null}),{code:'FORBIDDEN'});});
 test('owner onboarding starts with currency and cannot complete it by clicking',async()=>{
  const r=await service.refresh(actor);
  assert.deepEqual(Object.keys(r.steps),['configure_currency','create_client','create_project','approve_delivery']);
  assert.equal(r.metrics.total,4);assert.equal(r.steps.configure_currency,null);
  await assert.rejects(service.refresh(actor,{step:'configure_currency'}),{code:'STEP_NOT_COMPLETE'});
  assert.equal((await service.refresh(actor)).steps.configure_currency,null);
 });
 test('currency requires a valid supported denomination saved for the current organization',async()=>{
  for(const currency of [null,'','ils','ZZZ','JPY','KWD']){
   await pool.query("update organizations set settings=$1 where id='org-a'",[JSON.stringify({currency})]);
   const r=await service.refresh(actor);
   assert.equal(r.steps.configure_currency,null,String(currency));
   await assert.rejects(service.refresh(actor,{step:'configure_currency'}),{code:'STEP_NOT_COMPLETE'});
  }
  await pool.query("update organizations set settings=$1 where id='org-b'",[JSON.stringify({currency:'ILS'})]);
  assert.equal((await service.refresh(actor)).steps.configure_currency,null);
  assert.ok((await service.refresh({...actor,organizationId:'org-b'})).steps.configure_currency);
 });
 test('recorded ILS, EUR and USD complete the currency step without an explicit click',async()=>{
  for(const currency of ['ILS','EUR','USD']){
   await pool.query("update organizations set settings=$1 where id='org-a'",[JSON.stringify({currency})]);
   const r=await service.refresh(actor);
   assert.ok(r.steps.configure_currency);assert.equal(r.metrics.completed,1);
   assert.ok((await service.refresh(actor,{step:'configure_currency'})).steps.configure_currency);
  }
 });
 test('currency completion follows current settings while milestones and dismissals survive',async()=>{
  await pool.query(`insert into onboarding_progress(organization_id,user_id,role,steps,dismissed,completed_at)
   values('org-a','owner','admin',$1,true,'2026-09-21T12:00:00Z')`,
   [JSON.stringify({create_client:{completedAt:'2026-09-21T12:00:00Z'},create_project:{completedAt:'2026-09-21T12:00:00Z'},approve_delivery:{completedAt:'2026-09-21T12:00:00Z'}})]);
  let r=await service.refresh(actor);
  assert.equal(r.steps.configure_currency,null);assert.equal(r.metrics.completed,3);assert.equal(r.dismissed,true);
  assert.equal(new Date(r.completedAt).toISOString(),'2026-09-21T12:00:00.000Z');
  await pool.query("update organizations set settings=$1 where id='org-a'",[JSON.stringify({currency:'ILS'})]);
  r=await service.refresh(actor);assert.ok(r.steps.configure_currency);assert.equal(r.metrics.completed,4);
  await pool.query("update organizations set settings='{}' where id='org-a'");
  r=await service.refresh(actor);assert.equal(r.steps.configure_currency,null);assert.equal(r.metrics.completed,3);
  assert.equal(r.dismissed,true);assert.equal(new Date(r.completedAt).toISOString(),'2026-09-21T12:00:00.000Z');
 });
 test('manager and member onboarding exclude currency configuration',async()=>{
  for(const isOrganizationManager of [true,false]){
   const user={...actor,isOrganizationOwner:false,isOrganizationManager};
   const r=await service.refresh(user);
   assert.equal(r.metrics.total,3);assert.equal(Object.hasOwn(r.steps,'configure_currency'),false);
   await assert.rejects(service.refresh(user,{step:'configure_currency'}),{code:'INVALID_STEP'});
  }
 });

}

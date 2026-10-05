const {test,before,beforeEach,after}=require('node:test');
const assert=require('node:assert/strict');const {randomUUID}=require('node:crypto');
if(!process.env.PORTAL_INVITATION_TEST_DATABASE_URL)test('Portal invitation integration',{skip:true},()=>{});else{
 const url=new URL(process.env.PORTAL_INVITATION_TEST_DATABASE_URL);
 assert.equal(url.hostname,'127.0.0.1');assert.equal(url.port,'55442');assert.equal(url.pathname,'/flowlio_portal_invitation_test');
 const {Pool}=require('pg');const pool=new Pool({connectionString:url.href});
 const {createPortalInvitations,deliverPortalInvitation}=require('../src/modules/portal-invitations/service');
 const service=createPortalInvitations(pool,async password=>'hashed:'+password);
 const owner={id:'owner',role:'user',organizationId:'org',isOrganizationOwner:true};
 before(async()=>{await pool.query('drop schema public cascade;create schema public;drop schema if exists flowlio_releases cascade;drop schema if exists drizzle cascade');await require('../src/utils/release-migrations.util').runReleaseMigrations(pool);});
 beforeEach(async()=>{await pool.query(`truncate business_audit_events,verification,durable_jobs,users,organizations cascade;
 insert into users(id,name,email,role,status,email_verified,two_factor_enabled,is_super_admin,timezone,created_at,updated_at) values('owner','Owner','owner@example.test','user','active',true,false,false,'UTC',now(),now()),('client-user','Client','client@example.test','client','active',false,false,false,'UTC',now(),now());
 update users set is_organization_owner=true where id='owner';
 insert into organizations(id,name,slug,status,subscription_status,created_at,updated_at) values('org','Org','org','active','active',now(),now());
 insert into user_organizations(id,user_id,organization_id,role,status,created_at,updated_at) values('m','owner','org','owner','active',now(),now());
 insert into clients(id,name,email,organization_id,created_by,user_id,portal_access_enabled,created_at,updated_at) values('client','Client','client@example.test','org','owner','client-user',false,now(),now());
 insert into account(id,account_id,provider_id,user_id,password,created_at,updated_at) values('a','client-user','credential','client-user','original',now(),now());`);});
 after(()=>pool.end());
 async function invite(){const key=randomUUID();await service.issue(owner,'client',{key,language:'pt'});return(await pool.query('select payload from durable_jobs where dedupe_key=$1',['portal-invitation:'+key])).rows[0].payload;}
 test('invitation is queued once, hides token from responses, and never grants access before acceptance',async()=>{
  const key=randomUUID();const responses=await Promise.all([service.issue(owner,'client',{key}),service.issue(owner,'client',{key})]);
  assert.equal(responses[0].state,'queued');assert.equal(JSON.stringify(responses).includes('token'),false);
  assert.equal((await pool.query('select count(*)::int n from durable_jobs')).rows[0].n,1);
  assert.equal((await pool.query('select portal_access_enabled from clients')).rows[0].portal_access_enabled,false);
  const v=(await pool.query('select value from verification')).rows[0].value,job=(await pool.query('select payload from durable_jobs')).rows[0].payload;
  assert.equal(v.includes(job.token.split('.')[1]),false);
 });
 test('acceptance sets credentials and access once, verifies mailbox, and revokes prior sessions',async()=>{
  const payload=await invite();await pool.query("insert into session(id,token,user_id,expires_at,created_at,updated_at) values('s','old','client-user',now()+interval '1 day',now(),now())");
  assert.deepEqual(await service.accept({token:payload.token,password:'new-password'}),{accepted:true});
  const r=(await pool.query('select cl.portal_access_enabled,u.email_verified,a.password from clients cl join users u on u.id=cl.user_id join account a on a.user_id=u.id')).rows[0];
  assert.deepEqual(r,{portal_access_enabled:true,email_verified:true,password:'hashed:new-password'});
  assert.equal((await pool.query('select count(*)::int n from session')).rows[0].n,0);
  await assert.rejects(service.accept({token:payload.token,password:'other-password'}),{code:'INVITATION_INVALID'});
  assert.equal((await service.status(owner,'client')).state,'active');
 });
 test('expiry, revocation and replacement make old links unusable',async()=>{
  const old=await invite();await pool.query("update verification set expires_at=now()-interval '1 minute',created_at=now()-interval '2 minutes'");
  assert.equal((await service.status(owner,'client')).state,'expired');await assert.rejects(service.accept({token:old.token,password:'valid-password'}),{code:'INVITATION_INVALID'});
  const fresh=await invite();await service.revoke(owner,'client');await assert.rejects(service.accept({token:fresh.token,password:'valid-password'}),{code:'INVITATION_INVALID'});
  assert.equal((await service.status(owner,'client')).state,'not_invited');
 });
 test('forged client flags, unrelated organizations and changed recipients never grant access',async()=>{
  await assert.rejects(service.issue({...owner,role:'client'},'client',{key:randomUUID()}),{code:'FORBIDDEN'});
  await assert.rejects(service.status({...owner,organizationId:'other'},'client'),{code:'CLIENT_NOT_FOUND'});
  const payload=await invite();await pool.query("update clients set email='changed@example.test'");
  await assert.rejects(service.accept({token:payload.token,password:'valid-password'}),{code:'INVITATION_INVALID'});
  assert.equal((await pool.query('select password from account')).rows[0].password,'original');
 });
 test('revoked issuer permission invalidates both delivery and acceptance',async()=>{
  const payload=await invite();await pool.query("update user_organizations set status='inactive'");
  const c=await pool.connect();let sent=0;try{await deliverPortalInvitation(c,payload,'https://example.test',async()=>{sent++;return true;});}finally{c.release();}
  assert.equal(sent,0);await assert.rejects(service.accept({token:payload.token,password:'valid-password'}),{code:'INVITATION_INVALID'});
 });
 test('provider acknowledgement is required and token is removed after confirmed delivery',async()=>{
  const payload=await invite();const c=await pool.connect();try{
   await assert.rejects(deliverPortalInvitation(c,payload,'https://example.test',async()=>false),/unconfirmed/);
   await deliverPortalInvitation(c,payload,'https://example.test',async(email,name,title,message,link)=>{assert.equal(email,'client@example.test');assert.ok(title.includes('Convite'));assert.equal(new URL(link).pathname,'/portal-invitation');assert.equal(new URL(link).search,'');assert.ok(new URL(link).hash.includes('token='));return true;});
  }finally{c.release();}
  assert.equal((await pool.query('select payload from durable_jobs')).rows[0].payload.token,undefined);
 });
 test('concurrent acceptance has a single winner and audited completion',async()=>{
  const payload=await invite();const r=await Promise.allSettled([service.accept({token:payload.token,password:'password-one'}),service.accept({token:payload.token,password:'password-two'})]);
  assert.equal(r.filter(v=>v.status==='fulfilled').length,1);
  assert.equal((await pool.query("select count(*)::int n from business_audit_events where action='client.portal_invitation_accepted'")).rows[0].n,1);
 });
 test('resending rotates the link and does not reset an already active account',async()=>{
  const old=await invite();await assert.rejects(invite(),{code:'INVITATION_COOLDOWN'});await pool.query("update verification set created_at=now()-interval '2 minutes'");
  const fresh=await invite();await assert.rejects(service.accept({token:old.token,password:'valid-password'}),{code:'INVITATION_INVALID'});
  await service.accept({token:fresh.token,password:'valid-password'});await assert.rejects(invite(),{code:'PORTAL_ALREADY_ACTIVE'});
 });
}

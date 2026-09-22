const { test, before, beforeEach, after } = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
if (!process.env.AUDIT_TEST_DATABASE_URL) test('Business audit PostgreSQL', { skip: true }, () => {});
else {
  const url = new URL(process.env.AUDIT_TEST_DATABASE_URL);
  assert.ok(['127.0.0.1','localhost'].includes(url.hostname) && url.port === '55442' && url.pathname === '/flowlio_audit_test');
  const { Pool } = require('pg');
  const pool = new Pool({ connectionString: url.toString() });
  const schema = require('../src/schema/schema');
  const database = require('drizzle-orm/node-postgres').drizzle(pool, { schema, casing: 'snake_case' });
  const { setAuditContext, setDrizzleAuditContext } = require('../src/modules/audit/context');
  const { runReleaseMigrations } = require('../src/utils/release-migrations.util');
  const delivery = require('../src/modules/delivery/service').createDeliveryReviews(pool);
  const original = Module._load;
  Module._load = function(name, ...args) {
    if (name.includes('configs/connection.config')) return { database, connection: pool };
    if (name.includes('utils/logger.util')) return { logger: { info(){},error(){},warn(){},debug(){} } };
    if (name.includes('utils/activity.util')) return { logActivity: async () => {} };
    if (name.includes('utils/superadmin-notification.util')) return { notifySuperAdmins: async () => {} };
    if (name.includes('utils/cloudinary.util')) return { uploadToCloudinary: async () => { throw Error('External upload forbidden'); } };
    return original.call(this,name,...args);
  };
  const { updateProject } = require('../src/controllers/organization/projects/updateproject.controller');
  const { setOrganizationManager } = require('../src/controllers/organization/user-management/setorganizationmanager.controller');
  Module._load = original;
  const owner = { id:'owner',role:'user',organizationId:'org-a',isOrganizationOwner:true };
  const clientActor = { id:'client-user',role:'client',organizationId:'org-a' };
  const context = { organizationId:'org-a',actorKind:'human',actorId:'owner',operationId:'test-operation' };
  const response = () => ({ code:200,status(code){this.code=code;return this;},json(body){this.body=body;return this;} });
  const events = async () => (await pool.query('select * from business_audit_events order by occurred_at,id')).rows;
  async function transaction(callback, identity = context) {
    const c=await pool.connect();try {await c.query('begin');await setAuditContext(c,identity);const result=await callback(c);await c.query('commit');return result;}
    catch(error){await c.query('rollback');throw error;}finally{c.release();}
  }
  before(async () => {
    await pool.query('drop schema public cascade;create schema public;drop schema if exists flowlio_releases cascade;drop schema if exists drizzle cascade');
    await runReleaseMigrations(pool);
  });
  beforeEach(async () => {
    await pool.query(`truncate users,organizations cascade;truncate business_audit_events;
      insert into users(id,name,email,role,is_organization_manager,email_verified,two_factor_enabled,is_super_admin,timezone,created_at,updated_at) values
      ('owner','Owner','owner@example.test','user',false,true,false,false,'UTC',now(),now()),
      ('client-user','Client','client@example.test','client',false,true,false,false,'UTC',now(),now()),
      ('member','Member','member@example.test','viewer',false,true,false,false,'UTC',now(),now());
      insert into organizations(id,name,slug,created_at,updated_at) values ('org-a','A','a',now(),now()),('org-b','B','b',now(),now());
      insert into clients(id,name,email,organization_id,user_id,created_by,created_at,updated_at) values ('client','Client','client@example.test','org-a','client-user','owner',now(),now());
      insert into projects(id,name,project_number,organization_id,client_id,created_by,status,visibility,budget,created_at,updated_at) values
      ('project','Project','1','org-a','client','owner','pending','private',100,now(),now()),
      ('foreign','Foreign','2','org-b',null,'owner','pending','private',200,now(),now());
      insert into project_milestones(id,project_id,organization_id,title,status,position,created_at,updated_at) values ('milestone','project','org-a','Design','in_progress',0,now(),now());
      insert into user_organizations(id,user_id,organization_id,role,status,created_at,updated_at) values
      ('owner-membership','owner','org-a','owner','active',now(),now()),('membership','member','org-a','viewer','active',now(),now());
      insert into user_management(id,firstname,lastname,email,companyname,phonenumber,userrole,setpermission,password,organization_id,status,is_active,created_by,created_at,updated_at)
      values ('member-record','Member','Test','member@example.test','Test','000','viewer','view','DO-NOT-AUDIT','org-a','active',true,'owner',now(),now());
      truncate business_audit_events;`);
  });
  after(() => pool.end());
  test('actual project controller records only changed allowed fields and authenticated actor',async()=>{
    const res=response();await updateProject({user:owner,params:{id:'project'},body:{budget:150,status:'ongoing',description:'PRIVATE-CONTENT',endDate:'2026-12-01T00:00:00.000Z'}},res);
    assert.equal(res.code,200);const [row]=await events();assert.equal(row.actor_id,'owner');assert.equal(row.actor_kind,'human');assert.equal(row.organization_id,'org-a');assert.equal(row.project_id,'project');
    assert.deepEqual(Object.keys(row.changes).sort(),['budget','end_date','status']);assert.deepEqual(row.changes.budget,{before:100,after:150});assert.ok(row.operation_id);assert.ok(row.occurred_at instanceof Date);assert.ok(!JSON.stringify(row).includes('PRIVATE-CONTENT'));
  });
  test('concurrent retries of identical writes create one actual change',async()=>{
    await Promise.all(Array.from({length:12},()=>transaction(c=>c.query("update projects set budget=150 where id='project'"))));
    assert.equal((await events()).length,1);
  });
  test('rollback removes both mutation and receipt',async()=>{
    await assert.rejects(transaction(async c=>{await c.query("update projects set budget=999 where id='project'");throw Error('rollback');}));
    assert.equal((await events()).length,0);assert.equal((await pool.query("select budget from projects where id='project'")).rows[0].budget,'100.00');
  });
  test('audit storage failure rolls back the real project controller mutation',async()=>{
    await pool.query("create function fail_audit() returns trigger language plpgsql as $$ begin raise exception 'audit unavailable';end $$;create trigger fail_audit before insert on business_audit_events for each row execute function fail_audit()");
    try{const res=response();await updateProject({user:owner,params:{id:'project'},body:{budget:555}},res);assert.equal(res.code,500);assert.equal((await pool.query("select budget from projects where id='project'")).rows[0].budget,'100.00');assert.equal((await events()).length,0);}
    finally{await pool.query('drop trigger fail_audit on business_audit_events;drop function fail_audit()');}
  });
  test('cross-organization context rejects the mutation and forged body organization is rejected',async()=>{
    await assert.rejects(transaction(c=>c.query("update projects set budget=999 where id='foreign'")),/Invalid business audit context/);
    for(const body of [{budget:300},{budget:300,organizationId:'org-b'}]){const res=response();await updateProject({user:owner,params:{id:'foreign'},body},res);assert.equal(res.code,body.organizationId ? 400 : 404);}
    assert.equal((await events()).length,0);
  });
  test('legacy writer is explicitly unattributed and pooled identity never leaks',async()=>{
    const c=await pool.connect();try{
      await c.query('begin');await setAuditContext(c,context);await c.query("update projects set budget=150 where id='project'");await c.query('commit');
      await c.query("update projects set budget=160 where id='project'");
    }finally{c.release();}
    const rows=await events();assert.equal(rows[0].actor_id,'owner');assert.equal(rows[1].actor_kind,'unknown');assert.equal(rows[1].actor_id,null);
  });
  test('system mutations record their operation reference with Drizzle',async()=>{
    await database.transaction(async tx=>{await setDrizzleAuditContext(tx,{organizationId:'org-a',actorKind:'system',actorId:'automation:project-status',operationId:'job-123'});await tx.execute(require('drizzle-orm').sql`update projects set status='ongoing' where id='project'`);});
    const [row]=await events();assert.equal(row.actor_kind,'system');assert.equal(row.operation_id,'job-123');
  });
  test('permission changes exclude arbitrary JSON and preserve only known booleans',async()=>{
    await transaction(c=>c.query(`update user_organizations set role='user',permissions=$1 where id='membership'`,[JSON.stringify({canManageUsers:true,canManageBilling:true,token:'SECRET',canViewAnalytics:'SECRET'})]));
    const [row]=await events();assert.deepEqual(row.changes.permissions.after,{canManageUsers:true,canManageBilling:true});assert.ok(!JSON.stringify(row).includes('SECRET'));
  });
  test('manager promotion commits matching role representations and a single operation reference',async()=>{
    const res=response();await setOrganizationManager({user:owner,params:{memberId:'member-record'},body:{setAsManager:true}},res);assert.equal(res.code,200);
    const rows=await events();assert.equal(rows.length,2);assert.equal(new Set(rows.map(r=>r.operation_id)).size,1);assert.ok(rows.every(r=>r.actor_id==='owner'));
    assert.equal((await pool.query("select is_organization_manager from users where id='member'")).rows[0].is_organization_manager,true);
    const retry=response();await setOrganizationManager({user:owner,params:{memberId:'member-record'},body:{setAsManager:true}},retry);assert.equal((await events()).length,2);
  });
  test('failed promotion rolls back user flag, member role and membership role together',async()=>{
    await pool.query("create function fail_audit() returns trigger language plpgsql as $$ begin raise exception 'audit unavailable';end $$;create trigger fail_audit before insert on business_audit_events for each row execute function fail_audit()");
    try{const res=response();await setOrganizationManager({user:owner,params:{memberId:'member-record'},body:{setAsManager:true}},res);assert.equal(res.code,500);
      assert.equal((await pool.query("select is_organization_manager from users where id='member'")).rows[0].is_organization_manager,false);
      assert.equal((await pool.query("select userrole from user_management where id='member-record'")).rows[0].userrole,'viewer');assert.equal((await events()).length,0);
    }finally{await pool.query('drop trigger fail_audit on business_audit_events;drop function fail_audit()');}
  });
  test('delivery decisions are attributed to the client, versioned and deduplicated without private text',async()=>{
    const milestone=(await delivery.list(owner,'project')).milestones[0];
    const review=await delivery.request(owner,'project',{milestoneId:milestone.id,version:milestone.version,note:'PRIVATE-NOTE'});
    await Promise.all(Array.from({length:8},()=>delivery.decide(clientActor,'project',review.id,{version:milestone.version,state:'approved',comment:'PRIVATE-COMMENT'})));
    const rows=await events();assert.equal(rows.length,2);assert.equal(rows[0].changes.source_version.after,milestone.version);assert.equal(rows[1].actor_id,'client-user');assert.deepEqual(rows[1].changes.state,{before:'pending',after:'approved'});assert.ok(!JSON.stringify(rows).includes('PRIVATE-'));
    await assert.rejects(delivery.decide({...clientActor,organizationId:'org-b'},'project',review.id,{version:milestone.version,state:'approved'}));assert.equal((await events()).length,2);
  });
  test('empty updates and excluded content produce no audit events',async()=>{
    await pool.query("update projects set budget=100,description='SECRET',updated_at=now() where id='project'");assert.equal((await events()).length,0);
  });
  test('history survives resource deletion and cannot be rewritten or deleted',async()=>{
    await transaction(c=>c.query("update projects set budget=null where id='project'"));
    await pool.query("delete from projects where id='project'");assert.equal((await events()).length,1);
    await assert.rejects(pool.query("update business_audit_events set actor_id='forged'"),/append-only/);
    await assert.rejects(pool.query('delete from business_audit_events'),/append-only/);
  });
  test('startup refuses a disabled audit trigger',async()=>{
    await pool.query('alter table projects disable trigger projects_business_audit');
    try{await assert.rejects(runReleaseMigrations(pool),/Required database guards/);}finally{await pool.query('alter table projects enable trigger projects_business_audit');}
  });
}


const { test, before, beforeEach, after } = require('node:test');
const assert = require('node:assert/strict');
if (!process.env.AUDIT_READ_TEST_DATABASE_URL) test('Audit read PostgreSQL', { skip: true }, () => {});
else {
  const url = new URL(process.env.AUDIT_READ_TEST_DATABASE_URL);
  assert.ok(['localhost','127.0.0.1'].includes(url.hostname) && url.port === '55442' && url.pathname === '/flowlio_audit_read_test');
  const { Pool } = require('pg');
  const pool = new Pool({ connectionString: url.toString() });
  const { createAuditRead, csvCell } = require('../src/modules/audit/read');
  const service = createAuditRead(pool);
  const actor = { id: 'owner', role: 'user', organizationId: 'org-a', isOrganizationOwner: true };
  const period = { from: '2026-09-01', to: '2026-09-30' };
  before(async () => {
    await pool.query('drop schema public cascade; create schema public; drop schema if exists flowlio_releases cascade; drop schema if exists drizzle cascade');
    await require('../src/utils/release-migrations.util').runReleaseMigrations(pool);
  });
  beforeEach(async () => {
    await pool.query(`truncate business_audit_events, users, organizations cascade;
      insert into users(id,name,email,role,status,email_verified,two_factor_enabled,is_super_admin,timezone,created_at,updated_at) values ('owner','Alex','owner@example.test','user','active',true,false,false,'UTC',now(),now()),('foreign','Foreign name','foreign@example.test','user','active',true,false,false,'UTC',now(),now());
      insert into organizations(id,name,slug,created_at,updated_at) values ('org-a','A','a',now(),now()),('org-b','B','b',now(),now());
      insert into user_organizations(id,user_id,organization_id,role,status,created_at,updated_at) values ('m1','owner','org-a','owner','active',now(),now()),('m2','foreign','org-b','owner','active',now(),now());
      insert into clients(id,name,email,organization_id,created_by,created_at,updated_at) values ('client','Client','client@example.test','org-a','owner',now(),now());
      insert into projects(id,name,project_number,organization_id,client_id,created_by,visibility,created_at,updated_at) values ('project','Project','1','org-a','client','owner','private',now(),now()),('private','Private','2','org-a','client','foreign','private',now(),now());
      truncate business_audit_events;`);
  });
  after(() => pool.end());
  async function event(id, options = {}) {
    const o = { org: 'org-a', kind: 'human', actor: 'owner', resource: 'project', resourceId: 'project', project: 'project', changes: { status: { before: 'todo', after: 'completed' } }, at: '2026-09-15T12:00:00.000001Z', ...options };
    await pool.query('insert into business_audit_events(id,organization_id,actor_kind,actor_id,action,resource_type,resource_id,project_id,operation_id,changes,occurred_at) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)', [id,o.org,o.kind,o.actor,o.resource+'.update',o.resource,o.resourceId,o.project,'op-'+id,JSON.stringify(o.changes),o.at]);
  }
  test('current permissions scope both consultation and export, including private/deleted projects', async () => {
    await event('visible'); await event('foreign',{org:'org-b'}); await event('private',{project:'private'}); await event('deleted',{project:'missing'});
    assert.deepEqual((await service.read(actor,period)).events.map(e=>e.id),['visible']);
    const csv = (await service.read(actor,period,true)).csv;
    assert.ok(csv.includes('op-visible')); assert.ok(!csv.includes('op-private') && !csv.includes('op-foreign') && !csv.includes('op-deleted'));
    for (const role of ['client','operator','viewer']) await assert.rejects(service.read({...actor,role},period),{code:'FORBIDDEN'});
    await assert.rejects(service.read({...actor,organizationId:null},period),{code:'FORBIDDEN'});
  });
  test('financial and membership fields are removed before filtering and pagination', async () => {
    await event('mixed',{changes:{budget:{before:100,after:200},status:{before:'todo',after:'done'},secret:{after:'NEVER'}}});
    await event('financial',{changes:{budget:{before:200,after:300}}});
    await event('membership',{resource:'organization_membership',resourceId:'m1',project:null,changes:{role:{before:'member',after:'manager'}}});
    const manager={...actor,isOrganizationOwner:false,isOrganizationManager:true};
    const r=await service.read(manager,period); assert.deepEqual(r.events.map(e=>e.id),['mixed']); assert.deepEqual(Object.keys(r.events[0].changes),['status']);
    assert.ok(!(await service.read(manager,period,true)).csv.includes('budget'));
    const owner=await service.read(actor,period); assert.equal(owner.events.length,3); assert.ok(!JSON.stringify(owner).includes('NEVER'));
  });
  test('filters combine person, resource, action, project and UTC day boundaries', async () => {
    await event('start',{at:'2026-09-01T00:00:00Z'}); await event('end',{at:'2026-09-30T23:59:59.999999Z'}); await event('outside',{at:'2026-10-01T00:00:00Z'});
    const query={...period,person:'ale',resourceType:'project',action:'project.update',resourceId:'project',projectId:'project',actorId:'owner'};
    assert.deepEqual((await service.read(actor,query)).events.map(e=>e.id),['end','start']);
    assert.equal((await service.read(actor,{...query,person:'missing'})).events.length,0);
    assert.equal((await service.read(actor,{...query,projectId:'foreign'})).events.length,0);
  });
  test('pagination preserves microseconds and equal timestamps without duplicates or omissions', async () => {
    for(let i=0;i<107;i++) await event('event-'+i.toString().padStart(3,'0'),{at:i<54?'2026-09-15T12:00:00.000002Z':'2026-09-15T12:00:00.000001Z'});
    let cursor, ids=[]; do {const r=await service.read(actor,{...period,...(cursor?{cursor}:{})}); assert.ok(r.events.length<=50); ids.push(...r.events.map(e=>e.id)); cursor=r.nextCursor;}while(cursor);
    assert.equal(ids.length,107); assert.equal(new Set(ids).size,107);
  });
  test('actor names never join across organizations; system and unknown remain explicit', async () => {
    await event('human',{actor:'foreign'}); await event('system',{kind:'system',actor:'worker'}); await event('unknown',{kind:'unknown',actor:null});
    const r=await service.read(actor,period); assert.ok(r.events.every(e=>e.actor_name===null)); assert.equal((await service.read(actor,{...period,person:'Foreign name'})).events.length,0);
  });
  test('invalid filters and forged cursors are rejected without mutating history', async () => {
    for(const query of [{...period,from:'2026-02-30'},{...period,to:'2025-01-01'},{...period,to:'2030-01-01'},{...period,resourceType:'users'},{...period,unexpected:'x'}]) await assert.rejects(service.read(actor,query),{code:'INVALID_FILTERS'});
    await assert.rejects(service.read(actor,{...period,cursor:'invalid'}),{code:'INVALID_CURSOR'});
    await event('immutable'); await assert.rejects(pool.query("update business_audit_events set action='changed'")); await assert.rejects(pool.query('delete from business_audit_events'));
  });
  test('CSV escapes quotes, line breaks and spreadsheet formulas; export has a hard limit', async () => {
    assert.equal(csvCell(' =HYPERLINK("x")'),'"\' =HYPERLINK(""x"")"'); assert.equal(csvCell('a\nb'),'"a\nb"');
    await pool.query("update users set name='=1+1' where id='owner'"); await event('formula');
    assert.ok((await service.read(actor,period,true)).csv.includes('"\'=1+1"'));
    await pool.query(`insert into business_audit_events(id,organization_id,actor_kind,action,resource_type,resource_id,project_id,operation_id,changes,occurred_at) select 'bulk-'||n,'org-a','unknown','project.update','project','project','project','bulk','{"status":{"before":"todo","after":"done"}}'::jsonb,'2026-09-15'::timestamptz from generate_series(1,5000)n`);
    await assert.rejects(service.read(actor,period,true),{code:'EXPORT_TOO_LARGE'});
  });
}

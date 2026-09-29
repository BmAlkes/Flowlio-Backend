const { test, before, beforeEach, after } = require('node:test');
const assert = require('node:assert/strict');

if (!process.env.MILESTONE_TEST_DATABASE_URL) test('Milestone controller PostgreSQL', { skip: true }, () => {});
else {
  const url = new URL(process.env.MILESTONE_TEST_DATABASE_URL);
  assert.ok(['localhost', '127.0.0.1'].includes(url.hostname) && url.port === '55442' && url.pathname === '/flowlio_milestone_test');
  const { Pool } = require('pg');
  const pool = new Pool({ connectionString: url.toString() });
  const schema = require('../src/schema/schema');
  const db = require('drizzle-orm/node-postgres').drizzle(pool, { schema, casing: 'snake_case' });
  const Module = require('node:module'), originalLoad = Module._load;
  let controller;
  Module._load = function (name, ...args) {
    if (name.endsWith('configs/connection.config')) return { database: db, connection: pool };
    return originalLoad.call(this, name, ...args);
  };
  try { controller = require('../src/controllers/organization/projects/milestones.controller'); }
  finally { Module._load = originalLoad; }
  const { createDeliveryReviews, milestoneVersion } = require('../src/modules/delivery/service');
  const service = createDeliveryReviews(pool);
  const owner = { id: 'owner', role: 'user', organizationId: 'org-a', isOrganizationOwner: true };
  const client = { id: 'client-user', role: 'client', organizationId: 'org-a' };

  before(async () => {
    await pool.query('drop schema public cascade;create schema public;drop schema if exists flowlio_releases cascade;drop schema if exists drizzle cascade');
    await require('../src/utils/release-migrations.util').runReleaseMigrations(pool);
  });
  beforeEach(async () => {
    await pool.query(`truncate users,organizations cascade;
      insert into users(id,name,email,email_verified,two_factor_enabled,is_super_admin,timezone,created_at,updated_at)
        values ('owner','Owner','owner@example.test',true,false,false,'UTC',now(),now()),('client-user','Client','client@example.test',true,false,false,'UTC',now(),now());
      insert into organizations(id,name,slug,created_at,updated_at) values ('org-a','A','a',now(),now()),('org-b','B','b',now(),now());
      insert into clients(id,name,email,organization_id,user_id,portal_access_enabled,created_by,created_at,updated_at)
        values ('client','Client','client@example.test','org-a','client-user',true,'owner',now(),now());
      insert into projects(id,name,project_number,organization_id,client_id,created_by,visibility,created_at,updated_at)
        values ('project','Project','1','org-a','client','owner','private',now(),now()),('other-project','Other','2','org-a','client','owner','private',now(),now());
      insert into project_milestones(id,project_id,organization_id,title,status,position,due_date,created_at,updated_at)
        values ('milestone','project','org-a','Design','in_progress',0,'2026-10-01 00:00:00',now(),'2026-09-29 12:34:56.123456');`);
  });
  after(() => pool.end());

  async function invoke(action, body, overrides = {}) {
    const req = { params: { projectId: 'project', id: 'milestone' }, user: owner, body, ...overrides };
    const res = { statusCode: 200, status(code) { this.statusCode = code; return this; }, json(value) { this.body = value; return this; } };
    await controller[action](req, res);
    return res;
  }
  async function current(id = 'milestone') {
    return (await pool.query('select * from project_milestones where id=$1', [id])).rows[0];
  }
  async function version(id = 'milestone') { return milestoneVersion(await current(id)); }

  test('create trims titles, accepts leap dates and explicitly cleared dates', async () => {
    for (const dueDate of ['2028-02-29', '', null, undefined]) {
      const res = await invoke('createMilestone', { title: '  Delivery milestone  ', dueDate });
      assert.equal(res.statusCode, 201);
      assert.equal(res.body.data.title, 'Delivery milestone');
      assert.equal(res.body.data.status, 'pending');
      assert.equal(res.body.data.dueDate?.toISOString().slice(0, 10) ?? null, dueDate || null);
    }
    assert.equal((await invoke('createMilestone', { title: 'x'.repeat(255) })).statusCode, 201);
  });

  test('create and update reject empty or oversized titles and invalid calendar inputs without writing', async () => {
    const before = await version();
    for (const title of ['', '  ', null, 8, 'x'.repeat(256)]) {
      for (const action of ['createMilestone', 'updateMilestone']) {
        const res = await invoke(action, { title });
        assert.equal(res.statusCode, 400);
        assert.equal(res.body.code, 'INVALID_MILESTONE');
      }
    }
    for (const dueDate of ['2026-02-29', '2026-04-31', '2028-02-30', '2026-13-01', '2026-00-01', '0000-01-01', '2026-1-01', '2026-01-01T00:00:00.000Z', 'not-a-date', 0, {}, []]) {
      for (const action of ['createMilestone', 'updateMilestone']) {
        const res = await invoke(action, { title: 'Valid title', dueDate });
        assert.equal(res.statusCode, 400, `${action}: ${JSON.stringify(dueDate)}`);
        assert.equal(res.body.code, 'INVALID_MILESTONE');
      }
    }
    assert.equal(await version(), before);
    assert.equal((await pool.query('select count(*)::int n from project_milestones')).rows[0].n, 1);
  });

  test('update preserves omitted status, clears dates and keeps unversioned callers compatible', async () => {
    let res = await invoke('updateMilestone', { title: '  Revised  ', dueDate: null });
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.data.title, 'Revised');
    assert.equal(res.body.data.dueDate, null);
    assert.equal(res.body.data.status, 'in_progress');
    res = await invoke('updateMilestone', { dueDate: '2028-02-29', status: 'completed' });
    assert.equal(res.statusCode, 200);
    assert.ok(res.body.data.completedAt);
    const completion = res.body.data.completedAt.getTime();
    res = await invoke('updateMilestone', { dueDate: '', status: 'completed' });
    assert.equal(res.body.data.dueDate, null);
    assert.equal(res.body.data.completedAt.getTime(), completion);
    res = await invoke('updateMilestone', { status: 'in_progress' });
    assert.equal(res.body.data.completedAt, null);
  });

  test('versions validate before writes and stale snapshots cannot overwrite newer work', async () => {
    const original = await version();
    for (const patch of [{ version: '' }, { version: 'g'.repeat(64) }, { version: null }, { version: 123 }, { status: 'approved' }]) {
      const res = await invoke('updateMilestone', patch);
      assert.equal(res.statusCode, 400);
      assert.equal(res.body.code, 'INVALID_MILESTONE');
    }
    assert.equal(await version(), original);
    const updated = await invoke('updateMilestone', { title: 'Changed', version: original });
    assert.equal(updated.statusCode, 200);
    const stale = await invoke('updateMilestone', { title: 'Overwrite', version: original });
    assert.equal(stale.statusCode, 409);
    assert.equal(stale.body.code, 'SOURCE_CHANGED');
    assert.equal((await current()).title, 'Changed');
  });

  test('competing versioned edits serialize and only one can change the selected snapshot', async () => {
    const selected = await version();
    const results = await Promise.all(['First', 'Second'].map(title => invoke('updateMilestone', { title, version: selected })));
    assert.deepEqual(results.map(r => r.statusCode).sort(), [200, 409]);
    assert.equal((await current()).title, results.find(r => r.statusCode === 200).body.data.title);
    assert.equal(results.find(r => r.statusCode === 409).body.code, 'SOURCE_CHANGED');
  });

  test('organization and project boundaries continue to reject inaccessible milestones', async () => {
    const before = await version();
    assert.equal((await invoke('createMilestone', { title: 'Foreign' }, { user: { ...owner, organizationId: 'org-b' } })).statusCode, 403);
    assert.equal((await invoke('updateMilestone', { title: 'Foreign' }, { user: { ...owner, organizationId: 'org-b' } })).statusCode, 403);
    assert.equal((await invoke('updateMilestone', { title: 'Foreign project' }, { params: { projectId: 'other-project', id: 'milestone' } })).statusCode, 404);
    assert.equal((await invoke('updateMilestone', { title: 'Missing' }, { params: { projectId: 'project', id: 'missing' } })).statusCode, 404);
    assert.equal((await invoke('updateMilestone', { title: 'Anonymous' }, { user: undefined })).statusCode, 401);
    assert.equal(await version(), before);
  });

  test('version comparison uses the delivery raw PG timestamp snapshot outside UTC', async () => {
    const previousTimezone = process.env.TZ;
    try {
      process.env.TZ = 'America/New_York';
      const selected = (await service.list(owner, 'project')).milestones.find(m => m.id === 'milestone');
      const res = await invoke('updateMilestone', { title: 'Timezone safe', version: selected.version });
      assert.equal(res.statusCode, 200);
    } finally {
      if (previousTimezone === undefined) delete process.env.TZ;
      else process.env.TZ = previousTimezone;
    }
  });

  test('create, client changes, intentional unchanged revision and a new approval preserve old receipts', async () => {
    const created = await invoke('createMilestone', { title: '  Final design  ', dueDate: '2026-12-01' });
    assert.equal(created.statusCode, 201);
    const id = created.body.data.id;
    const selected = (await service.list(owner, 'project')).milestones.find(m => m.id === id);
    const first = await service.request(owner, 'project', { milestoneId: id, version: selected.version, clientId: 'client', note: 'Initial design for review' });
    await service.decide(client, 'project', first.id, { version: selected.version, state: 'changes_requested', comment: 'Adjust spacing in the attached design' });
    const revised = await invoke('updateMilestone', { title: 'Final design', dueDate: '2026-12-01', version: selected.version }, { params: { projectId: 'project', id } });
    assert.equal(revised.statusCode, 200);
    assert.equal(revised.body.data.status, 'pending');
    const next = (await service.list(owner, 'project')).milestones.find(m => m.id === id);
    assert.notEqual(next.version, selected.version);
    assert.equal(next.currentReview, null);
    const second = await service.request(owner, 'project', { milestoneId: id, version: next.version, clientId: 'client', note: 'Spacing adjusted in the attachment' });
    assert.notEqual(second.id, first.id);
    await service.decide(client, 'project', second.id, { version: next.version, state: 'approved', comment: 'Accepted' });
    const history = (await service.list(owner, 'project')).reviews;
    assert.equal(history.find(r => r.id === first.id).state, 'changes_requested');
    assert.equal(history.find(r => r.id === first.id).comment, 'Adjust spacing in the attached design');
    assert.equal(history.find(r => r.id === second.id).state, 'approved');
    assert.equal((await current(id)).status, 'pending');
  });
}

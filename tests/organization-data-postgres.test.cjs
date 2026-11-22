const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');

// Real PostgreSQL: per-organization backup/restore, full deletion and spreadsheet import must never touch
// another organization and must survive the protection triggers (audit, invoice numbering).
if (!process.env.ORGANIZATION_DATA_TEST_DATABASE_URL) {
  test('Organization data PostgreSQL integration (set ORGANIZATION_DATA_TEST_DATABASE_URL)', { skip: true }, () => {});
} else {
  const url = new URL(process.env.ORGANIZATION_DATA_TEST_DATABASE_URL);
  assert.ok(['localhost', '127.0.0.1'].includes(url.hostname) && url.port === '55442' && url.pathname === '/flowlio_organization_data_test', 'Dedicated local test database only');
  const { Pool } = require('pg');
  const pool = new Pool({ connectionString: url.toString() });
  const { createBackup, listBackups, runScheduledBackups } = require('../src/modules/organization-data/backup');
  const { restoreOrganization } = require('../src/modules/organization-data/restore');
  const { deleteOrganizationCompletely, trackInactiveOrganizations, runAutoDeletion } = require('../src/modules/organization-data/deletion');
  const { importRows } = require('../src/modules/organization-data/import');
  const { exportOrganization } = require('../src/modules/privacy/organization-export');

  const snapshot = async org => ({
    projects: (await pool.query('select id,name from projects where organization_id=$1 order by id', [org])).rows,
    tasks: (await pool.query('select t.id,t.title,t.parent_id from tasks t join projects p on p.id=t.project_id where p.organization_id=$1 order by t.id', [org])).rows,
    invoices: (await pool.query('select id,invoice_number,amount from invoices where organization_id=$1 order by id', [org])).rows,
    clients: (await pool.query('select id,name from clients where organization_id=$1 order by id', [org])).rows,
  });

  before(async () => {
    await pool.query('drop schema public cascade; create schema public; drop schema if exists flowlio_releases cascade; drop schema if exists drizzle cascade');
    await require('../src/utils/release-migrations.util').runReleaseMigrations(pool);
    await pool.query(`
      insert into users(id,name,email,email_verified,two_factor_enabled,is_super_admin,timezone,created_at,updated_at) values
        ('owner-a','Owner A','owner-a@example.test',true,false,false,'UTC',now(),now()),
        ('member-a','Member A','member-a@example.test',true,false,false,'UTC',now(),now()),
        ('shared','Shared','shared@example.test',true,false,false,'UTC',now(),now()),
        ('owner-b','Owner B','owner-b@example.test',true,false,false,'UTC',now(),now());
      insert into organizations(id,name,slug,subscription_status,created_at,updated_at) values ('org-a','A','a','active',now(),now()),('org-b','B','b','active',now(),now());
      insert into user_organizations(id,user_id,organization_id,role,status,created_at,updated_at) values
        ('m1','owner-a','org-a','owner','active',now(),now()),('m2','member-a','org-a','member','active',now(),now()),
        ('m3','shared','org-a','member','active',now(),now()),('m4','shared','org-b','member','active',now(),now()),('m5','owner-b','org-b','owner','active',now(),now());
      insert into clients(id,name,email,organization_id,created_by,created_at,updated_at) values ('c-a','Client A','ca@example.test','org-a','owner-a',now(),now()),('c-b','Client B','cb@example.test','org-b','owner-b',now(),now());
      insert into projects(id,name,project_number,organization_id,created_by,status,visibility,created_at,updated_at) values
        ('p-a','Site A','P1','org-a','owner-a','pending','private',now(),now()),('p-b','Site B','P1','org-b','owner-b','pending','private',now(),now());
      insert into tasks(id,title,project_id,created_by,status,visibility,created_at,updated_at) values
        ('t-a1','Parent','p-a','owner-a','todo','private',now(),now()),('t-b1','Other org','p-b','owner-b','todo','private',now(),now());
      insert into tasks(id,title,project_id,parent_id,created_by,status,visibility,created_at,updated_at) values ('t-a2','Subtask','p-a','t-a1','owner-a','todo','private',now(),now());
      insert into invoices(id,organization_id,client_id,created_by,invoice_number,client_name,amount,status,created_at,updated_at) values
        ('i-a','org-a','c-a','owner-a','S1-00042','Client A',100,'draft',now(),now()),('i-b','org-b','c-b','owner-b','S1-00042','Client B',200,'draft',now(),now());
    `);
    await pool.query(`insert into business_audit_events(id,organization_id,actor_kind,actor_id,action,resource_type,resource_id,project_id,operation_id,changes,occurred_at)
      values('audit-a','org-a','user','owner-a','project.update','project','p-a','p-a','op-a','{}',now())`);
  });
  after(() => pool.end());

  test('export and backup only contain the organization', async () => {
    const exported = await exportOrganization(pool, 'org-a');
    assert.deepEqual(exported.data.projects.map(row => row.id), ['p-a']);
    assert.deepEqual(exported.data.tasks.map(row => row.id).sort(), ['t-a1', 't-a2']);
    assert.ok(JSON.stringify(exported).indexOf('org-b') === -1);
    const backup = await createBackup(pool, 'org-a', 'manual', 'owner-a');
    assert.ok(backup.row_count > 0 && backup.size_bytes > 0);
  });

  test('restore brings back one organization exactly, keeps invoice numbers and leaves the other alone', async () => {
    const original = await snapshot('org-a');
    const otherBefore = await snapshot('org-b');
    const [backup] = await listBackups(pool, 'org-a');
    await pool.query("update projects set name='Renamed' where id='p-a'");
    await pool.query("delete from tasks where id='t-a2'");
    await pool.query("insert into projects(id,name,project_number,organization_id,created_by,status,visibility,created_at,updated_at) values ('p-new','New','P2','org-a','owner-a','pending','private',now(),now())");
    await pool.query("update user_organizations set status='inactive' where id='m2'");
    const changed = await snapshot('org-a');

    const dry = await restoreOrganization(pool, { organizationId: 'org-a', backupId: backup.id, dryRun: true, actorId: 'owner-b' });
    assert.equal(dry.dryRun, true);
    assert.deepEqual(await snapshot('org-a'), changed, 'a dry run changes nothing');

    const report = await restoreOrganization(pool, { organizationId: 'org-a', backupId: backup.id, dryRun: false, actorId: 'owner-b' });
    assert.ok(report.preRestoreBackupId);
    assert.deepEqual(await snapshot('org-a'), original);
    assert.deepEqual(await snapshot('org-b'), otherBefore);
    assert.equal((await pool.query("select status from user_organizations where id='m2'")).rows[0].status, 'inactive', 'team access is never restored');
    assert.equal((await pool.query("select count(*)::int n from business_audit_events where organization_id='org-a'")).rows[0].n, 1, 'audit history is kept');
    // The pre-restore backup undoes the restore.
    await restoreOrganization(pool, { organizationId: 'org-a', backupId: report.preRestoreBackupId, dryRun: false, actorId: 'owner-b' });
    assert.deepEqual(await snapshot('org-a'), changed);
    await restoreOrganization(pool, { organizationId: 'org-a', backupId: backup.id, dryRun: false, actorId: 'owner-b' });
    await assert.rejects(restoreOrganization(pool, { organizationId: 'org-b', backupId: backup.id, dryRun: true, actorId: null }), { code: 'WRONG_ORGANIZATION' });
  });

  test('scheduled backups run once a day per organization', async () => {
    const first = await runScheduledBackups(pool, 10);
    assert.equal(first, 2);
    assert.equal(await runScheduledBackups(pool, 10), 0);
  });

  test('spreadsheet import creates projects with milestones, tasks and leads, skipping duplicates', async () => {
    const tasks = await importRows(pool, { id: 'owner-a', organizationId: 'org-a' }, { kind: 'tasks', rows: [
      { project: 'Site A', title: 'Copy', status: 'Working on it', assigneeEmail: 'member-a@example.test' },
      { project: 'Imported board', title: 'Kickoff', status: 'Done', startDate: '2026-02-01' },
      { project: 'Imported board', title: '' },
    ] });
    assert.deepEqual([tasks.created, tasks.projectsCreated, tasks.skipped.length], [2, 1, 1]);
    const imported = (await pool.query("select id from projects where organization_id='org-a' and name='Imported board'")).rows[0];
    assert.equal((await pool.query('select count(*)::int n from project_milestones where project_id=$1', [imported.id])).rows[0].n, 4);
    assert.equal((await pool.query("select status from tasks where title='Kickoff'")).rows[0].status, 'completed');
    const leads = await importRows(pool, { id: 'owner-a', organizationId: 'org-a' }, { kind: 'leads', rows: [{ name: 'Lead', email: 'ca@example.test' }, { name: 'New', email: 'new@example.test', status: 'Qualified' }] });
    assert.deepEqual([leads.created, leads.skipped[0].reason], [1, 'duplicate email']);
    assert.equal((await pool.query("select status,type from clients where email='new@example.test'")).rows[0].status, 'Qualified');
  });

  test('inactive organizations are deleted only when enabled, after the warning, without touching others', async () => {
    await pool.query("update organizations set subscription_status='cancelled' where id='org-a'");
    assert.equal((await trackInactiveOrganizations(pool)).started, 1);
    await pool.query("update organizations set inactive_since=now()-interval '100 days' where id='org-a'");
    const warned = [];
    const first = await runAutoDeletion(pool, { enabled: true, warn: async owner => { warned.push(owner.email); } });
    assert.deepEqual([first.warned, first.deleted, warned], [1, 0, ['owner-a@example.test']]);
    await pool.query("update organizations set deletion_warning_sent_at=now()-interval '15 days' where id='org-a'");
    const otherBefore = await snapshot('org-b');
    const second = await runAutoDeletion(pool, { enabled: true, warn: async () => {} });
    assert.equal(second.deleted, 1);
    assert.equal((await pool.query("select count(*)::int n from organizations where id='org-a'")).rows[0].n, 0);
    assert.equal((await pool.query("select count(*)::int n from projects where organization_id='org-a'")).rows[0].n, 0);
    assert.equal((await pool.query("select count(*)::int n from organization_backups where organization_id='org-a'")).rows[0].n, 0);
    assert.deepEqual(await snapshot('org-b'), otherBefore);
    const people = Object.fromEntries((await pool.query("select id, deleted_at is not null deleted from users")).rows.map(row => [row.id, row.deleted]));
    assert.deepEqual(people, { 'owner-a': true, 'member-a': true, shared: false, 'owner-b': false });
  });

  test('deleting an organization that no longer exists is harmless', async () => {
    await deleteOrganizationCompletely(pool, 'org-a', 'test');
    assert.equal((await pool.query("select count(*)::int n from tasks where project_id='p-a'")).rows[0].n, 0);
  });
}

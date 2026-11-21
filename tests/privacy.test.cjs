const { test } = require('node:test'); const assert = require('node:assert/strict');
process.env.BETTER_AUTH_SECRET = process.env.BETTER_AUTH_SECRET || 'test-secret-for-token-encryption-000000';
const { encryptToken, decryptToken, isEncryptedToken } = require('../src/utils/token-crypto.util');
const { exportUserData, requestAccountDeletion, anonymizeUser, pruneRetention, RETENTION, PrivacyError } = require('../src/modules/privacy/service');

test('OAuth tokens are encrypted at rest and legacy plaintext still reads', () => {
  const stored = encryptToken('ya29.secret-access-token');
  assert.ok(isEncryptedToken(stored));
  assert.ok(!stored.includes('secret-access-token'));
  assert.notEqual(encryptToken('same'), encryptToken('same'), 'each value gets its own IV');
  assert.equal(decryptToken(stored), 'ya29.secret-access-token');
  assert.equal(decryptToken('1//legacy-refresh-token'), '1//legacy-refresh-token');
  assert.equal(encryptToken(stored), stored, 'already encrypted values are not wrapped twice');
  assert.equal(encryptToken(null), null); assert.equal(encryptToken(undefined), undefined);
  const tampered = stored.slice(0, -2) + (stored.endsWith('AA') ? 'BB' : 'AA');
  assert.throws(() => decryptToken(tampered));
});

function fakePool(rowsFor = () => []) {
  const queries = [];
  const client = { query: async (sql, params) => { queries.push({ sql, params }); return { rows: rowsFor(sql), rowCount: rowsFor(sql).length }; }, release() {} };
  return { queries, query: client.query, connect: async () => client };
}

test('the export leaves out passwords, tokens and secrets and logs the request', async () => {
  const pool = fakePool(sql => sql.startsWith('select * from users') ? [{ id: 'u1', email: 'ana@x.test', name: 'Ana' }]
    : sql.includes('from user_management') ? [{ email: 'ana@x.test', password: 'hash' }]
    : sql.includes('from account') ? [{ provider_id: 'google', access_token: 'x', refresh_token: 'y' }] : []);
  const out = await exportUserData(pool, { id: 'u1', email: 'ana@x.test' });
  assert.deepEqual(out.data.profile, [{ id: 'u1', email: 'ana@x.test', name: 'Ana' }]);
  assert.deepEqual(out.data.teamMemberRecords, [{ email: 'ana@x.test' }]);
  assert.deepEqual(out.data.connectedAccounts, [{ provider_id: 'google' }]);
  assert.ok(!JSON.stringify(out).match(/hash|"x"|"y"/));
  assert.ok(pool.queries.some(q => q.sql.startsWith('insert into privacy_requests') && q.params[3] === 'export' && q.params[4] === 'completed'));
});

test('members are anonymized in one transaction without deleting shared work', async () => {
  const pool = fakePool(sql => sql.startsWith('select email from users') ? [{ email: 'bia@x.test' }] : []);
  const result = await requestAccountDeletion(pool, { id: 'u2', organizationId: 'o1', isOrganizationOwner: false });
  assert.equal(result.status, 'completed');
  const sqls = pool.queries.map(q => q.sql);
  assert.equal(sqls[0], 'BEGIN'); assert.ok(sqls.includes('COMMIT'));
  const userUpdate = pool.queries.find(q => q.sql.includes('update users set'));
  assert.equal(userUpdate.params[1], 'deleted-u2@deleted.flowlio.invalid');
  assert.match(userUpdate.sql, /deleted_at=now\(\)/);
  assert.ok(sqls.some(s => s === 'delete from account where user_id=$1'), 'credentials and OAuth tokens are removed');
  assert.ok(!sqls.some(s => /delete from (users|tasks|projects|session)\b/.test(s)), 'no hard delete of users, shared work or access logs');
  assert.ok(sqls.some(s => s.startsWith('update session set token=')), 'sessions are revoked');
});

test('owners and super admins cannot self-delete instantly', async () => {
  const pool = fakePool();
  assert.deepEqual(await requestAccountDeletion(pool, { id: 'o', organizationId: 'org', isOrganizationOwner: true }), { status: 'pending' });
  assert.ok(pool.queries.some(q => q.sql.startsWith('insert into privacy_requests') && q.params[4] === 'pending'));
  assert.ok(!pool.queries.some(q => q.sql.includes('update users set')));
  await assert.rejects(requestAccountDeletion(pool, { id: 's', isSuperAdmin: true }), PrivacyError);
});

test('anonymizing an unknown user rolls back', async () => {
  const pool = fakePool();
  await assert.rejects(anonymizeUser(pool, 'missing'), { code: 'NOT_FOUND' });
  assert.ok(pool.queries.some(q => q.sql === 'ROLLBACK'));
});

test('retention keeps access logs for the 6 months the Marco Civil requires and keeps going after a failure', async () => {
  assert.match(RETENTION.find(r => r.name === 'expired-sessions').sql, /6 months/);
  let calls = 0; const failed = [];
  const fs = require('node:fs'); const os = require('node:os'); const path = require('node:path');
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'flowlio-uploads-'));
  const old = path.join(folder, 'old.pdf'), fresh = path.join(folder, 'fresh.pdf');
  fs.writeFileSync(old, 'x'); fs.writeFileSync(fresh, 'x');
  const twoDaysAgo = new Date(Date.now() - 48 * 3600 * 1000); fs.utimesSync(old, twoDaysAgo, twoDaysAgo);
  await pruneRetention({ query: async () => { calls++; if (calls === 1) throw new Error('boom'); return { rows: [] }; } }, step => failed.push(step), folder);
  assert.ok(!fs.existsSync(old), 'leftover uploads older than a day are removed');
  assert.ok(fs.existsSync(fresh), 'files of requests still running are kept');
  fs.rmSync(folder, { recursive: true, force: true });
  assert.equal(calls, RETENTION.length);
  assert.deepEqual(failed, ['expired-sessions']);
});

const { exportOrganization, childTablesInOrder } = require('../src/modules/privacy/organization-export');
const fk = (child, column, parent, parentColumn = 'id') => ({ child, column, parent, parentColumn });

test('child tables are read after all of their parents and shared tables are never walked into', () => {
  const fks = [fk('tasks', 'project_id', 'projects'), fk('task_links', 'task_id', 'tasks'), fk('task_links', 'file_id', 'files'),
    fk('files', 'task_id', 'tasks'), fk('tasks', 'assigned_to', 'users'), fk('sessions_like', 'user_id', 'users'), fk('session', 'x', 'projects')];
  const order = childTablesInOrder(['projects'], ['projects', 'tasks', 'files', 'task_links', 'sessions_like', 'session', 'users'], fks);
  assert.deepEqual(order, ['tasks', 'files', 'task_links']);
});

test('the organization export only reads this organization, follows children and strips secrets', async () => {
  const queries = [];
  const pool = { query: async (sql, params = []) => {
    queries.push({ sql, params });
    if (sql.includes('information_schema.columns')) return { rows: [
      ...['id', 'organization_id', 'name'].map(c => ({ table_name: 'projects', column_name: c })),
      ...['id', 'project_id', 'title'].map(c => ({ table_name: 'tasks', column_name: c })),
      ...['id', 'organization_id', 'secret'].map(c => ({ table_name: 'lead_webhooks', column_name: c })),
      ...['id', 'organization_id', 'token'].map(c => ({ table_name: 'session', column_name: c })),
    ] };
    if (sql.includes('pg_constraint')) return { rows: [{ child: 'tasks', column: 'project_id', parent: 'projects', parent_column: 'id' }] };
    if (sql.startsWith('select * from "projects"')) return { rows: [{ id: 'p1', organization_id: params[0], name: 'Site' }] };
    if (sql.startsWith('select * from "lead_webhooks"')) return { rows: [{ id: 'w1', organization_id: params[0], secret: 's3cret' }] };
    if (sql.startsWith('select * from "tasks"')) return { rows: [{ id: 't1', project_id: 'p1', title: 'Hero' }] };
    if (sql.includes('from organizations')) return { rows: [{ id: 'org1', name: 'Agency', paypal_api_key: 'k' }] };
    return { rows: [] };
  } };
  const out = await exportOrganization(pool, 'org1');
  assert.equal(out.format, 'flowlio-organization-export/1');
  assert.deepEqual(out.data.tasks, [{ id: 't1', project_id: 'p1', title: 'Hero' }]);
  assert.deepEqual(out.data.lead_webhooks, [{ id: 'w1', organization_id: 'org1' }]);
  assert.ok(!('session' in out.data), 'credential tables are excluded');
  assert.equal(out.organization.paypal_api_key, undefined);
  const taskQuery = queries.find(q => q.sql.startsWith('select * from "tasks"'));
  assert.deepEqual(taskQuery.params, [['p1']], 'children are filtered by the exported parent ids');
  assert.ok(queries.filter(q => q.sql.startsWith('select * from "projects"')).every(q => q.params[0] === 'org1'));
});

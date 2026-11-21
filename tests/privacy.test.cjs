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
  await pruneRetention({ query: async () => { calls++; if (calls === 1) throw new Error('boom'); return { rows: [] }; } }, step => failed.push(step));
  assert.equal(calls, RETENTION.length);
  assert.deepEqual(failed, ['expired-sessions']);
});

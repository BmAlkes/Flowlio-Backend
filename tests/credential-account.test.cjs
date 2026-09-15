const { test, before, beforeEach, after } = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
const { PgDialect } = require('drizzle-orm/pg-core');
const { hashPassword, verifyPassword } = require('better-auth/crypto');
let accounts, hash, updates, lookups;
const user = { id: 'alice', twoFactorEnabled: true };
const dialect = new PgDialect();
const database = {
  query: {
    account: { findFirst: async ({ where }) => {
      const query = dialect.sqlToQuery(where);
      lookups.push(query);
      // Evaluate the account lookup against linked-provider fixtures. The old
      // user-only lookup selects Google first and reproduces the reported error.
      const requestedUser = query.params[0];
      const provider = query.params[1];
      return accounts.find(row => row.userId === requestedUser && (!provider || row.providerId === provider));
    } },
    users: { findFirst: async () => user },
  },
  update: () => ({ set: value => ({ where: () => ({ returning: async () => {
    updates.push(value); return [{ ...user, ...value }];
  } }) }) }),
};
const original = Module._load;
Module._load = function(id, ...args) {
  if (id === '@/configs/connection.config') return { database };
  if (id === '@/utils/logger.util') return { logger: { info() {}, error() {}, warn() {} } };
  if (id === '@/lib/auth') return { auth: { $context: Promise.resolve({ password: { verify: verifyPassword } }) } };
  return original.call(this, id, ...args);
};
const { verifyCurrentUserPassword } = require('../src/controllers/user/verifyuserpassword.controller');
const { patchUserProfile } = require('../src/controllers/user/patchuserprofile.controller');
after(() => { Module._load = original; });
before(async () => { hash = await hashPassword('correct-password'); });
beforeEach(() => {
  updates = []; lookups = [];
  accounts = [
    { userId: 'alice', providerId: 'google', password: null },
    { userId: 'bob', providerId: 'credential', password: hash },
    { userId: 'alice', providerId: 'credential', password: hash },
  ];
});
async function invoke(handler, password = 'correct-password', identity = user) {
  const response = { statusCode: 200, body: undefined,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; } };
  await handler({ user: identity, body: { password, twoFactorEnabled: false } }, response);
  return response;
}
for (const [label, handler] of [
  ['2FA setup password verification', verifyCurrentUserPassword],
  ['2FA disable', patchUserProfile],
]) {
  test(`${label}: Google linked before credentials does not hide the valid password`, async () => {
    const response = await invoke(handler);
    assert.equal(response.statusCode, 200);
    assert.match(lookups[0].sql, /"provider_id"/);
    assert.deepEqual(lookups[0].params, ['alice', 'credential']);
    if (handler === patchUserProfile) assert.equal(updates[0].twoFactorEnabled, false);
  });
  test(`${label}: credentials-only account still works`, async () => {
    accounts = accounts.filter(row => row.providerId === 'credential');
    assert.equal((await invoke(handler)).statusCode, 200);
  });
  test(`${label}: wrong password is rejected without changing 2FA`, async () => {
    const response = await invoke(handler, 'wrong-password');
    assert.equal(response.statusCode, 400); assert.equal(response.body.message, 'Incorrect password');
    assert.equal(updates.length, 0);
  });
  test(`${label}: another user's password account cannot authorize this user`, async () => {
    accounts = accounts.filter(row => row.userId !== 'alice' || row.providerId !== 'credential');
    assert.equal((await invoke(handler)).statusCode, 400); assert.equal(updates.length, 0);
  });
  test(`${label}: provider without credentials is not treated as a password account`, async () => {
    accounts = [{ userId: 'alice', providerId: 'google', password: hash }];
    assert.equal((await invoke(handler)).statusCode, 400); assert.equal(updates.length, 0);
  });
  test(`${label}: anonymous and empty password are rejected before account lookup`, async () => {
    assert.equal((await invoke(handler, 'correct-password', null)).statusCode, 401);
    assert.equal((await invoke(handler, '')).statusCode, 400);
    assert.equal(lookups.length, 0); assert.equal(updates.length, 0);
  });
}

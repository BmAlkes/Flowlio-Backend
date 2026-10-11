const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
const logs = [];
const writes = [];
const database = {
  query: { users: { findFirst: async () => null } },
  insert: () => ({ values: value => ({ returning: async () => { writes.push(value); return [value]; } }) }),
};
const original = Module._load;
Module._load = function(id, ...args) {
  if (id === '@/configs/connection.config') return { database };
  if (id === '@/utils/logger.util') return { logger: Object.fromEntries(['info', 'warn', 'error'].map(key => [key, (...data) => logs.push(data)])) };
  if (id === '@/utils/cloudinary.util') return { uploadToCloudinary: () => { throw new Error('Unexpected upload'); } };
  if (id === '@/utils/activity.util') return { logActivity: async () => {} };
  if (id === '@/utils/plan-access.util') return { canCreateUser: async () => ({hasAccess: true}) };
  if (id === '@/lib/auth') return {auth: {$context: Promise.resolve({password: {hash: async () => 'test-only-secret-hash'}})}};
  return original.call(this, id, ...args);
};
const {createUserMember} = require('../src/controllers/organization/user-management/createusermember.controller');
after(() => { Module._load = original; });
test('member creation never returns credentials or logs form passwords and cookies', async () => {
  const response = { code: 200, body: null, status(code) {this.code=code;return this;}, json(body) {this.body=body;return this;} };
  await createUserMember({
    method: 'POST', url: '/organizations/create-user-member',
    headers: {'content-type':'application/json', cookie:'test-session-cookie', authorization:'test-bearer-secret'},
    user: {id:'owner',organizationId:'org-a',role:'user',isOrganizationOwner:true},
    body: {firstname:'Test',lastname:'Member',email:'test@example.test',phonenumber:'+972501234567',
      userrole:'viewer',companyname:'Test org',setpermission:'view',password:'SecretPassword1!'},
  }, response);
  assert.equal(response.code,201);
  assert.equal(writes.filter(value => value.password === 'test-only-secret-hash').length,2);
  assert.deepEqual(Object.keys(response.body.data.account).sort(),['id','providerId','userId']);
  const publicData = JSON.stringify({response:response.body,logs});
  for(const secret of ['SecretPassword1!','test-only-secret-hash','test-session-cookie','test-bearer-secret'])
    assert.equal(publicData.includes(secret),false,`Secret leaked: ${secret}`);
});

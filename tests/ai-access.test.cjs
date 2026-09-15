const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
const express = require('express');
const { RateLimiterMemory } = require('rate-limiter-flexible');
const { aiContext, AIAccessError } = require('../src/utils/ai-context.util');
const original = Module._load;
let attempts = 0, quotaCalls = 0, quotaFailure, planAllowed = true, storageFailed = false;
let limiter, server, base;
const actor = { id: 'alice', role: 'user', organizationId: 'org-a' };
Module._load = function(id, ...args) {
  if (id.includes('configs/connection.config')) return { connection: {}, database: {} };
  if (id.includes('utils/logger.util')) return { logger: { error() {}, warn() {}, info() {} } };
  return original.call(this, id, ...args);
};
const { createAIRateLimit } = require('../src/middlewares/ai-rate-limit.middleware');
Module._load = original;

function freshLimiters(points = {}) {
  const create = (key, value, duration) => {
    const memory = new RateLimiterMemory({ keyPrefix: key, points: points[key] ?? value, duration });
    return { consume: async id => {
      attempts++;
      if (storageFailed) throw Error('offline');
      return memory.consume(id);
    } };
  };
  return { userMinute: create('user', 15, 60), orgMinute: create('org', 30, 60),
    orgHour: create('hour', 60, 3600), userImages: create('image', 5, 3600) };
}

beforeEach(() => {
  attempts = 0; quotaCalls = 0; quotaFailure = undefined; planAllowed = true; storageFailed = false;
  limiter = createAIRateLimit(freshLimiters());
});
before(async () => {
  Module._load = function(id, ...args) {
    if (id.includes('middlewares/auth.middleware')) return { isAuthenticated(req, res, next) {
      if (!req.headers['x-actor']) return res.status(401).json({ error: 'AUTHENTICATION_REQUIRED' });
      const role = req.headers['x-actor'];
      req.user = { ...actor, id: req.headers['x-user'] || actor.id, role,
        organizationId: req.headers['x-org'] === 'none' ? undefined : req.headers['x-org'] || actor.organizationId };
      next();
    } };
    if (id.includes('middlewares/ai-rate-limit.middleware')) return { aiRateLimit: (...a) => limiter(...a) };
    if (id.includes('middlewares/ai-limit.middleware')) return { checkAITokenLimit(_req, res, next) {
      quotaCalls++;
      if (quotaFailure) return res.status(quotaFailure).json({ error: 'QUOTA_EXCEEDED' });
      next();
    } };
    if (id.includes('utils/plan-access.util')) return { hasFeatureAccess: async () => ({ hasAccess: planAllowed }) };
    if (id.includes('utils/logger.util')) return { logger: { error() {}, warn() {}, info() {} } };
    if (id.includes('security/resource-access')) return { resourceAccess: new Proxy({}, { get: () => () => (_r, _s, n) => n() }) };
    if (id.includes('/controllers/')) return new Proxy({}, { get(_o, key) {
      if (key === 'upload') return { array: () => (_r, _s, n) => n() };
      return (req, res) => {
        const context = aiContext.getStore();
        if (req.headers['x-provider-failure']) context.failure = new AIAccessError(429, 'ORG_TOKEN_LIMIT_EXCEEDED', 'quota');
        return res.json({ success: true, identity: context?.userId, feature: context?.feature });
      };
    } });
    return original.call(this, id, ...args);
  };
  const main = require('../src/routes/ai.routes').default;
  const viewer = require('../src/routes/viewer.routes').default;
  const monitoring = require('../src/routes/ai-monitoring.routes').default;
  Module._load = original;
  const app = express();
  app.use('/api/ai', main); app.use('/api/ai', monitoring); app.use('/api/viewer', viewer);
  server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(async () => { if (server) await new Promise(resolve => server.close(resolve)); });
const request = (role, path = '/api/ai/suggestions', headers = {}) => fetch(base + path,
  { method: 'POST', headers: { ...(role ? { 'x-actor': role } : {}), ...headers } });

test('anonymous, forbidden roles, missing organization and unavailable plans never consume rate limits', async () => {
  assert.equal((await request()).status, 401);
  for (const role of ['client', 'viewer', 'unknown']) assert.equal((await request(role)).status, 403);
  assert.equal((await request('user', undefined, { 'x-org': 'none' })).status, 403);
  planAllowed = false;
  assert.equal((await request('user')).status, 403);
  assert.equal(attempts, 0); assert.equal(quotaCalls, 0);
});
test('all fifteen allowed user calls succeed; sixteenth gets 429 and Retry-After', async () => {
  for (let i = 0; i < 15; i++) assert.equal((await request('user')).status, 200);
  const blocked = await request('user');
  assert.equal(blocked.status, 429); assert.ok(Number(blocked.headers.get('retry-after')) > 0);
  assert.equal(quotaCalls, 15);
});
test('shared organization limit stops concurrent users at thirty requests', async () => {
  const results = await Promise.all(Array.from({ length: 35 }, (_, i) => request('user', undefined, { 'x-user': `u-${i}` })));
  assert.equal(results.filter(r => r.status === 200).length, 30);
  assert.equal(results.filter(r => r.status === 429).length, 5);
  assert.equal((await request('user', undefined, { 'x-org': 'org-b', 'x-user': 'other' })).status, 200);
});
test('hourly allowance admits exactly sixty calls', async () => {
  limiter = createAIRateLimit(freshLimiters({ user: 100, org: 100 }));
  for (let i = 0; i < 60; i++) assert.equal((await request('user')).status, 200);
  assert.equal((await request('user')).status, 429);
});
test('five image generations are allowed, then blocked for the hour', async () => {
  for (let i = 0; i < 5; i++) assert.equal((await request('user', '/api/ai/generate-image')).status, 200);
  assert.equal((await request('user', '/api/ai/generate-image')).status, 429);
});
test('viewer AI routes enforce plan and token quota and establish the same usage context', async () => {
  for (const status of [403, 429]) {
    quotaFailure = status;
    assert.equal((await request('viewer', '/api/viewer/ai/suggestions')).status, status);
  }
  quotaFailure = undefined;
  const response = await request('viewer', '/api/viewer/ai/suggestions');
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { success: true, identity: 'alice', feature: 'event_suggestion' });
  planAllowed = false;
  assert.equal((await request('viewer', '/api/viewer/ai/suggestions')).status, 403);
});
test('storage failure returns 503 rather than granting access or claiming a rate violation', async () => {
  storageFailed = true;
  assert.equal((await request('user')).status, 503); assert.equal(quotaCalls, 0);
});
test('legacy success fallback cannot hide a provider-side quota rejection', async () => {
  const response = await request('user', undefined, { 'x-provider-failure': 'yes' });
  assert.equal(response.status, 429);
  assert.equal((await response.json()).success, false);
});
test('superadmin keeps its rate bypass but still has an organization and usage context', async () => {
  assert.equal((await request('superadmin')).status, 200); assert.equal(attempts, 0);
  assert.equal(quotaCalls, 1);
});
test('monitoring and token purchases remain accessible when generation quota is exhausted', async () => {
  quotaFailure = 429;
  for (const path of ['/api/ai/usage', '/api/ai/limits', '/api/ai/tokens/packages']) {
    const response = await fetch(base + path, { headers: { 'x-actor': 'user' } });
    assert.equal(response.status, 200);
  }
  assert.equal((await request('user', '/api/ai/tokens/purchase')).status, 200);
  assert.equal(attempts, 0); assert.equal(quotaCalls, 0);
});
test('superadmin monitoring remains accessible without an active tenant membership', async () => {
  const response = await fetch(base + '/api/ai/limits/all', { headers: { 'x-actor': 'superadmin', 'x-org': 'none' } });
  assert.equal(response.status, 200); assert.equal(attempts, 0);
});

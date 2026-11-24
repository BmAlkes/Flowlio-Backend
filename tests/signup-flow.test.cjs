const { test } = require('node:test');
const assert = require('node:assert/strict');
const { startOrganization, periodEnd, languageFor, organizationSlug } = require('../src/modules/signup-flow/service');

function fakePool({ plan, hasOrg = false, user = { id: 'u1', email: 'ana@x.test', name: 'Ana' } }) {
  const queries = [];
  const client = {
    query: async (sql, params) => {
      queries.push({ sql, params });
      if (sql.startsWith('select id, email, name from users')) return { rows: user ? [user] : [] };
      if (sql.startsWith('select 1 from user_organizations')) return { rows: [], rowCount: hasOrg ? 1 : 0 };
      if (sql.startsWith('select id, name, price')) return { rows: plan ? [plan] : [] };
      return { rows: [], rowCount: 1 };
    },
    release: () => queries.push({ sql: 'release' }),
  };
  return { queries, connect: async () => client };
}
const now = new Date('2026-11-24T12:00:00Z');
const starter = { id: 'starter', name: 'Starter', price: '19.00', trial_days: 14, duration_type: 'monthly', duration_value: 1, features: { maxUsers: 10 } };
const free = { id: 'free', name: 'Free', price: '0.00', trial_days: 0, duration_type: 'monthly', duration_value: 1, features: {} };

test('a trial creates a trialing organization, its owner and a subscription that ends with the trial', async () => {
  const pool = fakePool({ plan: starter });
  const result = await startOrganization(pool, { userId: 'u1', planId: 'starter', mode: 'trial', organizationName: ' Estúdio Ana ', country: 'br', now });
  assert.equal(result.trialEndsAt, '2026-12-08T12:00:00.000Z');
  assert.equal(result.periodEnd, result.trialEndsAt);
  assert.equal(result.organizationName, 'Estúdio Ana');
  const org = pool.queries.find(q => q.sql.includes('insert into organizations'));
  assert.equal(org.params[4], 'BR');
  assert.equal(org.params[6], 'trialing');
  assert.equal(org.params[10], 10);
  assert.equal(JSON.parse(org.params[13]).language, 'pt');
  assert.match(org.params[2], /^estudio-ana-u1-[0-9a-f]{4}$/);
  const sub = pool.queries.find(q => q.sql.includes('insert into subscriptions'));
  assert.deepEqual([sub.params[5], sub.params[6]].map(d => d.toISOString()), ['2026-11-24T12:00:00.000Z', '2026-12-08T12:00:00.000Z']);
  assert.ok(pool.queries.some(q => q.sql.includes('insert into user_organizations') && q.sql.includes('owner')));
  assert.ok(pool.queries.some(q => q.sql === 'commit'));
});

test('a free plan is active right away and runs for one billing period', async () => {
  const pool = fakePool({ plan: free });
  const result = await startOrganization(pool, { userId: 'u1', planId: 'free', mode: 'free', now });
  assert.equal(result.trialEndsAt, null);
  assert.equal(result.periodEnd, '2026-12-24T12:00:00.000Z');
  assert.equal(result.organizationName, "ana's Organization");
  assert.equal(pool.queries.find(q => q.sql.includes('insert into organizations')).params[6], 'active');
});

test('wrong plans, missing users and accounts that already have an organization are refused and rolled back', async () => {
  const cases = [
    [{ plan: starter }, 'free', 'PLAN_REQUIRES_PAYMENT'],
    [{ plan: free }, 'trial', 'PLAN_HAS_NO_TRIAL'],
    [{ plan: { ...starter, trial_days: 0 } }, 'trial', 'PLAN_HAS_NO_TRIAL'],
    [{ plan: null }, 'trial', 'PLAN_NOT_FOUND'],
    [{ plan: starter, hasOrg: true }, 'trial', 'ALREADY_HAS_ORGANIZATION'],
    [{ plan: starter, user: null }, 'trial', 'USER_NOT_FOUND'],
  ];
  for (const [setup, mode, code] of cases) {
    const pool = fakePool(setup);
    await assert.rejects(startOrganization(pool, { userId: 'u1', planId: 'p', mode, now }), { code });
    assert.ok(pool.queries.some(q => q.sql === 'rollback'), code);
    assert.ok(!pool.queries.some(q => q.sql.startsWith('insert')), code);
    assert.equal(pool.queries.at(-1).sql, 'release');
  }
});

test('helpers: billing period, language from country and slug', () => {
  assert.equal(periodEnd({ duration_type: 'yearly', duration_value: 1 }, now).toISOString(), '2027-11-24T12:00:00.000Z');
  assert.equal(periodEnd({ duration_type: 'days', duration_value: 30 }, now).toISOString(), '2026-12-24T12:00:00.000Z');
  assert.deepEqual(['BR', 'il', 'MX', 'US', null].map(languageFor), ['pt', 'he', 'es', 'en', 'en']);
  assert.match(organizationSlug('!!!', 'abcdefghij'), /^org-abcdefgh-[0-9a-f]{4}$/);
});

const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

if (!process.env.AI_TEST_DATABASE_URL) {
  test('PostgreSQL AI quota integration (set AI_TEST_DATABASE_URL to a local test database)', { skip: true }, () => {});
} else {
  const url = new URL(process.env.AI_TEST_DATABASE_URL);
  assert.ok(['localhost', '127.0.0.1'].includes(url.hostname) && url.pathname === '/flowlio_ai_test',
    'Integration tests accept only the dedicated local flowlio_ai_test database');
  const { Pool } = require('pg');
  const { drizzle } = require('drizzle-orm/node-postgres');
  const Module = require('node:module');
  const schema = require('../src/schema/schema');
  const namespace = `ai_test_${require('node:crypto').randomUUID().replaceAll('-', '')}`;
  const pool = new Pool({ connectionString: url.toString(), max: 16, options: `-c search_path=${namespace}` });
  const database = drizzle(pool, { casing: 'snake_case', schema });
  const original = Module._load;
  Module._load = function(id, ...args) {
    if (id.includes('configs/connection.config')) return { database, connection: pool };
    if (id.includes('utils/logger.util')) return { logger: { error() {}, warn() {}, info() {} } };
    return original.call(this, id, ...args);
  };
  const { reserveAITokens, settleAITokens } = require('../src/services/ai-quota.service');
  const { insertDefaultAITokenLimit } = require('../src/utils/aiTokenLimit.util');
  const { checkAITokenLimit } = require('../src/middlewares/ai-limit.middleware');
  const { aiRateLimit } = require('../src/middlewares/ai-rate-limit.middleware');
  Module._load = original;
  const context = { organizationId: 'org-a', userId: 'alice', feature: 'conversation', endpoint: '/api/ai/conversation' };
  const actual = { promptTokens: 60, completionTokens: 40, totalTokens: 100 };
  const reserve = (amount, override = {}) => reserveAITokens({ ...context, ...override }, amount, 'gpt-4o');
  const used = async () => Number((await pool.query("select tokens_used from ai_token_limits where user_id is null order by created_at limit 1")).rows[0]?.tokens_used);
  const logs = async () => (await pool.query('select * from ai_usage_logs order by created_at')).rows;

  before(async () => {
    await pool.query(`create schema "${namespace}"`);
    await pool.query(`
      create table ai_token_limits (
        id text primary key, organization_id text not null, user_id text, feature text,
        token_limit integer not null, tokens_used integer not null, period text not null default 'monthly',
        reset_at timestamp, alert_threshold_percent integer not null, is_active boolean not null,
        created_at timestamp not null, updated_at timestamp not null,
        unique (organization_id, user_id, feature)
      );
      create table ai_usage_logs (
        id text primary key, organization_id text not null, user_id text not null, feature text not null,
        provider text not null default 'openai', model text, prompt_tokens integer not null,
        completion_tokens integer not null, total_tokens integer not null, status text not null default 'success',
        endpoint text, duration_ms integer, error_message text, metadata json, created_at timestamp not null
      );
      create table throttle (key varchar(255) primary key, points integer not null default 0, expire bigint);
    `);
  });
  beforeEach(async () => {
    await pool.query('truncate ai_usage_logs, ai_token_limits, throttle');
    await insertDefaultAITokenLimit('org-a', 1000);
  });
  after(async () => {
    try { await pool.query(`drop schema if exists "${namespace}" cascade`); } finally { await pool.end(); }
  });

  test('PostgreSQL: concurrent organization reservations cannot spend the same balance', async () => {
    const results = await Promise.allSettled(Array.from({ length: 20 }, (_, i) => reserve(400, { userId: `u-${i}` })));
    assert.equal(results.filter(r => r.status === 'fulfilled').length, 2);
    assert.ok(results.filter(r => r.status === 'rejected').every(r => r.reason.status === 429));
    assert.equal(await used(), 800); assert.equal((await logs()).length, 2);
  });
  test('PostgreSQL: concurrent user reservations respect personal quota', async () => {
    await database.insert(schema.aiTokenLimits).values({ organizationId: 'org-a', userId: 'alice', tokenLimit: 600 });
    const results = await Promise.allSettled([reserve(400), reserve(400)]);
    assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
    assert.equal(results.find(r => r.status === 'rejected').reason.status, 403);
    assert.equal(await used(), 400);
  });
  test('PostgreSQL: usage is settled once even when completion is delivered concurrently twice', async () => {
    const reservation = await reserve(400);
    await Promise.all([settleAITokens(reservation, actual, 'success'), settleAITokens(reservation, actual, 'success')]);
    assert.equal(await used(), 100);
    const entries = await logs();
    assert.equal(entries.length, 1); assert.equal(entries[0].total_tokens, 100); assert.equal(entries[0].status, 'success');
    await reserve(900); assert.equal(await used(), 1000);
    await assert.rejects(reserve(1), { status: 429 });
  });
  test('PostgreSQL: definite provider failure refunds once and creates no extra log', async () => {
    const reservation = await reserve(400);
    const zero = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };
    await settleAITokens(reservation, zero, 'error'); await settleAITokens(reservation, zero, 'error');
    assert.equal(await used(), 0); assert.equal((await logs()).length, 1);
    assert.equal((await logs())[0].status, 'error');
  });
  test('PostgreSQL: independent organizations do not share quota', async () => {
    await insertDefaultAITokenLimit('org-b', 1000);
    await Promise.all([reserve(1000), reserve(1000, { organizationId: 'org-b' })]);
    assert.equal((await logs()).length, 2);
  });
  test('PostgreSQL: creating a missing organization quota never bypasses an existing personal quota', async () => {
    await pool.query('delete from ai_token_limits');
    await database.insert(schema.aiTokenLimits).values({ organizationId: 'org-a', userId: 'alice', tokenLimit: 100 });
    await assert.rejects(reserve(101), { status: 403 });
    assert.equal((await logs()).length, 0);
    await reserve(100); assert.equal(await used(), 100);
  });
  test('PostgreSQL: default quota creation is idempotent across concurrent callers', async () => {
    await pool.query('delete from ai_token_limits');
    await Promise.all(Array.from({ length: 12 }, () => insertDefaultAITokenLimit('org-a', 1000)));
    assert.equal(Number((await pool.query('select count(*) from ai_token_limits')).rows[0].count), 1);
  });
  test('PostgreSQL: period rollover renews quota and late settlement never refunds the new month', async () => {
    await pool.query("update ai_token_limits set reset_at = now() - interval '1 day', tokens_used = 1000");
    const reservation = await reserve(400);
    assert.equal(await used(), 400);
    await pool.query("update ai_token_limits set reset_at = reset_at + interval '1 month', tokens_used = 200");
    await settleAITokens(reservation, actual, 'success');
    assert.equal(await used(), 200);
  });
  test('PostgreSQL: failed log insertion rolls back quota consumption', async () => {
    await assert.rejects(reserve(400, { userId: null }));
    assert.equal(await used(), 0); assert.equal((await logs()).length, 0);
  });
  test('PostgreSQL: failure updating balance rolls back usage settlement, retaining one pending record', async () => {
    const reservation = await reserve(400);
    await pool.query(`create function reject_balance_update() returns trigger language plpgsql as $$
      begin raise exception 'simulated storage failure'; end; $$;
      create trigger reject_balance before update on ai_token_limits for each row execute function reject_balance_update();`);
    try {
      await assert.rejects(settleAITokens(reservation, actual, 'success'));
      assert.equal(await used(), 400); assert.equal((await logs())[0].status, 'pending');
    } finally { await pool.query('drop trigger reject_balance on ai_token_limits; drop function reject_balance_update()'); }
    await settleAITokens(reservation, actual, 'success');
    assert.equal(await used(), 100); assert.equal((await logs()).length, 1);
  });
  test('PostgreSQL: disabled organization quotas are never replaced with new credit', async () => {
    await pool.query('update ai_token_limits set is_active = false');
    await assert.rejects(reserve(100), { status: 403 });
    assert.equal(Number((await pool.query('select count(*) from ai_token_limits')).rows[0].count), 1);
  });
  test('PostgreSQL: HTTP preflight checks personal quota after creating missing organization quota', async () => {
    await pool.query('delete from ai_token_limits');
    await database.insert(schema.aiTokenLimits).values({ organizationId: 'org-a', userId: 'alice', tokenLimit: 100 });
    await database.insert(schema.aiUsageLogs).values({ ...context, model: 'gpt-4o', totalTokens: 100, status: 'success' });
    let status = 200, passed = false;
    const res = { status(code) { status = code; return this; }, json() {} };
    await checkAITokenLimit({ user: { id: 'alice', organizationId: 'org-a' } }, res, () => { passed = true; });
    assert.equal(status, 403); assert.equal(passed, false);
  });
  test('PostgreSQL: shared rate limiter atomically admits only fifteen concurrent user attempts', async () => {
    const responses = await Promise.all(Array.from({ length: 20 }, async () => {
      let status = 200;
      const res = { status(code) { status = code; return this; }, set() { return this; }, json() {} };
      await aiRateLimit({ user: { id: 'alice', role: 'user', organizationId: 'org-a' }, path: '/conversation' }, res, () => {});
      return status;
    }));
    assert.equal(responses.filter(status => status === 200).length, 15);
    assert.equal(responses.filter(status => status === 429).length, 5);
  });
}

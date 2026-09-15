const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
const { aiContext, AIAccessError } = require('../src/utils/ai-context.util');
let reservations, settlements, reserveError, settleError;
const original = Module._load;
Module._load = function(id, ...args) {
  if (id.includes('services/ai-quota.service')) return {
    reserveAITokens: async (context, reserved, model, metadata) => {
      if (reserveError) throw reserveError;
      const reservation = { id: String(reservations.length), context: { ...context }, reserved, model, metadata };
      reservations.push(reservation); return reservation;
    },
    settleAITokens: async (...args) => { if (settleError) throw settleError; settlements.push(args); },
  };
  if (id.includes('utils/logger.util')) return { logger: { error() {} } };
  return original.call(this, id, ...args);
};
const { meterAI, meteredChat, meteredImage, estimateChatReservation } = require('../src/services/ai-metering.service');
Module._load = original;
const context = () => ({ organizationId: 'org-a', userId: 'alice', feature: 'conversation', endpoint: '/api/ai/conversation' });
const params = { model: 'gpt-4o', messages: [{ role: 'user', content: 'Olá שלום' }], max_tokens: 100 };
const usage = { promptTokens: 10, completionTokens: 20, totalTokens: 30 };
beforeEach(() => { reservations = []; settlements = []; reserveError = undefined; settleError = undefined; });

test('one provider invocation has one reservation and one actual-usage settlement', async () => {
  let calls = 0;
  const client = { chat: { completions: { create: async () => { calls++; return {
    choices: [], usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
  }; } } } };
  await aiContext.run(context(), () => meteredChat(client, params));
  assert.equal(calls, 1); assert.equal(reservations.length, 1); assert.equal(settlements.length, 1);
  assert.deepEqual(settlements[0][1], usage);
  assert.equal(settlements[0][2], 'success');
});
test('missing identity, exhausted quota and quota-store failure never call the provider', async () => {
  let calls = 0;
  const invoke = () => { calls++; return Promise.resolve('text'); };
  await assert.rejects(meterAI('gpt-4o', 100, invoke, () => usage), { code: 'AI_CONTEXT_REQUIRED' });
  for (const error of [new AIAccessError(429, 'ORG_TOKEN_LIMIT_EXCEEDED', 'quota'), Error('database down')]) {
    reserveError = error;
    const current = context();
    await assert.rejects(aiContext.run(current, () => meterAI('gpt-4o', 100, invoke, () => usage)));
    assert.equal(current.failure.status, error instanceof AIAccessError ? 429 : 503);
  }
  assert.equal(calls, 0);
});
test('definite provider rejection releases reservation without logging success', async () => {
  await assert.rejects(aiContext.run(context(), () => meterAI('gpt-4o', 100,
    async () => { throw Object.assign(Error('invalid request'), { status: 400 }); }, () => usage)));
  assert.equal(settlements.length, 1);
  assert.deepEqual(settlements[0][1], { promptTokens: 0, completionTokens: 0, totalTokens: 0 });
  assert.equal(settlements[0][2], 'error');
});
test('ambiguous provider failure retains pending reservation and never retries automatically', async () => {
  let calls = 0;
  await assert.rejects(aiContext.run(context(), () => meterAI('gpt-4o', 100,
    async () => { calls++; throw Error('connection interrupted'); }, () => usage)));
  assert.equal(calls, 1); assert.equal(reservations.length, 1); assert.equal(settlements.length, 0);
});
test('settlement failure neither inserts a duplicate error entry nor retries the provider', async () => {
  settleError = Error('database down');
  let calls = 0;
  const current = context();
  await assert.rejects(aiContext.run(current, () => meterAI('gpt-4o', 100,
    async () => { calls++; return 'result'; }, () => usage)), { code: 'AI_ACCOUNTING_UNAVAILABLE' });
  assert.equal(calls, 1); assert.equal(reservations.length, 1);
  await assert.rejects(aiContext.run(current, () => meterAI('gpt-4o', 100,
    async () => { calls++; }, () => usage)));
  assert.equal(calls, 1);
});
test('missing provider usage remains pending instead of reporting zero consumption', async () => {
  const client = { chat: { completions: { create: async () => ({ choices: [] }) } } };
  await assert.rejects(aiContext.run(context(), () => meteredChat(client, params)), { code: 'AI_ACCOUNTING_UNAVAILABLE' });
  assert.equal(settlements.length, 0);
});
test('image generation preserves fixed 1000 credits and records the billing unit', async () => {
  const client = { images: { generate: async () => ({ data: [{ b64_json: 'image' }] }) } };
  await aiContext.run(context(), () => meteredImage(client, { model: 'gpt-image-1', prompt: 'A house', n: 1 }));
  assert.equal(reservations[0].reserved, 1000);
  assert.equal(reservations[0].metadata.accounting, 'fixed_image_credits');
  assert.equal(settlements[0][1].totalTokens, 1000);
});
test('parallel organizations retain separate identities across async provider work', async () => {
  await Promise.all(['org-a', 'org-b'].map(organizationId => aiContext.run({ ...context(), organizationId },
    () => meterAI('gpt-4o', 100, async () => { await new Promise(r => setImmediate(r)); return organizationId; }, () => usage))));
  assert.deepEqual(reservations.map(r => r.context.organizationId).sort(), ['org-a', 'org-b']);
});
test('vision reservation ignores base64 size but reserves image and output allowances', () => {
  const withImage = { ...params, messages: [{ role: 'user', content: [
    { type: 'text', text: 'Describe' }, { type: 'image_url', image_url: { url: 'data:image/png;base64,' + 'A'.repeat(100000) } },
  ] }] };
  assert.ok(estimateChatReservation(withImage) > 4096 + params.max_tokens);
  assert.ok(estimateChatReservation(withImage) < 5000);
});

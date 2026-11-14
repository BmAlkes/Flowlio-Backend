const { test } = require('node:test'); const assert = require('node:assert/strict');

// Replace the Sentry SDK with a recorder before the config module loads it.
const sent = []; let initOptions;
require.cache[require.resolve('@sentry/node')] = { id: '@sentry/node', loaded: true, exports: {
  init: options => { initOptions = options; },
  captureException: (error, context) => sent.push({ kind: 'exception', error, context }),
  captureMessage: (message, context) => sent.push({ kind: 'message', message, context }),
} };
process.env.SENTRY_DSN = 'https://public@example.ingest.sentry.io/1';
const { reportLoggedError, sentryEnabled } = require('../src/configs/sentry.config');

test('Sentry starts with errors only and no personal data collection', () => {
  assert.equal(sentryEnabled, true);
  assert.equal(initOptions.tracesSampleRate, 0);
  assert.deepEqual(initOptions.dataCollection, { userInfo: false, cookies: false, httpHeaders: false, urlQueryParams: false, httpBodies: [] });
});

test('a logged Error is sent with emails and tokens redacted from message, stack and extras', () => {
  sent.length = 0;
  const error = new Error('Login failed for ana@agency.com with token=abc123');
  reportLoggedError(['Auth error for bia@agency.com:', error, { email: 'bia@agency.com', step: 'verify' }], { correlationId: 'req-1', release: 'x' });
  assert.equal(sent.length, 1);
  const [{ kind, error: reported, context }] = sent;
  assert.equal(kind, 'exception');
  assert.equal(reported.message, 'Login failed for [email] with token=[redacted]');
  assert.ok(!reported.stack.includes('ana@agency.com') && !reported.stack.includes('abc123'));
  assert.equal(context.extra.message, 'Auth error for [email]:');
  assert.equal(JSON.stringify(context.extra.log).includes('bia@agency.com'), false);
  assert.equal(context.tags.correlationId, 'req-1');
});

test('an error nested in an object is found, and a plain message is sent as a message', () => {
  sent.length = 0;
  reportLoggedError(['Job failed', { error: new Error('boom') }]);
  reportLoggedError(['Rate limiter unavailable for carla@agency.com']);
  assert.equal(sent[0].kind, 'exception');
  assert.equal(sent[0].error.message, 'boom');
  assert.deepEqual([sent[1].kind, sent[1].message], ['message', 'Rate limiter unavailable for [email]']);
});

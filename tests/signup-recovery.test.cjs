const { test } = require('node:test');
const assert = require('node:assert/strict');
const { blockedBy, summarize, answerToken, validToken, sendFollowups, recordAnswer, sampleSignup, MAX_REMINDERS } = require('../src/modules/signup-recovery/service');
const { followupEmail, answerPage } = require('../src/modules/signup-recovery/email');

const DAY = 86400000;
const now = Date.parse('2026-11-22T12:00:00Z');
const ago = days => new Date(now - days * DAY).toISOString();
const base = { optedOut: false, reason: null, reminders: 0, lastReminderAt: null, createdAt: ago(30) };

test('a reminder is blocked after an answer, an opt-out, the limit, a recent one or for brand-new accounts', () => {
  assert.equal(blockedBy(base, now), null);
  assert.equal(blockedBy({ ...base, optedOut: true }, now), 'opted_out');
  assert.equal(blockedBy({ ...base, reason: 'price' }, now), 'answered');
  assert.equal(blockedBy({ ...base, reminders: MAX_REMINDERS, lastReminderAt: ago(20) }, now), 'max_reminders');
  assert.equal(blockedBy({ ...base, reminders: 1, lastReminderAt: ago(3) }, now), 'recent_reminder');
  assert.equal(blockedBy({ ...base, reminders: 1, lastReminderAt: ago(8) }, now), null);
  assert.equal(blockedBy({ ...base, createdAt: new Date(now - 3600000).toISOString() }, now), 'too_new');
});

test('the summary counts stages and answers', () => {
  const rows = [
    { ...base, stage: 'no_plan', blockedBy: null },
    { ...base, stage: 'checkout', reason: 'price', reminders: 1, blockedBy: 'answered' },
    { ...base, stage: 'checkout', optedOut: true, reminders: 1, blockedBy: 'opted_out' },
  ];
  const summary = summarize(rows);
  assert.deepEqual([summary.total, summary.noPlan, summary.checkout, summary.canRemind, summary.reminded, summary.answered, summary.optedOut], [3, 1, 2, 1, 2, 1, 1]);
  assert.equal(summary.reasons.price, 1);
});

test('answer links are signed per follow-up', () => {
  const token = answerToken('f1', 'secret');
  assert.ok(validToken('f1', token, 'secret'));
  assert.ok(!validToken('f2', token, 'secret'));
  assert.ok(!validToken('f1', token, 'other-secret'));
  assert.ok(!validToken('f1', undefined, 'secret'));
  assert.ok(!validToken('f1', 'short', 'secret'));
});

function signupRow(id, extra = {}) {
  return { id, name: 'Ana Souza', email: id + '@x.test', email_verified: true, created_at: ago(30), selected_plan_id: null, pending_plan_id: null, has_org_data: false, reminders: 0, ...extra };
}

function fakePool(rows) {
  const queries = [];
  return { queries, query: async (sql, params) => { queries.push({ sql, params }); return sql.includes('from users u') ? { rows: rows.filter(r => params[0].includes(r.id)) } : { rows: [], rowCount: 1 }; } };
}

test('follow-ups go only to eligible people and are recorded only after the email was accepted', async () => {
  const pool = fakePool([
    signupRow('ok'),
    signupRow('checkout', { selected_plan_id: 'basic', plan_name: 'Basic' }),
    signupRow('answered', { reason: 'price', reminders: 1, last_sent_at: ago(20) }),
    signupRow('bounce'),
  ]);
  const seen = [];
  const result = await sendFollowups(pool, ['ok', 'checkout', 'answered', 'bounce', 'gone', 'ok'], 'admin', async (signup) => {
    if (signup.id === 'bounce') throw new Error('rejected');
    seen.push([signup.id, signup.stage]);
  });
  assert.deepEqual(seen, [['ok', 'no_plan'], ['checkout', 'checkout']]);
  assert.equal(result.sent, 2);
  assert.deepEqual(result.skipped.map(s => [s.id, s.reason]).sort(), [['answered', 'answered'], ['bounce', 'email_failed'], ['gone', 'not_pending']]);
  const inserts = pool.queries.filter(q => q.sql.startsWith('insert into signup_followups'));
  assert.deepEqual(inserts.map(q => [q.params[1], q.params[2], q.params[3]]), [['ok', 'no_plan', 'admin'], ['checkout', 'checkout', 'admin']]);
});

test('only known answers are recorded; unsubscribe sets the opt-out', async () => {
  const pool = fakePool([]);
  assert.equal(await recordAnswer(pool, 'f1', 'price'), true);
  assert.equal(await recordAnswer(pool, 'f1', 'unsubscribe'), true);
  assert.equal(await recordAnswer(pool, 'f1', "price'; drop table users"), false);
  assert.match(pool.queries[0].sql, /set reason/);
  assert.match(pool.queries[1].sql, /opted_out_at/);
  assert.equal(pool.queries.length, 2);
});

test('the email names the stage, escapes names and carries every answer link plus the opt-out', () => {
  const signup = { name: '<b>Ana</b> Souza', email: 'ana@x.test', createdAt: '2026-10-01T10:00:00Z', stage: 'checkout', planName: 'Basic' };
  const links = { answer: reason => `https://api.test/a?a=${reason}`, continueUrl: 'https://app.test/auth/signin' };
  const pt = followupEmail(signup, 'pt', links);
  assert.match(pt.text, /escolheu o plano Basic/);
  assert.ok(!pt.html.includes('<b>Ana</b>'));
  for (const reason of ['price', 'missing_feature', 'too_complex', 'payment_problem', 'just_exploring', 'other', 'unsubscribe']) assert.ok(pt.html.includes(`a=${reason}`), reason);
  const en = followupEmail({ ...signup, stage: 'no_plan' }, 'en', links);
  assert.match(en.text, /didn't pick a plan/);
});

test('the answer page asks to confirm on GET so link scanners cannot answer', () => {
  assert.match(answerPage('pt', { kind: 'confirm', answer: 'price' }, 'x'), /<form method="post">/);
  assert.match(answerPage('pt', { kind: 'confirm', answer: '<script>' }, 'x'), /&lt;script&gt;/);
  assert.match(answerPage('en', { kind: 'done', answer: 'unsubscribe' }, 'x'), /won't get more emails/);
});

test('test follow-ups preview the email for the super admin and never touch the database', async () => {
  const pool = fakePool([]);
  assert.equal(await recordAnswer(pool, 'test-1', 'price'), true);
  assert.equal(await recordAnswer(pool, 'test-1', 'unsubscribe'), true);
  assert.equal(await recordAnswer(pool, 'test-1', 'nope'), false);
  assert.equal(pool.queries.length, 0);
  const signup = sampleSignup({ name: 'Ana Souza', email: 'ana@x.test' }, 'checkout', 'Basic', now);
  assert.deepEqual([signup.stage, signup.planName, signup.blockedBy, signup.daysSinceSignup], ['checkout', 'Basic', null, 10]);
  assert.equal(sampleSignup({ email: 'ana@x.test' }, 'no_plan', 'Basic', now).planName, null);
  assert.match(followupEmail(signup, 'pt', { answer: r => r, continueUrl: 'x' }).text, /escolheu o plano Basic/);
});

test('the email and the answer page show the Flowlio logo', () => {
  const signup = { name: 'Ana', email: 'ana@x.test', createdAt: '2026-10-01T10:00:00Z', stage: 'no_plan', planName: null };
  const links = { answer: r => r, continueUrl: 'x', logoUrl: 'https://api.test/logowithtext.png' };
  assert.match(followupEmail(signup, 'pt', links).html, /<img src="https:\/\/api.test\/logowithtext.png" alt="Flowlio"/);
  assert.match(answerPage('pt', { kind: 'confirm', answer: 'price' }, 'x', links.logoUrl), /alt="Flowlio"/);
});

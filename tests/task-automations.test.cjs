const { test } = require('node:test');
const assert = require('node:assert/strict');
const { ruleInput, triggerMatches, conditionsMatch, render, scheduleKey, addDays } = require('../src/modules/task-automations/rules');
const { createTaskAutomations } = require('../src/modules/task-automations/service');

const event = (changes, kind = 'updated') => ({ id: 1, organizationId: 'org', taskId: 't1', projectId: 'p1', kind, changes, depth: 0 });
const task = (extra = {}) => ({ id: 't1', title: 'Hero', status: 'todo', assignedTo: null, createdBy: 'u1', projectId: 'p1', projectName: 'Site', endDate: '2026-12-01', customFields: {}, ...extra });

test('rules are validated: actions required, scheduled rules only create tasks in a chosen project', () => {
  const base = { name: 'R', trigger: { type: 'task_created' }, actions: [{ type: 'set_status', status: 'in_progress' }] };
  assert.ok(ruleInput.safeParse(base).success);
  assert.equal(ruleInput.safeParse({ ...base, actions: [] }).success, false);
  assert.equal(ruleInput.safeParse({ ...base, actions: [{ type: 'set_status', status: 'archived' }] }).success, false);
  assert.equal(ruleInput.safeParse({ ...base, trigger: { type: 'schedule', every: 'week' } }).success, false, 'week needs a weekday');
  assert.equal(ruleInput.safeParse({ ...base, trigger: { type: 'schedule', every: 'day' } }).success, false, 'a schedule cannot change a task');
  assert.ok(ruleInput.safeParse({ name: 'Weekly', trigger: { type: 'schedule', every: 'week', weekday: 1 }, actions: [{ type: 'create_task', title: 'Report', projectId: 'p1' }] }).success);
});

test('triggers fire on the right changes', () => {
  assert.ok(triggerMatches({ type: 'task_created' }, event({}, 'created')));
  assert.ok(triggerMatches({ type: 'status_changed', to: 'completed' }, event({ status: { from: 'todo', to: 'completed' } })));
  assert.equal(triggerMatches({ type: 'status_changed', to: 'completed' }, event({ status: { from: 'todo', to: 'delay' } })), false);
  assert.ok(triggerMatches({ type: 'status_changed' }, event({ status: { from: 'todo', to: 'delay' } })));
  assert.ok(triggerMatches({ type: 'field_changed', fieldId: 'prio', to: 'alta' }, event({ fields: { prio: { from: null, to: 'Alta' } } })));
  assert.equal(triggerMatches({ type: 'assignee_changed' }, event({ assignee: { from: 'u1', to: null } })), false, 'unassigning is not an assignment');
  assert.equal(triggerMatches({ type: 'due_date', offsetDays: 1 }, event({})), false);
});

test('conditions look at the task as it is now', () => {
  const t = task({ status: 'delay', assignedTo: 'u2', customFields: { prio: 'Alta' } });
  assert.ok(conditionsMatch([{ type: 'status', op: 'is', value: 'delay' }, { type: 'field', fieldId: 'prio', op: 'is', value: 'alta' }], t));
  assert.equal(conditionsMatch([{ type: 'assignee', op: 'empty' }], t), false);
  assert.ok(conditionsMatch([{ type: 'field', fieldId: 'budget', op: 'empty' }], t));
  assert.ok(conditionsMatch([{ type: 'status', op: 'is_not', value: 'completed' }], t));
});

test('messages fill in the task, project and due date; schedules run once on their day', () => {
  assert.equal(render('{{task}} em {{project}} vence {{due}}', task()), 'Hero em Site vence 2026-12-01');
  const monday = new Date('2026-11-23T03:00:00Z');
  assert.equal(scheduleKey({ type: 'schedule', every: 'week', weekday: 1 }, monday), '2026-11-23');
  assert.equal(scheduleKey({ type: 'schedule', every: 'week', weekday: 2 }, monday), null);
  assert.equal(scheduleKey({ type: 'schedule', every: 'month', monthDay: 23 }, monday), '2026-11-23');
  assert.equal(addDays(monday, 9), '2026-12-02');
});

test('only owners and managers manage automations', async () => {
  const service = createTaskAutomations({ query: async () => ({ rows: [] }) });
  await assert.rejects(service.list({ id: 'u2', role: 'user', organizationId: 'org' }), { code: 'FORBIDDEN' });
  await assert.rejects(service.save({ id: 'c', role: 'client', organizationId: 'org' }, {}), { code: 'FORBIDDEN' });
});

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { normalizeValue, applyValues, guessType, importValue, FieldValueError } = require('../src/modules/custom-fields/values');
const { createCustomFields } = require('../src/modules/custom-fields/service');

const field = (type, extra = {}) => ({ id: 'f-' + type, name: type, type, ...extra });

test('each field type accepts what it should and normalizes it', () => {
  assert.equal(normalizeValue(field('number'), '1.234,5'.replace('.', '')), 1234.5);
  assert.equal(normalizeValue(field('currency'), '19.999'), 20);
  assert.equal(normalizeValue(field('rating'), '4'), 4);
  assert.equal(normalizeValue(field('progress'), 66.6), 67);
  assert.equal(normalizeValue(field('date'), '2026-12-05T10:00:00Z'), '2026-12-05');
  assert.equal(normalizeValue(field('boolean'), 'sim'), true);
  assert.equal(normalizeValue(field('select', { options: [{ label: 'Alta', color: '#f00' }] }), 'alta'), 'Alta');
  assert.equal(normalizeValue(field('url'), 'flowlioapp.com/precos'), 'https://flowlioapp.com/precos');
  assert.equal(normalizeValue(field('email'), ' Ana@X.com '), 'ana@x.com');
  assert.equal(normalizeValue(field('phone'), '+55 (11) 98765-4321'), '+55 (11) 98765-4321');
  assert.equal(normalizeValue(field('person'), 'u1', new Set(['u1'])), 'u1');
  assert.equal(normalizeValue(field('text'), ''), null, 'empty clears the field');
});

test('values that do not fit their field are refused', () => {
  const refuses = (type, value, extra) => assert.throws(() => normalizeValue(field(type, extra), value, new Set(['u1'])), FieldValueError);
  refuses('number', 'abc');
  refuses('rating', 6);
  refuses('progress', 101);
  refuses('date', '31/02');
  refuses('select', 'Média', { options: [{ label: 'Alta', color: '#f00' }] });
  refuses('url', 'javascript:alert(1)');
  refuses('email', 'not-an-email');
  refuses('phone', 'call me');
  refuses('person', 'someone-else');
  refuses('text', 'x'.repeat(2001));
});

test('updates merge into stored values, null clears, and unknown fields are refused', () => {
  const fields = [field('text'), field('number')];
  assert.deepEqual(applyValues({ 'f-text': 'a', 'f-number': 1 }, { 'f-text': null, 'f-number': '2' }, fields), { 'f-number': 2 });
  assert.throws(() => applyValues({}, { other: 'x' }, fields), FieldValueError);
});

test('imported columns get a field type from their values', () => {
  assert.equal(guessType(['10', '2,5', '']), 'number');
  assert.equal(guessType(['05/03/2026', '2026-04-01']), 'date');
  assert.equal(guessType(['Alta', 'Baixa', 'Alta', 'Média', 'Baixa', 'Alta']), 'select');
  assert.equal(guessType(['ana@x.com']), 'email');
  assert.equal(guessType(['Ligar para o cliente', 'Revisar layout']), 'text');
  assert.equal(importValue('date', '05/03/2026'), '2026-03-05');
});

function fakePool(rows = {}) {
  const queries = [];
  const query = async (sql, params) => {
    queries.push({ sql, params });
    for (const [match, result] of Object.entries(rows)) if (sql.includes(match)) return { rows: typeof result === 'function' ? result(params) : result };
    return { rows: [] };
  };
  return { queries, query, connect: async () => ({ query, release() {} }) };
}
const owner = { id: 'u1', role: 'user', organizationId: 'org', isOrganizationOwner: true };
const member = { id: 'u2', role: 'user', organizationId: 'org' };
const portal = { id: 'c1', role: 'client', organizationId: 'org' };

test('only owners and managers can create, change or delete fields; portal clients cannot even list them', async () => {
  const service = createCustomFields(fakePool());
  await assert.rejects(service.create(member, { name: 'Prioridade', type: 'text', entityType: 'task' }), { code: 'FORBIDDEN' });
  await assert.rejects(service.remove(member, 'f1'), { code: 'FORBIDDEN' });
  await assert.rejects(service.list(portal, 'task'), { code: 'FORBIDDEN' });
});

test('creating a field validates its type and options, and appends it at the end', async () => {
  const pool = fakePool({ 'count(*)::int n': [{ n: 2, last: 4 }], 'insert into custom_field_definitions': params => [{ id: params[0], position: params[7] }] });
  const service = createCustomFields(pool);
  await assert.rejects(service.create(owner, { name: 'Prioridade', type: 'select', entityType: 'task' }), { code: 'INVALID_FIELD' });
  await assert.rejects(service.create(owner, { name: 'X', type: 'formula', entityType: 'task' }), { code: 'INVALID_FIELD' });
  await assert.rejects(service.create(owner, { name: 'X', type: 'text', entityType: 'client', projectId: 'p1' }), { code: 'INVALID_FIELD' });
  const created = await service.create(owner, { name: 'Orçamento', type: 'currency', entityType: 'task' });
  assert.equal(created.position, 5);
});

test('setting task values checks each value against the task\'s fields and saves them', async () => {
  const pool = fakePool({
    'from tasks t join projects p': [{ id: 't1', project_id: 'p1', custom_fields: { 'f-text': 'old' } }],
    "entity_type='task' and (project_id is null": [field('text'), field('rating'), field('person')],
    'from user_organizations': [{ user_id: 'u2' }],
  });
  const result = await createCustomFields(pool).setTaskValues(member, 't1', { values: { 'f-rating': 5, 'f-person': 'u2' } });
  assert.deepEqual(result.customFields, { 'f-text': 'old', 'f-rating': 5, 'f-person': 'u2' });
  assert.ok(pool.queries.some(q => q.sql.startsWith('update tasks set custom_fields')));
  await assert.rejects(createCustomFields(pool).setTaskValues(member, 't1', { values: { 'f-rating': 9 } }), { code: 'INVALID_VALUE' });
  await assert.rejects(createCustomFields(pool).setTaskValues({ ...member, role: 'viewer' }, 't1', { values: {} }), { code: 'FORBIDDEN' });
});

test('deleting a task field also clears its stored values', async () => {
  const pool = fakePool({ 'select id, organization_id': [{ id: 'f1', entityType: 'task', projectId: null }] });
  await createCustomFields(pool).remove(owner, 'f1');
  assert.ok(pool.queries.some(q => q.sql.includes('custom_fields - $1')));
});

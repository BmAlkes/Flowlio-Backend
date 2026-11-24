const { test } = require('node:test'); const assert = require('node:assert/strict');
const { gzipSync } = require('node:zlib');
const { organizationTables, childTablesInOrder } = require('../src/modules/organization-data/graph');
const { parentsFirst, restoreOrganization, RESTORE_SKIP } = require('../src/modules/organization-data/restore');
const { normalizeTaskStatus, normalizeLeadStatus, contactRow, taskRow, importInput, MAX_IMPORT_ROWS } = require('../src/modules/organization-data/import');
const { runAutoDeletion, INACTIVE_SQL } = require('../src/modules/organization-data/deletion');

const fk = (child, column, parent, parentColumn = 'id') => ({ child, column, parent, parentColumn });
const cols = (...names) => names.map(name => ({ name, type: 'text' }));

test('organization tables come parents first, children included, shared and credential tables never', () => {
  const graph = { tables: new Map([
    ['projects', cols('id', 'organization_id')], ['tasks', cols('id', 'project_id', 'parent_id')], ['invoices', cols('id', 'organization_id', 'project_id')],
    ['users', cols('id')], ['session', cols('id', 'user_id', 'organization_id')], ['clients', cols('id', 'organization_id')],
  ]), foreignKeys: [fk('tasks', 'project_id', 'projects'), fk('tasks', 'parent_id', 'tasks'), fk('invoices', 'project_id', 'projects'), fk('projects', 'client_id', 'clients'), fk('tasks', 'assigned_to', 'users')] };
  const order = organizationTables(graph).map(entry => entry.table);
  assert.deepEqual(order, ['clients', 'projects', 'invoices', 'tasks']);
  assert.ok(organizationTables(graph).find(entry => entry.table === 'tasks').root === false);
  assert.deepEqual(childTablesInOrder(['projects'], ['projects', 'tasks', 'users'], graph.foreignKeys), ['tasks']);
});

test('subtasks are inserted after their parent task', () => {
  const rows = [{ id: 'c', parent_id: 'b' }, { id: 'b', parent_id: 'a' }, { id: 'a', parent_id: null }, { id: 'x', parent_id: 'outside' }];
  assert.deepEqual(parentsFirst(rows, ['parent_id']).map(row => row.id), ['a', 'x', 'b', 'c']);
  assert.deepEqual(parentsFirst(rows, []).map(row => row.id), ['c', 'b', 'a', 'x']);
});

test('restore never brings back team access or rewrites billing and audit history', () => {
  for (const table of ['user_organizations', 'invitations', 'user_management', 'subscriptions', 'business_audit_events', 'audit_logs']) assert.ok(RESTORE_SKIP.has(table), table);
  assert.ok(!RESTORE_SKIP.has('projects'));
});

test('a backup can only be restored into its own organization', async () => {
  const payload = { format: 'flowlio-organization-backup/1', organizationId: 'org-a', createdAt: '', schemaVersion: 1, tables: {} };
  const pool = { query: async () => ({ rows: [{ id: 'b1', organization_id: 'org-a', data: gzipSync(Buffer.from(JSON.stringify(payload))) }] }), connect: async () => assert.fail('must not open a transaction') };
  await assert.rejects(restoreOrganization(pool, { organizationId: 'org-b', backupId: 'b1', dryRun: true, actorId: null }), { code: 'WRONG_ORGANIZATION' });
  const tampered = { ...payload, organizationId: 'org-b' };
  const pool2 = { query: async () => ({ rows: [{ id: 'b1', organization_id: 'org-a', data: gzipSync(Buffer.from(JSON.stringify(tampered))) }] }) };
  await assert.rejects(restoreOrganization(pool2, { organizationId: 'org-a', backupId: 'b1', dryRun: true, actorId: null }), { code: 'INVALID_BACKUP' });
});

test('Monday, Trello and Portuguese status labels map to Flowlio statuses', () => {
  const cases = { 'Done': 'completed', 'Concluído': 'completed', 'Working on it': 'in_progress', 'Em andamento': 'in_progress', 'Stuck': 'delay', 'Atrasada': 'delay', 'Em revisão': 'changes', '': 'todo', 'Not Started': 'todo', null: 'todo' };
  for (const [label, expected] of Object.entries(cases)) assert.equal(normalizeTaskStatus(label === 'null' ? null : label), expected, label);
  assert.equal(normalizeLeadStatus('qualified'), 'Qualified');
  assert.equal(normalizeLeadStatus('Hot lead'), 'New Lead');
});

test('import rows are validated and cleaned before anything is written', () => {
  assert.equal(contactRow.safeParse({ name: 'Ana', email: 'not-an-email' }).success, false);
  assert.equal(contactRow.safeParse({ name: '' }).success, false);
  assert.deepEqual(contactRow.parse({ name: ' Ana ', email: 'ANA@X.TEST', phone: '' }), { name: 'Ana', email: 'ana@x.test', phone: null, cpfcnpj: null, businessIndustry: null, address: null, status: null, note: null, extra: {} });
  // Extra spreadsheet columns are kept (empty cells dropped) instead of being thrown away.
  assert.deepEqual(contactRow.parse({ name: 'Ana', extra: { Origem: ' Instagram ', Vazio: '', Score: 8 } }).extra, { Origem: 'Instagram', Score: '8' });
  const task = taskRow.parse({ project: 'Site', title: 'Hero', startDate: '2026-01-05', endDate: '05/01/2026', estimatedHours: '2,5' });
  assert.equal(task.startDate, '2026-01-05'); assert.equal(task.endDate, null); assert.equal(task.estimatedHours, 2.5);
  assert.equal(importInput.safeParse({ kind: 'tasks', rows: Array(MAX_IMPORT_ROWS + 1).fill({}) }).success, false);
  assert.equal(importInput.safeParse({ kind: 'invoices', rows: [{}] }).success, false);
});

test('automatic deletion does nothing until it is enabled, and demo organizations are never inactive', async () => {
  const pool = { query: async () => assert.fail('no query while disabled') };
  assert.deepEqual(await runAutoDeletion(pool, { enabled: false, warn: async () => {} }), { warned: 0, deleted: 0 });
  assert.match(INACTIVE_SQL, /demo/);
});

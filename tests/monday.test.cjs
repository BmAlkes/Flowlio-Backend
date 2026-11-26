const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { mondayClient, MondayError } = require('../src/modules/monday/client');
const { mapBoard, planColumns } = require('../src/modules/monday/mapping');

const TOKEN = 'eyJhbGciOiJIUzI1NiJ9.test-token-value-123456';
const v = (id, type, text, value = null) => ({ id, type, text, value: value && JSON.stringify(value) });
const board = {
  id: '111', name: 'Projetos de Clientes',
  columns: [
    { id: 'name', title: 'Name', type: 'name' }, { id: 'person', title: 'Person', type: 'people' }, { id: 'status', title: 'Status', type: 'status' },
    { id: 'timeline', title: 'Timeline', type: 'timeline' }, { id: 'date4', title: 'Due date', type: 'date' }, { id: 'numbers', title: 'Estimated hours', type: 'numbers' },
    { id: 'prio', title: 'Prioridade', type: 'status' }, { id: 'notes', title: 'Notes', type: 'long_text' }, { id: 'files', title: 'Files', type: 'file' },
    { id: 'link', title: 'Site', type: 'link' }, { id: 'ok', title: 'Aprovado', type: 'checkbox' },
  ],
  items: [
    { id: '1', name: 'Briefing', group: { id: 'g1', title: 'Site Padaria' }, column_values: [
      v('person', 'people', 'Ana Souza, Bia', { personsAndTeams: [{ id: 10, kind: 'person' }, { id: 11, kind: 'person' }] }), v('status', 'status', 'Done'),
      v('timeline', 'timeline', '2026-11-03 - 2026-11-05', { from: '2026-11-03', to: '2026-11-05' }), v('date4', 'date', '2026-11-06', { date: '2026-11-06' }),
      v('numbers', 'numbers', '3'), v('prio', 'status', 'Alta'), v('notes', 'long_text', 'Reunião gravada'), v('link', 'link', 'Site - https://padaria.test', { url: 'https://padaria.test', text: 'Site' }),
      v('ok', 'checkbox', 'v', { checked: 'true' })],
      subitems: [{ id: '1a', name: 'Enviar ata', column_values: [v('status', 'status', 'Working on it')] }] },
    { id: '2', name: 'Logo', group: { id: 'g2', title: 'Rebranding' }, column_values: [v('person', 'people', 'Carlos', { personsAndTeams: [{ id: 12, kind: 'person' }] }), v('prio', 'status', 'Baixa')] },
  ],
};
const users = [{ id: '10', email: 'ana@agency.test', name: 'Ana Souza' }, { id: '11', email: 'bia@agency.test', name: 'Bia' }, { id: '12', email: 'carlos@else.test', name: 'Carlos' }];

test('columns are matched to the task: status, people, due date, timeline and notes; the rest become fields', () => {
  const plan = Object.fromEntries(planColumns(board.columns).map(entry => [entry.column.title, entry.role === 'field' ? entry.type : entry.role]));
  assert.deepEqual(plan, { Name: 'skip', Person: 'assignee', Status: 'status', Timeline: 'timeline', 'Due date': 'due', 'Estimated hours': 'number', Prioridade: 'select', Notes: 'description', Files: 'skip', Site: 'url', Aprovado: 'boolean' });
});

test('items become tasks with subitems, matched people and field values; groups are kept as a field', () => {
  const mapped = mapBoard(board, users, new Set(['ana@agency.test']));
  assert.equal(mapped.tasks.length, 3);
  const [briefing, sub, logo] = mapped.tasks;
  assert.deepEqual(briefing, { externalId: '1', parentExternalId: null, title: 'Briefing', status: 'Done', assigneeEmail: 'ana@agency.test', startDate: '2026-11-03', endDate: '2026-11-06', description: 'Reunião gravada',
    values: { 'Estimated hours': '3', Prioridade: 'Alta', Site: 'https://padaria.test', Aprovado: 'true', Grupo: 'Site Padaria' } });
  assert.equal(sub.parentExternalId, '1');
  assert.equal(sub.status, 'Working on it');
  assert.equal(logo.assigneeEmail, null);
  assert.deepEqual(mapped.unmatchedPeople, ['Carlos']);
  assert.deepEqual(mapped.fields.find(f => f.name === 'Prioridade').options, ['Alta', 'Baixa']);
  assert.deepEqual(mapped.fields[0], { name: 'Grupo', type: 'select', options: ['Site Padaria', 'Rebranding'] });
});

test('the client sends the token only to monday.com and explains refusals and limits', async () => {
  const calls = [];
  const reply = (status, body) => async (url, init) => { calls.push({ url, init }); return { status, json: async () => body }; };
  const boards = await mondayClient(TOKEN, reply(200, { data: { boards: [{ id: 5, name: 'Board', type: 'board', items_count: 9, workspace: { name: 'Main' } }, { id: 6, name: 'Sub', type: 'sub_items_board', items_count: 1, workspace: null }] } })).boards();
  assert.deepEqual(boards, [{ id: '5', name: 'Board', itemsCount: 9, workspace: 'Main' }]);
  assert.equal(calls[0].url, 'https://api.monday.com/v2');
  assert.equal(calls[0].init.headers.Authorization, TOKEN);
  await assert.rejects(mondayClient(TOKEN, reply(401, {})).boards(), { code: 'INVALID_TOKEN' });
  await assert.rejects(mondayClient(TOKEN, reply(200, { errors: [{ message: 'Complexity budget exhausted', extensions: { code: 'ComplexityException' } }] })).boards(), { code: 'RATE_LIMITED' });
  assert.throws(() => mondayClient('short'), MondayError);
});

test('a board is read across monday\'s cursor pages', async () => {
  let page = 0;
  const fetchImpl = async (_url, init) => {
    const body = JSON.parse(init.body);
    page++;
    if (body.query.includes('next_items_page')) return { status: 200, json: async () => ({ data: { next_items_page: { cursor: null, items: [{ id: '3', name: 'C', group: null, column_values: [] }] } } }) };
    return { status: 200, json: async () => ({ data: { boards: [{ id: '9', name: 'B', columns: [], items_page: { cursor: 'next', items: [{ id: '1', name: 'A', group: null, column_values: [] }] } }] } }) };
  };
  const result = await mondayClient(TOKEN, fetchImpl).board('9');
  assert.deepEqual(result.items.map(item => item.id), ['1', '3']);
  assert.equal(page, 2);
  await assert.rejects(mondayClient(TOKEN, fetchImpl).board('9; drop'), { code: 'INVALID_BOARD' });
});

if (process.env.MONDAY_TEST_DATABASE_URL) {
  const url = new URL(process.env.MONDAY_TEST_DATABASE_URL);
  assert.ok(['localhost', '127.0.0.1'].includes(url.hostname) && url.port === '55442' && url.pathname === '/flowlio_monday_test', 'Dedicated local test database only');
  const { Pool } = require('pg');
  const pool = new Pool({ connectionString: url.toString() });
  const { createMondayImport } = require('../src/modules/monday/service');
  const owner = { id: 'owner', role: 'user', organizationId: 'org', isOrganizationOwner: true };
  let current = board;
  const fakeMonday = async (_url, init) => {
    const body = JSON.parse(init.body);
    if (body.query.includes('users(')) return { status: 200, json: async () => ({ data: { users } }) };
    return { status: 200, json: async () => ({ data: { boards: [{ ...current, items_page: { cursor: null, items: current.items } }] } }) };
  };
  const service = createMondayImport(pool, fakeMonday);

  before(async () => {
    await pool.query('drop schema public cascade; create schema public; drop schema if exists flowlio_releases cascade; drop schema if exists drizzle cascade');
    await require('../src/utils/release-migrations.util').runReleaseMigrations(pool);
    await pool.query(`
      insert into users(id,name,email,email_verified,two_factor_enabled,is_super_admin,timezone,created_at,updated_at) values
        ('owner','Owner','owner@agency.test',true,false,false,'UTC',now(),now()),('ana','Ana','ana@agency.test',true,false,false,'UTC',now(),now());
      insert into organizations(id,name,slug,subscription_status,created_at,updated_at) values ('org','Org','org','active',now(),now());
      insert into user_organizations(id,user_id,organization_id,role,status,created_at,updated_at) values ('m1','owner','org','owner','active',now(),now()),('m2','ana','org','member','active',now(),now());
    `);
  });
  after(() => pool.end());

  test('importing a board creates the project, its fields and tasks with subitems', async () => {
    const result = await service.importBoard(owner, { token: TOKEN, boardId: '111' });
    assert.deepEqual([result.projectCreated, result.created, result.updated, result.unmatchedPeople], [true, 3, 0, ['Carlos']]);
    assert.ok(result.skippedColumns.includes('Files'));
    const tasks = (await pool.query("select title, status, assigned_to, parent_id, to_char(end_date,'YYYY-MM-DD') due, custom_fields from tasks where project_id=$1 order by title", [result.projectId])).rows;
    const briefing = tasks.find(t => t.title === 'Briefing');
    assert.deepEqual([briefing.status, briefing.assigned_to, briefing.due], ['completed', 'ana', '2026-11-06']);
    assert.ok(tasks.find(t => t.title === 'Enviar ata').parent_id);
    const fields = (await pool.query("select id, name, type, project_id from custom_field_definitions where organization_id='org' order by position")).rows;
    assert.ok(fields.every(f => f.project_id === result.projectId), 'board columns belong to the imported project');
    const prio = fields.find(f => f.name === 'Prioridade');
    assert.equal(briefing.custom_fields[prio.id], 'Alta');
    assert.equal(briefing.custom_fields[fields.find(f => f.name === 'Aprovado').id], true);
  });

  test('importing again updates the same tasks, adds new items and keeps Flowlio-only values', async () => {
    const project = (await pool.query("select entity_id from external_links where entity_type='project' and external_id='111'")).rows[0].entity_id;
    await pool.query(`update tasks set custom_fields = custom_fields || '{"local":"kept"}' where title='Logo'`);
    current = { ...board, items: [{ ...board.items[1], name: 'Logo final', column_values: [v('status', 'status', 'Stuck')] }, { id: '3', name: 'Cartão de visita', group: { id: 'g2', title: 'Rebranding' }, column_values: [] }] };
    const result = await service.importBoard(owner, { token: TOKEN, boardId: '111' });
    assert.deepEqual([result.projectCreated, result.projectId, result.created, result.updated], [false, project, 1, 1]);
    const logo = (await pool.query("select status, custom_fields from tasks where title='Logo final'")).rows[0];
    assert.equal(logo.status, 'delay');
    assert.equal(logo.custom_fields.local, 'kept');
    assert.equal((await pool.query('select count(*)::int n from tasks where project_id=$1', [project])).rows[0].n, 4);
  });

  test('members cannot import', async () => {
    await assert.rejects(service.importBoard({ id: 'ana', role: 'user', organizationId: 'org' }, { token: TOKEN, boardId: '111' }), { code: 'FORBIDDEN' });
  });
}

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { mergeElements, mergeFiles, createWhiteboards, WhiteboardError } = require('../src/modules/whiteboards/service');

const el = (id, version, extra = {}) => ({ id, type: 'rectangle', version, versionNonce: 10, index: 'a' + id, ...extra });

test('merging keeps the newest version of each element, so two people editing do not overwrite each other', () => {
  const stored = [el('1', 3), el('2', 1), el('3', 5, { isDeleted: true })];
  const incoming = [el('1', 2), el('2', 4), el('3', 4), el('4', 1)];
  const merged = mergeElements(stored, incoming);
  assert.deepEqual(merged.map(e => [e.id, e.version]), [['1', 3], ['2', 4], ['3', 5], ['4', 1]]);
  assert.equal(merged.find(e => e.id === '3').isDeleted, true, 'a deletion is not undone by an older copy');
});

test('a version tie is settled like Excalidraw: the lower versionNonce wins', () => {
  assert.equal(mergeElements([el('1', 2, { versionNonce: 5 })], [el('1', 2, { versionNonce: 9 })])[0].versionNonce, 5);
  assert.equal(mergeElements([el('1', 2, { versionNonce: 9 })], [el('1', 2, { versionNonce: 5 })])[0].versionNonce, 5);
});

test('elements come back in scene order', () => {
  const merged = mergeElements([el('b', 1, { index: 'a2' })], [el('a', 1, { index: 'a1' }), el('c', 1, { index: null })]);
  assert.deepEqual(merged.map(e => e.id), ['a', 'b', 'c']);
});

test('images no longer on the board are dropped, and the size budget is enforced', () => {
  const image = (id, fileId, extra = {}) => ({ ...el(id, 1), type: 'image', fileId, ...extra });
  const file = (id, size = 10) => ({ id, mimeType: 'image/png', dataURL: 'data:image/png;base64,' + 'A'.repeat(size), created: 1 });
  const files = mergeFiles({ f1: file('f1'), f2: file('f2') }, { f3: file('f3') }, [image('1', 'f1'), image('2', 'f2', { isDeleted: true }), image('3', 'f3')]);
  assert.deepEqual(Object.keys(files).sort(), ['f1', 'f3']);
  assert.throws(() => mergeFiles({}, { big: file('big', 26 * 1024 * 1024) }, [image('1', 'big')]), e => e instanceof WhiteboardError && e.code === 'FILES_TOO_LARGE');
});

function fakePool({ board = null, project = null } = {}) {
  const queries = [];
  const query = async (sql, params) => {
    queries.push({ sql, params });
    if (sql.startsWith('select * from whiteboards')) return { rows: board ? [board] : [] };
    if (sql.includes('from projects where id')) return { rows: project ? [project] : [] };
    if (sql.startsWith('insert into whiteboards')) return { rows: [{ id: params[0], organization_id: params[1], project_id: params[2], title: params[3], created_by: params[4], revision: 0, elements: [], app_state: {}, files: {} }] };
    if (sql.startsWith('update whiteboards set title')) return { rows: [{ ...board, revision: board.revision + 1, title: params[1] }] };
    return { rows: [], rowCount: 1 };
  };
  return { queries, query, connect: async () => ({ query, release() {} }) };
}
const owner = { id: 'u1', role: 'user', organizationId: 'org', isOrganizationOwner: true };
const member = { id: 'u2', role: 'user', organizationId: 'org' };
const viewer = { id: 'u3', role: 'viewer', organizationId: 'org' };
const client = { id: 'c1', role: 'client', organizationId: 'org' };
const board = (extra = {}) => ({ id: 'w1', organization_id: 'org', project_id: null, title: 'Ideias', elements: [el('1', 1)], app_state: {}, files: {}, revision: 2, created_by: 'u1', ...extra });

test('client portal users and people outside an organization cannot reach whiteboards', async () => {
  const service = createWhiteboards(fakePool({ board: board() }));
  await assert.rejects(service.get(client, 'w1'), { code: 'FORBIDDEN' });
  await assert.rejects(service.list({ id: 'x', role: 'user', organizationId: null }, {}), { code: 'FORBIDDEN' });
});

test('viewers can open a board but not change it', async () => {
  const service = createWhiteboards(fakePool({ board: board() }));
  const opened = await service.get(viewer, 'w1');
  assert.equal(opened.canEdit, false);
  await assert.rejects(service.save(viewer, 'w1', { elements: [] }), { code: 'FORBIDDEN' });
  await assert.rejects(service.create(viewer, { title: 'x' }), { code: 'FORBIDDEN' });
});

test('a project board is hidden from people who cannot see the project', async () => {
  const privateProject = { id: 'p1', organizationId: 'org', createdBy: 'u1', assignedTo: null, visibility: 'private', name: 'Site' };
  const service = createWhiteboards(fakePool({ board: board({ project_id: 'p1' }), project: privateProject }));
  assert.equal((await service.get(owner, 'w1')).id, 'w1');
  await assert.rejects(service.get(member, 'w1'), { code: 'NOT_FOUND' });
  await assert.rejects(service.create(member, { title: 'x', projectId: 'p1' }), { code: 'PROJECT_NOT_FOUND' });
});

test('saving merges the scene and bumps the revision inside a transaction', async () => {
  const pool = fakePool({ board: board() });
  const result = await createWhiteboards(pool).save(member, 'w1', { title: 'Brainstorm', elements: [el('1', 2), el('2', 1)], appState: { viewBackgroundColor: '#fff', zoom: 3 } });
  assert.equal(result.revision, 3);
  assert.deepEqual(result.elements.map(e => [e.id, e.version]), [['1', 2], ['2', 1]]);
  const update = pool.queries.find(q => q.sql.startsWith('update whiteboards set title'));
  assert.deepEqual(JSON.parse(update.params[3]), { viewBackgroundColor: '#fff' }, 'unknown app state is not stored');
  assert.ok(pool.queries.some(q => q.sql.includes('for update')));
  assert.ok(pool.queries.some(q => q.sql === 'commit'));
});

test('invalid saves are refused before touching the database', async () => {
  const pool = fakePool({ board: board() });
  await assert.rejects(createWhiteboards(pool).save(member, 'w1', { elements: [{ id: 'x' }] }), { code: 'INVALID_REQUEST' });
  await assert.rejects(createWhiteboards(pool).save(member, 'w1', { files: { f: { id: 'f', mimeType: 'text/html', dataURL: 'data:text/html;base64,AA', created: 1 } } }), { code: 'INVALID_REQUEST' });
  assert.equal(pool.queries.length, 0);
});

test('only the creator or an owner/manager can delete a board', async () => {
  await assert.rejects(createWhiteboards(fakePool({ board: board() })).remove(member, 'w1'), { code: 'FORBIDDEN' });
  const pool = fakePool({ board: board() });
  await createWhiteboards(pool).remove(owner, 'w1');
  assert.ok(pool.queries.some(q => q.sql.startsWith('delete from whiteboards')));
});

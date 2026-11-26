const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

if (!process.env.CONVERSATIONS_TEST_DATABASE_URL) {
  test('Conversations PostgreSQL integration (set CONVERSATIONS_TEST_DATABASE_URL)', { skip: true }, () => {});
} else {
  const url = new URL(process.env.CONVERSATIONS_TEST_DATABASE_URL);
  assert.ok(['localhost', '127.0.0.1'].includes(url.hostname) && url.port === '55442' && url.pathname === '/flowlio_conversations_test', 'Dedicated local test database only');
  const { Pool } = require('pg');
  const pool = new Pool({ connectionString: url.toString() });
  const { createConversations } = require('../src/modules/conversations/service');
  const service = createConversations(pool);
  const owner = { id: 'owner', role: 'user', organizationId: 'org', isOrganizationOwner: true };
  const ana = { id: 'ana', role: 'user', organizationId: 'org' };
  const portal = { id: 'marcos', role: 'client', organizationId: 'org' };
  const events = [];
  const emit = (userIds, event, payload) => events.push({ userIds, event, payload });

  before(async () => {
    await pool.query('drop schema public cascade; create schema public; drop schema if exists flowlio_releases cascade; drop schema if exists drizzle cascade');
    await require('../src/utils/release-migrations.util').runReleaseMigrations(pool);
    await pool.query(`
      insert into users(id,name,email,email_verified,two_factor_enabled,is_super_admin,timezone,role,created_at,updated_at) values
        ('owner','Owner','owner@x.test',true,false,false,'UTC','user',now(),now()),('ana','Ana','ana@x.test',true,false,false,'UTC','user',now(),now()),
        ('marcos','Marcos','marcos@x.test',true,false,false,'UTC','client',now(),now());
      update users set is_organization_owner=true where id='owner';
      insert into organizations(id,name,slug,subscription_status,created_at,updated_at) values ('org','Org','org','active',now(),now());
      insert into user_organizations(id,user_id,organization_id,role,status,created_at,updated_at) values ('m1','owner','org','owner','active',now(),now()),('m2','ana','org','member','active',now(),now());
      insert into clients(id,name,email,organization_id,created_by,user_id,type,created_at,updated_at) values ('padaria','Padaria','','org','owner','marcos','client',now(),now());
      insert into projects(id,name,project_number,organization_id,created_by,status,visibility,client_id,created_at,updated_at) values
        ('site','Site','P1','org','owner','pending','public','padaria',now(),now()),('secret','Interno','P2','org','owner','pending','private',null,now(),now());
      insert into tasks(id,title,project_id,created_by,status,visibility,created_at,updated_at) values
        ('layout','Layout','site','owner','todo','public',now(),now()),('hidden','Só equipe','site','owner','todo','private',now(),now());
    `);
  });
  after(() => pool.end());

  test('existing comments and client messages are copied (as client-visible) without touching the old tables', async () => {
    await pool.query(`
      insert into project_comments(id,project_id,user_id,content,created_at,updated_at) values ('c1','site','owner','Kickoff','2026-11-01','2026-11-01');
      insert into project_comments(id,project_id,user_id,content,parent_id,created_at,updated_at) values ('c2','site','marcos','Ótimo','c1','2026-11-02','2026-11-02');
      insert into project_comments(id,project_id,task_id,user_id,content,created_at,updated_at) values ('c3','site','layout','ana','Tons quentes?','2026-11-03','2026-11-03');
      insert into client_interactions(id,client_id,user_id,organization_id,type,content,created_at) values ('i1','padaria','owner','org','note','Bem-vindo','2026-11-04');
      insert into interaction_replies(id,interaction_id,user_id,content,created_at) values ('r1','i1','marcos','Obrigado','2026-11-05');
    `);
    const sql = fs.readFileSync(path.resolve('drizzle/releases/0034_conversations.sql'), 'utf8');
    await pool.query(sql.slice(sql.indexOf('-- Copy (never move)')));
    const rows = (await pool.query(`select m.id, c.kind, m.visibility, m.author_kind, m.parent_id from messages m join conversations c on c.id=m.conversation_id order by m.id`)).rows;
    assert.deepEqual(rows.map(r => [r.id, r.kind, r.visibility, r.author_kind, r.parent_id]), [
      ['c1', 'project', 'client', 'member', null], ['c2', 'project', 'client', 'client', 'c1'], ['c3', 'task', 'client', 'member', null],
      ['i1', 'client', 'client', 'member', null], ['r1', 'client', 'client', 'client', 'i1'],
    ]);
    assert.equal((await pool.query('select count(*)::int n from project_comments')).rows[0].n, 3, 'old comments stay');
  });

  test('the sidebar lists channels, projects, clients and unread counts per person', async () => {
    const list = await service.list(owner);
    assert.deepEqual(list.channels.map(c => c.name), ['geral']);
    assert.deepEqual(list.projects.map(p => p.name).sort(), ['Interno', 'Site']);
    assert.equal(list.clients[0].name, 'Padaria');
    assert.equal(list.projects.find(p => p.name === 'Site').unread, 0, "the owner's own message and a reply do not count");
    assert.equal((await service.list(ana)).projects.find(p => p.name === 'Site').unread, 1, 'Ana has one unread top-level message');
    assert.deepEqual((await service.list(ana)).projects.map(p => p.name), ['Site'], 'a private project stays hidden');
    assert.deepEqual((await service.list(ana)).clients, [], 'members do not see client relationships');
  });

  test('internal messages never reach the client; client messages do, with approval', async () => {
    const site = await service.forContext(owner, { projectId: 'site' });
    assert.equal(site.access.postToClient, true);
    await service.post(owner, site.id, { body: 'Só entre nós', visibility: 'internal' }, emit);
    const request = await service.post(owner, site.id, { body: 'Versão 2 para aprovar', visibility: 'client', requestApproval: true }, emit);
    assert.equal(request.approval.status, 'pending');
    assert.ok(events.at(-1).userIds.includes('marcos'), 'the client gets client messages in realtime');
    assert.ok(!events.at(-2).userIds.includes('marcos'), 'but not internal ones');

    const clientView = await service.page(portal, site.id, {});
    assert.ok(clientView.messages.every(m => m.visibility === 'client'));
    assert.ok(!clientView.messages.some(m => m.body === 'Só entre nós'));
    await assert.rejects(service.post(portal, site.id, { body: 'x', visibility: 'internal', parentId: (await service.page(owner, site.id, { audience: 'internal' })).messages.at(-1).id }), { code: 'PARENT_NOT_FOUND' });

    const reply = await service.post(portal, site.id, { body: 'Ficou ótimo', visibility: 'internal' }, emit);
    assert.equal(reply.visibility, 'client', 'whatever the client sends is client-visible');
    await assert.rejects(service.decide(owner, request.id, { decision: 'approved' }), { code: 'FORBIDDEN' });
    const decided = await service.decide(portal, request.id, { decision: 'approved' }, emit);
    assert.equal(decided.approval.status, 'approved');
    await assert.rejects(service.decide(portal, request.id, { decision: 'changes' }), { code: 'NOT_PENDING' });
    const thread = await service.thread(owner, request.id);
    assert.match(thread.replies[0].body, /Marcos aprovou/);
    assert.equal((await pool.query("select count(*)::int n from notifications where user_id='owner' and title='Aprovado pelo cliente'")).rows[0].n, 1);
  });

  test('replies follow their message, mentions notify, reactions toggle, read clears unread', async () => {
    const site = await service.forContext(owner, { projectId: 'site' });
    const parent = await service.post(owner, site.id, { body: 'Plano interno', visibility: 'internal', mentions: ['ana', 'stranger'], taskRefs: ['layout', 'nope'] }, emit);
    assert.deepEqual(parent.mentions, ['ana']);
    assert.deepEqual(parent.tasks.map(t => t.title), ['Layout']);
    const reply = await service.post(ana, site.id, { body: 'Combinado', visibility: 'client', parentId: parent.id }, emit);
    assert.equal(reply.visibility, 'internal', 'a reply keeps the audience of the message it answers');
    await new Promise(resolve => setTimeout(resolve, 50));
    assert.equal((await pool.query("select count(*)::int n from notifications where user_id='ana' and title like '%mencionou%'")).rows[0].n, 1);
    assert.equal((await service.react(ana, parent.id, { emoji: '👍' })).active, true);
    assert.equal((await service.react(ana, parent.id, { emoji: '👍' })).active, false);
    await assert.rejects(service.react(ana, parent.id, { emoji: '💩' }), { code: 'INVALID_REACTION' });
    await service.read(ana, site.id);
    assert.equal((await service.list(ana)).projects.find(p => p.name === 'Site').unread, 0);
  });

  test('the client sees only their projects, public tasks and own client conversation', async () => {
    const list = await service.list(portal);
    assert.deepEqual(list.projects.map(p => p.name), ['Site']);
    assert.equal(list.channels.length, 0);
    await assert.rejects(service.forContext(portal, { projectId: 'secret' }), { code: 'NOT_FOUND' });
    await assert.rejects(service.forContext(portal, { taskId: 'hidden' }), { code: 'NOT_FOUND' });
    assert.ok((await service.forContext(portal, { taskId: 'layout' })).id);
    const channel = (await service.list(owner)).channels[0];
    await assert.rejects(service.page(portal, channel.conversationId, {}), { code: 'NOT_FOUND' });
  });

  test('channels and direct messages between members', async () => {
    const channel = await service.createChannel(owner, { name: 'Design' });
    assert.equal(channel.name, 'design');
    await assert.rejects(service.createChannel(owner, { name: 'design' }), { code: 'CHANNEL_EXISTS' });
    await assert.rejects(service.createChannel(portal, { name: 'x' }), { code: 'FORBIDDEN' });
    const dm = await service.direct(owner, { userId: 'ana' });
    assert.equal((await service.direct(ana, { userId: 'owner' })).id, dm.id, 'the same pair reuses one conversation');
    await service.post(owner, dm.id, { body: 'Oi Ana' }, emit);
    assert.deepEqual(events.at(-1).userIds, ['ana']);
    await assert.rejects(service.post(owner, dm.id, { body: 'x', visibility: 'client' }), { code: 'CLIENT_NOT_ALLOWED' });
    assert.equal((await service.list(ana)).directs[0].unread, 1);
  });
}

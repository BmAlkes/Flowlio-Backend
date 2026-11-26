const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');

if (!process.env.TASK_AUTOMATION_TEST_DATABASE_URL) {
  test('Task automation PostgreSQL integration (set TASK_AUTOMATION_TEST_DATABASE_URL)', { skip: true }, () => {});
} else {
  const url = new URL(process.env.TASK_AUTOMATION_TEST_DATABASE_URL);
  assert.ok(['localhost', '127.0.0.1'].includes(url.hostname) && url.port === '55442' && url.pathname === '/flowlio_task_automation_test', 'Dedicated local test database only');
  const { Pool } = require('pg');
  const pool = new Pool({ connectionString: url.toString() });
  const { createTaskAutomations, processTaskAutomations } = require('../src/modules/task-automations/service');
  const service = createTaskAutomations(pool);
  const owner = { id: 'owner', role: 'user', organizationId: 'org', isOrganizationOwner: true };

  async function runWorker(today = new Date('2026-11-26T09:00:00Z')) {
    const client = await pool.connect();
    try {
      await client.query('begin');
      const result = await processTaskAutomations(client, today);
      await client.query('commit');
      return result;
    } catch (error) { await client.query('rollback'); throw error; } finally { client.release(); }
  }
  const taskRow = async title => (await pool.query("select *, to_char(end_date,'YYYY-MM-DD') as due from tasks where title=$1", [title])).rows[0];

  before(async () => {
    await pool.query('drop schema public cascade; create schema public; drop schema if exists flowlio_releases cascade; drop schema if exists drizzle cascade');
    await require('../src/utils/release-migrations.util').runReleaseMigrations(pool);
    await pool.query(`
      insert into users(id,name,email,email_verified,two_factor_enabled,is_super_admin,timezone,created_at,updated_at) values
        ('owner','Owner','owner@example.test',true,false,false,'UTC',now(),now()),('ana','Ana','ana@example.test',true,false,false,'UTC',now(),now());
      insert into organizations(id,name,slug,subscription_status,created_at,updated_at) values ('org','Org','org','active',now(),now()),('other','Other','other','active',now(),now());
      insert into user_organizations(id,user_id,organization_id,role,status,created_at,updated_at) values ('m1','owner','org','owner','active',now(),now()),('m2','ana','org','member','active',now(),now());
      insert into projects(id,name,project_number,organization_id,created_by,status,visibility,created_at,updated_at) values
        ('p1','Site','P1','org','owner','pending','public',now(),now()),('p2','Backlog','P2','org','owner','pending','public',now(),now()),('px','Other','P1','other','owner','pending','public',now(),now());
      insert into custom_field_definitions(id,organization_id,entity_type,name,type,options,position,created_at,updated_at) values
        ('prio','org','task','Prioridade','select','[{"label":"Alta","color":"#f00"},{"label":"Baixa","color":"#0f0"}]',0,now(),now());
    `);
  });
  after(() => pool.end());

  test('without rules no events are recorded', async () => {
    await pool.query("insert into tasks(id,title,project_id,created_by,status,visibility,created_at,updated_at) values ('t0','Quiet','p1','owner','todo','private',now(),now())");
    assert.equal((await pool.query('select count(*)::int n from task_events')).rows[0].n, 0);
  });

  test('when a task is completed, the creator is notified and a follow-up task is created', async () => {
    await service.save(owner, { name: 'Pronto → revisar', trigger: { type: 'status_changed', to: 'completed' }, conditions: [{ type: 'field', fieldId: 'prio', op: 'is', value: 'Alta' }],
      actions: [{ type: 'notify', recipient: 'creator', message: '{{task}} foi concluída' }, { type: 'create_task', title: 'Revisar {{task}}', projectId: 'same', assignee: 'none', dueInDays: 2 }] });
    await pool.query(`insert into tasks(id,title,project_id,created_by,status,visibility,custom_fields,created_at,updated_at) values
      ('t1','Hero','p1','owner','todo','private','{"prio":"Alta"}',now(),now()),('t2','Footer','p1','owner','todo','private','{"prio":"Baixa"}',now(),now())`);
    await pool.query("update tasks set status='completed' where id in ('t1','t2')");
    const result = await runWorker();
    assert.equal(result.runs, 1, 'only the high-priority task matches');
    const note = (await pool.query("select user_id,message from notifications where organization_id='org'")).rows[0];
    assert.deepEqual(note, { user_id: 'owner', message: 'Hero foi concluída' });
    const review = await taskRow('Revisar Hero');
    assert.equal(review.project_id, 'p1');
    assert.equal(review.due, '2026-11-28');
    assert.equal((await runWorker()).runs, 0, 'an event runs a rule only once');
  });

  test('chains stop after three steps, so two rules cannot loop forever', async () => {
    await pool.query('update task_automation_rules set enabled=false');
    await service.save(owner, { name: 'A', trigger: { type: 'status_changed', to: 'delay' }, actions: [{ type: 'set_status', status: 'changes' }] });
    await service.save(owner, { name: 'B', trigger: { type: 'status_changed', to: 'changes' }, actions: [{ type: 'set_status', status: 'delay' }] });
    await pool.query("update tasks set status='delay' where id='t0'");
    for (let i = 0; i < 6; i++) await runWorker();
    const runs = (await pool.query("select count(*)::int n from task_automation_runs r join task_automation_rules a on a.id=r.rule_id where a.name in ('A','B')")).rows[0].n;
    assert.equal(runs, 3);
    assert.equal((await pool.query('select count(*)::int n from task_events where processed_at is null')).rows[0].n, 0);
  });

  test('field, assignee and due date triggers; actions set fields, assign and move', async () => {
    await pool.query('update task_automation_rules set enabled=false');
    await service.save(owner, { name: 'Alta → Ana', trigger: { type: 'field_changed', fieldId: 'prio', to: 'Alta' }, actions: [{ type: 'assign', userId: 'ana' }, { type: 'set_due', days: 1 }] });
    await service.save(owner, { name: 'Atribuída → em andamento', trigger: { type: 'assignee_changed' }, actions: [{ type: 'set_status', status: 'in_progress' }] });
    await service.save(owner, { name: 'Véspera', trigger: { type: 'due_date', offsetDays: 1 }, conditions: [{ type: 'assignee', op: 'not_empty' }], actions: [{ type: 'set_field', fieldId: 'prio', value: 'Baixa' }, { type: 'move_project', projectId: 'p2' }] });
    await pool.query("insert into tasks(id,title,project_id,created_by,status,visibility,created_at,updated_at) values ('t3','Menu','p1','owner','todo','private',now(),now())");
    await pool.query(`update tasks set custom_fields='{"prio":"Alta"}' where id='t3'`);
    await runWorker(); await runWorker();
    let menu = await taskRow('Menu');
    assert.deepEqual([menu.assigned_to, menu.status, menu.due], ['ana', 'in_progress', '2026-11-27']);
    await runWorker(new Date('2026-11-26T09:00:00Z'));
    menu = await taskRow('Menu');
    assert.deepEqual([menu.custom_fields.prio, menu.project_id], ['Baixa', 'p2']);
  });

  test('a weekly schedule creates its task once on the chosen weekday', async () => {
    await pool.query('update task_automation_rules set enabled=false');
    await service.save(owner, { name: 'Relatório semanal', trigger: { type: 'schedule', every: 'week', weekday: 4 }, actions: [{ type: 'create_task', title: 'Relatório da semana', projectId: 'p2', assignee: 'ana', dueInDays: 1 }] });
    const thursday = new Date('2026-11-26T09:00:00Z');
    await runWorker(thursday); await runWorker(thursday);
    await runWorker(new Date('2026-11-27T09:00:00Z'));
    const created = (await pool.query("select assigned_to from tasks where title='Relatório da semana'")).rows;
    assert.deepEqual(created, [{ assigned_to: 'ana' }]);
  });

  test('rules refuse people, fields and projects from outside the organization, and stop when their author leaves', async () => {
    await assert.rejects(service.save(owner, { name: 'X', trigger: { type: 'task_created' }, actions: [{ type: 'move_project', projectId: 'px' }] }), { code: 'INVALID_RULE' });
    await assert.rejects(service.save(owner, { name: 'X', trigger: { type: 'task_created' }, actions: [{ type: 'set_field', fieldId: 'prio', value: 'Média' }] }), { code: 'INVALID_RULE' });
    await assert.rejects(service.save(owner, { name: 'X', trigger: { type: 'task_created' }, actions: [{ type: 'assign', userId: 'stranger' }] }), { code: 'INVALID_RULE' });
    const rule = await service.save({ ...owner, id: 'ana', isOrganizationOwner: false, isOrganizationManager: true }, { name: 'De Ana', trigger: { type: 'task_created' }, actions: [{ type: 'set_status', status: 'delay' }] });
    await pool.query("update user_organizations set status='inactive' where user_id='ana'");
    await pool.query("insert into tasks(id,title,project_id,created_by,status,visibility,created_at,updated_at) values ('t4','Novo','p1','owner','todo','private',now(),now())");
    await runWorker();
    assert.equal((await pool.query('select enabled from task_automation_rules where id=$1', [rule.id])).rows[0].enabled, false);
    assert.equal((await taskRow('Novo')).status, 'todo');
    const history = await service.history(owner);
    assert.ok(history.some(row => row.ruleName === 'Pronto → revisar' && row.taskTitle === 'Hero' && row.outcome === 'done'));
  });
}

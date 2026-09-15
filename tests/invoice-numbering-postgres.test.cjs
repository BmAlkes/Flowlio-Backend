const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { randomUUID } = require('node:crypto');

if (!process.env.INVOICE_TEST_DATABASE_URL) {
  test('Invoice PostgreSQL integration (set INVOICE_TEST_DATABASE_URL)', { skip: true }, () => {});
} else {
  const url = new URL(process.env.INVOICE_TEST_DATABASE_URL);
  assert.ok(['127.0.0.1', 'localhost'].includes(url.hostname) && url.pathname === '/flowlio_invoice_test',
    'Only a dedicated local flowlio_invoice_test database is allowed');
  const { Pool } = require('pg');
  const { drizzle } = require('drizzle-orm/node-postgres');
  const { eq, and } = require('drizzle-orm');
  const Module = require('node:module');
  const schema = require('../src/schema/schema');
  const pool = new Pool({ connectionString: url.toString(), max: 20 });
  const db = drizzle(pool, { schema, casing: 'snake_case' });
  // The client lookup uses the real tenant predicate, with only the columns
  // needed by invoice creation; no unrelated CRM fixture is necessary.
  db.query.clients.findFirst = async ({ where }) => (await db.select({ id: schema.clients.id,
    name: schema.clients.name, organizationId: schema.clients.organizationId }).from(schema.clients)
    .where(where(schema.clients, { eq, and })).limit(1))[0];
  const original = Module._load;
  let activities = [];
  Module._load = function(id, ...args) {
    if (id.endsWith('configs/connection.config')) return { database: db, connection: pool };
    if (id.includes('utils/logger.util')) return { logger: { info() {}, error() {}, warn() {} } };
    if (id.includes('utils/cloudinary.util')) return { uploadToCloudinary: async () => { throw Error('No uploads in tests'); } };
    if (id.includes('utils/plan-access.util')) return { canCreateInvoice: async () => ({ hasAccess: true }) };
    if (id.includes('utils/activity.util')) return { logActivity: async value => { activities.push(value); } };
    return original.call(this, id, ...args);
  };
  const { prepareInvoiceNumbering } = require('../src/utils/invoice-numbering-migration.util');
  const { insertNumberedInvoice } = require('../src/services/invoice-numbering.service');
  const { RecurringInvoiceService } = require('../src/services/recurringInvoice.service');
  const { createInvoice } = require('../src/controllers/organization/invoices/createinvoice.controller');
  Module._load = original;
  const migration = fs.readFileSync('drizzle/0034_invoice_number_sequences.sql', 'utf8');
  const data = (org = 'org-a') => ({ id: randomUUID(), organizationId: org, clientId: 'client-' + org,
    createdBy: 'alice', clientname: 'Client', amount: '25', status: 'draft' });
  const insert = (series = 'S1', org = 'org-a') => db.transaction(tx => insertNumberedInvoice(tx, series, data(org)));
  const count = async () => Number((await pool.query('select count(*) from invoices')).rows[0].count);
  const counter = async () => (await pool.query('select last_value from invoice_number_counters order by series')).rows;
  const reapply = async () => {
    const client = await pool.connect();
    try { await client.query('begin'); await client.query(migration); await client.query('commit'); }
    catch (error) { await client.query('rollback'); throw error; } finally { client.release(); }
  };
  before(async () => {
    await pool.query(`
      create table organizations (id text primary key);
      create table users (id text primary key);
      create table clients (id text primary key, organization_id text not null references organizations(id), name text not null);
      create table invoices (
        id text primary key, organization_id text not null references organizations(id),
        client_id text not null references clients(id), created_by text not null references users(id),
        invoice_number text not null, client_name text not null, amount numeric(10,2) not null,
        status text not null, date_paid timestamp, due_date timestamp, description text,
        pdf_url text, pdf_file_name text, pdf_file_size integer, payment_url text, overdue_notified_at timestamp,
        created_at timestamp not null, updated_at timestamp not null,
        constraint unique_invoice_number_per_org unique(invoice_number, organization_id)
      );
      create table recent_activities (organization_id text, type text, resource text, action text, message text);
      create table recurring_invoices (
        id text primary key, organization_id text not null references organizations(id),
        client_id text not null references clients(id), created_by text not null references users(id),
        template_name text not null, client_name text not null, amount numeric(10,2) not null, description text,
        frequency text not null, start_date timestamp not null, end_date timestamp, last_run_date timestamp,
        next_run_date timestamp not null, status text not null, created_at timestamp not null, updated_at timestamp not null
      );
    `);
    await prepareInvoiceNumbering(pool);
  });
  beforeEach(async () => {
    await pool.query('truncate recent_activities, invoices, invoice_number_counters, recurring_invoices, clients, users, organizations cascade');
    await pool.query("insert into organizations values ('org-a'), ('org-b'); insert into users values ('alice'); insert into clients values ('client-org-a','org-a','Client A'), ('client-org-b','org-b','Client B')");
    activities = [];
  });
  after(async () => {
    try { await pool.query('drop table if exists recent_activities, invoices, invoice_number_counters, recurring_invoices, clients, users, organizations cascade; drop function if exists assign_invoice_number()'); }
    finally { await pool.end(); }
  });
  async function manual(org = 'org-a', clientId = 'client-' + org) {
    const res = { code: 200, status(value) { this.code = value; return this; }, json(value) { this.body = value; } };
    await createInvoice({ user: { id: 'alice', role: 'user', organizationId: org }, body: { clientId, amount: 25 } }, res);
    return res;
  }
  async function template() {
    return (await db.insert(schema.recurringInvoices).values({ ...data(), templateName: 'Monthly',
      frequency: 'monthly', startDate: new Date('2026-01-01'), nextRunDate: new Date('2026-01-01'), status: 'active' }).returning())[0];
  }
  test('manual controller: 30 simultaneous invoices get distinct sequential numbers', async () => {
    const responses = await Promise.all(Array.from({ length: 30 }, () => manual()));
    assert.ok(responses.every(r => r.code === 201));
    const numbers = responses.map(r => r.body.data.invoiceNumber).sort();
    assert.equal(new Set(numbers).size, 30); assert.equal(numbers[0], 'S1-00001'); assert.equal(numbers[29], 'S1-00030');
    assert.equal(activities.length, 30);
    assert.ok(activities.every(a => numbers.some(n => a.message.includes(n))));
  });
  test('deleting highest invoice or all invoices does not reuse issued numbers', async () => {
    await insert(); const last = await insert();
    await db.delete(schema.invoices).where(eq(schema.invoices.id, last.id));
    assert.equal((await insert()).invoiceNumber, 'S1-00003');
    await pool.query('delete from invoices');
    assert.equal((await insert()).invoiceNumber, 'S1-00004');
  });
  test('each organization and series has an independent counter', async () => {
    assert.equal((await insert()).invoiceNumber, 'S1-00001');
    assert.equal((await insert('REC')).invoiceNumber, 'REC-00001');
    assert.equal((await insert('S1', 'org-b')).invoiceNumber, 'S1-00001');
  });
  test('legacy and new writers can run together during deployment', async () => {
    const responses = await Promise.all(Array.from({ length: 20 }, (_, i) => i % 2 ? insert() :
      db.insert(schema.invoices).values({ ...data(), invoiceNumber: 'S1-00001' }).returning().then(r => r[0])));
    assert.equal(new Set(responses.map(r => r.invoiceNumber)).size, 20);
    assert.equal(await count(), 20);
  });
  test('migration seeds largest historical suffix, preserves invoices and is repeatable', async () => {
    await pool.query('alter table invoices disable trigger invoices_assign_number');
    await db.insert(schema.invoices).values([
      { ...data(), invoiceNumber: 'S1-00042' }, { ...data(), invoiceNumber: 'S1-00007' },
      { ...data(), invoiceNumber: 'REC-00091' }, { ...data(), invoiceNumber: 'CUSTOM-abc' },
    ]);
    await prepareInvoiceNumbering(pool);
    assert.equal((await insert()).invoiceNumber, 'S1-00043');
    assert.equal((await insert('REC')).invoiceNumber, 'REC-00092');
    assert.equal(await count(), 6);
    await pool.query('delete from invoices'); await reapply();
    assert.equal((await insert()).invoiceNumber, 'S1-00044');
  });
  test('migration recovers deleted invoice numbers from retained activity history', async () => {
    await pool.query("insert into recent_activities values ('org-a', 'invoice', 'invoice', 'delete', 'Deleted invoice: S1-00120')");
    await reapply();
    assert.equal((await insert()).invoiceNumber, 'S1-00121');
  });
  test('numbers beyond five digits are never truncated', async () => {
    await insert(); await pool.query("update invoice_number_counters set last_value = 99999");
    assert.equal((await insert()).invoiceNumber, 'S1-100000');
  });
  test('failed invoice insertion rolls back its counter increment', async () => {
    await assert.rejects(db.transaction(tx => insertNumberedInvoice(tx, 'S1', { ...data(), clientId: 'missing' })));
    assert.equal(await count(), 0); assert.deepEqual(await counter(), []);
    assert.equal((await insert()).invoiceNumber, 'S1-00001');
  });
  test('manual controller rejects foreign clients without allocating a number', async () => {
    assert.equal((await manual('org-a', 'client-org-b')).code, 404);
    assert.equal(await count(), 0); assert.deepEqual(await counter(), []);
  });
  test('same recurring occurrence processed concurrently creates one invoice and advances once', async () => {
    const source = await template();
    const results = await Promise.all(Array.from({ length: 10 }, () => RecurringInvoiceService.generateInvoiceFromTemplate(source)));
    assert.equal(results.filter(Boolean).length, 1); assert.equal(await count(), 1);
    assert.equal(results.find(Boolean).invoiceNumber, 'REC-00001');
    const current = (await db.select().from(schema.recurringInvoices))[0];
    assert.equal(current.nextRunDate.toISOString(), '2026-02-01T00:00:00.000Z');
  });
  test('recurring schedule failure rolls back both invoice and allocated number', async () => {
    const source = await template();
    await pool.query(`create function fail_schedule() returns trigger language plpgsql as $$ begin raise exception 'test schedule error'; end; $$;
      create trigger fail_schedule before update on recurring_invoices for each row execute function fail_schedule();`);
    try {
      await assert.rejects(RecurringInvoiceService.generateInvoiceFromTemplate(source));
      assert.equal(await count(), 0); assert.deepEqual(await counter(), []);
    } finally { await pool.query('drop trigger fail_schedule on recurring_invoices; drop function fail_schedule()'); }
    assert.equal((await RecurringInvoiceService.generateInvoiceFromTemplate(source)).invoiceNumber, 'REC-00001');
  });
  test('missing trigger fails closed and never persists a placeholder invoice', async () => {
    await pool.query('alter table invoices disable trigger invoices_assign_number');
    try { await assert.rejects(insert(), /migration is required/); assert.equal(await count(), 0); }
    finally { await prepareInvoiceNumbering(pool); }
  });
  test('concurrent startup migration checks are safe and do not reset counters', async () => {
    await insert(); await Promise.all(Array.from({ length: 5 }, () => prepareInvoiceNumbering(pool)));
    assert.equal((await insert()).invoiceNumber, 'S1-00002');
  });
}

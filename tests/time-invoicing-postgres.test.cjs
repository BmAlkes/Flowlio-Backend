const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
if (!process.env.TIME_INVOICE_TEST_DATABASE_URL) {
  test('Time invoicing PostgreSQL integration (set TIME_INVOICE_TEST_DATABASE_URL)', { skip: true }, () => {});
} else {
  const url = new URL(process.env.TIME_INVOICE_TEST_DATABASE_URL);
  assert.ok(['127.0.0.1','localhost'].includes(url.hostname) && url.pathname === '/flowlio_time_invoice_test');
  const { Pool } = require('pg');
  const { drizzle } = require('drizzle-orm/node-postgres');
  const Module = require('node:module');
  const schema = require('../src/schema/schema');
  const pool = new Pool({ connectionString: url.toString(), max: 15 });
  const db = drizzle(pool, { schema, casing: 'snake_case' });
  let quota = true;
  const original = Module._load;
  Module._load = function(id, ...args) {
    if (id.endsWith('configs/connection.config')) return { database: db, connection: pool };
    if (id.includes('utils/plan-access.util')) return { canCreateInvoice: async () => ({ hasAccess: quota }) };
    if (id.includes('utils/logger.util')) return { logger: { error() {}, info() {}, warn() {} } };
    return original.call(this,id,...args);
  };
  const { listBillableTime, createTimeInvoice, getInvoiceTimeItems } = require('../src/services/time-invoicing.service');
  const { billableTime, invoiceFromTime } = require('../src/controllers/organization/invoices/time-invoicing.controller');
  const { getInvoices } = require('../src/controllers/organization/invoices/getinvoices.controller');
  const { prepareInvoiceNumbering } = require('../src/utils/invoice-numbering-migration.util');
  const { prepareTimeInvoicing } = require('../src/utils/time-invoicing-migration.util');
  Module._load = original;
  const actor = { id: 'alice', role: 'user', organizationId: 'org-a', isOrganizationOwner: true };
  const filter = { clientId: 'client-a', start: '2026-09-01T00:00:00Z', end: '2026-10-01T00:00:00Z' };
  const request = async () => ({ ...filter, requestKey: randomUUID(), entries: (await listBillableTime(actor,filter)).entries.map(({id,version}) => ({id,version})), fallbackRate: '40.00' });
  const count = async table => Number((await pool.query('select count(*) from ' + table)).rows[0].count);
  const response = () => ({ code: 200, status(code) { this.code=code; return this; }, json(body) { this.body=body; return this; } });
  before(async () => {
    await pool.query(`      create table organizations (id text primary key);
      create table users (id text primary key, name text not null);
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
      create table recent_activities (id text primary key, organization_id text, actor_id text, user_id text, type text, resource text, resource_id text, action text, message text, metadata json, created_at timestamp);

      create table projects (id text primary key, name text, organization_id text references organizations(id), client_id text references clients(id), created_by text, assigned_to text, visibility text);
      create table tasks (id text primary key, title text, project_id text references projects(id), created_by text, assigned_to text, visibility text);
      create table time_entries (id text primary key, user_id text references users(id), project_id text references projects(id), task_id text references tasks(id), client_id text references clients(id), description text, start_time timestamp, end_time timestamp, duration integer, billable boolean, hourly_rate numeric(10,2), status text);
    `);
    await prepareInvoiceNumbering(pool); await prepareTimeInvoicing(pool);
  });
  beforeEach(async () => {
    quota=true;
    await pool.query('truncate organizations, users, clients, projects, tasks, time_entries, invoices, recent_activities, invoice_number_counters, invoice_time_items, time_invoicing_requests cascade');
    await pool.query(`
      insert into organizations values ('org-a'),('org-b');
      insert into users values ('alice','Alice'),('bob','Bob');
      insert into clients values ('client-a','org-a','Client A'),('client-b','org-b','Client B');
      insert into projects values ('p','Project','org-a','client-a','alice',null,'public'),('private','Private','org-a','client-a','bob',null,'private'),('foreign','Foreign','org-b','client-b','bob',null,'public');
      insert into tasks values ('t','Design','p','alice',null,'public');
      insert into time_entries values ('one','alice','p','t','client-a',null,'2026-09-15','2026-09-15 01:00',60,true,50,'completed'),('two','bob','p','t',null,null,'2026-09-16','2026-09-16 00:30',30,true,null,'completed');
    `);
  });
  after(async () => { try { await pool.query('drop table time_invoicing_requests, invoice_time_items, time_entries, tasks, projects, recent_activities, invoices, invoice_number_counters, clients, users, organizations cascade; drop function if exists protect_invoiced_time(); drop function if exists assign_invoice_number()'); } finally { await pool.end(); } });
  test('team entries create one invoice with persisted per-entry prices and server total', async () => {
    const input=await request(); assert.equal(input.entries.length,2);
    const {invoice}=await createTimeInvoice(actor,input);
    assert.equal(invoice.amount,'70.00'); assert.equal(invoice.invoiceNumber,'S1-00001');
    const items=await getInvoiceTimeItems(actor,invoice.id);
    assert.deepEqual(items.map(i=>[i.userName,i.hourlyRate,i.amount]),[['Alice','50.00','50.00'],['Bob','40.00','20.00']]);
    assert.equal((await listBillableTime(actor,filter)).entries.length,0);
    await assert.rejects(getInvoiceTimeItems({...actor,organizationId:'org-b'},invoice.id),e=>e.status===404);
  });
  test('concurrent retries return the original invoice exactly once', async () => {
    const input=await request();
    const results=await Promise.all(Array.from({length:12},()=>createTimeInvoice(actor,input)));
    assert.equal(new Set(results.map(r=>r.invoice.id)).size,1);
    assert.equal(results.filter(r=>!r.replayed).length,1);
    assert.equal(await count('invoices'),1); assert.equal(await count('invoice_time_items'),2); assert.equal(await count('recent_activities'),1);
    quota=false; assert.equal((await createTimeInvoice(actor,input)).replayed,true);
    await assert.rejects(createTimeInvoice(actor,{...input,fallbackRate:'80.00'}),e=>e.code==='REQUEST_KEY_CONFLICT');
  });
  test('competing requests cannot invoice overlapping hours', async () => {
    const input=await request();
    const results=await Promise.allSettled([createTimeInvoice(actor,input),createTimeInvoice(actor,{...input,requestKey:randomUUID()})]);
    assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
    assert.equal(results.find(r=>r.status==='rejected').reason.code,'TIME_CHANGED');
    assert.equal(await count('invoices'),1);
  });
  test('unbillable, active, private, foreign and mismatched entries are excluded', async () => {
    await pool.query(`insert into time_entries select 'unbillable',user_id,project_id,task_id,client_id,description,start_time,end_time,duration,false,hourly_rate,status from time_entries where id='one';
      insert into time_entries select 'active',user_id,project_id,task_id,client_id,description,start_time,null,duration,true,hourly_rate,'active' from time_entries where id='one';
      insert into time_entries select 'private-time',user_id,'private',null,client_id,description,start_time,end_time,duration,true,hourly_rate,status from time_entries where id='one';
      insert into time_entries select 'foreign-time',user_id,'foreign',null,'client-b',description,start_time,end_time,duration,true,hourly_rate,status from time_entries where id='one';
      insert into time_entries select 'mismatch',user_id,project_id,task_id,'client-b',description,start_time,end_time,duration,true,hourly_rate,status from time_entries where id='one';`);
    assert.deepEqual((await request()).entries.map(e=>e.id),['one','two']);
    await assert.rejects(listBillableTime(actor,{...filter,clientId:'client-b'}),e=>e.status===404);
    const input=await request(); input.entries.push({id:'foreign-time',version:'a'.repeat(64)});
    await assert.rejects(createTimeInvoice(actor,input),e=>e.code==='TIME_CHANGED');
    assert.equal(await count('invoices'),0);
  });
  test('changed hours or rate require a new review', async () => {
    const input=await request(); await pool.query("update time_entries set hourly_rate=90 where id='one'");
    await assert.rejects(createTimeInvoice(actor,input),e=>e.code==='TIME_CHANGED');
    assert.equal(await count('invoices'),0);
  });
  test('write failure rolls back invoice, links, request and invoice counter', async () => {
    await pool.query(`create function fail_time_request() returns trigger language plpgsql as $$ begin raise exception 'test failure'; end; $$; create trigger test_fail before insert on time_invoicing_requests for each row execute function fail_time_request()`);
    try { await assert.rejects(createTimeInvoice(actor,await request())); }
    finally { await pool.query('drop trigger test_fail on time_invoicing_requests; drop function fail_time_request()'); }
    for (const table of ['invoices','invoice_time_items','time_invoicing_requests','invoice_number_counters']) assert.equal(await count(table),0);
    assert.equal((await createTimeInvoice(actor,await request())).invoice.invoiceNumber,'S1-00001');
  });
  test('billed time cannot be changed/deleted; deleting draft releases time but preserves replay tombstone', async () => {
    const input=await request(); const {invoice}=await createTimeInvoice(actor,input);
    await assert.rejects(pool.query("update time_entries set duration=15 where id='one'"),e=>e.code==='23514');
    await assert.rejects(pool.query("delete from time_entries where id='one'"),e=>e.code==='23503');
    await pool.query('delete from invoices where id=$1',[invoice.id]);
    assert.equal((await request()).entries.length,2);
    await assert.rejects(createTimeInvoice(actor,input),e=>e.code==='INVOICE_DELETED');
    assert.equal((await createTimeInvoice(actor,await request())).invoice.invoiceNumber,'S1-00002');
  });
  test('missing fallback and quota failures leave no invoice', async () => {
    const input=await request(); delete input.fallbackRate;
    await assert.rejects(createTimeInvoice(actor,input),e=>e.code==='RATE_REQUIRED');
    quota=false; await assert.rejects(createTimeInvoice(actor,{...input,fallbackRate:'10'}),e=>e.status===403);
    assert.equal(await count('invoices'),0);
  });
  test('controller rejects unauthenticated, nonbilling roles, duplicate IDs and client totals', async () => {
    for (const user of [undefined,{...actor,role:'viewer'},{...actor,role:'client'},{...actor,isOrganizationOwner:false}]) {
      const res=response(); await invoiceFromTime({user,body:{}},res); assert.equal(res.code,user?403:401);
    }
    const input=await request();
    for (const body of [{...input,amount:1},{...input,entries:[input.entries[0],input.entries[0]]},{...input,dueDate:'2026-02-30'}]) {
      const res=response(); await invoiceFromTime({user:actor,body},res); assert.equal(res.code,400);
    }
    const res=response(); await billableTime({user:actor,query:filter},res); assert.equal(res.code,200);
    const created=response(); await invoiceFromTime({user:actor,body:input},created); assert.equal(created.code,201);
    const replay=response(); await invoiceFromTime({user:actor,body:input},replay); assert.equal(replay.code,200); assert.equal(replay.body.data.id,created.body.data.id);
  });
  test('listing identifies tracked invoices and warns only for legacy time invoices', async () => {
    assert.equal((await listBillableTime(actor,filter)).hasLegacyTimeInvoices,false);
    const { invoice }=await createTimeInvoice(actor,await request());
    const res=response(); await getInvoices({user:actor,query:{}},res);
    assert.equal(res.code,200); assert.equal(res.body.data[0].hasTrackedTime,true);
    await pool.query('update invoices set description=$1 where id=$2',['Time tracking (2026-08-01 to 2026-08-31), 1.00h total:\n- Design: 1.00h',invoice.id]);
    assert.equal((await listBillableTime(actor,filter)).hasLegacyTimeInvoices,true);
  });
  test('required migrations can run repeatedly', async () => { await prepareTimeInvoicing(pool); await prepareTimeInvoicing(pool); assert.equal((await request()).entries.length,2); });
}

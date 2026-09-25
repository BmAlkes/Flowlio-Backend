const {test,before,beforeEach,after}=require('node:test'),assert=require('node:assert/strict'),{randomUUID}=require('node:crypto');
const {transfer,totals,nextMonth}=require('../src/modules/retainers/policy');
test('carry expires independently, consumes oldest first and obeys cap',()=>{
 const rules={carry_policy:'carry',carry_cap:100,carry_months:2},p={id:'p',month:'2026-01',included_minutes:120,carry:[{source:'old',minutes:30,expires:'2026-02'},{source:'new',minutes:50,expires:'2026-03'}]};
 assert.deepEqual(transfer(rules,p,40),[{source:'new',minutes:40,expires:'2026-03'},{source:'p',minutes:60,expires:'2026-04'}]);
 assert.deepEqual(totals(120,p.carry,210),{included:120,carried:80,used:210,remaining:0,overage:10});assert.equal(nextMonth('2026-12'),'2027-01');
});
if(!process.env.RETAINER_TEST_DATABASE_URL)test('Retainer PostgreSQL',{skip:true},()=>{});else{
 const url=new URL(process.env.RETAINER_TEST_DATABASE_URL);assert.ok(url.hostname==='127.0.0.1'&&url.port==='55442'&&url.pathname==='/flowlio_retainer_test');
 const {Pool}=require('pg'),pool=new Pool({connectionString:url.toString()}),service=require('../src/modules/retainers/service').createRetainers(pool);
 const owner={id:'owner',role:'user',organizationId:'org',isOrganizationOwner:true},client={id:'client-user',role:'client',organizationId:'org'},manager={...owner,isOrganizationOwner:false,isOrganizationManager:true};
 const base={name:'Monthly support',currency:'BRL',monthlyAmount:'100.00',includedMinutes:60,timezone:'America/New_York',startMonth:'2026-01',endMonth:null,renewal:'automatic',carryPolicy:'carry',carryCap:120,carryMonths:2,overagePolicy:'approval',overageRate:'15.00',recurringId:null,confirm:true};
 before(async()=>{await pool.query('drop schema public cascade;create schema public;drop schema if exists flowlio_releases cascade;drop schema if exists drizzle cascade');await require('../src/utils/release-migrations.util').runReleaseMigrations(pool);});
 beforeEach(async()=>{await pool.query(`truncate business_audit_events,users,organizations cascade;
 insert into users(id,name,email,role,status,email_verified,two_factor_enabled,is_super_admin,timezone,created_at,updated_at) values ('owner','Owner','owner@example.test','user','active',true,false,false,'UTC',now(),now()),('client-user','Client','client@example.test','client','active',true,false,false,'UTC',now(),now()),('foreign','Other','other@example.test','client','active',true,false,false,'UTC',now(),now());
 insert into organizations(id,name,slug,created_at,updated_at) values('org','Org','org',now(),now()),('other','Other','other',now(),now());
 insert into user_organizations(id,user_id,organization_id,role,status,created_at,updated_at) values('member','owner','org','owner','active',now(),now());
 insert into clients(id,name,email,organization_id,created_by,user_id,created_at,updated_at) values('client','Client','client@example.test','org','owner','client-user',now(),now()),('other-client','Other','other@example.test','org','owner','foreign',now(),now());
 insert into projects(id,name,project_number,organization_id,client_id,created_by,visibility,created_at,updated_at) values('project','Project','1','org','client','owner','private',now(),now());
 insert into invoices(id,organization_id,client_id,created_by,client_name,invoice_number,amount,status,created_at,updated_at) values('invoice','org','client','owner','Client','S1-',100,'draft',now(),now());`);});
 after(()=>pool.end());
 async function create(extra={}){const d={...base,id:randomUUID(),...extra};await service.create(owner,'client',d);return d;}
 async function detail(r,extra={},a=owner){return service.detail(a,'client',r.id,extra);}
 async function act(r,action,extra={},a=owner){const p=(await detail(r)).period;return service.mutate(a,'client',r.id,{key:randomUUID(),periodId:p.id,revision:p.revision,action,...extra});}
 async function time(id='t',minutes=90,start='2026-01-15 10:00:00',end='2026-01-15 11:30:00'){await pool.query(`insert into time_entries(id,user_id,project_id,client_id,start_time,end_time,duration,status,billable,hourly_rate,created_at,updated_at) values($1,'owner','project','client',$3,$4,$2,'completed',true,10,now(),now())`,[id,minutes,start,end]);}
 async function allocate(r){const p=(await detail(r)).period,entries=(await service.candidates(owner,'client',r.id,p.id,{})).items;return act(r,'allocate',{entries:entries.map(t=>({id:t.id,version:t.version}))});}
 async function invoiceTime(id='t'){return pool.query(`insert into invoice_time_items(id,invoice_id,time_entry_id,user_name,project_name,started_at,minutes,hourly_rate,amount) values($1,'invoice',$2,'Owner','Project','2026-01-15',90,10,15)`,[randomUUID(),id]);}
 test('full close produces exact statement, next allowance and one draft on retry; client decides',async()=>{
  const r=await create();await time();await allocate(r);const before=(await detail(r)).period;
  const cmd={key:randomUUID(),periodId:before.id,revision:before.revision,action:'close',confirm:true};await Promise.all([service.mutate(owner,'client',r.id,cmd),service.mutate(owner,'client',r.id,cmd)]);
  const closed=(await detail(r,{periodId:before.id})).period;assert.equal(closed.state,'closed');assert.equal(closed.statement.used,90);assert.equal(closed.statement.overageAmount,'7.50');assert.equal(closed.statement.billing.monthlyAmount,'100.00');assert.equal(closed.decision,'awaiting');assert.equal((await detail(r)).period.month,'2026-02');
  await service.mutate(client,'client',r.id,{key:randomUUID(),periodId:closed.id,revision:closed.revision,action:'decide',decision:'approved',note:'Reviewed',confirm:true});
  assert.equal((await detail(r,{periodId:closed.id},client)).period.decision,'approved');assert.equal((await pool.query('select count(*)::int n from invoices')).rows[0].n,1);assert.equal((await pool.query('select count(*)::int n from retainer_periods')).rows[0].n,2);
 });
 test('creation and command keys reject changed payloads',async()=>{
  const r=await create();await service.create(owner,'client',r);await assert.rejects(service.create(owner,'client',{...r,name:'Changed'}),{code:'REQUEST_CONFLICT'});
  const cmd={key:randomUUID(),action:'state',state:'paused',revision:0,reason:'Vacation'};await service.mutate(owner,'client',r.id,cmd);await assert.rejects(service.mutate(owner,'client',r.id,{...cmd,reason:'Different'}),{code:'REQUEST_CONFLICT'});
 });
 test('tenant and client isolation, manager masking and client cannot change contracts',async()=>{
  const r=await create();for(const a of [{...owner,organizationId:'other'},{...client,id:'foreign'}])await assert.rejects(service.detail(a,'client',r.id,{}),{code:'CLIENT_NOT_FOUND'});
  await assert.rejects(service.create(client,'client',{...base,id:randomUUID()}),{code:'FORBIDDEN'});await assert.rejects(service.candidates(manager,'client',r.id,(await detail(r)).period.id,{}),{code:'FORBIDDEN'});
  const visible=await detail(r,{},manager);assert.equal(visible.contract.currency,undefined);assert.equal(visible.contract.monthly_amount,undefined);assert.equal((await service.list(client,'me',{})).items.length,1);
 });
 test('same timer cannot consume two contracts concurrently',async()=>{
  const a=await create(),b=await create();await time();const pa=(await detail(a)).period,pb=(await detail(b)).period,entries=(await service.candidates(owner,'client',a.id,pa.id,{})).items.map(t=>({id:t.id,version:t.version}));
  const results=await Promise.allSettled([service.mutate(owner,'client',a.id,{key:randomUUID(),action:'allocate',periodId:pa.id,revision:pa.revision,entries}),service.mutate(owner,'client',b.id,{key:randomUUID(),action:'allocate',periodId:pb.id,revision:pb.revision,entries})]);assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal((await pool.query('select count(*)::int n from retainer_entries')).rows[0].n,1);
 });
 test('allocation and direct invoicing race has only one winner',async()=>{
  const r=await create();await time();const results=await Promise.allSettled([allocate(r),invoiceTime()]);assert.equal(results.filter(r=>r.status==='fulfilled').length,1);const count=(await pool.query('select (select count(*) from retainer_entries)+(select count(*) from invoice_time_items) n')).rows[0].n;assert.equal(Number(count),1);
 });
 test('allocated time cannot be edited or invoiced; open removal allows reassignment',async()=>{
  const r=await create();await time();await allocate(r);await assert.rejects(pool.query("update time_entries set duration=120 where id='t'"));await assert.rejects(pool.query("delete from time_entries where id='t'"));await assert.rejects(invoiceTime());
  const entry=(await detail(r)).entries[0];await act(r,'remove',{entryId:entry.id});await pool.query("update time_entries set duration=120 where id='t'");const other=await create();await allocate(other);assert.equal((await detail(other)).period.totals.used,120);
 });
 test('stale timer versions and private tasks are not silently allocated',async()=>{
  const r=await create();await time();const p=(await detail(r)).period,entries=(await service.candidates(owner,'client',r.id,p.id,{})).items.map(t=>({id:t.id,version:t.version}));await pool.query("update time_entries set duration=10 where id='t'");await assert.rejects(act(r,'allocate',{entries}),{code:'TIME_CHANGED'});
  await pool.query("update projects set created_by='foreign'");assert.equal((await service.candidates(owner,'client',r.id,p.id,{})).items.length,0);
 });
 test('month boundaries use contract zone and DST; crossing entries are excluded',async()=>{
  const r=await create({startMonth:'2026-03'}),p=(await detail(r)).period;assert.equal(p.starts_at.toISOString(),'2026-03-01T05:00:00.000Z');assert.equal(p.ends_at.toISOString(),'2026-04-01T04:00:00.000Z');
  await time('before',30,'2026-03-01 04:30:00','2026-03-01 05:00:00');await time('start',30,'2026-03-01 05:00:00','2026-03-01 05:30:00');await time('cross',90,'2026-04-01 03:30:00','2026-04-01 05:00:00');await time('end',30,'2026-04-01 04:00:00','2026-04-01 04:30:00');
  const rows=(await service.candidates(owner,'client',r.id,p.id,{})).items;assert.deepEqual(rows.map(t=>t.id),['start']);
 });
 test('pause and cancellation stop consumption, cancellation is permanent',async()=>{
  const r=await create();await time();await service.mutate(owner,'client',r.id,{key:randomUUID(),action:'state',state:'paused',revision:0,reason:'Pause'});await assert.rejects(allocate(r),{code:'CONTRACT_INACTIVE'});
  await service.mutate(owner,'client',r.id,{key:randomUUID(),action:'state',state:'active',revision:1,reason:'Resume'});await allocate(r);await service.mutate(owner,'client',r.id,{key:randomUUID(),action:'state',state:'cancelled',revision:2,reason:'End'});await act(r,'close',{confirm:true});assert.equal((await detail(r)).period.month,'2026-01');await assert.rejects(service.mutate(owner,'client',r.id,{key:randomUUID(),action:'state',state:'active',revision:3,reason:'Resume'}),{code:'CONTRACT_INACTIVE'});
 });
 test('closed statements and entries stay immutable; corrections are attributed to the original time',async()=>{
  const r=await create();await time();await allocate(r);const old=await detail(r);await act(r,'close',{confirm:true});await time('next',60,'2026-02-15 10:00:00','2026-02-15 11:00:00');await allocate(r);await act(r,'adjust',{sourceEntryId:old.entries[0].id,minutes:-30,reason:'Correct recorded duration'});const current=await detail(r);assert.equal(current.period.totals.used,30);assert.equal(current.entries.find(e=>e.kind==='adjustment').source_entry_id,old.entries[0].id);
  await assert.rejects(pool.query('update retainer_periods set statement=null where id=$1',[old.period.id]));await assert.rejects(pool.query('delete from retainer_entries where id=$1',[old.entries[0].id]));await assert.rejects(pool.query('update retainer_entries set minutes=1 where id=$1',[old.entries[0].id]));await assert.rejects(act(r,'adjust',{sourceEntryId:old.entries[0].id,minutes:-100,reason:'Invalid'}),{code:'INVALID_ADJUSTMENT'});
 });
 test('removing time cannot make an adjusted open period negative',async()=>{
  const r=await create();await time();await allocate(r);const old=await detail(r);await act(r,'close',{confirm:true});await time('next',60,'2026-02-15 10:00:00','2026-02-15 11:00:00');await allocate(r);await act(r,'adjust',{sourceEntryId:old.entries[0].id,minutes:-30,reason:'Correction'});
  const current=await detail(r);await assert.rejects(act(r,'remove',{entryId:current.entries.find(e=>e.kind==='time').id}),{code:'INVALID_ADJUSTMENT'});assert.equal((await detail(r)).period.totals.used,30);
 });
 test('manual renewal, expiry and end month do not create unwanted periods',async()=>{
  const r=await create({renewal:'manual',carryPolicy:'expire',carryCap:0,carryMonths:0,endMonth:'2026-02'});await act(r,'close',{confirm:true});assert.equal((await detail(r)).period.month,'2026-01');await service.mutate(owner,'client',r.id,{key:randomUUID(),action:'open',month:'2026-02'});assert.deepEqual((await detail(r)).period.carry,[]);await act(r,'close',{confirm:true});await assert.rejects(service.mutate(owner,'client',r.id,{key:randomUUID(),action:'open',month:'2026-03'}),{code:'CONTRACT_INACTIVE'});
 });
 test('active timers and future periods block closing',async()=>{
  const r=await create();await pool.query("insert into time_entries(id,user_id,project_id,start_time,status,billable,created_at,updated_at) values('live','owner','project','2026-01-01','active',true,now(),now())");await assert.rejects(act(r,'close',{confirm:true}),{code:'ACTIVE_TIMER'});const future=await create({startMonth:'2099-01'});await assert.rejects(act(future,'close',{confirm:true}),{code:'PERIOD_NOT_ENDED'});
 });
 test('linked recurrence owns monthly fee; T29 cannot duplicate it and pauses its schedule',async()=>{
  await pool.query("insert into recurring_invoices(id,organization_id,client_id,created_by,template_name,client_name,amount,frequency,start_date,next_run_date,status,created_at,updated_at) values('rec','org','client','owner','Monthly','Client',100,'monthly','2026-01-01','2026-02-01','active',now(),now())");
  const r=await create({recurringId:'rec'});await assert.rejects(create({recurringId:'rec'}),{code:'RECURRING_ASSIGNED'});await act(r,'close',{confirm:true});const p=(await detail(r)).periods.find(p=>p.month==='2026-01');assert.equal((await detail(r,{periodId:p.id})).period.statement.billing.monthlyAmount,'0.00');
  await assert.rejects(pool.query("update recurring_invoices set amount=200 where id='rec'"));await service.mutate(owner,'client',r.id,{key:randomUUID(),action:'state',state:'paused',revision:0,reason:'Pause'});assert.equal((await pool.query("select status from recurring_invoices where id='rec'")).rows[0].status,'paused');await assert.rejects(pool.query("update recurring_invoices set status='active' where id='rec'"));
 });
 test('audit failure rolls back allocations; financial audit is hidden from managers',async()=>{
  const r=await create();await time();await pool.query("create function fail_retainer_audit() returns trigger language plpgsql as $$ begin raise exception 'audit unavailable';end $$;create trigger fail_retainer_audit before insert on business_audit_events for each row execute function fail_retainer_audit()");
  try{await assert.rejects(allocate(r));assert.equal((await detail(r)).period.totals.used,0);}finally{await pool.query('drop trigger fail_retainer_audit on business_audit_events;drop function fail_retainer_audit()');}
  await allocate(r);const reader=require('../src/modules/audit/read').createAuditRead(pool),day=new Date().toISOString().slice(0,10);assert.ok((await reader.read(owner,{from:day,to:day,resourceType:'retainer'})).events.length>0);assert.equal((await reader.read(manager,{from:day,to:day,resourceType:'retainer'})).events.length,0);
 });
 test('pagination does not change reconciled totals and skips already invoiced time',async()=>{
  const r=await create();for(let i=0;i<27;i++)await time('t'+i,10);await invoiceTime('t0');await allocate(r);const first=await detail(r),second=await detail(r,{entryPage:2});assert.equal(first.entries.length,25);assert.equal(first.hasMoreEntries,true);assert.equal(second.entries.length,1);assert.equal(first.period.totals.used,260);
 });
}

const {test,before,beforeEach,after}=require('node:test');
const assert=require('node:assert/strict');
const {randomUUID}=require('node:crypto');
if(!process.env.SIMPLER_WORKFLOWS_TEST_DATABASE_URL)test('Simpler workflows PostgreSQL',{skip:true},()=>{});else{
 const url=new URL(process.env.SIMPLER_WORKFLOWS_TEST_DATABASE_URL);assert.ok(url.hostname==='127.0.0.1'&&url.port==='55442'&&url.pathname==='/flowlio_simpler_workflows_test');
 const {Pool}=require('pg'),pool=new Pool({connectionString:url.toString()});
 const service=require('../src/modules/retainers/service').createRetainers(pool);
 const billing=require('../src/modules/retainers/billing').createBillingSources(pool,async()=>({hasAccess:true}));
 const owner={id:'owner',role:'user',organizationId:'org',isOrganizationOwner:true};
 const client={id:'client-user',role:'client',organizationId:'org'};
 const base={name:'Support',currency:'ILS',monthlyAmount:'120.00',includedMinutes:60,timezone:'UTC',startMonth:'2026-01',endMonth:null,renewal:'automatic',carryPolicy:'carry',carryCap:60,carryMonths:1,overagePolicy:'approval',overageRate:'120.00',recurringId:null,confirm:true};
 before(async()=>{await pool.query('drop schema public cascade;create schema public;drop schema if exists flowlio_releases cascade;drop schema if exists drizzle cascade');await require('../src/utils/release-migrations.util').runReleaseMigrations(pool);});
 beforeEach(async()=>{await pool.query(`truncate business_audit_events,users,organizations cascade;
 insert into users(id,name,email,role,status,email_verified,two_factor_enabled,is_super_admin,timezone,created_at,updated_at) values ('owner','Owner','owner@example.test','user','active',true,false,false,'UTC',now(),now()),('client-user','Client','client@example.test','client','active',true,false,false,'UTC',now(),now());
 update users set is_organization_owner=true where id='owner';
 insert into organizations(id,name,slug,created_at,updated_at) values('org','Org','org',now(),now());
 insert into user_organizations(id,user_id,organization_id,role,status,created_at,updated_at) values('member','owner','org','owner','active',now(),now());
 insert into clients(id,name,email,organization_id,created_by,user_id,portal_access_enabled,created_at,updated_at) values('client','Client','client@example.test','org','owner','client-user',true,now(),now());
 insert into projects(id,name,project_number,organization_id,client_id,created_by,visibility,currency_code,created_at,updated_at) values('project','Website','1','org','client','owner','private','ILS',now(),now());`);});
 after(()=>pool.end());
 async function create(){const d={...base,id:randomUUID()};await service.create(owner,'client',d);return d;}
 async function link(r){await service.mutate(owner,'client',r.id,{key:randomUUID(),action:'link',revision:0,projectId:'project',enabled:true});await pool.query("update retainer_project_links set created_at='2025-01-01'");}
 async function time(id='t',month='2026-01',duration=120){await pool.query("insert into time_entries(id,user_id,project_id,start_time,end_time,duration,status,billable,created_at,updated_at) values($1,'owner','project',$2::timestamp,$2::timestamp+interval '2 hours',$3,'completed',true,now(),now())",[id,month+'-15 10:00:00',duration]);}
 async function period(r,month='2026-01'){return(await pool.query('select * from retainer_periods where retainer_id=$1 and month=$2',[r.id,month])).rows[0];}
 async function close(r,month='2026-01'){const p=await period(r,month);await service.mutate(owner,'client',r.id,{key:randomUUID(),action:'close',periodId:p.id,revision:p.revision,confirm:true});return p;}
 test('explicit link sends new completed time to consumption once; other contracts cannot claim the project',async()=>{
  const r=await create();await time('old');await link(r);assert.equal((await pool.query('select count(*)::int n from retainer_entries')).rows[0].n,0);
  await time();assert.equal((await pool.query('select minutes from retainer_entries')).rows[0].minutes,120);
  await pool.query("update time_entries set updated_at=now() where id='t'");assert.equal((await pool.query('select count(*)::int n from retainer_entries')).rows[0].n,1);
  const other=await create();await assert.rejects(service.mutate(owner,'client',other.id,{key:randomUUID(),action:'link',revision:0,projectId:'project',enabled:true}),{code:'PROJECT_ALREADY_LINKED'});
  await assert.rejects(service.mutate(client,'me',r.id,{key:randomUUID(),action:'link',revision:1,projectId:'project',enabled:false}),{code:'FORBIDDEN'});
 });
 test('new month records hours before prior closure and waits for its carry before finalizing',async()=>{
  const r=await create();await link(r);await time('feb','2026-02',30);const feb=await period(r,'2026-02');assert.equal(feb.carry_pending,true);
  await assert.rejects(close(r,'2026-02'),{code:'CLOSE_PREVIOUS'});await close(r);const settled=await period(r,'2026-02');assert.equal(settled.carry_pending,false);assert.equal(settled.carry[0].minutes,60);
 });
 test('monthly and approved excess become separate reviewable invoices without duplicate effects',async()=>{
  const r=await create();await link(r);await time();const jan=await close(r);
  let rows=(await billing.list(owner,{})).items;assert.equal(rows.length,1);assert.equal(rows[0].key,'monthly:'+jan.id);
  const p=await period(r);await service.mutate(client,'me',r.id,{key:randomUUID(),action:'decide',periodId:p.id,revision:p.revision,decision:'approved',note:'OK',confirm:true});
  rows=(await billing.list(owner,{})).items;assert.equal(rows.length,2);const source=rows.find(v=>v.key.startsWith('overage:'));
  const [a,b]=await Promise.all([billing.prepare(owner,{key:source.key,version:source.version}),billing.prepare(owner,{key:source.key,version:source.version})]);assert.equal(a.id,b.id);
  const invoice=(await pool.query('select amount,currency_code,status from invoices where id=$1',[a.id])).rows[0];assert.deepEqual(invoice,{amount:'120.00',currency_code:'ILS',status:'draft'});
  await assert.rejects(billing.list(client,{}),{code:'FORBIDDEN'});
 });
 test('client sees excess approval in the same pending queue with a direct link to its month',async()=>{
  const r=await create();await link(r);await time();const jan=await close(r);
  const queue=await require('../src/modules/client-pending/service').createClientPending(pool).list(client,{});
  assert.equal(queue.items[0].kind,'overage');assert.ok(queue.items[0].href.includes('periodId='+jan.id));
  assert.equal((await require('../src/modules/client-pending/service').createClientPending(pool).list({...client,id:'unrelated'},{})).items.length,0);
 });
 test('simple requests can finish on response, while the existing review policy stays available',async()=>{
  const pending=require('../src/modules/client-pending/service').createClientPending(pool);
  const d={id:randomUUID(),projectId:'project',kind:'question',title:'Which color?',description:'Choose blue or green.',questions:[],dependencies:[],assignedTo:'owner',dueDate:null,timezone:'UTC',reminderHours:0,reminderChannel:'internal',reviewRequired:false};
  await pending.create(owner,d);await pending.mutate(client,d.id,{key:randomUUID(),revision:0,action:'respond',message:'Blue',answers:{},fileIds:[]});
  assert.equal((await pending.detail(client,d.id)).request.state,'completed');
  await pending.mutate(owner,d.id,{key:randomUUID(),revision:1,action:'reopen',reason:'One more question'});assert.equal((await pending.detail(client,d.id)).request.state,'open');
 });
 test('approval can finish the milestone while keeping delivery workflows eligible',async()=>{
  await pool.query("insert into project_milestones(id,project_id,organization_id,title,status,position,created_at,updated_at) values('milestone','project','org','Design','in_progress',0,now(),now())");
  const delivery=require('../src/modules/delivery/service').createDeliveryReviews(pool),current=(await delivery.list(owner,'project')).milestones[0];
  const review=await delivery.request(owner,'project',{milestoneId:'milestone',version:current.version,note:'Review design',completeMilestone:true});
  await delivery.decide(client,'project',review.id,{version:current.version,state:'approved',comment:''});
  assert.equal((await pool.query('select status from project_milestones')).rows[0].status,'completed');
  const c=await pool.connect();try{
   const valid=await require('../src/modules/workflows/policy').sourceValid(c,{trigger:'delivery_approved',organization_id:'org'},{source_id:review.id,resource_id:'project'});assert.equal(valid,true);
   await pool.query("update project_milestones set title='Changed after approval',updated_at=now()");
   assert.equal(await require('../src/modules/workflows/policy').sourceValid(c,{trigger:'delivery_approved',organization_id:'org'},{source_id:review.id,resource_id:'project'}),false);
  }finally{c.release();}
 });
 test('approved extra preserves its project and cannot change commercial terms while invoiced',async()=>{
  const scope=require('../src/modules/scope/service').createScopeChanges(pool),id=randomUUID();
  await scope.create(owner,'project',{id,title:'Extra page',description:'Contact page',fileIds:[]});
  const estimate={action:'estimate',revision:0,classification:'additional',estimatedHours:'2',amount:'240',currency:'ILS',endDate:null,note:'Two hours'};
  await scope.transition(owner,'project',id,estimate);
  await scope.transition(client,'project',id,{action:'decide',revision:1,state:'approved',comment:''});
  const source=(await billing.list(owner,{})).items[0];
  await assert.rejects(billing.prepare(owner,{key:source.key,version:'b'.repeat(64)}),{code:'VERSION_CHANGED'});
  const invoice=await billing.prepare(owner,{key:source.key,version:source.version});
  assert.equal((await pool.query('select project_id from invoices where id=$1',[invoice.id])).rows[0].project_id,'project');
  await assert.rejects(scope.transition(owner,'project',id,{...estimate,revision:1}),{code:'INVOICE_EXISTS'});
  await assert.rejects(scope.transition(owner,'project',id,{action:'cancel',revision:1,reason:'Changed'}),{code:'INVOICE_EXISTS'});
  await pool.query('delete from invoices where id=$1',[invoice.id]);
  await scope.transition(owner,'project',id,{...estimate,revision:1,amount:'250'});
  assert.equal((await billing.list(owner,{})).items.length,0);
 });
 test('a paused contract does not consume new hours and a wrong project currency cannot be linked',async()=>{
  const r=await create();await link(r);
  await service.mutate(owner,'client',r.id,{key:randomUUID(),action:'state',state:'paused',revision:1,reason:'Pause'});await time();assert.equal((await pool.query('select count(*)::int n from retainer_entries')).rows[0].n,0);
  const other=await create();await pool.query("insert into projects(id,name,project_number,organization_id,client_id,created_by,visibility,currency_code,created_at,updated_at) values('eur','Euro project','2','org','client','owner','private','EUR',now(),now())");
  await assert.rejects(service.mutate(owner,'client',other.id,{key:randomUUID(),action:'link',projectId:'eur',enabled:true,revision:0}),{code:'CURRENCY_MISMATCH'});
 });

}

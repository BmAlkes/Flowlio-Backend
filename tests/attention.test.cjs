const {test,before,beforeEach,after}=require('node:test');const assert=require('node:assert/strict');
if(!process.env.ATTENTION_TEST_DATABASE_URL)test('Attention PostgreSQL',{skip:true},()=>{});
else{
 const url=new URL(process.env.ATTENTION_TEST_DATABASE_URL);assert.ok(['localhost','127.0.0.1'].includes(url.hostname)&&url.port==='55442'&&url.pathname==='/flowlio_attention_test');
 const {Pool}=require('pg');const pool=new Pool({connectionString:url.toString()});const service=require('../src/modules/attention/service').createAttention(pool);
 const actor={id:'owner',role:'user',organizationId:'org-a',isOrganizationOwner:true};const period={from:'2026-09-01',to:'2026-09-30',week:'2026-09-23'};
 before(async()=>{await pool.query('drop schema public cascade;create schema public;drop schema if exists flowlio_releases cascade;drop schema if exists drizzle cascade');await require('../src/utils/release-migrations.util').runReleaseMigrations(pool);});
 beforeEach(async()=>{await pool.query(`truncate users,organizations cascade;
 insert into users(id,name,email,role,status,email_verified,two_factor_enabled,is_super_admin,timezone,created_at,updated_at) values ('owner','Owner','owner@example.test','user','active',true,false,false,'UTC',now(),now()),('member','Member','member@example.test','operator','active',true,false,false,'UTC',now(),now()),('foreign','Foreign','foreign@example.test','user','active',true,false,false,'UTC',now(),now());
 insert into organizations(id,name,slug,created_at,updated_at) values ('org-a','A','a',now(),now()),('org-b','B','b',now(),now());
 insert into user_organizations(id,user_id,organization_id,role,status,created_at,updated_at) values('m1','owner','org-a','owner','active',now(),now()),('m2','member','org-a','member','active',now(),now()),('m3','foreign','org-b','member','active',now(),now());
 insert into clients(id,name,email,organization_id,created_by,created_at,updated_at) values('client','Client','client@example.test','org-a','owner',now(),now());
 insert into projects(id,name,project_number,organization_id,client_id,created_by,visibility,budget,created_at,updated_at) values ('project','Project','1','org-a','client','owner','private',100,now(),now());
 insert into project_financial_settings(project_id,currency,hourly_cost,updated_by) values('project','USD',25,'owner');
 insert into project_expenses(id,project_id,amount,category,description,date,created_by,created_at,updated_at) values('expense','project',40,'other','Expense','2026-09-20','owner',now(),now());
 insert into tasks(id,title,project_id,assigned_to,created_by,visibility,status,estimated_hours,start_date,end_date,created_at,updated_at) values ('task','Design','project','member','owner','private','todo',14,'2026-09-21','2026-10-04',now(),now());
 insert into time_entries(id,user_id,project_id,start_time,end_time,duration,hourly_rate,billable,status,created_at,updated_at) values('time','owner','project','2026-09-20 10:00','2026-09-20 12:00',120,80,true,'completed',now(),now());
 insert into member_capacity(organization_id,user_id,weekly_minutes,team) values('org-a','member',300,'Design');
 insert into proposals(id,organization_id,client_id,created_by,project_title,client_name,status,created_at,updated_at) values('proposal','org-a','client','owner','Website','Client','pending','2020-01-01','2020-01-01');
 insert into project_milestones(id,project_id,organization_id,title,status,position,created_at,updated_at) values('milestone','project','org-a','Design','pending',0,'2019-01-01','2019-01-01');
 insert into delivery_reviews(id,project_id,organization_id,milestone_id,client_id,source_version,title,note,state,requested_by,requested_at) values('review','project','org-a','milestone','client','version','Design','PRIVATE','pending','owner','2020-01-01');`);});
 after(()=>pool.end());
 test('five sources use actual permissions, dates and existing calculation rules',async()=>{
  const r=await service.list(actor,period);assert.deepEqual(r.items.map(i=>i.type).sort(),['approval','budget','capacity','proposal','unbilled']);
  const cost=r.items.find(i=>i.type==='budget');assert.equal(Number(cost.details.cost),90);assert.equal(cost.details.percent,90);
  const profitability=await require('../src/modules/profitability/service').createProfitability(pool).report(actor,'project',{from:period.from,to:period.to});assert.equal(Number(cost.details.cost),Number(profitability.expenses)+Number(profitability.laborCost));
  const capacity=await require('../src/modules/capacity/service').createCapacity(pool).report(actor,{week:period.week});assert.equal(r.items.find(i=>i.type==='capacity').details.minutes,capacity.members.find(m=>m.id==='member').plannedMinutes);
  assert.equal(r.items.find(i=>i.type==='unbilled').details.minutes,profitability.unbilledMinutes);assert.ok(!JSON.stringify(r).includes('PRIVATE'));assert.equal(r.gaps.unknownCapacity,1);
 });
 test('managers cannot see financial values and ordinary members cannot access the queue',async()=>{
  const r=await service.list({...actor,isOrganizationOwner:false,isOrganizationManager:true},period);assert.ok(r.items.every(i=>!['budget','unbilled'].includes(i.type)));assert.equal(r.gaps.financialProjects,0);
  for(const role of ['viewer','operator','client'])await assert.rejects(service.list({...actor,role,isOrganizationOwner:false},period),{code:'FORBIDDEN'});
  assert.equal((await service.list({...actor,organizationId:'org-b'},period)).items.length,0);
 });
 test('private project and task values never enter another manager queue',async()=>{
  await pool.query("update projects set created_by='member'");const r=await service.list(actor,period);assert.deepEqual(r.items.map(i=>i.type),['proposal']);
 });
 test('missing costs and availability remain gaps, rather than fabricated zero alerts',async()=>{
  await pool.query('update project_financial_settings set hourly_cost=null;update member_capacity set weekly_minutes=null');const r=await service.list(actor,period);assert.ok(!r.items.some(i=>['budget','capacity'].includes(i.type)));assert.equal(r.gaps.financialProjects,1);assert.equal(r.gaps.unknownCapacity,2);
 });
 test('period boundaries and current source status resolve items without manual completion flags',async()=>{
  const r=await service.list(actor,{...period,from:'2026-09-21',to:'2026-09-21'});assert.ok(!r.items.some(i=>['budget','unbilled'].includes(i.type)));
  await pool.query("update delivery_reviews set state='approved';update proposals set status='approved';update tasks set status='completed'");assert.ok((await service.list(actor,period)).items.every(i=>['budget','unbilled'].includes(i.type)));
 });
 test('snooze, ownership filters and changed source reactivation survive reload',async()=>{
  const item=(await service.list(actor,period)).items.find(i=>i.type==='unbilled');const change={period,key:item.key,revision:item.revision,assigneeId:'owner',snoozedUntil:new Date(Date.now()+86400000).toISOString()};
  await Promise.all([service.triage(actor,change),service.triage(actor,change)]);assert.equal((await service.list(actor,{...period,state:'snoozed',assigned:'mine'})).items.length,1);assert.ok(!(await service.list(actor,period)).items.some(i=>i.key===item.key));
  await pool.query("update time_entries set duration=180 where id='time'");assert.ok((await service.list(actor,period)).items.some(i=>i.key===item.key));await assert.rejects(service.triage(actor,change),{code:'SOURCE_CHANGED'});
  assert.equal((await pool.query('select count(*)::int n from attention_triage')).rows[0].n,1);
 });
 test('triage rejects cross organization members, vanished sources and forged keys',async()=>{
  const item=(await service.list(actor,period)).items[0];const body={period,key:item.key,revision:item.revision,assigneeId:'foreign',snoozedUntil:null};await assert.rejects(service.triage(actor,body),{code:'INVALID_ASSIGNEE'});await assert.rejects(service.triage({...actor,organizationId:'org-b'},body),{code:'ITEM_NOT_FOUND'});await assert.rejects(service.triage(actor,{...body,key:'forged'}),{code:'ITEM_NOT_FOUND'});assert.equal((await pool.query('select count(*)::int n from attention_triage')).rows[0].n,0);
 });
 test('organization preferences persist, validate limits and change the queue',async()=>{
  await service.settings(actor,{approvalDays:365,proposalDays:365,unbilledMinutes:180,budgetPercent:100});const r=await service.list(actor,period);assert.equal(r.settings.budgetPercent,100);assert.ok(!r.items.some(i=>['unbilled','budget'].includes(i.type)));assert.equal((await service.list({...actor,organizationId:'org-b'},period)).settings.budgetPercent,80);
  await assert.rejects(service.settings(actor,{approvalDays:-1}),{code:'INVALID_SETTINGS'});await assert.rejects(service.list(actor,{...period,from:'2026-02-30'}),{code:'INVALID_QUERY'});
 });
 test('pagination is stable and bounded across source groups',async()=>{
  await pool.query("insert into proposals(id,organization_id,client_id,created_by,project_title,client_name,status,created_at,updated_at) select 'p-'||n,'org-a','client','owner','P '||n,'Client','pending','2020-01-01','2020-01-01' from generate_series(1,55)n");let ids=[];for(let page=1;page<=3;page++){const r=await service.list(actor,{...period,page});assert.ok(r.items.length<=25);ids.push(...r.items.map(i=>i.key));}assert.equal(new Set(ids).size,60);
 });
 test('member search stays in organization and never accepts a foreign assignee',async()=>{assert.deepEqual((await service.members(actor,'Member')).map(m=>m.id),['member']);assert.equal((await service.members(actor,'Foreign')).length,0);});
 test('expired snoozes can be reassigned and changed delivery sources do not request obsolete approval',async()=>{
  const item=(await service.list(actor,period)).items.find(i=>i.type==='approval');await service.triage(actor,{period,key:item.key,revision:item.revision,assigneeId:'owner',snoozedUntil:new Date(Date.now()+86400000).toISOString()});
  await pool.query("update attention_triage set snoozed_until=now()-interval '1 day'");const current=(await service.list(actor,period)).items.find(i=>i.key===item.key);assert.equal(current.snoozed_until,null);assert.equal(current.assignee_name,'Owner');
  await service.triage(actor,{period,key:current.key,revision:current.revision,assigneeId:'member',snoozedUntil:null});
  await pool.query("update project_milestones set title='Revised',updated_at=now()");assert.ok(!(await service.list(actor,period)).items.some(i=>i.type==='approval'));
 });

}

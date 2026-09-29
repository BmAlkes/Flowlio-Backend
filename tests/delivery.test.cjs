const {test,before,beforeEach,after}=require('node:test');const assert=require('node:assert/strict');
if(!process.env.DELIVERY_TEST_DATABASE_URL)test('Delivery PostgreSQL',{skip:true},()=>{});
else{
 const url=new URL(process.env.DELIVERY_TEST_DATABASE_URL);assert.ok(['localhost','127.0.0.1'].includes(url.hostname)&&url.port==='55442'&&url.pathname==='/flowlio_delivery_test');
 const {Pool}=require('pg');const pool=new Pool({connectionString:url.toString()});const service=require('../src/modules/delivery/service').createDeliveryReviews(pool);
 const owner={id:'owner',role:'user',organizationId:'org-a',isOrganizationOwner:true};const client={id:'client-user',role:'client',organizationId:'org-a'};
 before(async()=>{await pool.query('drop schema public cascade;create schema public;drop schema if exists flowlio_releases cascade;drop schema if exists drizzle cascade');await require('../src/utils/release-migrations.util').runReleaseMigrations(pool)});
 beforeEach(async()=>{await pool.query(`truncate users,organizations cascade;
 insert into users(id,name,email,email_verified,two_factor_enabled,is_super_admin,timezone,created_at,updated_at) values ('owner','Owner','owner@example.test',true,false,false,'UTC',now(),now()),('client-user','Client','client@example.test',true,false,false,'UTC',now(),now()),('other','Other','other@example.test',true,false,false,'UTC',now(),now());
 insert into organizations(id,name,slug,created_at,updated_at) values ('org-a','A','a',now(),now()),('org-b','B','b',now(),now());
 insert into clients(id,name,email,organization_id,user_id,created_by,created_at,updated_at) values ('client','Client','client@example.test','org-a','client-user','owner',now(),now()),('other-client','Other','other@example.test','org-a','other','owner',now(),now());
 insert into projects(id,name,project_number,organization_id,client_id,created_by,visibility,created_at,updated_at) values ('project','Project','1','org-a','client','owner','private',now(),now());
 insert into project_milestones(id,project_id,organization_id,title,status,position,created_at,updated_at) values('milestone','project','org-a','Design','in_progress',0,now(),now());`);});
 after(()=>pool.end());
 async function input(){const row=(await service.list(owner,'project')).milestones[0];return{milestoneId:row.id,version:row.version,note:'Review the agreed design milestone'};}
 async function requested(){const body=await input();const r=await service.request(owner,'project',body);return{id:r.id,version:body.version};}
 test('concurrent request retries create one receipt and one activity',async()=>{const body=await input();const rows=await Promise.all(Array.from({length:12},()=>service.request(owner,'project',body)));assert.equal(new Set(rows.map(r=>r.id)).size,1);assert.equal((await pool.query('select count(*)::int n from recent_activities')).rows[0].n,1);const view=await service.list(client,'project');assert.equal(view.canRequest,false);assert.equal(view.reviews[0].canDecide,true);});
 test('client decisions are idempotent and competing decisions cannot overwrite history',async()=>{const r=await requested();const body={version:r.version,state:'approved',comment:'Accepted'};const results=await Promise.all(Array.from({length:10},()=>service.decide(client,'project',r.id,body)));assert.equal(results.filter(r=>!r.existing).length,1);await assert.rejects(service.decide(client,'project',r.id,{...body,state:'changes_requested',comment:'Change it'}),{code:'ALREADY_DECIDED'});const view=await service.list(owner,'project');assert.equal(view.reviews[0].state,'approved');assert.equal(view.reviews[0].decidedBy,'Client');assert.equal((await pool.query('select status from project_milestones')).rows[0].status,'in_progress');});
 test('changed or removed milestones reject stale decisions and preserve the original receipt',async()=>{const r=await requested();await pool.query("update project_milestones set title='New scope',updated_at=now()");assert.equal((await service.list(client,'project')).reviews[0].stale,true);await assert.rejects(service.decide(client,'project',r.id,{version:r.version,state:'approved'}),{code:'SOURCE_CHANGED'});assert.equal((await service.list(owner,'project')).reviews[0].title,'Design');await pool.query("delete from project_milestones");await assert.rejects(service.decide(client,'project',r.id,{version:r.version,state:'approved'}),{code:'SOURCE_CHANGED'});});
 test('only the assigned project client can decide and foreign organizations cannot inspect history',async()=>{const r=await requested();const body={version:r.version,state:'approved'};for(const actor of [owner,{...client,id:'other'},{...client,organizationId:'org-b'}])await assert.rejects(service.decide(actor,'project',r.id,body));await assert.rejects(service.list({...owner,organizationId:'org-b'},'project'));await assert.rejects(service.request(client,'project',await input()),{code:'FORBIDDEN'});});
 test('changing the project client does not leak previous client receipts to the replacement',async()=>{await requested();await pool.query("update projects set client_id='other-client'");await assert.rejects(service.list(client,'project'));assert.equal((await service.list({...client,id:'other'},'project')).reviews.length,0);assert.equal((await service.list(owner,'project')).reviews[0].stale,true);});
 test('requesting changes requires a comment; editing the milestone permits a new review',async()=>{const r=await requested();await assert.rejects(service.decide(client,'project',r.id,{version:r.version,state:'changes_requested',comment:' '}),{code:'INVALID_DECISION'});await service.decide(client,'project',r.id,{version:r.version,state:'changes_requested',comment:'Adjust spacing'});await pool.query("update project_milestones set title='Design revised',updated_at=now()");const next=await requested();assert.notEqual(next.id,r.id);const view=await service.list(client,'project');assert.equal(view.reviews.length,2);assert.ok(view.reviews.some(row=>row.comment==='Adjust spacing'));});
 test('a failed activity write rolls back the review request',async()=>{const body=await input();await pool.query("create function fail_delivery_activity() returns trigger language plpgsql as $$ begin raise exception 'test'; end $$;create trigger fail_delivery before insert on recent_activities for each row execute function fail_delivery_activity()");try{await assert.rejects(service.request(owner,'project',body));assert.equal((await pool.query('select count(*)::int n from delivery_reviews')).rows[0].n,0);}finally{await pool.query('drop trigger fail_delivery on recent_activities;drop function fail_delivery_activity()')}});
 test('a request cannot publish a version changed since selection',async()=>{const body=await input();await pool.query("update project_milestones set title='Different scope'");await assert.rejects(service.request(owner,'project',body),{code:'SOURCE_CHANGED'});});
 test('linked client identity and portal access are required before publishing a review',async()=>{
  const body=await input();
  await pool.query("update clients set user_id=null where id='client'");
  let view=await service.list(owner,'project');
  assert.equal(view.hasClient,true);assert.deepEqual(view.client,{id:'client',name:'Client',portalReady:false});assert.equal(view.requestBlockReason,'CLIENT_PORTAL_REQUIRED');
  await assert.rejects(service.request(owner,'project',body),{code:'CLIENT_PORTAL_REQUIRED'});
  await pool.query("update clients set user_id='client-user',portal_access_enabled=false where id='client'");
  view=await service.list(owner,'project');assert.equal(view.client.portalReady,false);assert.equal(view.requestBlockReason,'CLIENT_PORTAL_REQUIRED');
  await assert.rejects(service.request(owner,'project',body),{code:'CLIENT_PORTAL_REQUIRED'});
  assert.equal((await pool.query('select count(*)::int n from delivery_reviews')).rows[0].n,0);
  await pool.query("update clients set portal_access_enabled=true where id='client'");
  view=await service.list(owner,'project');assert.equal(view.client.portalReady,true);assert.equal(view.requestBlockReason,null);
  await service.request(owner,'project',body);assert.equal((await service.list(client,'project')).reviews[0].canDecide,true);
 });
 test('disabled portal blocks old client receipts and decisions without losing review history',async()=>{
  const r=await requested();await pool.query("update clients set portal_access_enabled=false where id='client'");
  await assert.rejects(service.list(client,'project'),{code:'PROJECT_NOT_FOUND'});
  await assert.rejects(service.decide(client,'project',r.id,{version:r.version,state:'approved'}),{code:'PROJECT_NOT_FOUND'});
  const internal=await service.list(owner,'project');assert.equal(internal.reviews[0].state,'pending');assert.equal(internal.requestBlockReason,'CLIENT_PORTAL_REQUIRED');
  await pool.query("update clients set portal_access_enabled=true where id='client'");
  await service.decide(client,'project',r.id,{version:r.version,state:'approved'});assert.equal((await service.list(owner,'project')).reviews[0].state,'approved');
 });
 test('no assigned client has a distinct prerequisite and milestone data stays available to managers',async()=>{
  await pool.query("update projects set client_id=null where id='project'");
  const view=await service.list(owner,'project');assert.equal(view.hasClient,false);assert.equal(view.client,null);assert.equal(view.requestBlockReason,'CLIENT_REQUIRED');
  assert.equal(view.milestones[0].status,'in_progress');assert.equal(view.milestones[0].dueDate,null);assert.equal(view.milestones[0].currentReview,null);
  await assert.rejects(service.request(owner,'project',await input()),{code:'CLIENT_REQUIRED'});
 });
 test('same-version retries preserve the original note and changed instructions require an explicit revision',async()=>{
  const body=await input();const first=await service.request(owner,'project',body);
  assert.deepEqual(await service.request(owner,'project',{...body,note:'  '+body.note+'  '}),{id:first.id,existing:true});
  await assert.rejects(service.request(owner,'project',{...body,note:'Different instructions'}),{code:'REVIEW_ALREADY_EXISTS'});
  await service.decide(client,'project',first.id,{version:body.version,state:'changes_requested',comment:'Revise the spacing'});
  assert.deepEqual(await service.request(owner,'project',body),{id:first.id,existing:true});
  await assert.rejects(service.request(owner,'project',{...body,note:'Adjusted spacing, review again'}),{code:'REVIEW_ALREADY_EXISTS'});
  const view=await service.list(owner,'project');assert.equal(view.reviews.length,1);assert.equal(view.reviews[0].note,body.note);
  assert.deepEqual(view.milestones[0].currentReview,{id:first.id,state:'changes_requested'});
  await pool.query("update project_milestones set title='Design revision 2',updated_at=now() where id='milestone'");
  assert.equal((await service.list(owner,'project')).milestones[0].currentReview,null);
  const second=await service.request(owner,'project',{...await input(),note:'Adjusted spacing, review again'});assert.notEqual(second.id,first.id);
  assert.equal((await service.list(owner,'project')).reviews.find(r=>r.id===first.id).comment,'Revise the spacing');
 });
 test('current milestone review is found outside the displayed history page and respects client changes',async()=>{
  const r=await requested();await pool.query("update delivery_reviews set requested_at='2020-01-01' where id=$1",[r.id]);
  for(let i=0;i<26;i++)await pool.query("insert into delivery_reviews(id,project_id,organization_id,milestone_id,client_id,source_version,title,note,requested_by,requested_at) values($1,'project','org-a','milestone','client',$2,'Old version','Old instructions','owner',now())",['older-'+i,String(i).padStart(64,'0')]);
  const first=await service.list(owner,'project');assert.equal(first.hasMore,true);assert.equal(first.reviews.length,25);assert.ok(first.reviews.every(item=>item.id!==r.id));
  assert.deepEqual(first.milestones[0].currentReview,{id:r.id,state:'pending'});
  const second=await service.list(owner,'project',2);assert.equal(second.hasMore,false);assert.ok(second.reviews.some(item=>item.id===r.id));
  const focused=await service.list(owner,'project',1,r.id);assert.equal(focused.reviews.length,1);assert.equal(focused.reviews[0].id,r.id);
  await pool.query("update projects set client_id='other-client' where id='project'");
  assert.equal((await service.list(owner,'project')).milestones[0].currentReview,null);
  assert.equal((await service.list({...client,id:'other'},'project')).reviews.length,0);
 });
 test('published delivery appears in client pending items and a decision completes that pending item',async()=>{
  const pending=require('../src/modules/client-pending/service').createClientPending(pool);
  const r=await requested();const open=await pending.list(client,{kind:'delivery'});
  assert.equal(open.items.length,1);assert.equal(open.items[0].id,r.id);assert.equal(open.items[0].stale,false);
  assert.ok(open.items[0].href.includes('reviewId='+r.id));assert.equal(open.summary.open,1);
  await service.decide(client,'project',r.id,{version:r.version,state:'approved',comment:'Ready'});
  const after=await pending.list(client,{kind:'delivery'});assert.equal(after.items.length,0);assert.equal(after.summary.open,0);
  const history=await pending.list(client,{kind:'delivery',state:'completed'});assert.equal(history.items[0].id,r.id);assert.equal(history.items[0].sourceState,'approved');
 });

 test('a client snapshot prevents publishing review instructions to a replacement recipient',async()=>{
  const body={...await input(),clientId:'client'};
  await pool.query("update projects set client_id='other-client' where id='project'");
  await assert.rejects(service.request(owner,'project',body),{code:'CLIENT_CHANGED'});
  assert.equal((await pool.query('select count(*)::int n from delivery_reviews')).rows[0].n,0);
  assert.equal((await pool.query('select count(*)::int n from recent_activities')).rows[0].n,0);
  const fresh=await service.list(owner,'project');assert.equal(fresh.client.id,'other-client');assert.equal(fresh.client.portalReady,true);
  const result=await service.request(owner,'project',{...body,clientId:fresh.client.id});
  const replacement=await service.list({...client,id:'other'},'project');assert.equal(replacement.reviews[0].id,result.id);assert.equal(replacement.reviews[0].canDecide,true);
  await assert.rejects(service.list(client,'project'),{code:'PROJECT_NOT_FOUND'});
 });

 test('the latest 200 milestones include newly created and updated work while older review versions remain readable',async()=>{
  await pool.query("update project_milestones set updated_at='1999-01-01' where id='milestone'");
  const original=await requested();
  await pool.query("insert into project_milestones(id,project_id,organization_id,title,status,position,created_at,updated_at) select 'bulk-'||lpad(i::text,3,'0'),'project','org-a','Milestone '||i,'pending',i,'2020-01-01','2020-01-01' from generate_series(1,201) as s(i)");
  let view=await service.list(owner,'project');assert.equal(view.milestonesTruncated,true);assert.equal(view.milestones.length,200);assert.equal(view.milestones.some(m=>m.id==='milestone'),false);
  assert.equal(view.reviews.find(r=>r.id===original.id).stale,false);
  await pool.query("insert into project_milestones(id,project_id,organization_id,title,status,position,created_at,updated_at) values('newest','project','org-a','New delivery','pending',202,now(),now())");
  view=await service.list(owner,'project');assert.equal(view.milestones[0].id,'newest');assert.equal(view.milestones.length,200);
  await pool.query("update project_milestones set title='Revised old delivery',updated_at=clock_timestamp() where id='bulk-201'");
  view=await service.list(owner,'project');assert.equal(view.milestones[0].id,'bulk-201');assert.ok(view.milestones.some(m=>m.id==='newest'));assert.equal(view.milestonesTruncated,true);
  assert.equal(view.reviews.find(r=>r.id===original.id).stale,false);
  const selected=view.milestones.find(m=>m.id==='newest');const created=await service.request(owner,'project',{milestoneId:selected.id,version:selected.version,note:'Review the newly created delivery'});
  assert.deepEqual((await service.list(owner,'project')).milestones.find(m=>m.id==='newest').currentReview,{id:created.id,state:'pending'});
 });

 test('milestone due dates keep their calendar day in positive-offset server timezones',async()=>{
  const previousTimezone=process.env.TZ;
  try{
   process.env.TZ='Asia/Jerusalem';
   await pool.query("update project_milestones set due_date='2026-12-01' where id='milestone'");
   const selected=(await service.list(owner,'project')).milestones[0];assert.equal(selected.dueDate,'2026-12-01');
   const review=await service.request(owner,'project',{milestoneId:selected.id,version:selected.version,clientId:'client',note:'Review this calendar date'});
   await service.decide(client,'project',review.id,{version:selected.version,state:'approved'});
   const result=await service.list(owner,'project');assert.equal(result.milestones[0].currentReview.state,'approved');assert.equal(result.reviews.find(r=>r.id===review.id).dueDate,'2026-12-01');
  }finally{if(previousTimezone===undefined)delete process.env.TZ;else process.env.TZ=previousTimezone;}
 });

}

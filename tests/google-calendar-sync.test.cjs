const {test,before,beforeEach,after}=require('node:test');
const assert=require('node:assert/strict');const {randomUUID}=require('node:crypto');
const gcal=require('../src/services/googleCalendar.service');
const {zonedMidnight,dayIn,fromGoogleTimes,googleIdFor,appIdFromGoogle,googleCalendarService}=gcal;

test('local midnight, day and hours follow the user time zone',()=>{
 assert.equal(zonedMidnight('2026-11-10','America/Sao_Paulo').toISOString(),'2026-11-10T03:00:00.000Z');
 assert.equal(zonedMidnight('2026-03-29','Europe/Lisbon').toISOString(),'2026-03-29T00:00:00.000Z');
 assert.equal(zonedMidnight('2026-07-01','Asia/Jerusalem').toISOString(),'2026-06-30T21:00:00.000Z');
 assert.equal(dayIn(new Date('2026-11-10T01:00:00Z'),'America/Sao_Paulo'),'2026-11-09');
 assert.deepEqual(fromGoogleTimes({start:{dateTime:'2026-11-10T15:00:00-03:00'},end:{dateTime:'2026-11-10T16:30:00-03:00'}},'America/Sao_Paulo'),{day:'2026-11-10',startHour:15,endHour:16,allDay:false});
 assert.deepEqual(fromGoogleTimes({start:{dateTime:'2026-11-10T23:00:00-03:00'},end:{dateTime:'2026-11-11T01:00:00-03:00'}},'America/Sao_Paulo'),{day:'2026-11-10',startHour:23,endHour:23,allDay:false});
 assert.deepEqual(fromGoogleTimes({start:{date:'2026-11-10'},end:{date:'2026-11-11'}},'America/Sao_Paulo'),{day:'2026-11-10',startHour:0,endHour:0,allDay:true});
 assert.equal(fromGoogleTimes({start:{},end:{}},'UTC'),null);
});
test('Flowlio event ids map to valid Google ids and back',()=>{
 const id=randomUUID();assert.match(googleIdFor(id),/^[0-9a-f]{32}$/);assert.equal(appIdFromGoogle(googleIdFor(id)),id);
 assert.equal(appIdFromGoogle('abcdefghijklmnopqrstuv0123'),null);assert.equal(appIdFromGoogle(googleIdFor(id)+'_20261110T150000Z'),null);
});
test('the OAuth state only names a user when it is signed and fresh',()=>{
 const url=new URL(googleCalendarService.generateAuthUrl('user-1'));const state=url.searchParams.get('state');
 assert.equal(googleCalendarService.verifyAuthState(state),'user-1');
 assert.equal(googleCalendarService.verifyAuthState(state.replace('user-1','user-2')),null);
 assert.equal(googleCalendarService.verifyAuthState('user-1'),null);
 const [user,expiry,signature]=state.split('.');assert.equal(googleCalendarService.verifyAuthState(`${user}.${Number(expiry)+1}.${signature}`),null);
 const realNow=Date.now;Date.now=()=>realNow()+11*60000;try{assert.equal(googleCalendarService.verifyAuthState(state),null);}finally{Date.now=realNow;}
});

if(!process.env.GOOGLE_CALENDAR_TEST_DATABASE_URL)test('Google Calendar sync PostgreSQL',{skip:true},()=>{});
else{
 const url=new URL(process.env.GOOGLE_CALENDAR_TEST_DATABASE_URL);assert.equal(url.hostname,'127.0.0.1');assert.equal(url.port,'55442');assert.equal(url.pathname,'/flowlio_google_calendar_test');
 const {Pool}=require('pg');const pool=new Pool({connectionString:url.toString()});
 const {drizzle}=require('drizzle-orm/node-postgres');const schema=require('../src/schema/schema');const db=drizzle(pool,{schema,casing:'snake_case'});
 const {createCalendarSync}=require('../src/modules/google-calendar/sync');
 const now=Date.parse('2026-11-07T12:00:00Z');const tz='America/Sao_Paulo';
 let calls,feeds,channels;
 const api={
  connected:async userId=>userId!=='offline',timeZone:async()=>tz,
  listChanges:async(userId,from)=>{calls.push(['list',userId,'syncToken'in from?from.syncToken:'window']);const next=feeds.shift();if(next instanceof Error)throw next;return next;},
  importEvent:async(userId,event,organizationId)=>{const t=fromGoogleTimes(event,tz);return(await db.insert(schema.calendarEvents).values({id:randomUUID(),title:event.summary||'Untitled Event',description:event.description||'',date:zonedMidnight(t.day,tz),startHour:t.startHour,endHour:t.endHour,calendarType:'work',platform:'google_meet',organizationId,userId,googleEventId:event.id,syncStatus:'synced',syncDirection:'google_to_app'}).returning())[0];},
  pushEvent:async(userId,event)=>{calls.push(['push',userId,event.id]);await db.update(schema.calendarEvents).set({googleEventId:googleIdFor(event.id)}).where(require('drizzle-orm').eq(schema.calendarEvents.id,event.id));},
  watch:async(userId,channel)=>{channels.push(channel);return{resourceId:'res-'+channels.length,expiration:new Date(now+7*86400000)};},
  stop:async(userId,channel)=>{calls.push(['stop',userId,channel.id]);},
 };
 const sync=createCalendarSync(db,api,{now:()=>now});
 const rows=async(sql,params=[])=>(await pool.query(sql,params)).rows;
 const event=(id,extra={})=>({id,status:'confirmed',summary:'Meeting '+id,start:{dateTime:'2026-11-10T15:00:00-03:00'},end:{dateTime:'2026-11-10T16:00:00-03:00'},...extra});
 const addEvent=(values)=>db.insert(schema.calendarEvents).values({id:randomUUID(),title:'Flowlio event',description:'',date:zonedMidnight('2026-11-12',tz),startHour:9,endHour:10,calendarType:'meeting',platform:'none',organizationId:'org',userId:'u1',createdAt:new Date(now-3600000),...values}).returning().then(r=>r[0]);
 before(async()=>{await pool.query('drop schema public cascade;create schema public;drop schema if exists flowlio_releases cascade;drop schema if exists drizzle cascade');await require('../src/utils/release-migrations.util').runReleaseMigrations(pool);});
 beforeEach(async()=>{
  calls=[];feeds=[];channels=[];
  await pool.query('TRUNCATE users,organizations,calendar_events,google_calendar_sync_state,notifications CASCADE');
  await pool.query(`INSERT INTO users(id,name,email,email_verified,two_factor_enabled,is_super_admin,timezone,created_at,updated_at) VALUES
   ('u1','Ana','ana@example.test',true,false,false,'${tz}',now(),now()),('u2','Bia','bia@example.test',true,false,false,'UTC',now(),now());
   INSERT INTO organizations(id,name,slug,settings,created_at,updated_at) VALUES ('org','Test','test','{"currency":"USD"}',now(),now());
   INSERT INTO user_organizations(id,user_id,organization_id,role,status,created_at,updated_at) VALUES ('m1','u1','org','owner','active',now(),now()),('m2','u2','org','user','active',now(),now());`);
 });
 after(async()=>{await pool.end();});

 test('the first sync imports the window, keeps linked events missing from it and sends no notifications',async()=>{
  const farAway=await addEvent({googleEventId:'far-future',date:zonedMidnight('2027-03-01',tz),syncDirection:'bidirectional'});
  feeds.push({items:[event('g1'),event('old',{start:{dateTime:'2026-01-01T10:00:00Z'},end:{dateTime:'2026-01-01T11:00:00Z'}})],nextSyncToken:'t1'});
  await sync.syncUser('u1');
  assert.deepEqual(calls[0],['list','u1','window']);
  const events=await rows("select id,google_event_id,start_hour,end_hour,user_id from calendar_events order by google_event_id");
  assert.deepEqual(events.map(e=>e.google_event_id),['far-future','g1']);
  assert.ok(events.some(e=>e.id===farAway.id),'a linked event outside the window must survive');
  assert.deepEqual([events[1].start_hour,events[1].end_hour],[15,16]);
  assert.equal((await rows('select * from notifications')).length,0);
  const [state]=await rows("select sync_token,last_synced_at,last_error from google_calendar_sync_state where user_id='u1'");
  assert.equal(state.sync_token,'t1');assert.ok(state.last_synced_at);assert.equal(state.last_error,null);
 });

 test('changes apply per user: deletions only touch this user, edits move the day and hours, new events notify the team',async()=>{
  const mine=await addEvent({googleEventId:'shared',syncDirection:'google_to_app'});
  const theirs=await addEvent({googleEventId:'shared',userId:'u2'});
  const moved=await addEvent({googleEventId:'moved',syncDirection:'google_to_app',date:new Date('2026-11-12T00:00:00Z')});
  await pool.query("insert into google_calendar_sync_state(user_id,sync_token) values ('u1','t1')");
  feeds.push({items:[{id:'shared',status:'cancelled'},event('moved',{summary:'Moved',start:{dateTime:'2026-11-13T14:00:00-03:00'},end:{dateTime:'2026-11-13T17:00:00-03:00'}}),event('brand-new')],nextSyncToken:'t2'});
  await sync.syncUser('u1');
  assert.deepEqual(calls[0],['list','u1','t1']);
  const left=await rows('select id from calendar_events');
  assert.ok(!left.some(r=>r.id===mine.id));assert.ok(left.some(r=>r.id===theirs.id),"another member's copy is not deleted");
  const [m]=await db.select().from(schema.calendarEvents).where(require('drizzle-orm').eq(schema.calendarEvents.id,moved.id));
  assert.equal(m.title,'Moved');assert.equal(dayIn(m.date,tz),'2026-11-13');assert.equal(m.date.toISOString(),'2026-11-13T03:00:00.000Z');assert.deepEqual([m.startHour,m.endHour],[14,17]);
  assert.equal((await rows("select * from calendar_events where google_event_id='brand-new' and user_id='u1'")).length,1);
  const notes=await rows('select user_id from notifications');assert.deepEqual(notes.map(n=>n.user_id),['u2']);
  assert.equal((await rows("select sync_token from google_calendar_sync_state where user_id='u1'"))[0].sync_token,'t2');
 });

 test('events pushed from Flowlio are linked, never duplicated, and never brought back after deletion',async()=>{
  const unlinked=await addEvent({});const deletedId=randomUUID();
  await pool.query("insert into google_calendar_sync_state(user_id,sync_token) values ('u1','t1')");
  feeds.push({items:[event(googleIdFor(unlinked.id)),event(googleIdFor(deletedId))],nextSyncToken:'t2'});
  await sync.syncUser('u1');
  const all=await rows('select id,google_event_id from calendar_events');
  assert.equal(all.length,1);assert.equal(all[0].google_event_id,googleIdFor(unlinked.id));
 });

 test('the first pass does not overwrite events created in Flowlio with what Google has',async()=>{
  const own=await addEvent({googleEventId:'from-flowlio',syncDirection:'bidirectional'});
  feeds.push({items:[event('from-flowlio',{summary:'Changed in Google',start:{dateTime:'2026-11-12T12:00:00Z'},end:{dateTime:'2026-11-12T13:00:00Z'}})],nextSyncToken:'t1'});
  await sync.syncUser('u1');
  const [row]=await rows('select title,start_hour from calendar_events where id=$1',[own.id]);
  assert.deepEqual(row,{title:'Flowlio event',start_hour:9});
 });

 test('an expired sync token starts over from the window',async()=>{
  await pool.query("insert into google_calendar_sync_state(user_id,sync_token) values ('u1','stale')");
  feeds.push(Object.assign(new Error('Gone'),{code:410}),{items:[],nextSyncToken:'fresh'});
  await sync.syncUser('u1');
  assert.deepEqual(calls.map(c=>c[2]),['stale','window']);
  assert.equal((await rows("select sync_token from google_calendar_sync_state where user_id='u1'"))[0].sync_token,'fresh');
 });

 test('unsent Flowlio events are pushed, except brand-new ones and recent failures',async()=>{
  const old=await addEvent({});
  await addEvent({createdAt:new Date(now-30000)});
  await addEvent({syncStatus:'failed',lastSyncAt:new Date(now-600000)});
  const retry=await addEvent({syncStatus:'failed',lastSyncAt:new Date(now-2*3600000)});
  await addEvent({date:new Date(now-60*86400000)});
  feeds.push({items:[],nextSyncToken:'t1'});
  await sync.syncUser('u1');
  assert.deepEqual(calls.filter(c=>c[0]==='push').map(c=>c[2]).sort(),[old.id,retry.id].sort());
 });

 test('failures are recorded on the state row and never thrown',async()=>{
  feeds.push(new Error('invalid_grant'));
  await sync.syncUser('u1');
  assert.equal((await rows("select last_error from google_calendar_sync_state where user_id='u1'"))[0].last_error,'invalid_grant');
  await sync.syncUser('offline');assert.equal(calls.length,1);
 });

 test('push channels are created, renewed before expiry, verified by token and stopped on disconnect',async()=>{
  const live=createCalendarSync(db,api,{now:()=>now,webhookUrl:'https://api.example.test/api/google-calendar/webhook'});
  feeds.push({items:[],nextSyncToken:'t1'},{items:[],nextSyncToken:'t2'});
  await live.syncUser('u1');
  assert.equal(channels.length,1);assert.equal(channels[0].address,'https://api.example.test/api/google-calendar/webhook');
  assert.equal(await live.notificationOwner(channels[0].id,channels[0].token),'u1');
  assert.equal(await live.notificationOwner(channels[0].id,'wrong-token'),null);
  assert.equal(await live.notificationOwner('unknown',channels[0].token),null);
  assert.equal(await live.notificationOwner(undefined,undefined),null);
  await pool.query("update google_calendar_sync_state set channel_expires_at=now()+interval '2 hours'");
  await createCalendarSync(db,api,{now:Date.now,webhookUrl:'https://api.example.test/api/google-calendar/webhook'}).syncUser('u1');
  assert.equal(channels.length,2);assert.deepEqual(calls.find(c=>c[0]==='stop'),['stop','u1',channels[0].id]);
  assert.equal(await live.notificationOwner(channels[0].id,channels[0].token),null,'the replaced channel no longer queues syncs');
  await live.forget('u1');
  assert.deepEqual(calls.filter(c=>c[0]==='stop').map(c=>c[2]),[channels[0].id,channels[1].id]);
  assert.equal((await rows('select * from google_calendar_sync_state')).length,0);
 });
}

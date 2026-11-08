const {test,before,beforeEach,after}=require('node:test');
const assert=require('node:assert/strict');const {createHmac,randomUUID}=require('node:crypto');
const {validSignature,inboundMessages}=require('../src/modules/whatsapp/cloud-api');
const {formatAnswer,describe,maskPhone,newCode,createWhatsApp}=require('../src/modules/whatsapp/service');

test('only requests signed with the app secret are accepted',()=>{
 const raw=Buffer.from('{"entry":[]}');const sign=secret=>'sha256='+createHmac('sha256',secret).update(raw).digest('hex');
 assert.equal(validSignature(raw,sign('secret'),'secret'),true);
 for(const header of [sign('other'),undefined,'sha256=abc','md5='+sign('secret').slice(7)])assert.equal(validSignature(raw,header,'secret'),false);
 assert.equal(validSignature(Buffer.from('{"entry":[1]}'),sign('secret'),'secret'),false);
});
test('webhook batches keep messages for our number only, in the shapes Lio understands',()=>{
 const change=(id,messages)=>({field:'messages',value:{metadata:{phone_number_id:id},messages}});
 const body={entry:[{changes:[change('mine',[
  {id:'a',from:'972501234567',timestamp:'1',type:'text',text:{body:'hi'}},
  {id:'b',from:'972501234567',timestamp:'2',type:'audio',audio:{id:'media'}},
  {id:'c',from:'972501234567',timestamp:'3',type:'interactive',interactive:{type:'button_reply',button_reply:{id:'ok:x:0'}}},
  {id:'d',from:'972501234567',timestamp:'4',type:'image',image:{id:'img'}},
  {id:'e',from:'not-a-number',type:'text',text:{body:'x'}}]),change('someone-else',[{id:'f',from:'972501234567',type:'text',text:{body:'x'}}]),{field:'statuses',value:{metadata:{phone_number_id:'mine'},statuses:[{id:'g'}]}}]}]};
 assert.deepEqual(inboundMessages(body,'mine').map(m=>[m.id,m.kind,m.text??m.mediaId??m.reply??null]),[['a','text','hi'],['b','audio','media'],['c','button','ok:x:0'],['d','other',null]]);
 assert.deepEqual(inboundMessages({entry:'bad'},'mine'),[]);
});
test('answers read naturally on WhatsApp and actions are summarized with record names',()=>{
 const sources=[{key:'project:p',kind:'project',id:'p',title:'Website'},{key:'task:t',kind:'task',id:'t',title:'Homepage'}];
 const run={id:'r',state:'ready',sources,result:{answer:'**Website** is late: see [[task:t]] and [[task:gone]].',missing:['Budget'],actions:[]}};
 assert.equal(formatAnswer(run,'Still missing:'),'*Website* is late: see Homepage and .\n\nStill missing:\n• Budget');
 assert.equal(describe({type:'create_task',projectId:'p',title:'Fix menu',description:'',assignedTo:null,startDate:null,endDate:'2026-11-20',estimatedHours:null},sources,'en'),'📝 New task: Fix menu · Website · 2026-11-20');
 assert.equal(describe({type:'set_task_status',taskId:'t',status:'completed'},sources,'pt'),'✔️ Homepage → Concluída');
 assert.equal(describe({type:'create_event',title:'Kickoff',description:'',date:'2026-11-10',startHour:9,endHour:10,calendarType:'meeting'},sources,'xx'),'📅 Kickoff · 2026-11-10 09:00–10:00');
 assert.equal(maskPhone('972501234567'),'+972 •••• 4567');assert.match(newCode(),/^[A-HJKMNP-Z2-9]{4}-[A-HJKMNP-Z2-9]{4}$/);
});

if(!process.env.WHATSAPP_TEST_DATABASE_URL)test('WhatsApp PostgreSQL',{skip:true},()=>{});
else{
 const url=new URL(process.env.WHATSAPP_TEST_DATABASE_URL);assert.equal(url.hostname,'127.0.0.1');assert.equal(url.port,'55442');assert.equal(url.pathname,'/flowlio_whatsapp_test');
 const {Pool}=require('pg');const pool=new Pool({connectionString:url.toString()});
 const phone='972501234567';const users={u1:{id:'u1',name:'Ana Lima',role:'user',organizationId:'org',timezone:'Asia/Jerusalem'},u2:{id:'u2',name:'Bia',role:'user',organizationId:'org',timezone:'UTC'}};
 let sent,created,applied,clock,actorError,assistant,nextRun,createError,audio;
 const api={sendText:async(to,body)=>{sent.push([to,body]);},sendButtons:async(to,body,buttons)=>{sent.push([to,body,buttons.map(b=>b.id)]);},
  downloadMedia:async id=>{if(audio instanceof Error)throw audio;return{buffer:Buffer.from(id),mimetype:'audio/ogg'};},displayNumber:async()=>'15551874420'};
 const agent={create:async(a,raw)=>{created.push(raw);if(createError)throw createError;return nextRun(raw);},apply:async(a,id,raw)=>{applied.push([id,raw]);return{id,state:'applied',sources:[],result:{answer:'',missing:[],actions:[{type:'create_event',title:'Kickoff',description:'',date:'2026-11-10',startHour:9,endHour:10,calendarType:'meeting'}]}};}};
 const wa=createWhatsApp(pool,{api,agent,transcribe:async a=>({text:'what is due '+a.buffer.toString()}),actor:async id=>{if(actorError)throw actorError;return users[id];},hasAssistant:async()=>assistant,now:()=>clock});
 const text=(body,from=phone)=>wa.handle({id:randomUUID(),from,timestamp:0,kind:'text',text:body});
 const link=async(user=users.u1,from=phone)=>{const {code}=await wa.startLink(user,'en');await text(`FLOWLIO ${code}`,from);return code;};
 before(async()=>{await pool.query('drop schema public cascade;create schema public;drop schema if exists flowlio_releases cascade;drop schema if exists drizzle cascade');await require('../src/utils/release-migrations.util').runReleaseMigrations(pool);});
 beforeEach(async()=>{
  sent=[];created=[];applied=[];clock=Date.parse('2026-11-08T12:00:00Z');actorError=null;assistant=true;createError=null;audio=null;
  nextRun=raw=>({id:raw.id,state:'ready',sources:[],result:{answer:'Two tasks are due.',missing:[],actions:[]}});
  await pool.query('TRUNCATE users,organizations,whatsapp_links CASCADE');
  await pool.query(`INSERT INTO users(id,name,email,email_verified,two_factor_enabled,is_super_admin,timezone,created_at,updated_at) VALUES
   ('u1','Ana Lima','ana@example.test',true,false,false,'Asia/Jerusalem',now(),now()),('u2','Bia','bia@example.test',true,false,false,'UTC',now(),now());
   INSERT INTO organizations(id,name,slug,settings,created_at,updated_at) VALUES ('org','Test','test','{"currency":"USD"}',now(),now());`);
 });
 after(async()=>{await pool.end();});

 test('a number is linked only by sending the fresh code shown to the user, and the code works once',async()=>{
  await text('hello');assert.match(sent.pop()[1],/não está conectado/);
  const {code,expiresAt}=await wa.startLink(users.u1,'en');assert.equal(new Date(expiresAt).getTime(),clock+15*60000);
  assert.deepEqual((await wa.status(users.u1)).pending,{expiresAt:new Date(expiresAt)});
  await text(`flowlio ${code.toLowerCase().replace('-','')}`);assert.equal(sent.pop()[1],'✅ Connected, Ana! Ask me anything about your work, or send a voice note. Write "new" to start a new conversation.');
  assert.deepEqual(await wa.status(users.u1),{linked:{phone:'+972 •••• 4567',since:(await wa.status(users.u1)).linked.since},pending:null});
  await text(`FLOWLIO ${code}`,'972509999999');assert.match(sent.pop()[1],/não é válido/);
  const {code:late}=await wa.startLink(users.u2,'en');clock+=16*60000;await text(`FLOWLIO ${late}`,'972508888888');assert.match(sent.pop()[1],/não é válido/);
  assert.equal(created.length,0);
 });
 test('linking a number to another user moves it, and unlinking stops replies',async()=>{
  await link(users.u1);await link(users.u2);
  assert.equal((await wa.status(users.u1)).linked,null);assert.equal((await wa.status(users.u2)).linked.phone,'+972 •••• 4567');
  await wa.unlink(users.u2);sent=[];await text('what is due today?');assert.match(sent[0][1],/não está conectado/);assert.equal(created.length,0);
 });
 test('messages go to Lio in the same conversation, actions come with confirm buttons, and "new" starts over',async()=>{
  await link();sent=[];
  nextRun=raw=>({id:raw.id,state:'ready',sources:[{key:'project:p',kind:'project',id:'p',title:'Website'}],result:{answer:'Here you go.',missing:[],actions:[
   {type:'create_task',projectId:'p',title:'Fix menu',description:'',assignedTo:null,startDate:null,endDate:null,estimatedHours:null},
   {type:'client_request',projectId:'p',title:'Send logo',description:'Need the logo',questions:[]}]}});
  await text('create a task to fix the menu');
  const [first]=created;assert.deepEqual({...first,id:undefined,conversationId:undefined},{id:undefined,scope:{area:'dashboard'},prompt:'create a task to fix the menu',language:'en',conversationId:undefined,mode:'review'});
  assert.deepEqual(sent,[[phone,'Here you go.'],[phone,'📝 New task: Fix menu · Website',[`ok:${first.id}:0`,`no:${first.id}:0`]],[phone,'📨 Send logo\nThis is shared with a client, so confirm it in Flowlio.']]);
  await text('and another one');assert.equal(created[1].conversationId,first.conversationId);
  await text('new');assert.equal(sent.at(-1)[1],'Starting a new conversation. What do you need?');
  await text('fresh start');assert.notEqual(created[2].conversationId,first.conversationId);
  await text('ok');assert.equal(sent.at(-1)[1],'Tell me a bit more about what you need.');assert.equal(created.length,3);
 });
 test('a confirm tap applies only that action in the user time zone; skip does nothing',async()=>{
  await link();sent=[];const runId=randomUUID();
  await wa.handle({id:'t1',from:phone,timestamp:0,kind:'button',reply:`ok:${runId}:0`});
  assert.deepEqual(applied,[[runId,{selected:[0],confirm:true,edits:{},timeZone:'Asia/Jerusalem'}]]);assert.equal(sent.pop()[1],'✅ Done: 📅 Kickoff · 2026-11-10 09:00–10:00');
  await wa.handle({id:'t2',from:phone,timestamp:0,kind:'button',reply:`no:${runId}:1`});assert.equal(sent.pop()[1],'OK, I did not do it.');
  await wa.handle({id:'t3',from:phone,timestamp:0,kind:'button',reply:'ok:../../x:0'});assert.equal(applied.length,1);
 });
 test('voice notes are transcribed, echoed and answered; unreadable ones get a clear reply',async()=>{
  await link();sent=[];
  await wa.handle({id:'v1',from:phone,timestamp:0,kind:'audio',mediaId:'today'});
  assert.deepEqual(sent.slice(0,2),[[phone,'🎤 "what is due today"'],[phone,'Two tasks are due.']]);assert.equal(created[0].prompt,'what is due today');
  audio=new Error('WHATSAPP_HTTP_404');await wa.handle({id:'v2',from:phone,timestamp:0,kind:'audio',mediaId:'x'});assert.match(sent.pop()[1],/could not understand that voice note/);
  await wa.handle({id:'i1',from:phone,timestamp:0,kind:'other'});assert.match(sent.pop()[1],/text and voice notes/);
 });
 test('revoked access, a plan without Lio and an exhausted quota each get their own reply',async()=>{
  await link();sent=[];
  actorError=Object.assign(new Error('x'),{code:'USER_DEACTIVATED'});await text('what is due?');assert.match(sent.pop()[1],/access changed/);actorError=null;
  assistant=false;await text('what is due?');assert.match(sent.pop()[1],/plan does not include Lio/);assistant=true;
  createError=Object.assign(new Error('x'),{code:'ORG_TOKEN_LIMIT_EXCEEDED',status:429});await text('what is due?');assert.match(sent.pop()[1],/AI credits/);
  createError=new Error('boom');await text('what is due?');assert.match(sent.pop()[1],/went wrong/);
  assert.equal(applied.length,0);
 });
}

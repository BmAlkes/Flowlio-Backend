const {test}=require('node:test');
const assert=require('node:assert/strict');
const {spawn}=require('node:child_process');
const net=require('node:net');
const {once}=require('node:events');
const {setTimeout:delay}=require('node:timers/promises');
test('compiled HTTP server boots without ts-node or tsconfig-paths and serves the protected capacity route',{timeout:60000,skip:!process.env.STARTUP_TEST_DATABASE_URL},async()=>{
 const url=new URL(process.env.STARTUP_TEST_DATABASE_URL);
 assert.ok(url.hostname==='127.0.0.1'&&url.port==='55442'&&url.pathname==='/flowlio_startup_test');
 const {Pool}=require('pg');const admin=new Pool({connectionString:url.toString().replace('/flowlio_startup_test','/postgres')});
 try{if(!(await admin.query("select 1 from pg_database where datname='flowlio_startup_test'")).rowCount)await admin.query('create database flowlio_startup_test')}finally{await admin.end()}
 const database=new Pool({connectionString:url.toString()});
 try{await database.query('drop schema public cascade;create schema public;drop schema if exists flowlio_releases cascade;drop schema if exists drizzle cascade')}finally{await database.end()}
 const reserve=net.createServer();reserve.listen(0,'127.0.0.1');await once(reserve,'listening');const port=reserve.address().port;await new Promise(resolve=>reserve.close(resolve));
 const script=`require('./tests/ci-environment.cjs');process.env.CONNECTION_URL=process.env.STARTUP_TEST_DATABASE_URL;process.env.PORT='${port}';require('./dist/src/server.js')`;
 const child=spawn(process.execPath,['-e',script],{windowsHide:true,stdio:['ignore','pipe','pipe'],env:{...process.env,NODE_OPTIONS:''}});
 let output='';child.stdout.on('data',chunk=>{output+=chunk});child.stderr.on('data',chunk=>{output+=chunk});
 const exited=once(child,'exit');
 try{
  let ready=false;
  for(let count=0;count<150;count++){
   if(child.exitCode!==null)throw new Error('Compiled server exited: '+output.slice(-5000));
   try{const response=await fetch(`http://127.0.0.1:${port}/api/health`);if(response.ok){assert.equal((await response.json()).database,'connected');ready=true;break}}catch{}
   await delay(200);
  }
  assert.ok(ready,'Compiled server never became ready: '+output.slice(-5000));
  assert.equal((await fetch(`http://127.0.0.1:${port}/api/capacity?week=2026-09-21`)).status,401);
 }finally{if(child.exitCode===null)child.kill('SIGKILL');await exited;}
});

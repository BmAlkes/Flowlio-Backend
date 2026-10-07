const {test}=require("node:test");
const assert=require("node:assert/strict");
const {randomUUID}=require("node:crypto");
const {Pool}=require("pg");
const {claimLoginOtpSend}=require("../src/lib/otp-send-gate");
const url=process.env.TIMER_TEST_DATABASE_URL;
test("OTP cooldown is atomic across connections and permits explicit resend after expiry",{skip:!url},async()=>{
 const pool=new Pool({connectionString:url,max:5});
 const schema="otp_test_"+randomUUID().replaceAll("-","");
 try{
  await pool.query(`create schema ${schema}`);
  await pool.query(`create table ${schema}.verification(id text primary key,identifier text not null,value text not null,expires_at timestamp not null,created_at timestamp,updated_at timestamp)`);
  const db={query:(sql,args)=>pool.query(sql.replaceAll("verification",schema+".verification"),args)};
  const outcomes=await Promise.all(Array.from({length:12},()=>claimLoginOtpSend(db,"signed-challenge-a")));
  assert.equal(outcomes.filter(Boolean).length,1);
  assert.equal(await claimLoginOtpSend(db,"signed-challenge-b"),true);
  const rows=(await pool.query(`select * from ${schema}.verification`)).rows;
  assert.equal(rows.length,2);
  assert.ok(rows.every(row=>!JSON.stringify(row).includes("signed-challenge")));
  await pool.query(`update ${schema}.verification set expires_at=now()-interval '1 second'`);
  assert.equal(await claimLoginOtpSend(db,"signed-challenge-a"),true);
  assert.equal(await claimLoginOtpSend(db,"signed-challenge-a"),false);
 }finally{await pool.query(`drop schema if exists ${schema} cascade`);await pool.end();}
});

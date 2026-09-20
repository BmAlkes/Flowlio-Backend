const { test }=require("node:test");
const assert=require("node:assert/strict");
const {createObservability}=require("../src/modules/observability/store");
const {redactLog,releaseVersion}=require("../src/modules/observability/privacy");
test("structured logs redact credentials and common personal fields",()=>{
 const value=redactLog({email:"private@example.com",headers:{authorization:"Bearer secret"},nested:{password:"secret",message:"private@example.com token=secret"},error:new Error("Bearer secret password=secret")});
 const text=JSON.stringify(value); assert.ok(!text.includes("private@example.com"));assert.ok(!text.includes("secret"));
 assert.equal(releaseVersion("bad value with private data"),"unknown");
});
test("persistent events use an allowlist instead of exception messages and payloads",async()=>{
 let values; const store=createObservability({query:async(_sql,args)=>{values=args;return {rows:[]};}});
 await store.record({source:"ui",code:"UI_ERROR",route:"dashboard",correlationId:"11111111-1111-1111-1111-111111111111",release:"abc123",password:"DO_NOT_STORE",message:"DO_NOT_STORE",durationMs:-50});
 assert.ok(!JSON.stringify(values).includes("DO_NOT_STORE"));assert.equal(values[8],0);
});
test("metrics retry after storage failure and telemetry failure never escapes into business code",async()=>{
 let unavailable=true; const calls=[];
 const store=createObservability({query:async(sql,args)=>{if(unavailable)throw Error("db unavailable");calls.push({sql,args});return {rows:[]};}});
 store.metric("api","org",true,20);await store.flush();assert.equal(store.health().pending,1);
 assert.equal(await store.record({source:"api",code:"HTTP_SERVER_ERROR",route:"/all",correlationId:"bad"}),false);
 unavailable=false;await store.flush();assert.equal(store.health().pending,0);assert.deepEqual(calls[0].args.slice(3),[1,1,20,20]);
});
test("metric cardinality is bounded",()=>{
 const store=createObservability({query:async()=>({rows:[]})});
 for(let n=0;n<2001;n++)store.metric("api","org-"+n,false,1);
 assert.equal(store.health().pending,2000);assert.equal(store.health().dropped,1);
});

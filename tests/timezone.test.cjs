const {test}=require("node:test");
const assert=require("node:assert/strict");
const Module=require("node:module");
let writes=[],fail=false;
const original=Module._load;
Module._load=function(request,parent,main){
 if(request==="@/configs/connection.config")return {database:{update:()=>({set:value=>({where:async()=>{if(fail)throw Error("private database detail");writes.push(value);}})})}};
 if(request==="@/utils/logger.util")return {logger:{info(){},error(){}}};
 return original.call(this,request,parent,main);
};
const {updateUserTimezone}=require("../src/controllers/user/updateUserTimezone.controller");
Module._load=original;
async function invoke(body,user={id:"user-a"}){const res={code:200,status(n){this.code=n;return this},json(value){this.body=value;return this}};await updateUserTimezone({body,user},res);return res}
test("timezone accepts valid IANA zones and UTC only after authentication",async()=>{
 writes=[];assert.equal((await invoke({timezone:"UTC"},null)).code,401);assert.equal(writes.length,0);
 for(const timezone of ["UTC","Asia/Jerusalem","America/New_York"])assert.equal((await invoke({timezone})).code,200);
 assert.equal(writes.length,3);
});
test("malformed timezone values never reach persistence",async()=>{
 writes=[];for(const timezone of [null,[],{},12,""," ","invalid-zone","x".repeat(101)])assert.equal((await invoke({timezone})).code,400);
 assert.equal((await invoke(undefined)).code,400);assert.equal(writes.length,0);
});
test("storage failures do not expose internal error details",async()=>{
 fail=true;try {const res=await invoke({timezone:"UTC"});assert.equal(res.code,500);assert.ok(!JSON.stringify(res.body).includes("private"));}finally{fail=false}
});

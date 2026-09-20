const {test,before,after}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');const path=require('node:path');const express=require('express');
const core=require('../src/contracts/core-api');
const {registeredRoutes,assertCoreRoutes}=require('../scripts/check-core-routes.cjs');
const {apiErrorEnvelope,validateDomainStatus,contractResponse}=require('../src/middlewares/api-contract.middleware');
const root=path.resolve(__dirname,'..');
const project={id:'p',projectName:'Project',projectNumber:'P1',status:'active',progress:0,startDate:null,endDate:null,createdAt:new Date('2026-01-01Z'),updatedAt:new Date('2026-01-01Z')};
let server,origin,reached=0;
before(async()=>{
 const app=express();app.use(express.json());app.use(apiErrorEnvelope);
 app.post('/client',validateDomainStatus('client'),(req,res)=>{reached++;res.json(req.body);});
 app.post('/project',validateDomainStatus('project'),(req,res)=>{reached++;res.json(req.body);});
 app.get('/project',contractResponse(core.projectResponseSchema),(_req,res)=>res.json({success:true,data:project}));
 app.get('/broken',contractResponse(core.projectResponseSchema),(_req,res)=>res.json({success:true,data:{...project,status:'made-up',createdAt:'not a date',privateValue:'DO_NOT_LEAK'}}));
 app.get('/forbidden',(_req,res)=>res.status(403).json({error:'Access denied',code:'RESOURCE_FORBIDDEN'}));
 app.use(require('../src/routes/unknown.routes').default);
 server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));origin=`http://127.0.0.1:${server.address().port}`;
});
after(async()=>{await new Promise(resolve=>server.close(resolve));});
test('all 18 contracted method/path pairs exist in routers actually mounted by server',()=>{
 const routes=registeredRoutes(root);assert.equal(Object.keys(core.coreEndpoints).length,18);assertCoreRoutes(core.coreEndpoints,routes);
});
test('contract check detects a removed endpoint and a method mismatch',()=>{
 const routes=registeredRoutes(root);
 assert.throws(()=>assertCoreRoutes(core.coreEndpoints,routes.filter(r=>r.path!=='/projects/all')),/projectsList/);
 const wrong=routes.map(r=>r.path==='/projects/all'?{...r,method:'post'}:r);
 assert.throws(()=>assertCoreRoutes(core.coreEndpoints,wrong),/projectsList/);
});
test('removing a route from the actual source is detected, without importing server or opening database',()=>{
 const routes=registeredRoutes(root,file=>fs.readFileSync(file,'utf8').replace('router.get("/all",','router.post("/all",'));
 assert.throws(()=>assertCoreRoutes(core.coreEndpoints,routes),/projectsList/);
});
test('route parameters are encoded and missing identifiers cannot issue a request',()=>{
 assert.equal(core.corePath('projectDetail',{id:'a/b?c'}),'/projects/a%2Fb%3Fc');assert.throws(()=>core.corePath('projectDetail'),/Missing/);
});
test('unsupported statuses are rejected before a write handler; known aliases normalize',async()=>{
 for(const endpoint of ['client','project'])for(const status of ['invented',null,4,{}]){
  const before=reached;const res=await fetch(origin+'/'+endpoint,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({status})});
  assert.equal(res.status,400);assert.equal((await res.json()).code,'INVALID_STATUS');assert.equal(reached,before);
 }
 const res=await fetch(origin+'/project',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({status:'active'})});
 assert.equal((await res.json()).status,'ongoing');
});
test('read responses serialize Dates to ISO strings and normalize legacy status',async()=>{
 const res=await fetch(origin+'/project');assert.equal(res.status,200);const body=await res.json();
 assert.equal(body.data.status,'ongoing');assert.equal(body.data.createdAt,'2026-01-01T00:00:00.000Z');assert.equal(body.data.startDate,null);
});
test('malformed response returns a typed failure without disclosing the raw payload',async()=>{
 const res=await fetch(origin+'/broken');assert.equal(res.status,500);const body=await res.json();assert.equal(body.code,'API_RESPONSE_INVALID');assert.ok(!JSON.stringify(body).includes('DO_NOT_LEAK'));
});
test('error envelope preserves authorization codes and API misses return JSON 404 even without browser headers',async()=>{
 const forbidden=await (await fetch(origin+'/forbidden')).json();assert.equal(forbidden.code,'RESOURCE_FORBIDDEN');assert.equal(forbidden.message,'Access denied');assert.equal(forbidden.success,false);
 const missing=await fetch(origin+'/api/does-not-exist');assert.equal(missing.status,404);assert.equal((await missing.json()).code,'ENDPOINT_NOT_FOUND');
});
test('all client and proposal canonical statuses are accepted, unknown values and non-serialized dates rejected',()=>{
 for(const status of core.CLIENT_STATUSES)assert.equal(core.clientStatusSchema.parse(status),status);
 for(const status of core.PROPOSAL_STATUSES)assert.equal(core.proposalStatusSchema.parse(status),status);
 assert.equal(core.clientStatusSchema.parse('Project In Progress'),'Active');assert.equal(core.clientStatusSchema.parse('Lost'),'Churned');
 assert.throws(()=>core.projectStatusSchema.parse('cancelled'));assert.throws(()=>core.serializedDateSchema.parse(new Date()));assert.throws(()=>core.serializedDateSchema.parse('yesterday'));
});

const Module = require('node:module');
const {drizzle}=require('drizzle-orm/node-postgres');
const schema=require('../../src/schema/schema');
exports.load = pool => {
 const db=drizzle(pool,{schema,casing:'snake_case'});
 const original=Module._load;
 Module._load=function(id,...args){
  if(id.endsWith('configs/connection.config'))return {connection:pool,database:db};
  if(id.includes('utils/logger.util'))return {logger:{info(){},error(){},warn(){},debug(){}}};
  if(id.includes('utils/env.util'))return {env:{FRONTEND_DOMAIN:'https://example.test'}};
  if(id.includes('/email/transactional.service'))return {sendTransactionalEmail:async()=>{throw Error('External email must not run inside job');}};
  if(id.includes('utils/web-push.util'))return {sendPushToUser:async()=>{throw Error('External push must not run inside job');}};
  if(id.includes('weeklySummary.service'))return {checkOrgHasWeeklyActivity:async()=>false,generateWeeklySummary:async()=>{throw Error('No paid AI in tests');}};
  return original.call(this,id,...args);
 };
 try{
  const {RecurringInvoiceService}=require('../../src/services/recurringInvoice.service');
  const {automationService}=require('../../src/services/automation/automation.service');
  const {retryWebhookLog}=require('../../src/controllers/organization/webhooks/retryWebhook.controller');
  const {recordAutomationRun}=require('../../src/utils/automationRun.util');
  return {db,schema,RecurringInvoiceService,automationService,retryWebhookLog,recordAutomationRun};
 }finally{Module._load=original;}
};

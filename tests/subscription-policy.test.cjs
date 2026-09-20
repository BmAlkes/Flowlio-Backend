const { test } = require('node:test');
const assert = require('node:assert/strict');
const { addBillingPeriod, providerState, eventSubscriptionId } = require('../src/services/subscription-policy');
const now = new Date('2026-03-01T12:00:00Z');
const end = new Date('2026-03-01T00:00:00Z');
const snapshot = { id:'I-1', plan_id:'P-1', status:'ACTIVE', billing_info:{last_payment:{time:'2026-03-01T00:00:00Z'},next_billing_time:'2026-04-01T00:00:00Z'} };
test('calendar periods clamp month and leap-year ends without approximating days',()=>{
 assert.equal(addBillingPeriod(new Date('2024-01-31T15:45:00Z'),'monthly',1).toISOString(),'2024-02-29T15:45:00.000Z');
 assert.equal(addBillingPeriod(new Date('2024-02-29T15:45:00Z'),'yearly',1).toISOString(),'2025-02-28T15:45:00.000Z');
 assert.equal(addBillingPeriod(new Date('2024-01-31T15:45:00Z'),'monthly',2).toISOString(),'2024-03-31T15:45:00.000Z');
 assert.equal(addBillingPeriod(new Date('2024-02-28T15:45:00Z'),'days',2).toISOString(),'2024-03-01T15:45:00.000Z');
 assert.throws(()=>addBillingPeriod(now,'monthly',0));
});
test('successful renewal adopts provider date and repeated reconciliation never adds time',()=>{
 const first=providerState(snapshot,end,now);assert.equal(first.status,'active');
 assert.deepEqual(providerState(snapshot,first.end,now),first);
});
test('failed or missing payment never grants a future scheduled period',()=>{
 for(const billing of [{next_billing_time:snapshot.billing_info.next_billing_time},{...snapshot.billing_info,failed_payments_count:1},{...snapshot.billing_info,outstanding_balance:{value:'12.00'}}]){
  const result=providerState({...snapshot,billing_info:billing},end,now);assert.equal(result.status,'past_due');assert.deepEqual(result.end,end);
 }
});
test('cancellation preserves paid access then expires; suspension does not become cancellation',()=>{
 const paidEnd=new Date('2026-04-01T00:00:00Z');
 assert.deepEqual(providerState({...snapshot,status:'CANCELLED'},paidEnd,now),{status:'active',end:paidEnd,cancel:true});
 assert.equal(providerState({...snapshot,status:'CANCELLED'},end,now).status,'cancelled');
 assert.equal(providerState({...snapshot,status:'SUSPENDED'},paidEnd,now).status,'past_due');
 assert.equal(providerState({...snapshot,status:'EXPIRED'},end,now).status,'expired');
 assert.throws(()=>providerState({...snapshot,status:'UNKNOWN'},end,now));
});
test('sale notifications identify the agreement, never the sale itself',()=>{
 assert.equal(eventSubscriptionId({event_type:'PAYMENT.SALE.COMPLETED',resource:{id:'SALE',billing_agreement_id:'I-1'}}),'I-1');
 assert.equal(eventSubscriptionId({event_type:'BILLING.SUBSCRIPTION.PAYMENT.FAILED',resource:{id:'I-1'}}),'I-1');
 assert.equal(eventSubscriptionId({event_type:'PAYMENT.SALE.COMPLETED',resource:{id:'ONE-OFF'}}),undefined);
});

test('a later scheduled charge cannot reuse the payment from the previous period',()=>{
 const result=providerState(snapshot,end,now,snapshot.billing_info.last_payment.time);
 assert.equal(result.status,'past_due');assert.deepEqual(result.end,end);
});

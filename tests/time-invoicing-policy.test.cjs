const {test}=require('node:test');
const assert=require('node:assert/strict');
const {priceTime,formatCents,timeInvoiceSchema}=require('../src/services/time-invoicing-policy');
const {isInvoicedTimeConstraint}=require('../src/utils/invoiced-time-error.util');
test('billing rounds each line in cents and uses fallback only for missing rates',()=>{
 assert.equal(priceTime(1,'0.30').amount,'0.01');
 assert.equal(priceTime(90,'12.35','900').amount,'18.53');
 assert.equal(priceTime(30,null,'40').amount,'20.00');
 assert.equal(formatCents(priceTime(1,'0.30').amountCents*2n),'0.02');
 assert.equal(priceTime(60,'99999999.99').amount,'99999999.99');
});
test('invalid and overflowing rates do not become billable amounts',()=>{
 for(const rate of ['0','-1','1.005','1e2','100000000']) assert.throws(()=>priceTime(60,rate));
 assert.throws(()=>priceTime(60,null)); assert.throws(()=>priceTime(120,'99999999.99'));
 assert.throws(()=>priceTime(0,'10')); assert.throws(()=>priceTime(1.5,'10'));
});
test('only billing foreign-key errors are recognized through driver wrappers',()=>{
 assert.equal(isInvoicedTimeConstraint({cause:{code:'23503',constraint:'invoice_time_items_time_entry_id_fkey'}}),true);
 assert.equal(isInvoicedTimeConstraint({code:'23503',constraint:'other_fk'}),false);
 assert.equal(isInvoicedTimeConstraint(null),false);
});

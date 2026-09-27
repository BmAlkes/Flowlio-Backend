const {test}=require('node:test');const assert=require('node:assert/strict');
const {proposalCurrency,invoiceCurrency}=require('../src/utils/financial-currency');
const {timeInvoiceSchema}=require('../src/services/time-invoicing-policy');
test('proposal currency requires an explicit, unambiguous denomination',()=>{
 for(const [totalBudget,expected] of [['₪4,000','ILS'],['€4,000','EUR'],['4000 USD','USD'],['$4,000',null],['4000 ILS / USD',null]])assert.equal(proposalCurrency({investment:{totalBudget}}),expected);
 assert.throws(()=>invoiceCurrency(undefined),/Currency not configured/);assert.throws(()=>invoiceCurrency('JPY'),/two decimal/);
});
test('malformed currencies are validation errors, never server exceptions',()=>{
 for(const currencyCode of ['','not-a-currency','XYZ','JPY'])assert.equal(timeInvoiceSchema.safeParse({clientId:'client',start:'2026-09-01T00:00:00Z',end:'2026-10-01T00:00:00Z',requestKey:'11111111-1111-4111-8111-111111111111',currencyCode,entries:[{id:'e',version:'a'.repeat(64)}]}).success,false);
});

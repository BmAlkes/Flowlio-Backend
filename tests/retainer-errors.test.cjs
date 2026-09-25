const {test}=require('node:test'),assert=require('node:assert/strict');
const {retainerConstraint}=require('../src/utils/retainer-error.util');
test('contract guards map nested database failures without misclassifying unrelated constraints',()=>{
 assert.equal(retainerConstraint({cause:{code:'23503',constraint:'invoice_time_items_time_entry_id_retainer'}}),'time');
 assert.equal(retainerConstraint({cause:{code:'23514',message:'Recurring terms belong to a contract'}}),'recurring');
 assert.equal(retainerConstraint({code:'23503',constraint:'invoice_time_items_time_entry_id'}),null);
 assert.equal(retainerConstraint({code:'23514',message:'Other constraint'}),null);
 const self={};self.cause=self;assert.equal(retainerConstraint(self),null);
});

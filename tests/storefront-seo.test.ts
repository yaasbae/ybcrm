import test from 'node:test';import assert from 'node:assert/strict';
import {emptySeo,seoFields,seoTargets,publicSeoEntries,nextSeoRecord,seoIssues,resolvedSeo,productSeoSchema} from '../src/lib/storefrontSeo.ts';
const product={id:'123',name:'Костюм ISIDA',color:'розовый',price:19900,photos:['https://example.invalid/photo.jpg'],availability:'unknown'};
test('drafts never enter public output and published entries have only allowed fields',()=>{
 const p={...emptySeo,title:'Опубликовано',focusQuery:'internal query'};
 const out=publicSeoEntries({secret:'private',entries:{home:{draft:{...p,title:'secret draft'},published:p,history:[{at:'now',fields:p}],managerEmail:'private'},catalog:{draft:p},'../../account':{published:p}}});
 assert.deepEqual(Object.keys(out),['home']);assert.equal(out.home.title,'Опубликовано');assert.equal(out.home.focusQuery,'');assert.equal(JSON.stringify(out).includes('secret'),false);assert.equal('history' in out.home,false);
});
test('saving draft preserves live SEO; publishing maintains bounded rollback history and conflicts',()=>{
 const a={...emptySeo,title:'A'},b={...emptySeo,title:'B'};
 const first=nextSeoRecord(undefined,a,0,true,'one'),draft=nextSeoRecord(first,b,1,false,'two');
 assert.equal(draft.published.title,'A');assert.equal(draft.draft.title,'B');
 let current=nextSeoRecord(draft,b,2,true,'three');assert.equal(current.history[0].fields.title,'A');
 assert.throws(()=>nextSeoRecord(current,a,2,true,'bad'),/SEO_CONFLICT/);
 for(let i=0;i<5;i++)current=nextSeoRecord(current,a,current.revision,true,String(i));assert.equal(current.history.length,3);
 assert.throws(()=>nextSeoRecord(current,{...a,title:'x'.repeat(181)},current.revision,false,'now'));
});
test('safe canonical targets, useful defaults and duplicate feedback',()=>{
 const targets=seoTargets([product,{...product,id:'../bad'}]);assert.equal(targets.length,4);const target=targets[3];assert.equal(target.path,'/product/?id=123');assert.match(resolvedSeo(target).title,/розовый/);
 assert.ok(seoIssues(target,{...emptySeo,title:'Same'},['Same','Same']).some(v=>v.includes('повторяется')));
 assert.equal(seoFields({title:' hi ',noindex:'false',body:{unsafe:true}}).noindex,false);
});
test('product markup uses real price and never invents availability or reviews',()=>{
 const target=seoTargets([product])[3],fields=resolvedSeo(target),schema=productSeoSchema(product,fields,'https://yaasbae.store/product/?id=123');
 assert.equal((schema.offers as any).price,19900);assert.equal('availability' in (schema.offers as any),false);assert.equal('aggregateRating' in schema,false);
 const made=productSeoSchema({...product,availability:'made_to_order'},fields,'url');assert.equal((made.offers as any).availability,'https://schema.org/PreOrder');
});

import {seoRecords} from '../src/lib/storefrontSeo.ts';
test('private records normalize and hidden products never enter public SEO',()=>{
 const fields={...emptySeo,title:'Visible'};
 const doc={entries:{product_123:{revision:1,draft:fields,published:fields},product_hidden:{revision:2,draft:fields,published:fields}}};
 assert.equal(seoRecords(doc).product_123.revision,1);
 assert.deepEqual(Object.keys(publicSeoEntries(doc,[product])),['product_123']);
});

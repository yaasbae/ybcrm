import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash, randomUUID} from 'node:crypto';
import vm from 'node:vm';
import ts from 'typescript';
import {normalizeStorefrontCheckout, checkoutQuoteMatches, storefrontSignature, verifyStorefrontSignature} from '../src/lib/storefrontCheckout.ts';
import {sanitizeStorefrontProduct, isStorefrontSizeAvailable} from '../src/lib/storefrontCommerce.ts';
import {classifyCheckoutClaim} from '../src/lib/storefrontCheckoutClaim.ts';

// Execute the production route itself, without starting the monolithic server.
// Only persistence and external services are replaced. No production credentials,
// network, payments, Telegram messages or CDEK shipments are used by these tests.
const source=readFileSync(new URL('../server.ts',import.meta.url),'utf8');
const start=source.indexOf('app.post("/api/storefront/checkout",');
const end=source.indexOf('\napp.post(',start+1);
assert.ok(start>=0&&end>start,'Production checkout handler must be present');
const code=ts.transpileModule(source.slice(start,end),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText;
const secret='local-integration-test-secret-not-for-production';
const product={name:'TEST SITE ORDER DO NOT FULFILL',sellingPrice:19900,photos:['https://example.invalid/test.jpg'],sizeGrid:'Over',color:'test'};
const payload=(method:'tochka'|'split'='tochka')=>({
 cart:[{productId:'test-product',quantity:1,size:'Over',fit:''}],
 customer:{name:'TEST SITE ORDER',phone:'70000000000',email:'checkout-test@example.invalid'},
 delivery:{cityCode:44,city:'TEST CITY',pointCode:'TEST-PVZ',pointAddress:'TEST ADDRESS',tariffCode:136},
 paymentMethod:method,expectedTotal:20260,
});

function harness(options:{paymentFails?:boolean;deliveryFails?:boolean}={}){
 const documents=new Map<string,any>();
 documents.set('products/test-product',product);
 const operations:string[]=[];
 const audits:any[]=[];
 let handler:(req:any,res:any)=>Promise<unknown>;
 let transactionTail=Promise.resolve();
 const snapshot=(key:string)=>({id:key.split('/').at(-1),exists:documents.has(key),data:()=>documents.get(key)});
 const ref=(key:string)=>({key,get:async()=>snapshot(key),create:async(value:any)=>{assert.ok(!documents.has(key));documents.set(key,value);},set:async(value:any)=>{documents.set(key,{...documents.get(key),...value});}});
 const adminDb={collection:(name:string)=>({doc:(id:string)=>ref(`${name}/${id}`)}),runTransaction:(callback:any)=>{
  const result=transactionTail.then(()=>callback({get:async(r:any)=>snapshot(r.key),create:(r:any,value:any)=>{assert.ok(!documents.has(r.key));documents.set(r.key,value);}}));
  transactionTail=result.then(()=>undefined,()=>undefined);return result;
 }};
 const context={
  app:{post:(_path:string,fn:any)=>{handler=fn;}},
  storefrontCheckoutRateWindows:new Map(),STOREFRONT_SHARED_SECRET:secret,
  isTrustedStorefrontServiceRequest:(req:any)=>verifyStorefrontSignature({secret,timestamp:req.headers['x-storefront-timestamp'],requestId:req.headers['x-storefront-request-id'],signature:req.headers['x-storefront-signature'],payload:req.body}),
  normalizeStorefrontCheckout,classifyCheckoutClaim,createHash,adminDb,sanitizeStorefrontProduct,isStorefrontSizeAvailable,checkoutQuoteMatches,
  getCdekToken:async()=> 'local-fixture-token',getCdekSettings:async()=>({baseUrl:'https://example.invalid',senderCityCode:44}),
  axios:{get:async()=>({data:[{code:'TEST-PVZ',location:{city_code:44,address:'TEST ADDRESS'}}]}),post:async()=>({data:{tariff_codes:[{tariff_code:136,delivery_sum:360}]}})},
  FieldValue:{serverTimestamp:()=> 'test-timestamp'},
  getOrderSnapshot:async(id:string)=>snapshot(`orders_new/${id}`),
  writeAuditLog:async(value:any)=>{audits.push(value);},dispatchPushEvent:async()=>{},sendNewOrderToTelegram:async()=>{},
  executeStorefrontOperation:async(path:string,body:any)=>{
   operations.push(path);
   if(path==='/api/cdek/create-order'){
    if(options.deliveryFails)throw new Error('TEST DELIVERY FAILURE');
    return {data:{cdekNumber:'TEST-NOT-A-REAL-SHIPMENT'}};
   }
   if(options.paymentFails)throw new Error('TEST PAYMENT FAILURE');
   return {data:{paymentUrl:`https://example.invalid/payment/${body.orderId}`}};
  },console:{error:()=>{},warn:()=>{}},
 };
 vm.runInNewContext(code,context,{timeout:1000});
 async function submit(body:any,id=randomUUID(),validSignature=true){
  const timestamp=String(Date.now());
  const response={code:200,body:null as any,status(code:number){this.code=code;return this;},json(body:any){this.body=body;return this;}};
  await handler!({ip:'127.0.0.1',body,headers:{'x-storefront-request-id':id,'x-storefront-timestamp':timestamp,'x-storefront-signature':validSignature?storefrontSignature(secret,timestamp,id,body):'0'.repeat(64)}},response);
  return response;
 }
 const orders=()=>[...documents.entries()].filter(([key])=>key.startsWith('orders_new/')).map(([,value])=>value);
 return {submit,orders,operations,audits};
}

for(const method of ['tochka','split'] as const)test(`site checkout creates an unpaid CRM order with correct items and source: ${method}`,async()=>{
 const h=harness();const result=await h.submit(payload(method));
 assert.equal(result.code,200);assert.equal(h.orders().length,1);
 const order=h.orders()[0];assert.equal(order.orderId,result.body.orderId);
 assert.equal(order.status,'Новый');assert.equal(order.source,'Сайт yaasbae.store');assert.equal(order.createdBy,'storefront');
 assert.equal(order.paidAmount,0);assert.equal(order.revenue,19900);assert.equal(order.deliveryPrice,360);assert.equal(order.totalAmount,20260);
 assert.equal(order.clientName,'TEST SITE ORDER');assert.equal(order.itemSizes[0],'Over');assert.equal(order.itemQuantities[0],1);assert.equal(order.itemProductIds[0],'test-product');
 assert.equal(order.paymentProvider,method==='split'?'yandex_split':'tochka');assert.equal(h.audits[0].entityId,order.orderId);
 assert.deepEqual(h.operations,['/api/cdek/create-order',method==='split'?'/api/yandex-pay/create-payment':'/api/tochka/create-payment']);
});

test('repeated and simultaneous submissions create one order and do not reset its payment or status',async()=>{
 const h=harness(),id=randomUUID(),body=payload();
 const results=await Promise.all([h.submit(body,id),h.submit(body,id)]);
 const success=results.find(r=>r.code===200)!;assert.ok(success);assert.equal(h.orders().length,1);assert.equal(h.operations.length,2);
 const order=h.orders()[0];order.paidAmount=100;order.status='TEST UPDATED STATUS';
 const retry=await h.submit(body,id);assert.equal(retry.code,200);assert.equal(retry.body.orderId,success.body.orderId);assert.equal(retry.body.existing,true);
 assert.equal(h.operations.length,2);assert.equal(order.paidAmount,100);assert.equal(order.status,'TEST UPDATED STATUS');
 const conflict=await h.submit({...body,expectedTotal:20261},id);assert.equal(conflict.code,409);assert.equal(h.orders().length,1);
});

for(const failure of ['paymentFails','deliveryFails'] as const)test(`a ${failure} does not lose the CRM order or repeat external operations`,async()=>{
 const h=harness({[failure]:true}),id=randomUUID(),body=payload();
 const first=await h.submit(body,id);assert.equal(first.code,500);assert.equal(h.orders().length,1);assert.equal(h.orders()[0].paidAmount,0);
 const attempts=h.operations.length;const retry=await h.submit(body,id);assert.equal(retry.code,409);assert.equal(h.orders().length,1);assert.equal(h.operations.length,attempts);
});

test('invalid signatures, changed quotes and unavailable sizes cannot create CRM orders',async()=>{
 const h=harness();assert.equal((await h.submit(payload(),randomUUID(),false)).code,401);
 assert.equal((await h.submit({...payload(),expectedTotal:1})).code,409);
 assert.equal((await h.submit({...payload(),cart:[{productId:'test-product',quantity:1,size:'XS'}]})).code,409);
 assert.equal(h.orders().length,0);assert.equal(h.operations.length,0);
});

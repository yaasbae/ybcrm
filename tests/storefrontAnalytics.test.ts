import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {createHash,randomUUID} from 'node:crypto';
import ts from 'typescript';
import {validCheckoutProof,purchaseReceipt} from '../src/lib/storefrontAnalytics.ts';
import {storefrontSignature,verifyStorefrontSignature} from '../src/lib/storefrontCheckout.ts';
import {siteIntegrations,checkoutAttribution} from '../src/lib/storefrontIntegrations.ts';
const id='WEB-ABCDEF123456',now=Date.now();
const order={orderId:id,createdBy:'storefront',totalAmount:20260,paidAmount:20260,deliveryPrice:360,itemProductIds:['p1'],itemQuantities:[2],itemPrices:[19900],clientName:'PRIVATE NAME',clientEmail:'private@example.invalid',clientPhone:'70000000000',paymentId:'private-payment'};
test('only full payment and a recent site order produce a minimal conversion receipt',()=>{
 assert.deepEqual(purchaseReceipt(id,now, {...order,paidAmount:100},now),{paid:false});
 assert.deepEqual(purchaseReceipt(id,now, {...order,paidAmount:0},now),{paid:false});
 assert.equal(purchaseReceipt(id,now-8*86400000,order,now),null);
 assert.equal(purchaseReceipt(id,now,{...order,createdBy:'employee'},now),null);
 const receipt=purchaseReceipt(id,now,order,now)!;assert.equal(receipt.paid,true);
 assert.equal(JSON.stringify(receipt).includes('PRIVATE'),false);assert.equal(JSON.stringify(receipt).includes('private'),false);
 assert.equal((receipt as any).items[0].price,9950);assert.equal((receipt as any).shipping,360);
});
test('only safe counter IDs and non-personal attribution fields are public',()=>{
 const config=siteIntegrations({metrikaId:'12345678',ga4Id:'G-ABC1234567',apiSecret:'private',googleVerification:'<script>'});
 assert.equal('apiSecret' in config,false);assert.equal(config.googleVerification,'');
 assert.deepEqual(checkoutAttribution({source:'chatgpt',landingPath:'/catalog/?phone=private',referrer:'https://chatgpt.com/private?token=secret',email:'private'}),{source:'chatgpt',referrer:'https://chatgpt.com',landingPath:'/catalog/'});
});
test('confirmation route rejects forged requests and cannot look up another order by client-supplied ID',async()=>{
 const source=readFileSync(new URL('../server.ts',import.meta.url),'utf8');
 const start=source.indexOf('const analyticsReceiptRates='),end=source.indexOf('app.post("/api/storefront/checkout",',start);
 assert.ok(start>0&&end>start);let handler:any;const secret='local-analytics-fixture-secret',proof=randomUUID();
 const hash=createHash('sha256').update(proof).digest('hex'),ownId=`WEB-${hash.slice(0,12).toUpperCase()}`;
 let reads=0;
 const documents=new Map<string,any>([[`storefront_checkout_requests/${hash}`,{orderId:ownId,createdAt:{toMillis:()=>now}}],[`orders_new/${ownId}`,{...order,orderId:ownId}]]);
 vm.runInNewContext(ts.transpileModule(source.slice(start,end),{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText,{app:{post:(_path:string,fn:any)=>{handler=fn;}},createHash,validCheckoutProof,purchaseReceipt,adminDb:{collection:(name:string)=>({doc:(key:string)=>({get:async()=>{reads++;const value=documents.get(name+'/'+key);return {exists:Boolean(value),data:()=>value};}})})},isTrustedStorefrontServiceRequest:(req:any)=>verifyStorefrontSignature({secret,timestamp:req.headers['x-storefront-timestamp'],requestId:req.headers['x-storefront-request-id'],signature:req.headers['x-storefront-signature'],payload:req.body})});
 async function request(value:any,signed=true){const timestamp=String(Date.now()),requestId=value.checkoutId||randomUUID(),res={code:200,data:null as any,setHeader:()=>{},status(n:number){this.code=n;return this;},json(v:any){this.data=v;return this;}};await handler({ip:'test',body:value,headers:{'x-storefront-request-id':requestId,'x-storefront-timestamp':timestamp,'x-storefront-signature':signed?storefrontSignature(secret,timestamp,requestId,value):'0'.repeat(64)}},res);return res;}
 assert.equal((await request({checkoutId:proof},false)).code,401);assert.equal(reads,0);
 assert.equal((await request({checkoutId:'invalid-proof-value'})).code,400);assert.equal(reads,0);
 assert.equal((await request({checkoutId:randomUUID()})).code,404);
 const result=await request({checkoutId:proof,orderId:'OTHER-CUSTOMER',paid:true});
 assert.equal(result.code,200);assert.equal(result.data.transactionId,ownId);assert.equal(JSON.stringify(result.data).includes('private'),false);
 documents.get(`orders_new/${ownId}`).paidAmount=0;
 const unpaid=await request({checkoutId:proof,paid:true});assert.equal(unpaid.code,200);assert.equal(unpaid.data.paid,false);
});

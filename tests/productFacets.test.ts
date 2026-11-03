import test from 'node:test';
import assert from 'node:assert/strict';
import {sanitizeStorefrontProduct} from '../src/lib/storefrontCommerce.ts';
import {facetValues} from '../src/lib/productFacets.ts';
test('CRM public product carries filter attributes but no internal fields; selling price stays authoritative',()=>{
 const product=sanitizeStorefrontProduct('p',{name:'Костюм',sellingPrice:19900,oldPrice:21900,height:'160–165',modelName:'ISIDA',productLength:'mini',isNew:true,photos:['https://example.invalid/p.webp'],materials:[{id:'insulation',name:'Утеплитель',composition:'Без утеплителя',supplierSecret:'private'}]} as any)!;
 assert.equal(product.price,19900);assert.equal(product.oldPrice,21900);assert.equal(product.modelName,'ISIDA');assert.equal(product.height,'160–165');assert.equal(product.productLength,'mini');assert.equal(product.isNew,true);
 assert.deepEqual(facetValues(product,'insulation'),['Без утеплителя']);assert.ok(!JSON.stringify(product).includes('supplierSecret'));
 assert.equal(sanitizeStorefrontProduct('p',{name:'A',sellingPrice:100,photos:['https://example.invalid/p'],isNew:'true',productLength:'whatever',oldPrice:Infinity} as any)?.isNew,false);
});

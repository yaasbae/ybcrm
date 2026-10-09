import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeStorefrontCheckout,
  stableJson,
  storefrontSignature,
  verifyStorefrontSignature,
} from '../src/lib/storefrontCheckout.ts';

test('stable JSON and HMAC do not depend on object key order', () => {
  const first = { customer: { phone: '79990000000', name: 'Анна' }, cart: [{ productId: 'p1', quantity: 1 }] };
  const second = { cart: [{ quantity: 1, productId: 'p1' }], customer: { name: 'Анна', phone: '79990000000' } };
  assert.equal(stableJson(first), stableJson(second));
  assert.equal(storefrontSignature('secret', '1720000000000', 'request-12345678', first), storefrontSignature('secret', '1720000000000', 'request-12345678', second));
});

test('signature rejects stale or changed checkout requests', () => {
  const payload = { cart: [{ productId: 'p1', quantity: 1 }] };
  const timestamp = '1720000000000';
  const signature = storefrontSignature('secret', timestamp, 'request-12345678', payload);
  assert.equal(verifyStorefrontSignature({ secret: 'secret', timestamp, requestId: 'request-12345678', signature, payload, now: 1720000000000 }), true);
  assert.equal(verifyStorefrontSignature({ secret: 'secret', timestamp, requestId: 'request-12345678', signature, payload: { cart: [] }, now: 1720000000000 }), false);
  assert.equal(verifyStorefrontSignature({ secret: 'secret', timestamp, requestId: 'request-12345678', signature, payload, now: 1720001000000 }), false);
});

test('checkout data is normalized and validated', () => {
  const result = normalizeStorefrontCheckout({
    cart: [{ productId: ' p1 ', quantity: 2, size: ' M ' }],
    customer: { name: ' Анна  Иванова ', phone: '8 999 123-45-67', email: 'TEST@EXAMPLE.RU' },
    delivery: { cityCode: 44, city: 'Москва', pointCode: 'MSK1', pointAddress: 'Тверская', tariffCode: 136 },
    paymentMethod: 'tochka',
  });
  assert.deepEqual(result.value, {
    cart: [{ productId: 'p1', quantity: 2, size: 'M', fit: '' }],
    customer: { name: 'Анна Иванова', phone: '79991234567', email: 'test@example.ru' },
    delivery: { cityCode: 44, city: 'Москва', pointCode: 'MSK1', pointAddress: 'Тверская', tariffCode: 136 },
    paymentMethod: 'tochka',
  });
  assert.equal(normalizeStorefrontCheckout({}).error, 'Корзина пуста');
});

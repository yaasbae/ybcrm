import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeStorefrontCheckout,
  checkoutQuoteMatches,
  stableJson,
  storefrontSignature,
  verifyStorefrontSignature,
} from '../src/lib/storefrontCheckout.ts';

test('changed price or shipping cannot silently redirect to a different payable amount', () => {
  assert.equal(checkoutQuoteMatches(20260, 20260), true);
  assert.equal(checkoutQuoteMatches(20260, 20360), false);
  assert.equal(checkoutQuoteMatches(100.10, 100.1), true);
  assert.equal(checkoutQuoteMatches(100, Infinity), false);
  assert.equal(checkoutQuoteMatches(undefined, 100), true);
});

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

test('checkout never silently drops, truncates or changes malformed cart lines', () => {
  const validLine = { productId: 'p1', quantity: 1 };
  const invalid = [
    [validLine, null], [validLine, { productId: '', quantity: 1 }],
    [{ productId: 'products/p1', quantity: 1 }],
    ...[0, -1, 1.5, 21, Infinity, NaN, '2', undefined].map(quantity => [{ productId: 'p1', quantity }]),
    Array.from({ length: 31 }, () => validLine),
    [{ ...validLine, size: { unexpected: true } }],
    [{ ...validLine, fit: 'x'.repeat(61) }],
  ];
  for (const cart of invalid) {
    const result = normalizeStorefrontCheckout({ cart });
    assert.equal(result.value, undefined);
    assert.match(result.error || '', /Некорректный состав корзины/);
  }
});

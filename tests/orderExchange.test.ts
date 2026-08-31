import test from 'node:test';
import assert from 'node:assert/strict';
import { getExchangeOrderId } from '../src/lib/orderExchange.ts';

test('replaces the C suffix with E for an exchange', () => {
  assert.equal(getExchangeOrderId('69-07C'), '69-07E');
  assert.equal(getExchangeOrderId('69-07c'), '69-07E');
});
test('adds E once when an order has no C suffix', () => {
  assert.equal(getExchangeOrderId('69-07'), '69-07E');
  assert.equal(getExchangeOrderId('69-07E'), '69-07E');
});

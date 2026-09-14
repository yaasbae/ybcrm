import assert from 'node:assert/strict';
import test from 'node:test';
import { getOrderCreationMode } from '../src/lib/orderCreation.ts';

test('creates an order when the number has never been used', () => {
  assert.equal(getOrderCreationMode(null), 'create');
});

test('allows a deleted order number to be used again', () => {
  assert.equal(getOrderCreationMode({ deleted: true, orderId: '6984С' }), 'reuse_deleted');
});

test('does not overwrite an active order', () => {
  assert.equal(getOrderCreationMode({ deleted: false, orderId: '6986С' }), 'conflict');
  assert.equal(getOrderCreationMode({ orderId: '6986С' }), 'conflict');
});

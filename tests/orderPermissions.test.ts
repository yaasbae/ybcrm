import test from 'node:test';
import assert from 'node:assert/strict';

import { ALL_ORDER_ACTIONS, getOrderActionForField, resolveOrderActions } from '../src/lib/orderPermissionConfig';

test('defines the complete order action catalog', () => {
  assert.deepEqual(ALL_ORDER_ACTIONS, [
    'create', 'edit', 'status', 'exchange', 'payments', 'refund', 'cdek', 'delete', 'export',
  ]);
});

test('denies order actions until the owner explicitly configures them', () => {
  assert.deepEqual(resolveOrderActions(['create'], undefined), []);
  assert.deepEqual(resolveOrderActions([], false), []);
  assert.deepEqual(resolveOrderActions(['create', 'payments'], true), ['create', 'payments']);
});

test('maps order fields to the permission that controls them', () => {
  assert.equal(getOrderActionForField('clientName', 'Клиент'), 'edit');
  assert.equal(getOrderActionForField('status', 'Готов'), 'status');
  assert.equal(getOrderActionForField('status', 'Обмен'), 'exchange');
  assert.equal(getOrderActionForField('isShipped', true), 'status');
  assert.equal(getOrderActionForField('paymentStatus', 'paid'), 'payments');
  assert.equal(getOrderActionForField('finalPaymentAmount', 1000), 'payments');
  assert.equal(getOrderActionForField('cdekNumber', '123'), 'cdek');
});

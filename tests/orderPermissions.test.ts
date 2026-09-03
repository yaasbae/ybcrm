import test from 'node:test';
import assert from 'node:assert/strict';

import { ALL_ORDER_ACTIONS, getOrderActionForField, resolveOrderActions } from '../src/lib/orderPermissionConfig';

test('keeps existing accounts compatible with every order action', () => {
  assert.deepEqual(ALL_ORDER_ACTIONS, [
    'create', 'edit', 'status', 'exchange', 'payments', 'refund', 'cdek', 'delete', 'export',
  ]);
});

test('does not enforce order permissions until the owner explicitly configures them', () => {
  assert.deepEqual(resolveOrderActions(['create'], undefined), ALL_ORDER_ACTIONS);
  assert.deepEqual(resolveOrderActions([], false), ALL_ORDER_ACTIONS);
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

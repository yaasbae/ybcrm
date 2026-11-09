import test from 'node:test';
import assert from 'node:assert/strict';
import { isOrderPinnedAtTop, isPendingExchangeOrder } from '../src/lib/orderListPriority';

test('only an exchange waiting for shipment receives exchange priority', () => {
  assert.equal(isPendingExchangeOrder({ status: 'Обмен', exchangeAt: '2026-11-09T10:00:00Z' }), true);
  assert.equal(isPendingExchangeOrder({ status: 'Обмен', exchangeAt: '2026-11-09T10:00:00Z', isShipped: true }), false);
  assert.equal(isPendingExchangeOrder({ status: 'Получен', exchangeAt: '2026-11-09T10:00:00Z', isShipped: true }), false);
});

test('a completed exchange does not stay at the top because of an old pin', () => {
  assert.equal(isOrderPinnedAtTop({ status: 'Получен', exchangeOriginalOrderId: '7000C', isPinned: true, isShipped: true }), false);
  assert.equal(isOrderPinnedAtTop({ status: 'Обмен', exchangeOriginalOrderId: '7000C' }), true);
  assert.equal(isOrderPinnedAtTop({ status: 'Новый', isPinned: true }), true);
});

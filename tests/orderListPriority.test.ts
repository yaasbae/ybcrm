import test from 'node:test';
import assert from 'node:assert/strict';
import { compareOrdersForList, isOrderPinnedAtTop, isPendingExchangeOrder } from '../src/lib/orderListPriority';

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

test('shipped exchanges return to the common list ordered by order date', () => {
  const orders = [
    { status: 'В пути', exchangeAt: '2026-11-12T10:00:00Z', date: new Date('2026-09-22'), isShipped: true },
    { status: 'Новый', date: new Date('2026-11-10') },
    { status: 'Получен', exchangeOriginalOrderId: '7000C', date: new Date('2026-09-14'), isShipped: true },
    { status: 'Обмен', exchangeAt: '2026-11-11T10:00:00Z', date: new Date('2026-09-27') },
    { status: 'Отгружен', exchangeAt: '2026-11-12T11:00:00Z', date: new Date('2026-10-21'), isShipped: true },
  ];

  orders.sort(compareOrdersForList);

  assert.deepEqual(orders.map(order => order.status), [
    'Обмен',
    'Новый',
    'Отгружен',
    'В пути',
    'Получен',
  ]);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { buildExchangeStartPatch, getExchangeOrderId } from '../src/lib/orderExchange.ts';

test('replaces the C suffix with E for an exchange', () => {
  assert.equal(getExchangeOrderId('69-07C'), '69-07E');
  assert.equal(getExchangeOrderId('69-07c'), '69-07E');
});
test('adds E once when an order has no C suffix', () => {
  assert.equal(getExchangeOrderId('69-07'), '69-07E');
  assert.equal(getExchangeOrderId('69-07E'), '69-07E');
});

test('starts exchange in the same CRM record and resets shipped state', () => {
  const patch = buildExchangeStartPatch({
    orderId: '7051C',
    status: 'В пути',
    items: ['Бомбер FLAME'],
    itemPrices: [19_900],
    itemColors: ['Тёмный хаки'],
    itemSizes: ['OVER 200'],
    cdekUuid: 'old-cdek-uuid',
    cdekNumber: '10347285410',
    cdekStatus: 'IN_TRANSIT',
  }, '2026-11-12T10:00:00.000Z');

  assert.equal(patch.orderId, '7051E');
  assert.equal(patch.exchangeOriginalOrderId, '7051C');
  assert.equal(patch.status, 'Обмен');
  assert.equal(patch.isShipped, false);
  assert.equal(patch.exchangeCdekStatus, 'pending');
  assert.deepEqual(patch.exchangeHistory[0], {
    orderId: '7051C',
    status: 'В пути',
    items: ['Бомбер FLAME'],
    itemPrices: [19_900],
    itemColors: ['Тёмный хаки'],
    itemSizes: ['OVER 200'],
    itemHeights: [],
    cdekUuid: 'old-cdek-uuid',
    cdekNumber: '10347285410',
    cdekStatus: 'IN_TRANSIT',
    archivedAt: '2026-11-12T10:00:00.000Z',
  });
});

test('keeps only ten latest exchange history entries', () => {
  const exchangeHistory = Array.from({ length: 12 }, (_, index) => ({ marker: index }));
  const patch = buildExchangeStartPatch({
    orderId: '7051E',
    status: 'Получен',
    exchangeOriginalOrderId: '7051C',
    exchangeHistory,
  }, '2026-11-12T11:00:00.000Z');

  assert.equal(patch.orderId, '7051E');
  assert.equal(patch.exchangeOriginalOrderId, '7051C');
  assert.equal(patch.exchangeHistory.length, 10);
  assert.deepEqual(patch.exchangeHistory[0], { marker: 3 });
});

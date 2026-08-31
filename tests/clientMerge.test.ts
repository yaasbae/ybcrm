import assert from 'node:assert/strict';
import test from 'node:test';

import {
  clientMatchesOrder,
  formatClientPhone,
  getClientPurchaseSummary,
  getPurchaseAfterContactSummary,
  mergeOrderClientsWithContacts,
  normalizeClientPhone,
  normalizeClientPhoneInput,
} from '../src/lib/clientMerge';

test('normalizes Russian phone numbers to one client key', () => {
  assert.equal(normalizeClientPhone('8 (987) 212-12-46'), '79872121246');
  assert.equal(normalizeClientPhone('+8 (987) 212-12-46'), '79872121246');
  assert.equal(normalizeClientPhone('+7 987 212 12 46'), '79872121246');
  assert.equal(normalizeClientPhoneInput('+8'), '7');
  assert.equal(formatClientPhone('89872121246'), '+79872121246');
});

test('matches purchase history across differently formatted phones', () => {
  assert.equal(clientMatchesOrder(
    { phone: '8 (999) 000-11-22' },
    { clientPhone: '+7 999 000 11 22' },
  ), true);
});

test('purchase totals exclude returns, cancellations and blogger expenses', () => {
  const summary = getClientPurchaseSummary([
    { revenue: 12000, status: 'Получен' },
    { revenue: 5000, status: 'Возврат' },
    { revenue: 3000, status: 'Отмена' },
    { revenue: 9000, status: 'Пошив', isBlogger: true },
  ]);
  assert.deepEqual(summary, { ordersCount: 1, totalSpent: 12000 });
});

test('counts only purchases made after a manager contacted the client', () => {
  const summary = getPurchaseAfterContactSummary(
    { phone: '89990001122', lastContactAt: '2026-08-01T12:00:00.000Z' },
    [
      { clientPhone: '+79990001122', revenue: 5000, date: new Date('2026-07-30T12:00:00.000Z'), status: 'Получен' },
      { clientPhone: '89990001122', revenue: 12000, createdAt: '2026-08-03T10:00:00.000Z', date: new Date('2026-08-03'), status: 'Новый' },
      { clientPhone: '89990001122', revenue: 4000, createdAt: '2026-08-04T10:00:00.000Z', date: new Date('2026-08-04'), status: 'Возврат' },
    ],
  );
  assert.equal(summary.count, 1);
  assert.equal(summary.total, 12000);
  assert.equal(summary.firstPurchaseAt?.toISOString(), '2026-08-03T10:00:00.000Z');
});

test('keeps clients from new orders even when contacts already exist', () => {
  const result = mergeOrderClientsWithContacts(
    [
      { name: 'Новый клиент', phone: '89990001122', total: 12000, count: 1 },
      { name: 'Существующий', phone: '89872121246', total: 25000, count: 2 },
    ],
    [{ fullName: 'Существующий клиент', phone: '+7 987 212-12-46', email: 'owner@example.com', totalSpent: 1000, ordersCount: 1 }],
  );

  assert.equal(result.length, 2);
  assert.equal(result.find(client => client.phone === '79990001122')?.fullName, 'Новый клиент');
  const existing = result.find(client => client.phone === '79872121246');
  assert.equal(existing?.fullName, 'Существующий клиент');
  assert.equal(existing?.ordersCount, 2);
  assert.equal(existing?.totalSpent, 25000);
});

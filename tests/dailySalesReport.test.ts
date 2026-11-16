import test from 'node:test';
import assert from 'node:assert/strict';
import { buildDailySalesReport, formatDailySalesReportTelegram, getMoscowDateKey, getPreviousMoscowDateKey } from '../src/lib/dailySalesReport';

test('uses Moscow calendar day including around midnight UTC', () => {
  assert.equal(getMoscowDateKey('2026-11-14T21:30:00.000Z'), '2026-11-15');
  assert.equal(getPreviousMoscowDateKey(new Date('2026-11-15T05:00:00.000Z')), '2026-11-14');
});

test('separates sales, confirmed main payments and final payments', () => {
  const report = buildDailySalesReport({
    dateKey: '2026-11-15',
    orders: [
      {
        orderId: '#A1', date: '2026-11-15', manager: 'Менеджер 1', status: 'Новый',
        items: ['Бомбер', 'Джоггеры'], itemPrices: [19000, 10000], deliveryPrice: 650,
        paymentStatus: 'paid', paymentAmount: 14825, paymentPaidAt: '2026-11-15T07:00:00Z',
      },
      {
        orderId: 'OLD', date: '2026-10-20', manager: 'Менеджер 2', status: 'Отгружен', revenue: 10000,
        finalPaymentStatus: 'manual_confirmed', finalPaymentAmount: 5000, finalPaymentPaidAt: '2026-11-15T12:00:00Z',
      },
      {
        orderId: 'LINK', date: '2026-11-15', status: 'Новый', revenue: 9000,
        paymentStatus: 'created', paymentAmount: 9000, paymentPaidAt: '2026-11-15T12:00:00Z',
      },
      { orderId: 'CANCELLED', date: '2026-11-15', status: 'Возврат', revenue: 12000 },
    ],
    broadcastSent: 31,
    shiftManagers: ['Менеджер 1'],
  });

  assert.equal(report.sales.length, 2);
  assert.equal(report.salesTotal, 38650);
  assert.equal(report.mainPaymentsTotal, 14825);
  assert.equal(report.finalPaymentsTotal, 5000);
  assert.equal(report.mainPayments.length, 1);
  assert.equal(report.finalPayments.length, 1);
  const text = formatDailySalesReportTelegram(report);
  assert.match(text, /Продажи: 2 · 38[\s\u00a0]650 ₽/);
  assert.match(text, /Доплаты: 1 · <b>5[\s\u00a0]000 ₽<\/b>/);
  assert.match(text, /Успешно отправлено по базе: <b>31<\/b>/);
});

test('does not infer payment from an issued link or legacy paid amount without confirmation date', () => {
  const report = buildDailySalesReport({
    dateKey: '2026-11-15',
    orders: [{
      orderId: 'A2', date: '2026-11-15', status: 'Новый', revenue: 10000,
      paymentStatus: 'pending', paymentAmount: 5000, paidAmount: 5000,
    }],
  });
  assert.equal(report.mainPaymentsTotal, 0);
  assert.equal(report.finalPaymentsTotal, 0);
});

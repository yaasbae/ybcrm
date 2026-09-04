import test from 'node:test';
import assert from 'node:assert/strict';
import { buildFinanceReport, parseFinanceDate, reconcileBankIncome } from '../src/lib/financeAccounting';

test('parses CRM dates in Russian format', () => {
  const date = parseFinanceDate('02.09.2026');
  assert.equal(date.getFullYear(), 2026);
  assert.equal(date.getMonth(), 8);
  assert.equal(date.getDate(), 2);
});

test('builds P&L, cash flow and balance without mixing accrual and cash dates', () => {
  const report = buildFinanceReport({
    selectedDate: new Date(2026, 8, 1),
    period: 'month',
    bankBalance: 70_000,
    products: [{ id: 'p1', name: 'Костюм', costPrice: 4_000, stock: 2 }],
    orders: [{ id: 'o1', orderNumber: '1001', date: '02.09.2026', revenue: 10_000, paidAmount: 10_000, status: 'Готов', productIds: ['p1'] }],
    expenses: [],
    operations: [
      { id: 'i1', date: '2026-09-03', amount: 10_000, absAmount: 10_000, direction: 'income', description: 'Оплата заказа 1001' },
      { id: 'e1', date: '2026-09-04', amount: -2_000, absAmount: 2_000, direction: 'expense', category: 'Маркетинг' },
    ],
  });
  assert.equal(report.pnl.revenue, 10_000);
  assert.equal(report.pnl.cogs, 4_000);
  assert.equal(report.pnl.netProfit, 4_000);
  assert.equal(report.cashFlow.net, 8_000);
  assert.equal(report.balance.inventory, 8_000);
  assert.equal(report.reconciliation.rate, 1);
});

test('suggests a unique order by amount and nearby date', () => {
  const rows = reconcileBankIncome(
    [{ id: 'i1', date: '2026-09-04', amount: 5_000, absAmount: 5_000, direction: 'income', description: 'Перевод' }],
    [{ id: 'o1', orderNumber: '1010', date: '02.09.2026', revenue: 5_000, paidAmount: 5_000, status: 'Новый' }],
  );
  assert.equal(rows[0].status, 'suggested');
  assert.equal(rows[0].orderId, 'o1');
});

test('keeps planned payments out of actual expenses until they are paid', () => {
  const baseInput = {
    selectedDate: new Date(2026, 8, 1),
    period: 'month' as const,
    bankBalance: 50_000,
    products: [],
    orders: [{ id: 'o1', date: '02.09.2026', revenue: 20_000, paidAmount: 20_000, status: 'Готов' }],
    operations: [],
  };
  const planned = buildFinanceReport({
    ...baseInput,
    expenses: [{ id: 'p1', date: '15.09.2026', amount: 7_000, status: 'planned' }],
  });
  assert.equal(planned.pnl.operatingExpenses, 0);
  assert.equal(planned.pnl.netProfit, 20_000);
  assert.equal(planned.balance.payables, 7_000);

  const paid = buildFinanceReport({
    ...baseInput,
    expenses: [{ id: 'p1', date: '15.09.2026', amount: 7_000, status: 'paid', paid: true }],
  });
  assert.equal(paid.pnl.operatingExpenses, 7_000);
  assert.equal(paid.pnl.netProfit, 13_000);
  assert.equal(paid.balance.payables, 0);
});

test('limits receivables, advances and planned payables to the selected month', () => {
  const report = buildFinanceReport({
    selectedDate: new Date(2026, 8, 1),
    period: 'month',
    bankBalance: 140_450,
    products: [],
    operations: [],
    orders: [
      { id: 'september', date: '02.09.2026', revenue: 20_000, paidAmount: 5_000, status: 'Новый' },
      { id: 'august', date: '20.08.2026', revenue: 1_500_000, paidAmount: 0, status: 'Новый' },
    ],
    expenses: [
      { id: 'september-plan', date: '15.09.2026', amount: 7_000, status: 'planned' },
      { id: 'august-plan', date: '15.08.2026', amount: 900_000, status: 'planned' },
    ],
  });

  assert.equal(report.balance.cash, 140_450);
  assert.equal(report.balance.receivables, 15_000);
  assert.equal(report.balance.customerAdvances, 5_000);
  assert.equal(report.balance.payables, 7_000);
});

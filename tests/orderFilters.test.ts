import test from 'node:test';
import assert from 'node:assert/strict';
import { isPrepaymentOrder } from '../src/lib/orderFilters';

test('shows only active orders with an outstanding prepayment balance', () => {
  const base = {
    invoiceType: 'prepayment',
    revenue: 11900,
    deliveryPrice: 650,
    paymentAmount: 6275,
    paymentStatus: 'Accepted',
  };
  assert.equal(isPrepaymentOrder({ ...base, status: 'Новый' }), true);
  assert.equal(isPrepaymentOrder({ ...base, finalPaymentAmount: 6275, finalPaymentStatus: 'Accepted', status: 'Упакован' }), false);
  assert.equal(isPrepaymentOrder({ ...base, status: 'Отгружен' }), false);
});

test('recognizes a legacy order as prepayment from the issued half invoice', () => {
  assert.equal(isPrepaymentOrder({
    invoiceType: 'full',
    paymentType: 'Полная оплата',
    revenue: 11_900,
    deliveryPrice: 650,
    paymentAmount: 6_275,
    paymentStatus: 'Accepted',
    status: 'Упакован',
  }), true);
});

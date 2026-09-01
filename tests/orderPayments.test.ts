import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getCalculatedInitialInvoiceAmount,
  getInitialInvoiceAmount,
} from '../src/lib/orderPayments';

test('recalculates a 50% prepayment even when an older full invoice exists', () => {
  const order = {
    revenue: 14900,
    deliveryPrice: 650,
    invoiceType: 'prepayment' as const,
    paymentAmount: 15550,
    paymentUrl: 'https://example.test/old-invoice',
  };

  assert.equal(getInitialInvoiceAmount(order), 15550);
  assert.equal(getCalculatedInitialInvoiceAmount(order), 7775);
});

test('uses the full order total for full payment', () => {
  assert.equal(getCalculatedInitialInvoiceAmount({
    revenue: 14900,
    deliveryPrice: 650,
    invoiceType: 'full',
  }), 15550);
});

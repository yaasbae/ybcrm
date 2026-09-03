import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getCalculatedInitialInvoiceAmount,
  getInitialInvoiceAmount,
  getPlannedFinalPaymentAmount,
  isConfirmedPaymentStatus,
} from '../src/lib/orderPayments';

test('recognizes the successful SBP QR status returned by Tochka', () => {
  assert.equal(isConfirmedPaymentStatus('Accepted'), true);
});

test('does not create a second payment when the issued first invoice already covers the total', () => {
  const order = {
    revenue: 14900,
    deliveryPrice: 650,
    invoiceType: 'prepayment' as const,
    paymentAmount: 15550,
    paymentUrl: 'https://example.test/old-invoice',
  };

  assert.equal(getInitialInvoiceAmount(order), 15550);
  assert.equal(getCalculatedInitialInvoiceAmount(order), 7775);
  assert.equal(getPlannedFinalPaymentAmount(order), 0);
});

test('uses the full order total for full payment', () => {
  assert.equal(getCalculatedInitialInvoiceAmount({
    revenue: 14900,
    deliveryPrice: 650,
    invoiceType: 'full',
  }), 15550);
});

test('keeps the second half as a separate payment when the first invoice is already issued', () => {
  const order = {
    revenue: 11900,
    deliveryPrice: 650,
    invoiceType: 'full' as const,
    paymentAmount: 6275,
    paymentUrl: 'https://example.test/prepayment',
  };

  assert.equal(getInitialInvoiceAmount(order), 6275);
  assert.equal(getPlannedFinalPaymentAmount(order), 6275);
});

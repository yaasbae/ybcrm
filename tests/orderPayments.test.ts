import test from 'node:test';
import assert from 'node:assert/strict';
import {
  canAttemptFinalPayment,
  getStablePaymentStatus,
  getCreatedPaymentAmount,
  getCalculatedInitialInvoiceAmount,
  getConfirmedPaidAmount,
  getEffectiveInvoiceType,
  getInitialInvoiceAmount,
  getNewOrderPaymentAccounting,
  getPlannedFinalPaymentAmount,
  getOutstandingPaymentAmount,
  isConfirmedPaymentStatus,
  isFullyPaidOrder,
  shouldOfferMainPaymentRefund,
} from '../src/lib/orderPayments';

test('keeps the amount actually created by the payment server', () => {
  assert.equal(getCreatedPaymentAmount({ paymentAmount: 10_775 }, 21_550), 10_775);
  assert.equal(getCreatedPaymentAmount({}, 10_775), 10_775);
});

test('recognizes the successful SBP QR status returned by Tochka', () => {
  assert.equal(isConfirmedPaymentStatus('Accepted'), true);
});

test('does not downgrade a confirmed payment to the technical QR status', () => {
  assert.equal(getStablePaymentStatus('Accepted', 'Active'), 'Accepted');
  assert.equal(getStablePaymentStatus('manual_confirmed', 'pending'), 'manual_confirmed');
  assert.equal(getStablePaymentStatus('pending', 'Accepted'), 'Accepted');
});

test('allows the final-payment button to verify an issued prepayment automatically', () => {
  assert.equal(canAttemptFinalPayment({ paymentId: 'main-qr', paymentStatus: 'Active' }), true);
  assert.equal(canAttemptFinalPayment({ paymentUrl: 'https://example.test/main', paymentStatus: 'pending' }), true);
  assert.equal(canAttemptFinalPayment({ paymentStatus: 'Accepted' }), true);
  assert.equal(canAttemptFinalPayment({ paymentStatus: 'pending' }), false);
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

test('uses an explicit legacy full-payment choice over a stale prepayment invoice type', () => {
  assert.equal(getCalculatedInitialInvoiceAmount({
    revenue: 14900,
    deliveryPrice: 650,
    invoiceType: 'prepayment',
    paymentType: 'Полная оплата 100%',
  }), 15550);
});

test('uses an explicit 50% prepayment choice over a stale full-payment flag', () => {
  const order = {
    revenue: 20_900,
    deliveryPrice: 650,
    paymentType: 'Предоплата 50%',
    invoiceType: 'full' as const,
  };

  assert.equal(getEffectiveInvoiceType(order), 'prepayment');
  assert.equal(getCalculatedInitialInvoiceAmount(order), 10_775);
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
  assert.equal(getEffectiveInvoiceType(order), 'prepayment');
});

test('uses bank-issued amounts over a stale legacy full-payment label', () => {
  assert.equal(getEffectiveInvoiceType({
    revenue: 11900,
    deliveryPrice: 650,
    invoiceType: 'full',
    paymentType: 'Полная оплата',
    paymentAmount: 6275,
    paymentUrl: 'https://example.test/prepayment',
    finalPaymentAmount: 6275,
    finalPaymentUrl: 'https://example.test/final',
  }), 'prepayment');
});

test('turns a confirmed prepayment plus confirmed final payment into full payment', () => {
  const order = {
    revenue: 10_000,
    invoiceType: 'prepayment' as const,
    paymentAmount: 5_000,
    paymentStatus: 'Accepted',
    finalPaymentAmount: 5_000,
    finalPaymentStatus: 'Accepted',
    paymentAccountingVersion: 2,
  };

  assert.equal(getConfirmedPaidAmount(order), 10_000);
  assert.equal(getOutstandingPaymentAmount(order), 0);
  assert.equal(getEffectiveInvoiceType(order), 'full');
  assert.equal(isFullyPaidOrder(order), true);
});

test('keeps the final amount outstanding until Tochka confirms it', () => {
  const order = {
    revenue: 10_000,
    invoiceType: 'prepayment' as const,
    paymentAmount: 5_000,
    paymentStatus: 'Accepted',
    finalPaymentAmount: 5_000,
    finalPaymentStatus: 'Active',
    paymentAccountingVersion: 2,
  };

  assert.equal(getConfirmedPaidAmount(order), 5_000);
  assert.equal(getOutstandingPaymentAmount(order), 5_000);
  assert.equal(getEffectiveInvoiceType(order), 'prepayment');
  assert.equal(isFullyPaidOrder(order), false);
});

test('offers a bank-verified refund when a manager marks an invoiced order for return', () => {
  assert.equal(shouldOfferMainPaymentRefund({
    revenue: 16900,
    deliveryPrice: 650,
    paymentAmount: 17550,
    paymentUrl: 'https://qr.nspk.ru/example',
    paymentStatus: 'Active',
    status: 'Возврат',
    invoiceType: 'full',
  }), true);
});

test('does not offer a refund for an unpaid active QR on a normal order', () => {
  assert.equal(shouldOfferMainPaymentRefund({
    revenue: 16900,
    deliveryPrice: 650,
    paymentAmount: 17550,
    paymentUrl: 'https://qr.nspk.ru/example',
    paymentStatus: 'Active',
    status: 'Новый',
    invoiceType: 'full',
  }), false);
});

test('does not count a newly issued invoice as money already paid', () => {
  assert.deepEqual(getNewOrderPaymentAccounting({
    revenue: 16900,
    deliveryPrice: 650,
    invoiceType: 'full',
  }), {
    paidAmount: 0,
    initialPaymentAmount: 17550,
    paymentAccountingVersion: 2,
  });
});

test('keeps a recorded payment for a fulfilled legacy order with a stale active link', () => {
  assert.equal(getConfirmedPaidAmount({
    revenue: 19_900,
    deliveryPrice: 650,
    status: 'Отгружен',
    paymentStatus: 'Active',
    paymentId: 'legacy-qr',
    paymentAmount: 10_275,
    paidAmount: 20_550,
    paymentAccountingVersion: 2,
  }), 20_550);
});

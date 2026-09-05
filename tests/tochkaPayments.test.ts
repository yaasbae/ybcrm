import assert from 'node:assert/strict';
import test from 'node:test';

import {
  findAcceptedSbpPaymentByQr,
  findSbpStatementPayment,
  formatTochkaRefundAmount,
  getTochkaRefundAccount,
} from '../src/lib/tochkaPayments.ts';

test('finds the accepted SBP payment and its refund transaction id', () => {
  const payment = findAcceptedSbpPaymentByQr([
    { qrcId: 'OTHER', status: 'Accepted', refTransactionId: 'wrong' },
    {
      qrcId: 'AD20107UNSMRIBEV9F2B8G2TNLEBQP9D',
      status: 'Accepted',
      refTransactionId: '0036f5c9-8ac9-27ed-530d-4a248e4452c4',
    },
  ], 'AD20107UNSMRIBEV9F2B8G2TNLEBQP9D');

  assert.equal(payment?.refTransactionId, '0036f5c9-8ac9-27ed-530d-4a248e4452c4');
});

test('formats the composite account id for the Tochka refund API', () => {
  assert.deepEqual(getTochkaRefundAccount('40802810220000613147/044525104'), {
    accountCode: '40802810220000613147',
    bankCode: '044525104',
  });
  assert.equal(formatTochkaRefundAmount(17550), '17550.00');
});

test('recovers the SBP trxId from statement rows for the exact QR payment', () => {
  const qrcId = 'AD20107UNSMRIBEV9F2B8G2TNLEBQP9D';
  const match = findSbpStatementPayment([
    {
      transactionId: 'cbs-tb;2472075043;1',
      paymentId: 'tb-nspk-sbp-A62441834066550W0B10200011840301',
      creditDebitIndicator: 'Credit',
      description: `Зачисление по QR коду ID ${qrcId}`,
      Amount: { amount: 17550, currency: 'RUB' },
    },
    {
      transactionId: 'cbs-tb;2472075047;1',
      paymentId: 'nspk-sbp-core-c2b-0036f5c98ac927ed530d4a248e4452c4',
      creditDebitIndicator: 'Debit',
      description: `Комиссия по QR ID ${qrcId}`,
      Amount: { amount: 70.2, currency: 'RUB' },
    },
  ], qrcId, 17550);

  assert.equal(match?.trxId, '0036f5c98ac927ed530d4a248e4452c4');
  assert.equal(match?.bankTransactionId, 'cbs-tb;2472075043;1');
});

test('does not match another QR or another amount', () => {
  assert.equal(findSbpStatementPayment([{
    paymentId: 'nspk-sbp-core-c2b-0036f5c98ac927ed530d4a248e4452c4',
    creditDebitIndicator: 'Credit',
    description: 'Зачисление по QR коду ID OTHER',
    Amount: { amount: 17550 },
  }], 'EXPECTED', 17550), null);
});

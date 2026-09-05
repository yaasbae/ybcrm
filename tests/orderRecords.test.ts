import assert from 'node:assert/strict';
import test from 'node:test';

import { resolveStoredOrderIdentity } from '../src/lib/orderRecords.ts';

test('does not render a CDEK-only technical record as a CRM order', () => {
  assert.equal(resolveStoredOrderIdentity('WEB-MSQAG6E6', {
    cdekNumber: '10306346855',
    cdekCreatedAt: '2026-08-12T16:13:08.371Z',
  } as any), null);
});

test('uses the Firestore id for a real legacy order without orderId', () => {
  const result = resolveStoredOrderIdentity('legacy-order-id', {
    clientName: 'Анна Иванова',
    item: 'Костюм',
    date: '2026-09-05T06:00:00.000Z',
  });

  assert.equal(result?.orderId, 'legacy-order-id');
  assert.equal(result?.date.toISOString(), '2026-09-05T06:00:00.000Z');
});

test('does not replace a missing date with today', () => {
  assert.equal(resolveStoredOrderIdentity('order-without-date', {
    orderId: '12345',
    clientName: 'Анна Иванова',
  }), null);
});

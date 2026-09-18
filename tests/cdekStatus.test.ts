import test from 'node:test';
import assert from 'node:assert/strict';

import {
  getCdekCrmStatusPatch,
  parseCdekOrderStatusWebhook,
} from '../src/lib/cdekStatus.ts';

test('maps verified CDEK statuses to the CRM workflow', () => {
  const changedAt = '2026-09-18T12:00:00.000Z';
  assert.deepEqual(getCdekCrmStatusPatch('RECEIVED_AT_SHIPMENT_WAREHOUSE', 'Отгружен', changedAt), {
    status: 'Принят СДЭК',
    isShipped: true,
    cdekAcceptedAt: changedAt,
  });
  assert.deepEqual(getCdekCrmStatusPatch('READY_FOR_SHIPMENT_IN_TRANSIT_CITY', 'Отгружен', changedAt), {
    status: 'В пути',
    isShipped: true,
  });
  assert.deepEqual(getCdekCrmStatusPatch('DELIVERED', 'В пути', changedAt), {
    status: 'Получен',
    isShipped: true,
    cdekDeliveredAt: changedAt,
  });
});

test('does not overwrite return or cancellation workflows', () => {
  assert.deepEqual(getCdekCrmStatusPatch('DELIVERED', 'Возврат'), {});
  assert.deepEqual(getCdekCrmStatusPatch('IN_TRANSIT', 'Отмена'), {});
});

test('accepts only a bounded ORDER_STATUS webhook payload', () => {
  assert.deepEqual(parseCdekOrderStatusWebhook({
    type: 'ORDER_STATUS',
    uuid: '72753031-1820-4f99-9240-aab139f05ca5',
    attributes: {
      code: 'RECEIVED_AT_SHIPMENT_WAREHOUSE',
      cdek_number: '1100285492',
      number: '7000С',
    },
  }), {
    uuid: '72753031-1820-4f99-9240-aab139f05ca5',
    status: 'RECEIVED_AT_SHIPMENT_WAREHOUSE',
    cdekNumber: '1100285492',
    externalNumber: '7000С',
  });
  assert.equal(parseCdekOrderStatusWebhook({ type: 'PRINT_FORM', attributes: {} }), null);
  assert.equal(parseCdekOrderStatusWebhook({
    type: 'ORDER_STATUS',
    uuid: 'not-an-order',
    attributes: { code: 'DELIVERED', number: '7000С' },
  }), null);
  assert.equal(parseCdekOrderStatusWebhook({
    type: 'ORDER_STATUS',
    uuid: '72753031-1820-4f99-9240-aab139f05ca5',
    attributes: { code: '<script>', number: '7000С' },
  }), null);
});

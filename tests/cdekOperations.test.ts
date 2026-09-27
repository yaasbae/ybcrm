import assert from 'node:assert/strict';
import test from 'node:test';
import {
  canChangeCdekDelivery,
  canDeleteCdekWaybill,
  canEditCdekWaybill,
  canRequestCdekRefusal,
  isCdekTerminalStatus,
} from '../src/lib/cdekOperations.ts';

test('created waybill can be edited or deleted before physical movement', () => {
  for (const status of ['CREATED', 'ACCEPTED', 'created']) {
    assert.equal(canEditCdekWaybill(status), true);
    assert.equal(canDeleteCdekWaybill(status), true);
    assert.equal(canChangeCdekDelivery(status), false);
  }
});

test('in-transit shipment can change delivery or request refusal but cannot be deleted', () => {
  for (const status of ['IN_TRANSIT', 'SENT_TO_RECIPIENT_CITY', 'ACCEPTED_AT_PICK_UP_POINT']) {
    assert.equal(canDeleteCdekWaybill(status), false);
    assert.equal(canChangeCdekDelivery(status), true);
    assert.equal(canRequestCdekRefusal(status), true);
  }
});

test('terminal shipment blocks destructive operations', () => {
  for (const status of ['DELIVERED', 'REMOVED', 'RETURNED_TO_SENDER']) {
    assert.equal(isCdekTerminalStatus(status), true);
    assert.equal(canDeleteCdekWaybill(status), false);
    assert.equal(canChangeCdekDelivery(status), false);
    assert.equal(canRequestCdekRefusal(status), false);
  }
});

test('a requested refusal cannot be changed or requested twice', () => {
  assert.equal(canChangeCdekDelivery('REFUSAL_REQUESTED'), false);
  assert.equal(canRequestCdekRefusal('REFUSAL_REQUESTED'), false);
});

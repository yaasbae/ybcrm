import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyCheckoutClaim } from '../src/lib/storefrontCheckoutClaim.ts';

test('only a missing request may claim checkout', () => {
  assert.equal(classifyCheckoutClaim(null, 'digest').state, 'claimed');
  for (const status of ['processing', 'failed', 'completed']) {
    assert.equal(classifyCheckoutClaim({ status, payloadHash: 'digest' }, 'digest').state, 'pending');
  }
});

test('completed checkout returns its original payment without repeating side effects', () => {
  const response = { paymentUrl: 'https://example.com/payment', orderId: 'WEB-ONE' };
  assert.deepEqual(classifyCheckoutClaim({ status: 'completed', payloadHash: 'digest', response }, 'digest'), { state: 'completed', response });
});

test('changed payload and legacy requests without digest fail closed', () => {
  assert.equal(classifyCheckoutClaim({ payloadHash: 'old', status: 'completed', response: { paymentUrl: 'https://example.com' } }, 'new').state, 'conflict');
  assert.equal(classifyCheckoutClaim({}, 'new').state, 'conflict');
});

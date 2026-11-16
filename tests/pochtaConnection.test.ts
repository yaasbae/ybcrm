import assert from 'node:assert/strict';
import test from 'node:test';
import { checkPochtaConnection } from '../src/server/pochtaConnection.ts';

test('skips the network when a credential is missing', async () => {
  let called = false;
  const result = await checkPochtaConnection('test-token', '', async () => {
    called = true;
    return Response.json([]);
  });
  assert.equal(result, 'missing');
  assert.equal(called, false);
});

test('checks shipping points using both credentials without following redirects', async () => {
  const result = await checkPochtaConnection('test-token', 'test-key', async (url, options) => {
    assert.equal(url, 'https://otpravka-api.pochta.ru/1.0/user-shipping-points');
    assert.equal(options?.redirect, 'error');
    assert.equal(new Headers(options?.headers).get('Authorization'), 'AccessToken test-token');
    assert.equal(new Headers(options?.headers).get('X-User-Authorization'), 'Basic test-key');
    return Response.json([]);
  });
  assert.equal(result, 'connected');
});

test('distinguishes rejected keys from service failures', async () => {
  for (const status of [401, 403]) {
    assert.equal(await checkPochtaConnection('a', 'b', async () => new Response(null, { status })), 'rejected');
  }
  assert.equal(await checkPochtaConnection('a', 'b', async () => new Response(null, { status: 503 })), 'unavailable');
  assert.equal(await checkPochtaConnection('a', 'b', async () => Response.json({ error: 'test' })), 'unavailable');
  assert.equal(await checkPochtaConnection('a', 'b', async () => { throw new Error('timeout'); }), 'unavailable');
});

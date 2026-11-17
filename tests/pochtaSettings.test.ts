import assert from 'node:assert/strict';
import test from 'node:test';
import { parsePochtaCredentials } from '../src/server/pochtaSettings.ts';

test('forms the API key from the login and password without altering the password', () => {
  const result = parsePochtaCredentials({ token: ' sample-token ', login: ' api-user ', password: ' x:y ' });
  assert.equal(result?.token, 'sample-token');
  assert.equal(Buffer.from(result?.userKey ?? '', 'base64').toString(), 'api-user: x:y ');
});

test('rejects malformed credentials before making any external requests', () => {
  const valid = { token: 'sample-token', login: 'api-user', password: 'sample-password' };
  for (const invalid of [null, { ...valid, token: [] }, { ...valid, token: 'a\nb' },
    { ...valid, login: 'api:user' }, { ...valid, password: '' }, { ...valid, password: 'x'.repeat(513) }]) {
    assert.equal(parsePochtaCredentials(invalid), null);
  }
});

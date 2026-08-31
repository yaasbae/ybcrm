import assert from 'node:assert/strict';
import test from 'node:test';
import { managerNameForEmail } from '../src/lib/managerIdentity';

test('binds each CRM login to its own manager', () => {
  assert.equal(managerNameForEmail('YB1@YBCRM.RU '), 'Менеджер 1');
  assert.equal(managerNameForEmail('yb2@ybcrm.ru'), 'Менеджер 2');
  assert.equal(managerNameForEmail('ndtiger86@gmail.com'), '');
});

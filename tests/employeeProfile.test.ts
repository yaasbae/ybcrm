import test from 'node:test';
import assert from 'node:assert/strict';
import { cleanEmployeeNamePart, isTelegramUsernameInputValid, normalizeTelegramUsername } from '../src/lib/employeeProfile';

test('normalizes a Telegram username without storing an @ sign', () => {
  assert.equal(normalizeTelegramUsername('  @Alina_X  '), 'alina_x');
  assert.equal(isTelegramUsernameInputValid('@alina_x'), true);
});

test('rejects invalid Telegram usernames', () => {
  assert.equal(normalizeTelegramUsername('@иван'), '');
  assert.equal(isTelegramUsernameInputValid('abc'), false);
});

test('cleans employee first and last names', () => {
  assert.equal(cleanEmployeeNamePart('  Алина   Х  '), 'Алина Х');
});

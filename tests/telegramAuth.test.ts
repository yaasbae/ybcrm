import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeTelegramPhone, telegramAuthError, telegramDelivery } from '../src/lib/telegramAuth';

test('normalizes manager phone and rejects invalid input', () => {
  assert.equal(normalizeTelegramPhone('8 (987) 212-12-46'), '+79872121246');
  assert.equal(normalizeTelegramPhone('+79872121246'), '+79872121246');
  assert.equal(normalizeTelegramPhone('123'), '');
});

test('keeps actual app delivery and server-defined SMS fallback timeout', () => {
  const result = telegramDelivery({ type: { className: 'auth.SentCodeTypeApp' }, nextType: { className: 'auth.CodeTypeSms' }, timeout: 120, phoneCodeHash: 'secret' }, 1000);
  assert.equal(result.deliveryType, 'App');
  assert.equal(result.nextDeliveryLabel, 'SMS');
  assert.equal(result.canResend, true);
  assert.equal(result.resendAt, 121000);
  assert.ok(!JSON.stringify(result).includes('secret'));
  assert.equal(telegramDelivery({ timeout: 0 }, 1000).resendAt, 1000);
});

test('does not promise SMS when no fallback is offered', () => {
  const result = telegramDelivery({ type: { className: 'auth.SentCodeTypeApp' } });
  assert.equal(result.canResend, false);
  assert.equal(result.nextDeliveryLabel, '');
});

test('supports email and word codes but does not report unsupported flows as success', () => {
  assert.equal(telegramDelivery({ type: { className: 'auth.SentCodeTypeEmailCode' } }).deliveryLabel, 'письмо на почту');
  assert.equal(telegramDelivery({ type: { className: 'auth.SentCodeTypeSmsWord' } }).codeInputMode, 'text');
  assert.equal(telegramDelivery({ type: { className: 'auth.SentCodeTypeFirebaseSms' } }).supported, false);
  assert.equal(telegramDelivery({}).supported, false);
});

test('maps flood limits and expired codes without exposing raw RPC data', () => {
  assert.equal(telegramAuthError({ errorMessage: 'FLOOD_WAIT_123', seconds: 123 }).retryAfterSeconds, 123);
  assert.equal(telegramAuthError({ errorMessage: 'PHONE_CODE_EXPIRED' }).restartRequired, true);
  assert.equal(telegramAuthError({ errorMessage: 'API_ID_PUBLISHED_FLOOD' }).status, 503);
  assert.ok(!telegramAuthError({ message: 'secret password 12345' }).error.includes('12345'));
});

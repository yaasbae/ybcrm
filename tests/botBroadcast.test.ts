import test from 'node:test';
import assert from 'node:assert/strict';

import {
  TELEGRAM_BOT_MESSAGE_LIMIT,
  normalizeBotSubscriberIds,
  validateBotBroadcastMessage,
} from '../src/lib/botBroadcast';

test('validates Telegram bot broadcast text', () => {
  assert.equal(validateBotBroadcastMessage('  Новая коллекция  ').message, 'Новая коллекция');
  assert.match(validateBotBroadcastMessage('   ').error, /Введите текст/);
  assert.match(validateBotBroadcastMessage('а'.repeat(TELEGRAM_BOT_MESSAGE_LIMIT + 1)).error, /длиннее лимита/);
});

test('keeps only unique numeric Telegram subscriber ids', () => {
  assert.deepEqual(normalizeBotSubscriberIds(['123', 123, '', 'user', '456']), ['123', '456']);
});

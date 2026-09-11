import assert from 'node:assert/strict';
import test from 'node:test';

import { isReservedTelegramServiceTopic } from '../src/lib/telegramServiceTopics.ts';

const topics = [
  { chatId: '-1002176316557', threadId: 1244 },
  { chatId: '-1002176316557', threadId: 12750 },
];

test('recognizes the order topic even when the chat is absent from manager settings', () => {
  assert.equal(isReservedTelegramServiceTopic('-1002176316557', 1244, topics), true);
});

test('does not suppress customer messages or unrelated manager topics', () => {
  assert.equal(isReservedTelegramServiceTopic('123456', 1244, topics), false);
  assert.equal(isReservedTelegramServiceTopic('-1002176316557', 999, topics), false);
});

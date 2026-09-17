import assert from 'node:assert/strict';
import test from 'node:test';
import { calculateAiChatViewport } from '../src/lib/aiChatViewport.ts';

test('keeps the chat below the CRM header without the iPhone keyboard', () => {
  assert.deepEqual(calculateAiChatViewport(844, 0, 844), { top: 56, height: 788, keyboard: false });
});

test('follows the shifted iPhone visual viewport while the keyboard is open', () => {
  assert.deepEqual(calculateAiChatViewport(400, 390, 844), { top: 390, height: 400, keyboard: true });
});

test('subtracts only the visible part of the CRM header during a partial shift', () => {
  assert.deepEqual(calculateAiChatViewport(500, 20, 844), { top: 56, height: 464, keyboard: true });
});

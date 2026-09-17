import assert from 'node:assert/strict';
import test from 'node:test';
import { readOpenAiOutputText } from '../src/server/openAiResponses.ts';

test('reads the Responses API output text', () => {
  assert.equal(readOpenAiOutputText({ output_text: ' Готовый ответ ' }), 'Готовый ответ');
  assert.equal(readOpenAiOutputText({
    output: [{ content: [{ type: 'output_text', text: 'Ответ из массива' }] }],
  }), 'Ответ из массива');
});

test('ignores non-text response items', () => {
  assert.equal(readOpenAiOutputText({ output: [{ content: [{ type: 'refusal', text: 'нет' }] }] }), '');
});


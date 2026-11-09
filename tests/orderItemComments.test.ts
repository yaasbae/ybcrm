import test from 'node:test';
import assert from 'node:assert/strict';
import { buildItemCommentPatch, ItemCommentError, orderLines } from '../src/lib/orderItemComments.ts';

const order = { items: ['Бомбер', 'Джоггеры'], itemColors: ['Чёрный', 'Серый'], itemSizes: ['M', 'L'], itemComments: ['Укоротить', ''] };

test('order item comment preserves other product comments', () => {
  const patch = buildItemCommentPatch(order, { itemIndex: 1, line: orderLines(order)[1], previousComment: '', comment: 'Только отрезать' });
  assert.deepEqual(patch?.itemComments, ['Укоротить', 'Только отрезать']);
});

test('order item comment rejects stale product or stale comment', () => {
  assert.throws(() => buildItemCommentPatch(order, { itemIndex: 1, line: { ...orderLines(order)[1], size: 'S' }, previousComment: '', comment: 'Тест' }), ItemCommentError);
  assert.throws(() => buildItemCommentPatch(order, { itemIndex: 0, line: orderLines(order)[0], previousComment: '', comment: 'Тест' }), ItemCommentError);
});

test('order item comment rejects malformed input and long text', () => {
  assert.throws(() => buildItemCommentPatch(order, { itemIndex: 0, line: orderLines(order)[0], previousComment: 'Укоротить', comment: 'a'.repeat(1001) }), ItemCommentError);
  assert.throws(() => buildItemCommentPatch(order, { itemIndex: -1, line: orderLines(order)[0], previousComment: '', comment: 'Тест' }), ItemCommentError);
  assert.throws(() => buildItemCommentPatch(order, { itemIndex: 0, line: orderLines(order)[0], previousComment: 'Укоротить', comment: 'Тест', extra: true }), ItemCommentError);
});

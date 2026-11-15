import assert from 'node:assert/strict';
import test from 'node:test';
import { createRegulationAcknowledgementId, createRegulationId, isCurrentRegulationAcknowledgementVersion, validateRegulation } from '../src/lib/regulations.ts';

test('accepts and trims a complete regulation', () => {
  const result = validateRegulation({
    id: ' manager-rules ', group: ' Роли ', title: ' Работа менеджера ', summary: ' Инструкция ',
    blocks: [{ title: ' Начало ', steps: [' Проверить заказы ', ''] }],
  });
  assert.deepEqual(result.errors, []);
  assert.equal(result.regulation.title, 'Работа менеджера');
  assert.deepEqual(result.regulation.blocks[0].steps, ['Проверить заказы']);
});

test('rejects an unsafe id and empty content', () => {
  const result = validateRegulation({ id: '../owner', group: '', title: '', summary: '', blocks: [] });
  assert.ok(result.errors.length >= 5);
});

test('creates a unique id for a new regulation', () => {
  assert.equal(createRegulationId('Новый регламент', ['novyy-reglament']), 'novyy-reglament-2');
});

test('creates a stable acknowledgement id and rejects invalid input', () => {
  assert.equal(createRegulationAcknowledgementId('employee-1', 'orders', 1), 'employee-1_orders_v1');
  assert.throws(() => createRegulationAcknowledgementId('employee/1', 'orders', 1));
  assert.throws(() => createRegulationAcknowledgementId('employee-1', '../orders', 1));
  assert.throws(() => createRegulationAcknowledgementId('employee-1', 'orders', 0));
  assert.equal(isCurrentRegulationAcknowledgementVersion('orders', 1), true);
  assert.equal(isCurrentRegulationAcknowledgementVersion('orders', 2), false);
  assert.equal(isCurrentRegulationAcknowledgementVersion('unknown', 1), false);
});

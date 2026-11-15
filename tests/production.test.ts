import assert from 'node:assert/strict';
import test from 'node:test';
import {
  getProductionPaymentDate,
  getNextProductionStatus,
  getProductionStage,
  isProductionPaymentPassed,
  isProductionQueueStatus,
} from '../src/lib/production.ts';

test('calculates contractor payment dates for both halves of a month', () => {
  assert.equal(getProductionPaymentDate('2026-08-01'), '2026-08-30');
  assert.equal(getProductionPaymentDate('2026-08-15'), '2026-08-30');
  assert.equal(getProductionPaymentDate('2026-08-16'), '2026-09-15');
  assert.equal(getProductionPaymentDate('2026-02-01'), '2026-02-28');
});

test('marks a production period paid only after its payment date has passed', () => {
  assert.equal(isProductionPaymentPassed('2026-09-15', '2026-09-16'), true);
  assert.equal(isProductionPaymentPassed('2026-09-15', '2026-09-15'), false);
  assert.equal(isProductionPaymentPassed('2026-09-15', '2026-09-14'), false);
});

test('recognizes orders that must be shown in the production queue', () => {
  assert.equal(isProductionQueueStatus('Новый'), false);
  assert.equal(isProductionQueueStatus('Оплачен'), true);
  assert.equal(isProductionQueueStatus('Заказ ткань'), true);
  assert.equal(isProductionQueueStatus('Заказать ткань'), true);
  assert.equal(isProductionQueueStatus('Накроить'), true);
  assert.equal(isProductionQueueStatus('Нужно   накроить'), true);
  assert.equal(isProductionQueueStatus('Накроен'), true);
  assert.equal(isProductionQueueStatus('Пошив'), true);
  assert.equal(getProductionStage('Оплачен'), 'new');
  assert.equal(getProductionStage('Заказ ткань'), 'fabric');
  assert.equal(getProductionStage('Накроить'), 'cutting');
  assert.equal(getProductionStage('Пошив'), 'sewing');
  assert.equal(getNextProductionStatus('new'), 'Заказ ткань');
  assert.equal(getNextProductionStatus('fabric'), 'Накроить');
  assert.equal(getNextProductionStatus('cutting'), 'Пошив');
  assert.equal(getNextProductionStatus('sewing'), 'Готов');
});

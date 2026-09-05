import assert from 'node:assert/strict';
import test from 'node:test';

import { isOverdueOrder } from '../src/lib/orderFilters';
import { isReceivedOrderStatus, normalizeOrderStatus, ORDER_STATUS_OPTIONS } from '../src/lib/orderStatuses';

test('legacy order statuses are shown with the current names', () => {
  assert.equal(normalizeOrderStatus('В работе'), 'Пошив');
  assert.equal(normalizeOrderStatus('Вручен'), 'Получен');
  assert.equal(isReceivedOrderStatus('Получен'), true);
  assert.equal(isReceivedOrderStatus('Вручен'), true);
  assert.equal(isReceivedOrderStatus('Доставлен'), false);
});

test('the selectable workflow contains only the current statuses', () => {
  const statuses: readonly string[] = ORDER_STATUS_OPTIONS;
  assert.equal(statuses.includes('Есть на складе'), true);
  assert.equal(statuses.includes('Пошив'), true);
  assert.equal(statuses.includes('Получен'), true);
  assert.equal(statuses.includes('Вернули платёж'), true);
  assert.equal(statuses.includes('В работе'), false);
  assert.equal(statuses.includes('Вручен'), false);
});

test('overdue is a system marker only for active unshipped orders', () => {
  assert.equal(isOverdueOrder({ isOverdue: true, isShipped: false }), true);
  assert.equal(isOverdueOrder({ isOverdue: true, isShipped: true }), false);
  assert.equal(isOverdueOrder({ isOverdue: false, isShipped: false }), false);
  assert.equal(isOverdueOrder({ status: 'Отмена', isOverdue: true, isShipped: false }), false);
  assert.equal(isOverdueOrder({ status: 'Возврат', isOverdue: true, isShipped: false }), false);
  assert.equal(isOverdueOrder({ status: 'Вернули платёж', isOverdue: true, isShipped: false }), false);
});

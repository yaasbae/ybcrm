import assert from 'node:assert/strict';
import test from 'node:test';
import { buildProductionStageTelegramText } from '../src/lib/productionNotifications.ts';

test('builds a ready notification with order, variants and CRM link', () => {
  const text = buildProductionStageTelegramText({
    orderId: '7091C',
    items: ['Джоггеры зима FLAME90x'],
    itemColors: ['Молочный с капучино'],
    itemSizes: ['OVER XS/S'],
  }, 'Готов');

  assert.match(text, /Заказ отшит и готов/);
  assert.match(text, /#7091C/);
  assert.match(text, /Джоггеры зима FLAME90x — Молочный с капучино \/ OVER XS\/S/);
  assert.match(text, /orders\?order=7091C/);
});

test('escapes untrusted order content for Telegram HTML', () => {
  const text = buildProductionStageTelegramText({ orderId: '1', items: ['<script>'] }, 'Пошив');
  assert.doesNotMatch(text, /<script>/);
  assert.match(text, /&lt;script&gt;/);
});

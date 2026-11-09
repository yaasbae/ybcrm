import test from 'node:test';
import assert from 'node:assert/strict';
import { buildYandexPayCart } from '../src/lib/yandexPayCart.ts';

test('Split cart keeps each product, its quantity, delivery and exact total', () => {
  const cart = buildYandexPayCart('WEB-123', {
    items: ['Костюм ISIDA × 2', 'Бомбер FLAME × 1'],
    itemProductIds: ['isida', 'flame'],
    itemQuantities: [2, 1],
    itemPrices: [39800, 19900],
    revenue: 59700,
    deliveryPrice: 450,
    deliveryMethod: 'СДЭК',
  }, 60150);
  assert.deepEqual(cart.items.map(item => [item.productId, item.title, item.quantity.count, item.total]), [
    ['isida', 'Костюм ISIDA', '2', '39800.00'],
    ['flame', 'Бомбер FLAME', '1', '19900.00'],
    ['WEB-123-delivery', 'Доставка СДЭК', '1', '450.00'],
  ]);
  assert.equal(cart.total.amount, '60150.00');
  assert.equal(cart.items.reduce((sum, item) => sum + Number(item.total), 0), Number(cart.total.amount));
  assert.throws(() => buildYandexPayCart('WEB-123', { items: ['Изделие'], revenue: 19900 }, 100), /полная сумма заказа/);
});

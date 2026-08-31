import assert from 'node:assert/strict';
import test from 'node:test';
import { matchesOrderSearch } from '../src/lib/orderSearch';

const order = {
  orderId: 'A-42',
  clientName: 'Алёна Иванова',
  clientPhone: '+7 (987) 212-12-46',
  clientInsta: '@alena_yaasbae',
  clientCity: 'Казань',
  items: ['Платье Мира'],
  manager: 'Собственник',
};

test('finds a client regardless of case and е/ё', () => {
  assert.equal(matchesOrderSearch(order, 'алена иванова'), true);
  assert.equal(matchesOrderSearch(order, 'ИВАНОВА'), true);
});

test('finds formatted phone by digits', () => {
  assert.equal(matchesOrderSearch(order, '987212'), true);
  assert.equal(matchesOrderSearch(order, '+7 987 212'), true);
});

test('finds order fields and rejects unrelated query', () => {
  assert.equal(matchesOrderSearch(order, 'платье мира'), true);
  assert.equal(matchesOrderSearch(order, 'alena_yaasbae'), true);
  assert.equal(matchesOrderSearch(order, 'москва'), false);
});

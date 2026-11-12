import test from 'node:test';
import assert from 'node:assert/strict';

import { calculateCdekPackageWeight, parseProductWeightGrams } from '../src/lib/cdekPackage.ts';

test('parses product weights in grams and kilograms', () => {
  assert.equal(parseProductWeightGrams('1500'), 1500);
  assert.equal(parseProductWeightGrams('1,5 кг'), 1500);
  assert.equal(parseProductWeightGrams('700 г'), 700);
  assert.equal(parseProductWeightGrams(''), null);
});

test('sums catalog weights and makes missing weights visible', () => {
  assert.deepEqual(calculateCdekPackageWeight(
    ['Бомбер', 'Джоггеры'],
    [{ name: 'Бомбер', weight: '1,2 кг' }, { name: 'Джоггеры', weight: '800' }],
  ), { weight: 2000, missingItems: [], fallbackCount: 0 });

  assert.deepEqual(calculateCdekPackageWeight(
    ['Бомбер', 'Неизвестный товар'],
    [{ name: 'Бомбер', weight: '1200' }],
  ), { weight: 1900, missingItems: ['Неизвестный товар'], fallbackCount: 1 });

  assert.deepEqual(calculateCdekPackageWeight(
    ['Лёгкий товар'],
    [{ name: 'Лёгкий товар', weight: '600' }],
  ), { weight: 1500, missingItems: [], fallbackCount: 0 });
});

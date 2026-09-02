import test from 'node:test';
import assert from 'node:assert/strict';

import { ensureProductMaterials, formatProductMaterials, getPrimaryComposition } from '../src/lib/productMaterials';

test('moves an old single composition into the primary fabric field', () => {
  const materials = ensureProductMaterials(undefined, '100% хлопок');
  assert.equal(materials.length, 3);
  assert.equal(materials[0].name, 'Основная ткань');
  assert.equal(materials[0].composition, '100% хлопок');
  assert.equal(getPrimaryComposition(materials), '100% хлопок');
});

test('keeps default layers and any additional material', () => {
  const materials = ensureProductMaterials([
    { id: 'main', name: 'Основная ткань', composition: '100% полиэстер' },
    { id: 'fleece', name: 'Флис', composition: '100% полиэстер' },
  ]);
  assert.deepEqual(materials.map(item => item.name), ['Основная ткань', 'Утеплитель', 'Подкладочная ткань', 'Флис']);
  assert.equal(formatProductMaterials(materials), 'Основная ткань: 100% полиэстер; Флис: 100% полиэстер');
});

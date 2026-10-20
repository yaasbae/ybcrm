import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isStorefrontEmail,
  normalizeStorefrontCart,
  normalizeStorefrontPhone,
  sanitizeStorefrontProduct,
  sanitizeStorefrontSettings,
  isStorefrontSizeAvailable,
} from '../src/lib/storefrontCommerce.ts';

test('checkout only accepts sizes actually listed in the CRM product', () => {
  assert.equal(isStorefrontSizeAvailable('Over', 'Over'), true);
  assert.equal(isStorefrontSizeAvailable('Over', 'XS'), false);
  assert.equal(isStorefrontSizeAvailable('Over 100 / Over 200', 'Over 200'), true);
  assert.equal(isStorefrontSizeAvailable('S, M; L', 'M'), true);
  assert.equal(isStorefrontSizeAvailable('', 'M'), false);
  assert.equal(isStorefrontSizeAvailable('Over', undefined), false);
});

test('storefront category is independent from production printing method', () => {
  const source = { name: 'Костюм', sellingPrice: 100, photos: ['https://example.com/photo.webp'], applicationType: 'Шелкография', collectionName: 'Summer' };
  assert.equal(sanitizeStorefrontProduct('p1', source)?.category, 'Коллекция');
  assert.equal(sanitizeStorefrontProduct('p1', { ...source, storefrontCategory: 'Костюмы' })?.category, 'Костюмы');
});

test('public materials expose only descriptive fields and invalid prices never publish', () => {
  const source = {
    name: 'Test product', sellingPrice: 100, photos: ['https://example.com/photo.webp'],
    materials: [{ id: 'main', name: 'Fabric', composition: 'Cotton', supplierToken: 'private', costPrice: 10 }, null, ['bad']],
  };
  const product = sanitizeStorefrontProduct('p1', source);
  assert.deepEqual(product?.materials, [{ id: 'main', name: 'Fabric', composition: 'Cotton' }]);
  assert.ok(!JSON.stringify(product).includes('supplierToken'));
  assert.ok(!JSON.stringify(product).includes('costPrice'));
  for (const sellingPrice of [Infinity, -Infinity, NaN, 0, -1, Number.MAX_VALUE]) {
    assert.equal(sanitizeStorefrontProduct('p1', { ...source, sellingPrice }), null);
  }
});

test('storefront product exposes only public fields', () => {
  const result = sanitizeStorefrontProduct('p1', {
    name: 'Олимпийка',
    sellingPrice: 12990,
    costPrice: 100 as never,
    photos: ['https://cdn.example/look.webp', 'javascript:alert(1)'],
    description: 'Описание',
  } as never);
  assert.deepEqual(result, {
    id: 'p1',
    name: 'Олимпийка',
    price: 12990,
    photos: ['https://cdn.example/look.webp'],
    color: '',
    sizeGrid: '',
    category: 'Коллекция',
    description: 'Описание',
    collectionName: '',
    seasonality: '',
    sizeDetails: '',
    composition: '',
    materials: [],
    countryOfOrigin: '',
    availability: 'unknown',
  });
});

test('availability distinguishes missing stock, available stock and reserved stock without exposing quantities', () => {
  const base = { name: 'A', sellingPrice: 100, photos: ['https://example.com/a.jpg'] };
  for (const stockQuantity of [undefined, null, NaN, Infinity]) {
    assert.equal(sanitizeStorefrontProduct('a', { ...base, stockQuantity })?.availability, 'unknown');
  }
  assert.equal(sanitizeStorefrontProduct('a', { ...base, stockQuantity: 0 })?.availability, 'made_to_order');
  assert.equal(sanitizeStorefrontProduct('a', { ...base, stockQuantity: 2, reservedQuantity: 2 })?.availability, 'made_to_order');
  const available = sanitizeStorefrontProduct('a', { ...base, stockQuantity: 2, reservedQuantity: 1 });
  assert.equal(available?.availability, 'in_stock');
  assert.ok(!JSON.stringify(available).includes('stockQuantity'));
});

test('hidden or incomplete products are not published', () => {
  assert.equal(sanitizeStorefrontProduct('p1', { name: 'A', sellingPrice: 1, photos: ['https://x'], storefrontPublished: false }), null);
  assert.equal(sanitizeStorefrontProduct('p2', { name: 'A', sellingPrice: 0, photos: ['https://x'] }), null);
  assert.equal(sanitizeStorefrontProduct('p3', { name: 'A', sellingPrice: 1, photos: [] }), null);
});

test('prepared storefront photos override CRM source photos', () => {
  const result = sanitizeStorefrontProduct('p1', {
    name: 'Олимпийка',
    sellingPrice: 12990,
    photos: ['https://cdn.example/original.jpg'],
    storefrontPhotos: ['https://cdn.example/studio.webp'],
  });
  assert.deepEqual(result?.photos, ['https://cdn.example/studio.webp']);
});

test('cart and contacts are normalized before an order is created', () => {
  assert.deepEqual(normalizeStorefrontCart([{ productId: ' p1 ', quantity: 99, size: ' M ' }, null]), [
    { productId: 'p1', quantity: 20, size: 'M', fit: '' },
  ]);
  assert.equal(normalizeStorefrontPhone('8 (999) 123-45-67'), '79991234567');
  assert.equal(isStorefrontEmail('client@example.ru'), true);
  assert.equal(isStorefrontEmail('not-an-email'), false);
});

test('storefront settings never expose unrelated integration settings', () => {
  assert.deepEqual(sanitizeStorefrontSettings({
    announcementText: 'Доставка бесплатно',
    footer: { email: 'hello@example.ru' },
    apiKey: 'must-not-leak',
    telegramSession: 'must-not-leak',
  }), {
    announcementText: 'Доставка бесплатно',
    footer: { email: 'hello@example.ru' },
  });
});

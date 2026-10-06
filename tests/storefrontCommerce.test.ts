import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isStorefrontEmail,
  normalizeStorefrontCart,
  normalizeStorefrontPhone,
  sanitizeStorefrontProduct,
  sanitizeStorefrontSettings,
} from '../src/lib/storefrontCommerce.ts';

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
  });
});

test('hidden or incomplete products are not published', () => {
  assert.equal(sanitizeStorefrontProduct('p1', { name: 'A', sellingPrice: 1, photos: ['https://x'], storefrontPublished: false }), null);
  assert.equal(sanitizeStorefrontProduct('p2', { name: 'A', sellingPrice: 0, photos: ['https://x'] }), null);
  assert.equal(sanitizeStorefrontProduct('p3', { name: 'A', sellingPrice: 1, photos: [] }), null);
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

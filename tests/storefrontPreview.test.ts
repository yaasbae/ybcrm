import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isStorefrontPreviewRequestAllowed } from '../src/lib/storefrontPreview.ts';

test('local preview allows only storefront reads and tariff calculation', () => {
  for (const path of ['/storefront/bootstrap', '/storefront/cdek/cities', '/storefront/cdek/points']) {
    assert.equal(isStorefrontPreviewRequestAllowed('GET', path), true);
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) assert.equal(isStorefrontPreviewRequestAllowed(method, path), false);
  }
  assert.equal(isStorefrontPreviewRequestAllowed('POST', '/storefront/cdek/calculate'), true);
});

test('preview rejects checkout, payment, shipment, messaging and unrelated reads', () => {
  for (const path of ['/storefront/checkout', '/tochka/create-payment', '/yandex-pay/create-payment', '/cdek/create-order', '/broadcast/telegram', '/orders', '/storefront/bootstrap/extra']) {
    for (const method of ['GET', 'POST', 'PUT', 'PATCH', 'DELETE']) assert.equal(isStorefrontPreviewRequestAllowed(method, path), false);
  }
});

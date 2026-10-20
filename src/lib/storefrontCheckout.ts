import { createHmac, timingSafeEqual } from 'node:crypto';
import {
  isStorefrontEmail,
  normalizeStorefrontCart,
  normalizeStorefrontPhone,
  type StorefrontCartInput,
} from './storefrontCommerce.ts';

export type StorefrontCheckoutInput = {
  cart: StorefrontCartInput[];
  customer: {
    name: string;
    phone: string;
    email: string;
  };
  delivery: {
    cityCode: number;
    city: string;
    pointCode: string;
    pointAddress: string;
    tariffCode: number;
  };
  paymentMethod: 'tochka' | 'split';
  expectedTotal?: number;
};

export function stableJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map(key => `${JSON.stringify(key)}:${stableJson(record[key])}`).join(',')}}`;
}

export function storefrontSignature(secret: string, timestamp: string, requestId: string, payload: unknown) {
  return createHmac('sha256', secret)
    .update(`${timestamp}.${requestId}.${stableJson(payload)}`)
    .digest('hex');
}

export function verifyStorefrontSignature(input: {
  secret: string;
  timestamp: unknown;
  requestId: unknown;
  signature: unknown;
  payload: unknown;
  now?: number;
  maxAgeMs?: number;
}) {
  const timestamp = String(input.timestamp || '').trim();
  const requestId = String(input.requestId || '').trim();
  const signature = String(input.signature || '').trim().toLowerCase();
  const numericTimestamp = Number(timestamp);
  const maxAgeMs = input.maxAgeMs ?? 5 * 60_000;
  if (!input.secret || !/^\d{13}$/.test(timestamp) || !/^[a-zA-Z0-9-]{16,80}$/.test(requestId) || !/^[a-f0-9]{64}$/.test(signature)) return false;
  if (Math.abs((input.now ?? Date.now()) - numericTimestamp) > maxAgeMs) return false;
  const expected = storefrontSignature(input.secret, timestamp, requestId, input.payload);
  return timingSafeEqual(Buffer.from(signature, 'hex'), Buffer.from(expected, 'hex'));
}

export function normalizeStorefrontCheckout(value: unknown): { value?: StorefrontCheckoutInput; error?: string } {
  const row = value && typeof value === 'object' ? value as Record<string, any> : {};
  if (!Array.isArray(row.cart) || !row.cart.length) return { error: 'Корзина пуста' };
  // Checkout must reject malformed lines, never silently drop or clamp them.
  if (row.cart.length > 30 || row.cart.some((line: any) =>
    !line || typeof line !== 'object' || Array.isArray(line)
    || typeof line.productId !== 'string' || !line.productId.trim()
    || line.productId.trim().length > 160 || line.productId.includes('/')
    || typeof line.quantity !== 'number' || !Number.isInteger(line.quantity) || line.quantity < 1 || line.quantity > 20
    || (line.size !== undefined && (typeof line.size !== 'string' || line.size.length > 40))
    || (line.fit !== undefined && (typeof line.fit !== 'string' || line.fit.length > 60))
  )) return { error: 'Некорректный состав корзины. Проверьте товары и количество.' };
  const cart = normalizeStorefrontCart(row.cart);
  const name = String(row.customer?.name || '').trim().replace(/\s+/g, ' ').slice(0, 160);
  const phone = normalizeStorefrontPhone(row.customer?.phone);
  const email = String(row.customer?.email || '').trim().toLowerCase().slice(0, 254);
  const cityCode = Number(row.delivery?.cityCode || 0);
  const city = String(row.delivery?.city || '').trim().slice(0, 160);
  const pointCode = String(row.delivery?.pointCode || '').trim().slice(0, 80);
  const pointAddress = String(row.delivery?.pointAddress || '').trim().slice(0, 300);
  const tariffCode = Number(row.delivery?.tariffCode || 0);
  const paymentMethod = row.paymentMethod === 'split' ? 'split' : row.paymentMethod === 'tochka' ? 'tochka' : null;
  if (!cart.length) return { error: 'Корзина пуста' };
  if (name.length < 3) return { error: 'Укажите имя и фамилию получателя' };
  if (!/^7\d{10}$/.test(phone)) return { error: 'Укажите российский номер телефона' };
  if (!isStorefrontEmail(email)) return { error: 'Укажите корректную электронную почту' };
  if (!Number.isInteger(cityCode) || cityCode <= 0 || !city || !pointCode || !Number.isInteger(tariffCode) || tariffCode <= 0) {
    return { error: 'Выберите город, тариф и пункт выдачи СДЭК' };
  }
  if (!paymentMethod) return { error: 'Выберите способ оплаты' };
  if (row.expectedTotal !== undefined && (typeof row.expectedTotal !== 'number' || !Number.isFinite(row.expectedTotal) || row.expectedTotal <= 0)) return { error: 'Некорректная ожидаемая сумма заказа' };
  return {
    value: {
      cart,
      customer: { name, phone, email },
      delivery: { cityCode, city, pointCode, pointAddress, tariffCode },
      paymentMethod,
      ...(row.expectedTotal !== undefined ? { expectedTotal: row.expectedTotal } : {}),
    },
  };
}

export function checkoutQuoteMatches(expected: number | undefined, actual: number): boolean {
  return Number.isFinite(actual) && actual > 0 && (expected === undefined || Math.round(expected * 100) === Math.round(actual * 100));
}

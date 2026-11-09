export const SALE_BADGE_COLORS = ['red', 'white', 'pink', 'black', 'transparent'] as const;
export type SaleBadgeColor = typeof SALE_BADGE_COLORS[number];

export function productSale(basePrice: number, rawDiscount: unknown, rawBadge: unknown, rawColor: unknown) {
  const price = Math.round(Number(basePrice) * 100) / 100;
  const discount = typeof rawDiscount === 'number' && Number.isFinite(rawDiscount)
    ? Math.round(rawDiscount * 100) / 100 : 0;
  if (!Number.isFinite(price) || price <= 0 || discount < 0 || discount >= price || discount > 1e9) {
    return { discountAmount: 0, salePrice: price, saleBadgeText: '', saleBadgeColor: 'black' as SaleBadgeColor };
  }
  const badge = typeof rawBadge === 'string' ? rawBadge.trim().slice(0, 24) : '';
  const color = SALE_BADGE_COLORS.includes(rawColor as SaleBadgeColor) ? rawColor as SaleBadgeColor : 'black';
  return { discountAmount: discount, salePrice: Math.round((price - discount) * 100) / 100,
    saleBadgeText: discount ? badge : '', saleBadgeColor: color };
}

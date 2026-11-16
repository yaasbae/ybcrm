type ProductionNotificationOrder = {
  orderId?: unknown;
  orderNumber?: unknown;
  item?: unknown;
  items?: unknown;
  itemColors?: unknown;
  itemSizes?: unknown;
  itemHeights?: unknown;
};

const escapeHtml = (value: unknown) => String(value ?? '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;');

const cleanValue = (value: unknown, maxLength = 500) => {
  const text = String(value ?? '').trim();
  return escapeHtml(text.length > maxLength ? `${text.slice(0, maxLength - 1)}…` : text);
};

export const buildProductionStageTelegramText = (
  order: ProductionNotificationOrder,
  status: string,
  crmBaseUrl = 'https://ybcrm.ru',
) => {
  const items = Array.isArray(order.items)
    ? order.items.map((value) => String(value || '').trim()).filter(Boolean)
    : String(order.item || '').split(/\s*,\s*|\n/).map((value) => value.trim()).filter(Boolean);
  const colors = Array.isArray(order.itemColors) ? order.itemColors : [];
  const sizes = Array.isArray(order.itemSizes) ? order.itemSizes : [];
  const heights = Array.isArray(order.itemHeights) ? order.itemHeights : [];
  const productLines = items.map((item, index) => {
    const variant = [colors[index], sizes[index], heights[index]]
      .map((value) => String(value || '').trim())
      .filter(Boolean);
    return `${item}${variant.length ? ` — ${variant.join(' / ')}` : ''}`;
  });
  const orderId = String(order.orderNumber || order.orderId || '').replace(/^#+/, '').trim();
  const title = status.trim().toLocaleLowerCase('ru-RU') === 'готов'
    ? '✅ <b>Заказ отшит и готов</b>'
    : `🏭 <b>Этап производства: ${cleanValue(status, 100)}</b>`;
  const orderUrl = `${crmBaseUrl.replace(/\/$/, '')}/orders?order=${encodeURIComponent(orderId)}`;

  return [
    title,
    `Заказ: <b>#${cleanValue(orderId, 100)}</b>`,
    productLines.length ? `Изделия: ${cleanValue(productLines.join('; '), 1200)}` : 'Изделия: —',
    `<a href="${escapeHtml(orderUrl)}">Открыть заказ в CRM</a>`,
  ].join('\n');
};

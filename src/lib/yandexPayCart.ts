function asMoney(value: unknown) {
  return Math.max(0, Number(value) || 0).toFixed(2);
}

function allocateMoney(total: number, weights: number[], count: number) {
  const totalCents = Math.round(Math.max(0, total) * 100);
  const safeCount = Math.max(1, count);
  const safeWeights = Array.from({ length: safeCount }, (_, index) => Math.max(0, Number(weights[index]) || 0));
  const weightTotal = safeWeights.reduce((sum, value) => sum + value, 0);
  let remaining = totalCents;
  return safeWeights.map((weight, index) => {
    const cents = index === safeCount - 1
      ? remaining
      : Math.min(remaining, Math.round(weightTotal > 0 ? totalCents * (weight / weightTotal) : totalCents / safeCount));
    remaining -= cents;
    return cents / 100;
  });
}

export function buildYandexPayCart(orderId: string, order: any, amount: number) {
  const rawItems = Array.isArray(order.items) && order.items.length ? order.items : [order.item || `Заказ #${orderId}`];
  const prices = Array.isArray(order.itemPrices) ? order.itemPrices.map((value: unknown) => Number(value) || 0) : [];
  const quantities = Array.isArray(order.itemQuantities) ? order.itemQuantities : [];
  const revenue = Math.max(0, Number(order.revenue) || 0);
  const positivePrices = rawItems.map((_: unknown, index: number) => Math.max(0, prices[index] || 0));
  const knownTotal = positivePrices.reduce((sum: number, value: number) => sum + value, 0);
  const productTotal = revenue || knownTotal;
  const normalizedPrices = allocateMoney(productTotal, knownTotal > 0 ? positivePrices : rawItems.map(() => 1), rawItems.length);
  const delivery = Math.max(0, Number(order.deliveryPrice) || 0);
  const expectedTotal = productTotal + delivery;
  if (Math.abs(expectedTotal - amount) > 0.02) {
    throw new Error(`Для Сплита нужна полная сумма заказа ${asMoney(expectedTotal)} ₽, сейчас передано ${asMoney(amount)} ₽`);
  }
  const items = rawItems.map((title: unknown, index: number) => {
    const count = Number(quantities[index]);
    const quantity = Number.isSafeInteger(count) && count > 0 ? count : 1;
    const lineTotal = normalizedPrices[index];
    return {
      productId: String(order.itemProductIds?.[index] || `${orderId}-item-${index + 1}`),
      skuId: `${orderId}-${index + 1}`,
      title: String(title || `Товар ${index + 1}`).replace(/\s×\s\d+$/, '').slice(0, 2048),
      quantity: { count: String(quantity) },
      total: asMoney(lineTotal),
    };
  });
  if (delivery > 0) {
    items.push({
      productId: `${orderId}-delivery`,
      skuId: `${orderId}-delivery`,
      title: `Доставка ${String(order.deliveryMethod || '').trim() || 'заказа'}`,
      quantity: { count: '1' },
      total: asMoney(delivery),
    });
  }
  return { externalId: orderId, items, total: { amount: asMoney(amount) } };
}

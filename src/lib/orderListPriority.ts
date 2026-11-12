type OrderListPriorityInput = {
  status?: unknown;
  isShipped?: unknown;
  isPinned?: unknown;
  exchangeAt?: unknown;
  exchangeOriginalOrderId?: unknown;
  date?: unknown;
};

const normalizedStatus = (value: unknown) => String(value || '').trim().toLowerCase();

export const isExchangeOrder = (order: OrderListPriorityInput) => Boolean(
  String(order.exchangeAt || '').trim()
  || String(order.exchangeOriginalOrderId || '').trim()
  || normalizedStatus(order.status) === 'обмен'
);

export const isPendingExchangeOrder = (order: OrderListPriorityInput) =>
  isExchangeOrder(order)
  && normalizedStatus(order.status) === 'обмен'
  && order.isShipped !== true;

export const isOrderPinnedAtTop = (order: OrderListPriorityInput) =>
  isPendingExchangeOrder(order)
  || (Boolean(order.isPinned) && !isExchangeOrder(order));

const orderDateTime = (value: unknown) => {
  if (value instanceof Date) return Number.isFinite(value.getTime()) ? value.getTime() : 0;
  const parsed = new Date(String(value || ''));
  return Number.isFinite(parsed.getTime()) ? parsed.getTime() : 0;
};

export const compareOrdersForList = (a: OrderListPriorityInput, b: OrderListPriorityInput) => {
  const exchangeDifference = Number(isPendingExchangeOrder(b)) - Number(isPendingExchangeOrder(a));
  if (exchangeDifference) return exchangeDifference;
  const pinDifference = Number(isOrderPinnedAtTop(b)) - Number(isOrderPinnedAtTop(a));
  if (pinDifference) return pinDifference;
  return orderDateTime(b.date) - orderDateTime(a.date);
};

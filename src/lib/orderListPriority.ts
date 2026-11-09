type OrderListPriorityInput = {
  status?: unknown;
  isShipped?: unknown;
  isPinned?: unknown;
  exchangeAt?: unknown;
  exchangeOriginalOrderId?: unknown;
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

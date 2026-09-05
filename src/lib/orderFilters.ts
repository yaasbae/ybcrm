export const PREPAYMENT_FILTER_VALUE = '__prepayment__';
export const OVERDUE_FILTER_VALUE = '__overdue__';
export const REFUND_OR_CANCELLED_FILTER_VALUE = '__refund_or_cancelled__';

type PaymentOrder = {
  invoiceType?: unknown;
  paymentType?: unknown;
};

type StatusOrder = {
  status?: unknown;
};

export const isPrepaymentOrder = (order: PaymentOrder) => {
  const invoiceType = String(order.invoiceType || '').trim().toLowerCase();
  const paymentType = String(order.paymentType || '').trim().toLowerCase();

  return invoiceType === 'prepayment' || paymentType.includes('предоплат');
};

export const isRefundOrCancelledOrder = (order: StatusOrder) => {
  const status = String(order.status || '').trim().toLowerCase();
  return status.includes('возврат') || status.includes('вернули платёж') || status.includes('отмена');
};

export const isOverdueOrder = (order: StatusOrder & { isOverdue?: unknown; isShipped?: unknown }) =>
  Boolean(order.isOverdue) && !Boolean(order.isShipped) && !isRefundOrCancelledOrder(order);

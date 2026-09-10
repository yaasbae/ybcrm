import { getEffectiveInvoiceType, type PaymentAccountingOrder } from './orderPayments';

export const PREPAYMENT_FILTER_VALUE = '__prepayment__';
export const OVERDUE_FILTER_VALUE = '__overdue__';
export const REFUND_OR_CANCELLED_FILTER_VALUE = '__refund_or_cancelled__';

type PaymentOrder = {
  invoiceType?: unknown;
  paymentType?: unknown;
  revenue?: unknown;
  deliveryPrice?: unknown;
  paidAmount?: unknown;
  initialPaymentAmount?: unknown;
  paymentAmount?: unknown;
  paymentStatus?: unknown;
  finalPaymentAmount?: unknown;
  finalPaymentStatus?: unknown;
  status?: unknown;
};

type StatusOrder = {
  status?: unknown;
};

export const isPrepaymentOrder = (order: PaymentOrder) => {
  if (getEffectiveInvoiceType(order as PaymentAccountingOrder) !== 'prepayment') return false;
  const status = String(order.status || '').trim().toLowerCase();
  if (/отгруж|достав|получ|возврат|вернули платёж|отмен/.test(status)) return false;
  const isPaid = (value: unknown) => /paid|approved|accepted|completed|succeeded|success|done|captured|confirmed/.test(String(value || '').toLowerCase());
  const total = Math.max(0, (Number(order.revenue) || 0) + (Number(order.deliveryPrice) || 0));
  const mainPaid = isPaid(order.paymentStatus)
    ? Number(order.paymentAmount) || Number(order.initialPaymentAmount) || Number(order.paidAmount) || 0
    : 0;
  const finalPaid = isPaid(order.finalPaymentStatus) ? Number(order.finalPaymentAmount) || 0 : 0;
  return total <= 0 || mainPaid + finalPaid < total;
};

export const isRefundOrCancelledOrder = (order: StatusOrder) => {
  const status = String(order.status || '').trim().toLowerCase();
  return status.includes('возврат') || status.includes('вернули платёж') || status.includes('отмена');
};

export const isOverdueOrder = (order: StatusOrder & { isOverdue?: unknown; isShipped?: unknown }) =>
  Boolean(order.isOverdue) && !Boolean(order.isShipped) && !isRefundOrCancelledOrder(order);

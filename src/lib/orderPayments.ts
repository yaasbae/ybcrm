export type PaymentAccountingOrder = {
  revenue?: number;
  deliveryPrice?: number;
  paidAmount?: number;
  initialPaymentAmount?: number;
  paymentAmount?: number;
  paymentStatus?: string;
  paymentUrl?: string;
  paymentId?: string;
  finalPaymentAmount?: number;
  finalPaymentStatus?: string;
  finalPaymentUrl?: string;
  finalPaymentId?: string;
  invoiceType?: 'prepayment' | 'full' | 'fitting';
  paymentType?: string;
  paymentAccountingVersion?: number;
};

export const isConfirmedPaymentStatus = (status?: string) => {
  const normalized = String(status || '').toLowerCase();
  return ['paid', 'approved', 'completed', 'succeeded', 'success', 'done', 'captured', 'confirmed'].some(value => normalized.includes(value));
};

export const getOrderTotalAmount = (order: PaymentAccountingOrder) =>
  Math.max(0, (Number(order.revenue) || 0) + (Number(order.deliveryPrice) || 0));

export const getCalculatedInitialInvoiceAmount = (order: PaymentAccountingOrder) => {
  const total = getOrderTotalAmount(order);
  const invoiceType = order.invoiceType || (
    /пример/i.test(String(order.paymentType || '')) ? 'fitting'
      : /полн|100|сплит/i.test(String(order.paymentType || '')) ? 'full'
        : 'prepayment'
  );
  if (invoiceType === 'fitting') return Math.min(total, 2000);
  return invoiceType === 'full' ? total : total * 0.5;
};

export const getInitialInvoiceAmount = (order: PaymentAccountingOrder) => {
  const fixed = Number(order.paymentAmount) || Number(order.initialPaymentAmount) || 0;
  if (fixed > 0) return Math.min(getOrderTotalAmount(order), fixed);
  const legacy = Number(order.paidAmount) || 0;
  if (legacy > 0) return Math.min(getOrderTotalAmount(order), legacy);
  return getCalculatedInitialInvoiceAmount(order);
};

export const hasBankPaymentTracking = (order: PaymentAccountingOrder) => Boolean(
  order.paymentUrl || order.paymentId || order.paymentStatus ||
  order.finalPaymentUrl || order.finalPaymentId || order.finalPaymentStatus ||
  Number(order.paymentAccountingVersion) >= 2
);

export const getConfirmedPaidAmount = (order: PaymentAccountingOrder) => {
  const main = isConfirmedPaymentStatus(order.paymentStatus)
    ? Number(order.paymentAmount) || Number(order.initialPaymentAmount) || Number(order.paidAmount) || 0
    : 0;
  const final = isConfirmedPaymentStatus(order.finalPaymentStatus)
    ? Number(order.finalPaymentAmount) || 0
    : 0;
  if (hasBankPaymentTracking(order)) return Math.min(getOrderTotalAmount(order), Math.max(0, main + final));
  // Старые импортированные заказы не имеют банковских идентификаторов.
  return Math.min(getOrderTotalAmount(order), Math.max(0, Number(order.paidAmount) || 0));
};

export const getPlannedFinalPaymentAmount = (order: PaymentAccountingOrder) =>
  Math.max(0, getOrderTotalAmount(order) - getCalculatedInitialInvoiceAmount(order));

export const getOutstandingPaymentAmount = (order: PaymentAccountingOrder) =>
  Math.max(0, getOrderTotalAmount(order) - getConfirmedPaidAmount(order));

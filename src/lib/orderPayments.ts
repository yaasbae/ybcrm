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
  status?: string;
  refundStatus?: string;
  mainRefundStatus?: string;
};

export const isConfirmedPaymentStatus = (status?: string) => {
  const normalized = String(status || '').toLowerCase();
  return ['paid', 'approved', 'accepted', 'completed', 'succeeded', 'success', 'done', 'captured', 'confirmed'].some(value => normalized.includes(value));
};

export const getStablePaymentStatus = (storedStatus?: string, incomingStatus?: string) => {
  if (isConfirmedPaymentStatus(storedStatus) && !isConfirmedPaymentStatus(incomingStatus)) {
    return String(storedStatus);
  }
  return String(incomingStatus || storedStatus || '');
};

export const canAttemptFinalPayment = (order: PaymentAccountingOrder) => (
  isConfirmedPaymentStatus(order.paymentStatus) || Boolean(order.paymentUrl || order.paymentId)
);

export const getCreatedPaymentAmount = (response: unknown, requestedAmount: number) => {
  const responseAmount = Number((response as { paymentAmount?: unknown } | null)?.paymentAmount);
  return Number.isFinite(responseAmount) && responseAmount > 0 ? responseAmount : requestedAmount;
};

export const getOrderTotalAmount = (order: PaymentAccountingOrder) =>
  Math.max(0, (Number(order.revenue) || 0) + (Number(order.deliveryPrice) || 0));

export const getEffectiveInvoiceType = (order: PaymentAccountingOrder): 'prepayment' | 'full' | 'fitting' => {
  const paymentType = String(order.paymentType || '');
  if (/сплит/i.test(paymentType)) return 'full';
  const total = getOrderTotalAmount(order);
  const confirmedMain = isConfirmedPaymentStatus(order.paymentStatus)
    ? Number(order.paymentAmount) || Number(order.initialPaymentAmount) || Number(order.paidAmount) || 0
    : 0;
  const confirmedFinal = isConfirmedPaymentStatus(order.finalPaymentStatus)
    ? Number(order.finalPaymentAmount) || 0
    : 0;
  if (total > 0 && confirmedMain + confirmedFinal >= total) return 'full';
  const issuedAmount = Number(order.paymentAmount) || Number(order.initialPaymentAmount) || 0;
  const hasIssuedInvoice = Boolean(order.paymentUrl || order.paymentId || issuedAmount > 0);
  if (hasIssuedInvoice && issuedAmount > 0 && total > 0 && issuedAmount < total) {
    return /пример/i.test(paymentType) || order.invoiceType === 'fitting' ? 'fitting' : 'prepayment';
  }
  if (hasIssuedInvoice && issuedAmount >= total && total > 0) return 'full';
  if (/пример/i.test(paymentType)) return 'fitting';
  if (/полн|100/i.test(paymentType)) return 'full';
  if (/предоплат|prepay|(^|\D)50\s*%?(\D|$)/i.test(paymentType)) return 'prepayment';
  return order.invoiceType || 'prepayment';
};

export const getCalculatedInitialInvoiceAmount = (order: PaymentAccountingOrder) => {
  const total = getOrderTotalAmount(order);
  const paymentType = String(order.paymentType || '');
  // В старых заказах тип первого платежа сохранялся в paymentType. Если там
  // явно указаны 100%, 50% или примерка, это важнее устаревшего invoiceType.
  const legacyExplicitType = /пример/i.test(paymentType) ? 'fitting'
    : /полн|100|сплит/i.test(paymentType) ? 'full'
      : /предоплат|prepay|(^|\D)50\s*%?(\D|$)/i.test(paymentType) ? 'prepayment'
        : null;
  const invoiceType = legacyExplicitType || order.invoiceType || 'prepayment';
  if (invoiceType === 'fitting') return Math.min(total, 2000);
  return invoiceType === 'full' ? total : total * 0.5;
};

export const getNewOrderPaymentAccounting = (order: PaymentAccountingOrder) => ({
  paidAmount: 0,
  initialPaymentAmount: getCalculatedInitialInvoiceAmount(order),
  paymentAccountingVersion: 2,
});

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
  const legacyFulfilledPayment = /отгруж|достав|получ|вручен/i.test(String(order.status || ''))
    ? Number(order.paidAmount) || 0
    : 0;
  const main = isConfirmedPaymentStatus(order.paymentStatus)
    ? Number(order.paymentAmount) || Number(order.initialPaymentAmount) || Number(order.paidAmount) || 0
    : legacyFulfilledPayment;
  const final = isConfirmedPaymentStatus(order.finalPaymentStatus)
    ? Number(order.finalPaymentAmount) || 0
    : 0;
  if (hasBankPaymentTracking(order)) return Math.min(getOrderTotalAmount(order), Math.max(0, main + final));
  // Старые импортированные заказы не имеют банковских идентификаторов.
  return Math.min(getOrderTotalAmount(order), Math.max(0, Number(order.paidAmount) || 0));
};

export const getPlannedFinalPaymentAmount = (order: PaymentAccountingOrder) =>
  Math.max(0, getOrderTotalAmount(order) - getInitialInvoiceAmount(order));

export const getOutstandingPaymentAmount = (order: PaymentAccountingOrder) =>
  Math.max(0, getOrderTotalAmount(order) - getConfirmedPaidAmount(order));

export const isFullyPaidOrder = (order: PaymentAccountingOrder) => {
  const total = getOrderTotalAmount(order);
  return total > 0 && getConfirmedPaidAmount(order) >= total;
};

export const shouldOfferMainPaymentRefund = (order: PaymentAccountingOrder) => {
  const refundState = String(order.mainRefundStatus || order.refundStatus || '');
  if (refundState && !/fail|error/i.test(refundState)) return false;
  const hasBankInvoice = Boolean(order.paymentUrl || order.paymentId);
  if (!hasBankInvoice) return false;
  if (isConfirmedPaymentStatus(order.paymentStatus)) return true;
  // A manager can explicitly move an order to refund/cancellation before the
  // bank webhook is reconciled. The server still verifies the real transaction
  // before any money is returned.
  return /возврат|отмен/i.test(String(order.status || '')) && getInitialInvoiceAmount(order) > 0;
};

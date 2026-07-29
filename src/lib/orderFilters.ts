export const PREPAYMENT_FILTER_VALUE = '__prepayment__';

type PaymentOrder = {
  invoiceType?: unknown;
  paymentType?: unknown;
};

export const isPrepaymentOrder = (order: PaymentOrder) => {
  const invoiceType = String(order.invoiceType || '').trim().toLowerCase();
  const paymentType = String(order.paymentType || '').trim().toLowerCase();

  return invoiceType === 'prepayment' || paymentType.includes('предоплат');
};

export type TochkaStatementPaymentMatch = {
  transaction: Record<string, any>;
  trxId: string;
  bankTransactionId: string;
};

const operationAmount = (operation: any) => Number(
  operation?.Amount?.amount
  ?? operation?.Amount?.Amount
  ?? operation?.amount?.amount
  ?? operation?.amount?.Amount
  ?? operation?.amount
  ?? 0
) || 0;

const operationText = (operation: any) => JSON.stringify(operation || '').toLowerCase();

const extractSbpTrxId = (operation: any) => {
  const candidates = [
    operation?.trxId,
    operation?.operationId,
    operation?.paymentId,
    operation?.PaymentId,
  ].map(value => String(value || '').trim()).filter(Boolean);

  for (const candidate of candidates) {
    if (/^[a-f0-9]{32}$/i.test(candidate)) return candidate;
    const match = candidate.match(/(?:nspk-sbp-core-c2b-|(?:^|-)c2b-)([a-f0-9]{32})(?:-|$)/i);
    if (match?.[1]) return match[1];
  }
  return '';
};

export const findSbpStatementPayment = (
  transactions: any[],
  qrcId: string,
  expectedAmount: number,
): TochkaStatementPaymentMatch | null => {
  const cleanQrcId = String(qrcId || '').trim().toLowerCase();
  if (!cleanQrcId || !Array.isArray(transactions)) return null;

  const related = transactions.filter(operation => operationText(operation).includes(cleanQrcId));
  const payment = related.find(operation => {
    const direction = String(operation?.creditDebitIndicator || operation?.CreditDebitIndicator || '').toLowerCase();
    return direction === 'credit' && Math.abs(operationAmount(operation) - expectedAmount) < 0.01;
  });
  if (!payment) return null;

  const trxId = related.map(extractSbpTrxId).find(Boolean) || '';
  if (!trxId) return null;

  return {
    transaction: payment,
    trxId,
    bankTransactionId: String(payment?.transactionId || payment?.TransactionId || ''),
  };
};

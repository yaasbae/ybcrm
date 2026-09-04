import { getConfirmedPaidAmount, getOrderTotalAmount } from './orderPayments';

export type FinancePeriod = 'month' | 'quarter' | 'halfYear' | 'year';

export interface FinanceBankOperation {
  id: string;
  date: string;
  amount: number;
  absAmount: number;
  direction: 'income' | 'expense';
  category?: string;
  description?: string;
  counterparty?: string;
  isInternalTransfer?: boolean;
  isRefund?: boolean;
}

export interface FinanceReportInput {
  orders: any[];
  products: any[];
  expenses: Array<{ id?: string; amount: number; date: Date | string; category?: string; description?: string; status?: 'planned' | 'paid'; paid?: boolean }>;
  operations: FinanceBankOperation[];
  selectedDate: Date;
  period: FinancePeriod;
  bankBalance: number;
  expenseCategoryOverrides?: Record<string, string>;
  reconciliationOverrides?: Record<string, string>;
}

export interface ReconciliationRow {
  operationId: string;
  date: Date;
  amount: number;
  description: string;
  orderId?: string;
  orderNumber?: string;
  clientName?: string;
  orderTotal?: number;
  status: 'matched' | 'suggested' | 'unmatched';
  method: 'manual' | 'order_reference' | 'amount_and_date' | 'none';
}

const DAY = 86_400_000;

export const parseFinanceDate = (value: any): Date => {
  if (value?.toDate) return value.toDate();
  if (value instanceof Date) return value;
  const raw = String(value || '').trim();
  const ru = raw.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/);
  const date = ru
    ? new Date(Number(ru[3]), Number(ru[2]) - 1, Number(ru[1]))
    : new Date(value || 0);
  return Number.isNaN(date.getTime()) ? new Date(0) : date;
};

export const getFinancePeriodRange = (selectedDate: Date, period: FinancePeriod) => {
  const year = selectedDate.getFullYear();
  const month = selectedDate.getMonth();
  let startMonth = month;
  let endMonth = month;
  if (period === 'quarter') {
    startMonth = Math.floor(month / 3) * 3;
    endMonth = startMonth + 2;
  } else if (period === 'halfYear') {
    startMonth = month < 6 ? 0 : 6;
    endMonth = startMonth + 5;
  } else if (period === 'year') {
    startMonth = 0;
    endMonth = 11;
  }
  return {
    start: new Date(year, startMonth, 1),
    end: new Date(year, endMonth + 1, 0, 23, 59, 59, 999),
  };
};

const isWithin = (value: any, start: Date, end: Date) => {
  const time = parseFinanceDate(value).getTime();
  return time >= start.getTime() && time <= end.getTime();
};

const getOrderDate = (order: any) => parseFinanceDate(order?.date || order?.orderDate || order?.createdAt);

const getOrderRevenue = (order: any) => {
  if (Array.isArray(order?.itemPrices) && order.itemPrices.length) {
    return order.itemPrices.reduce((sum: number, value: any) => sum + (Number(value) || 0), 0)
      + (Number(order?.deliveryPrice ?? order?.shippingCost) || 0);
  }
  return getOrderTotalAmount(order);
};

const isCancelled = (order: any) => /отмен|cancel/i.test(String(order?.status || ''));
const isReturned = (order: any) => /возврат|refund/i.test(String(order?.status || '')) || Number(order?.refundAmount) > 0;
const isSale = (order: any) => !order?.isBlogger && !isCancelled(order) && getOrderRevenue(order) > 0;

const getProductCost = (product: any) => Number(product?.costPrice ?? product?.unitEconomics?.totalCostsPerItem) || 0;

const getOrderCogs = (order: any, productsById: Map<string, any>, productsByName: Map<string, any>) => {
  if (Array.isArray(order?.itemCosts) && order.itemCosts.some((value: any) => Number(value) > 0)) {
    return order.itemCosts.reduce((sum: number, value: any) => sum + (Number(value) || 0), 0);
  }
  if (Number(order?.costPrice ?? order?.costOfGoods) > 0) return Number(order.costPrice ?? order.costOfGoods);
  const ids = Array.isArray(order?.productIds) ? order.productIds : [];
  if (ids.length) return ids.reduce((sum: number, id: any) => sum + getProductCost(productsById.get(String(id))), 0);
  const names = Array.isArray(order?.items)
    ? order.items
    : String(order?.products || '').split(',').map((value: string) => value.trim()).filter(Boolean);
  return names.reduce((sum: number, name: any) => sum + getProductCost(productsByName.get(String(name).trim().toLowerCase())), 0);
};

const normalizeRef = (value: any) => String(value || '').replace(/^#/, '').trim().toLowerCase();

export const reconcileBankIncome = (operations: FinanceBankOperation[], orders: any[], overrides: Record<string, string> = {}): ReconciliationRow[] => {
  const incomes = operations.filter(operation => operation.direction === 'income' && !operation.isInternalTransfer);
  const claimedOrders = new Set<string>();
  return incomes.map(operation => {
    const manuallyMatched = orders.find(order => String(order.id) === String(overrides[operation.id] || ''));
    if (manuallyMatched) {
      claimedOrders.add(String(manuallyMatched.id));
      return {
        operationId: operation.id,
        date: parseFinanceDate(operation.date),
        amount: Number(operation.absAmount) || 0,
        description: operation.description || operation.counterparty || 'Поступление',
        orderId: String(manuallyMatched.id),
        orderNumber: String(manuallyMatched.orderNumber || manuallyMatched.id),
        clientName: manuallyMatched.clientName,
        orderTotal: getOrderRevenue(manuallyMatched),
        status: 'matched' as const,
        method: 'manual' as const,
      };
    }
    const text = `${operation.description || ''} ${operation.counterparty || ''}`.toLowerCase();
    const exact = orders.find(order => {
      const refs = [order.id, order.orderId, order.orderNumber].map(normalizeRef).filter(ref => ref.length >= 3);
      return refs.some(ref => text.includes(ref));
    });
    if (exact) {
      claimedOrders.add(String(exact.id));
      return {
        operationId: operation.id,
        date: parseFinanceDate(operation.date),
        amount: Number(operation.absAmount) || 0,
        description: operation.description || operation.counterparty || 'Поступление',
        orderId: String(exact.id),
        orderNumber: String(exact.orderNumber || exact.id),
        clientName: exact.clientName,
        orderTotal: getOrderRevenue(exact),
        status: 'matched' as const,
        method: 'order_reference' as const,
      };
    }

    const opDate = parseFinanceDate(operation.date).getTime();
    const candidates = orders.filter(order => {
      if (claimedOrders.has(String(order.id)) || !isSale(order)) return false;
      const expected = getConfirmedPaidAmount(order) || getOrderRevenue(order);
      const amountMatches = Math.abs(expected - Number(operation.absAmount)) < 0.01
        || Math.abs(getOrderRevenue(order) - Number(operation.absAmount)) < 0.01;
      return amountMatches && Math.abs(getOrderDate(order).getTime() - opDate) <= 7 * DAY;
    });
    const suggested = candidates.length === 1 ? candidates[0] : null;
    if (suggested) claimedOrders.add(String(suggested.id));
    return {
      operationId: operation.id,
      date: parseFinanceDate(operation.date),
      amount: Number(operation.absAmount) || 0,
      description: operation.description || operation.counterparty || 'Поступление',
      ...(suggested ? {
        orderId: String(suggested.id),
        orderNumber: String(suggested.orderNumber || suggested.id),
        clientName: suggested.clientName,
        orderTotal: getOrderRevenue(suggested),
      } : {}),
      status: suggested ? 'suggested' as const : 'unmatched' as const,
      method: suggested ? 'amount_and_date' as const : 'none' as const,
    };
  });
};

const operatingCategory = (category: string) => !/кредит|займ|перевод|дивиденд|основн.*средств|производство\s*\/\s*материал/i.test(category);

export const buildFinanceReport = (input: FinanceReportInput) => {
  const { start, end } = getFinancePeriodRange(input.selectedDate, input.period);
  const productsById = new Map(input.products.map(product => [String(product.id), product]));
  const productsByName = new Map(input.products.map(product => [String(product.name || '').trim().toLowerCase(), product]));
  const periodOrders = input.orders.filter(order => isWithin(order?.date || order?.orderDate || order?.createdAt, start, end));
  const sales = periodOrders.filter(isSale);
  const revenue = sales.reduce((sum, order) => sum + getOrderRevenue(order), 0);
  const returns = periodOrders.filter(isReturned).reduce((sum, order) => sum + (Number(order.refundAmount) || getConfirmedPaidAmount(order) || getOrderRevenue(order)), 0);
  const cogs = sales.reduce((sum, order) => sum + getOrderCogs(order, productsById, productsByName), 0);
  const bankExpenses = input.operations.filter(operation => {
    if (operation.direction !== 'expense' || operation.isInternalTransfer || operation.isRefund) return false;
    const category = input.expenseCategoryOverrides?.[operation.id] || operation.category || 'Другое';
    return operatingCategory(category);
  });
  const bankOperatingExpenses = bankExpenses.reduce((sum, operation) => sum + (Number(operation.absAmount) || 0), 0);
  const manualExpenses = input.expenses
    .filter(expense => isWithin(expense.date, start, end))
    .filter(expense => expense.status !== 'planned' && expense.paid !== false)
    .filter(expense => !bankExpenses.some(operation => (
      Math.abs((Number(operation.absAmount) || 0) - (Number(expense.amount) || 0)) < 0.01
      && Math.abs(parseFinanceDate(operation.date).getTime() - parseFinanceDate(expense.date).getTime()) <= 3 * DAY
    )))
    .reduce((sum, expense) => sum + (Number(expense.amount) || 0), 0);
  const operatingExpenses = bankOperatingExpenses + manualExpenses;
  const grossProfit = revenue - returns - cogs;
  const operatingProfit = grossProfit - operatingExpenses;

  const periodOperations = input.operations.filter(operation => isWithin(operation.date, start, end));
  const cashIncome = periodOperations.filter(operation => operation.direction === 'income' && !operation.isInternalTransfer)
    .reduce((sum, operation) => sum + (Number(operation.absAmount) || 0), 0);
  const cashRefunds = periodOperations.filter(operation => operation.direction === 'expense' && !operation.isInternalTransfer && operation.isRefund)
    .reduce((sum, operation) => sum + (Number(operation.absAmount) || 0), 0);
  const cashExpenses = periodOperations.filter(operation => operation.direction === 'expense' && !operation.isInternalTransfer && !operation.isRefund)
    .reduce((sum, operation) => sum + (Number(operation.absAmount) || 0), 0);
  const netCashFlow = cashIncome - cashRefunds - cashExpenses;

  const activeOrders = input.orders.filter(isSale);
  const receivables = activeOrders.reduce((sum, order) => sum + Math.max(0, getOrderRevenue(order) - getConfirmedPaidAmount(order)), 0);
  const inventory = input.products.reduce((sum, product) => {
    const stock = Number(product.stock ?? product.quantity ?? product.inStock) || 0;
    return sum + stock * getProductCost(product);
  }, 0);
  const assets = input.bankBalance + receivables + inventory;
  const payables = input.expenses.filter(expense => (expense as any).status === 'planned' || (expense as any).paid === false)
    .reduce((sum, expense) => sum + (Number(expense.amount) || 0), 0);
  const customerAdvances = activeOrders.reduce((sum, order) => {
    const paid = getConfirmedPaidAmount(order);
    return sum + (/нов|production|производ/i.test(String(order.status || '')) ? paid : 0);
  }, 0);
  const liabilities = payables + customerAdvances;
  const equity = assets - liabilities;

  const reconciliation = reconcileBankIncome(periodOperations, input.orders, input.reconciliationOverrides);
  const reconciledAmount = reconciliation.filter(row => row.status !== 'unmatched').reduce((sum, row) => sum + row.amount, 0);
  const unmatchedAmount = reconciliation.filter(row => row.status === 'unmatched').reduce((sum, row) => sum + row.amount, 0);
  const reconciliationRate = cashIncome > 0 ? reconciledAmount / cashIncome : 1;

  const productRows = new Map<string, { id: string; name: string; units: number; revenue: number; cogs: number }>();
  sales.forEach(order => {
    const ids = Array.isArray(order.productIds) ? order.productIds : [];
    const names = Array.isArray(order.items) ? order.items : String(order.products || '').split(',').map((value: string) => value.trim()).filter(Boolean);
    const count = Math.max(ids.length, names.length, 1);
    for (let index = 0; index < count; index += 1) {
      const product = productsById.get(String(ids[index])) || productsByName.get(String(names[index] || '').toLowerCase());
      const id = String(product?.id || names[index] || 'unknown');
      const row = productRows.get(id) || { id, name: product?.name || names[index] || 'Без товара', units: 0, revenue: 0, cogs: 0 };
      row.units += 1;
      row.revenue += getOrderRevenue(order) / count;
      row.cogs += getProductCost(product) || getOrderCogs(order, productsById, productsByName) / count;
      productRows.set(id, row);
    }
  });
  const unitEconomics = Array.from(productRows.values()).map(row => ({
    ...row,
    contribution: row.revenue - row.cogs,
    margin: row.revenue > 0 ? (row.revenue - row.cogs) / row.revenue : 0,
    averagePrice: row.units ? row.revenue / row.units : 0,
    unitCost: row.units ? row.cogs / row.units : 0,
  })).sort((a, b) => b.revenue - a.revenue);

  const warnings: Array<{ level: 'critical' | 'warning' | 'info'; title: string; message: string }> = [];
  if (reconciliationRate < 0.9) warnings.push({ level: 'critical', title: 'Сверка банка ниже 90%', message: `${Math.round(reconciliationRate * 100)}% поступлений связано с заказами; разберите ${unmatchedAmount.toLocaleString('ru-RU')} ₽.` });
  if (operatingProfit < 0) warnings.push({ level: 'critical', title: 'Отрицательная операционная прибыль', message: `За период бизнес сработал с результатом ${operatingProfit.toLocaleString('ru-RU')} ₽.` });
  if (revenue > 0 && grossProfit / revenue < 0.35) warnings.push({ level: 'warning', title: 'Низкая валовая маржа', message: `Валовая маржа ${Math.round(grossProfit / revenue * 100)}%; проверьте себестоимость и скидки.` });
  if (receivables > revenue * 0.3 && receivables > 0) warnings.push({ level: 'warning', title: 'Высокая дебиторская задолженность', message: `К доплате по заказам ${receivables.toLocaleString('ru-RU')} ₽.` });
  if (warnings.length === 0) warnings.push({ level: 'info', title: 'Критических отклонений нет', message: 'Денежный поток, маржа и сверка находятся в рабочем диапазоне.' });

  return {
    range: { start, end },
    pnl: { revenue, returns, netRevenue: revenue - returns, cogs, grossProfit, operatingExpenses, operatingProfit, netProfit: operatingProfit },
    cashFlow: { income: cashIncome, expenses: cashExpenses, refunds: cashRefunds, net: netCashFlow },
    balance: { cash: input.bankBalance, receivables, inventory, assets, payables, customerAdvances, liabilities, equity },
    reconciliation: { rows: reconciliation, reconciledAmount, unmatchedAmount, rate: reconciliationRate },
    unitEconomics,
    cfo: { warnings },
  };
};

export const ORDER_ACTION_OPTIONS = [
  ['create', 'Создавать заказы'],
  ['edit', 'Редактировать данные заказа'],
  ['status', 'Менять статус и отмечать отгрузку'],
  ['exchange', 'Оформлять обмен и повторную накладную'],
  ['payments', 'Создавать и проверять оплаты'],
  ['refund', 'Оформлять возвраты оплаты'],
  ['cdek', 'Создавать и обновлять СДЭК'],
  ['delete', 'Удалять заказы'],
  ['export', 'Выгружать заказы в CSV'],
] as const;

export type OrderAction = typeof ORDER_ACTION_OPTIONS[number][0];
export const ALL_ORDER_ACTIONS: OrderAction[] = ORDER_ACTION_OPTIONS.map(([value]) => value);

export const normalizeOrderActions = (value: unknown): OrderAction[] => {
  if (!Array.isArray(value)) return [...ALL_ORDER_ACTIONS];
  const allowed = new Set<string>(ALL_ORDER_ACTIONS);
  return Array.from(new Set(value.map(String).filter(item => allowed.has(item)))) as OrderAction[];
};

export const getOrderActionForField = (field: string, value?: unknown): OrderAction => {
  if (field === 'status') {
    return String(value || '').trim().toLowerCase() === 'обмен' ? 'exchange' : 'status';
  }
  if (field === 'isShipped') return 'status';
  if (/^(payment|finalPayment|initialPayment|paidAmount)/.test(field)) return 'payments';
  if (/^(cdek|exchangeCdek)/.test(field)) return 'cdek';
  return 'edit';
};


export const ORDER_STATUS_RENAMES: Record<string, string> = {
  'В работе': 'Пошив',
  'В пошиве': 'Пошив',
  'Вручен': 'Получен',
  'Накроен': 'Накроить',
};

export const normalizeOrderStatus = (status: unknown) => {
  const value = String(status ?? '').trim();
  return ORDER_STATUS_RENAMES[value] || value;
};

export const isReceivedOrderStatus = (status: unknown) =>
  normalizeOrderStatus(status).toLowerCase() === 'получен';

export const ORDER_STATUS_OPTIONS = [
  'Черновик',
  'Новый',
  'Есть на складе',
  'Пошив',
  'Оплачен',
  'Заказ ткань',
  'Накроить',
  'Упакован',
  'Принят СДЭК',
  'Отгружен',
  'В пути',
  'Доставлен',
  'Получен',
  'Возврат',
  'Обмен',
  'Отмена',
] as const;

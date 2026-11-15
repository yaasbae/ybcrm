const normalizeStatus = (value: unknown) => String(value ?? '')
  .trim()
  .toLocaleLowerCase('ru-RU')
  .replace(/ё/g, 'е')
  .replace(/\s+/g, ' ');

export const getProductionPaymentDate = (productionDate: string) => {
  const [year, month, day] = productionDate.split('-').map(Number);
  if (!year || !month || !day) return '';
  if (day <= 15) {
    const lastDay = new Date(year, month, 0).getDate();
    return `${year}-${String(month).padStart(2, '0')}-${String(Math.min(30, lastDay)).padStart(2, '0')}`;
  }
  const nextMonth = new Date(year, month, 15);
  return `${nextMonth.getFullYear()}-${String(nextMonth.getMonth() + 1).padStart(2, '0')}-15`;
};

export const isProductionPaymentPassed = (paymentDate: string, currentDate: string) =>
  Boolean(paymentDate && currentDate && paymentDate < currentDate);

export const isProductionQueueStatus = (status: unknown) => {
  const normalized = normalizeStatus(status);
  return normalized === 'оплачен'
    || normalized === 'заказ ткань'
    || normalized === 'заказать ткань'
    || normalized === 'накроить'
    || normalized === 'нужно накроить'
    || normalized === 'накроен'
    || normalized === 'пошив'
    || normalized === 'в пошиве';
};

export type ProductionStage = 'fabric' | 'cutting' | 'sewing';

export const getProductionStage = (status: unknown): ProductionStage | null => {
  const normalized = normalizeStatus(status);
  if (normalized === 'оплачен' || normalized === 'заказ ткань' || normalized === 'заказать ткань') return 'fabric';
  if (normalized === 'накроить' || normalized === 'нужно накроить' || normalized === 'накроен') return 'cutting';
  if (normalized === 'пошив' || normalized === 'в пошиве') return 'sewing';
  return null;
};

export const getNextProductionStatus = (stage: ProductionStage) => ({
  fabric: 'Накроить',
  cutting: 'Пошив',
  sewing: 'Готов',
})[stage];

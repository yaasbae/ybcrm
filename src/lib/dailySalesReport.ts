import { isConfirmedPaymentStatus } from './orderPayments';

export type DailyReportOrder = Record<string, any>;

export type DailySalesReport = {
  dateKey: string;
  sales: Array<{
    orderId: string;
    manager: string;
    items: Array<{ name: string; amount: number }>;
    delivery: number;
    total: number;
  }>;
  salesTotal: number;
  mainPayments: Array<{ orderId: string; manager: string; amount: number }>;
  finalPayments: Array<{ orderId: string; manager: string; amount: number }>;
  mainPaymentsTotal: number;
  finalPaymentsTotal: number;
  broadcastSent: number;
  shiftManagers: string[];
};

const MOSCOW_TIME_ZONE = 'Europe/Moscow';

const toDate = (value: any): Date | null => {
  if (!value) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value?.toDate === 'function') return value.toDate();
  if (typeof value?.seconds === 'number') return new Date(value.seconds * 1000);
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

export const getMoscowDateKey = (value: any): string => {
  if (typeof value === 'string') {
    const plainDate = value.match(/^(\d{4}-\d{2}-\d{2})(?:$|[T\s])/);
    if (plainDate && !/[T\s]\d{2}:\d{2}/.test(value)) return plainDate[1];
  }
  const date = toDate(value);
  if (!date) return '';
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: MOSCOW_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const part = (type: string) => parts.find(item => item.type === type)?.value || '';
  return `${part('year')}-${part('month')}-${part('day')}`;
};

export const getPreviousMoscowDateKey = (now = new Date()): string => {
  const todayKey = getMoscowDateKey(now);
  const [year, month, day] = todayKey.split('-').map(Number);
  return getMoscowDateKey(new Date(Date.UTC(year, month - 1, day - 1, 12)));
};

const amount = (value: any) => Math.max(0, Number(value) || 0);

const orderItems = (order: DailyReportOrder) => {
  const names = Array.isArray(order.items)
    ? order.items.map((value: any) => String(value || '').trim()).filter(Boolean)
    : String(order.item || '').split(/\s*,\s*|\n/).map(value => value.trim()).filter(Boolean);
  const prices = Array.isArray(order.itemPrices) ? order.itemPrices.map(amount) : [];
  if (names.length === 1 && !prices.length) prices.push(amount(order.revenue));
  return names.map((name: string, index: number) => ({ name, amount: prices[index] || 0 }));
};

const isSale = (order: DailyReportOrder, dateKey: string) => {
  const status = String(order.status || '').toLowerCase();
  const orderDate = order.date || order.orderDate || order.createdAt;
  return getMoscowDateKey(orderDate) === dateKey
    && order.deleted !== true
    && order.isBlogger !== true
    && order.orderKind !== 'blogger'
    && !status.includes('черновик')
    && !status.includes('возврат')
    && !status.includes('вернул')
    && !status.includes('отмена');
};

const orderId = (order: DailyReportOrder) => String(order.orderId || order.id || order.firestoreId || '—').replace(/^#+/, '');
const manager = (order: DailyReportOrder) => String(order.manager || 'Без менеджера').trim() || 'Без менеджера';

export const buildDailySalesReport = ({
  dateKey,
  orders,
  broadcastSent = 0,
  shiftManagers = [],
}: {
  dateKey: string;
  orders: DailyReportOrder[];
  broadcastSent?: number;
  shiftManagers?: string[];
}): DailySalesReport => {
  const sales = orders.filter(order => isSale(order, dateKey)).map(order => {
    const items = orderItems(order);
    const delivery = amount(order.deliveryPrice ?? order.shippingCost);
    const productTotal = items.some(item => item.amount > 0)
      ? items.reduce((sum, item) => sum + item.amount, 0)
      : amount(order.revenue ?? order.price);
    return { orderId: orderId(order), manager: manager(order), items, delivery, total: productTotal + delivery };
  });
  const mainPayments = orders
    .filter(order => isConfirmedPaymentStatus(order.paymentStatus) && getMoscowDateKey(order.paymentPaidAt) === dateKey)
    .map(order => ({
      orderId: orderId(order),
      manager: manager(order),
      amount: amount(order.paymentAmount ?? order.initialPaymentAmount ?? order.paidAmount),
    }))
    .filter(payment => payment.amount > 0);
  const finalPayments = orders
    .filter(order => isConfirmedPaymentStatus(order.finalPaymentStatus) && getMoscowDateKey(order.finalPaymentPaidAt) === dateKey)
    .map(order => ({ orderId: orderId(order), manager: manager(order), amount: amount(order.finalPaymentAmount) }))
    .filter(payment => payment.amount > 0);

  return {
    dateKey,
    sales,
    salesTotal: sales.reduce((sum, sale) => sum + sale.total, 0),
    mainPayments,
    finalPayments,
    mainPaymentsTotal: mainPayments.reduce((sum, payment) => sum + payment.amount, 0),
    finalPaymentsTotal: finalPayments.reduce((sum, payment) => sum + payment.amount, 0),
    broadcastSent: Math.max(0, Math.trunc(broadcastSent)),
    shiftManagers: Array.from(new Set(shiftManagers.map(value => String(value || '').trim()).filter(Boolean))),
  };
};

const escapeHtml = (value: unknown) => String(value ?? '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;');

const money = (value: number) => `${Math.round(value).toLocaleString('ru-RU')} ₽`;
const clipped = (value: string, limit: number) => value.length > limit ? `${value.slice(0, limit - 1)}…` : value;

export const formatDailySalesReportTelegram = (report: DailySalesReport): string => {
  const [year, month, day] = report.dateKey.split('-');
  const lines = [`📊 <b>Сводка за ${day}.${month}.${year}</b>`, ''];
  lines.push(`🛍 <b>Продажи: ${report.sales.length} · ${money(report.salesTotal)}</b>`);
  if (!report.sales.length) lines.push('Продаж за день нет.');
  report.sales.forEach(sale => {
    const positions = sale.items.length
      ? sale.items.map(item => `${escapeHtml(item.name)}${item.amount > 0 ? ` — ${money(item.amount)}` : ''}`).join('; ')
      : 'позиция не указана';
    lines.push(`• #${escapeHtml(sale.orderId)} · ${escapeHtml(sale.manager)} · ${clipped(positions, 220)}${sale.delivery > 0 ? `; доставка — ${money(sale.delivery)}` : ''}`);
  });
  lines.push('', '<b>Фактические оплаты</b>');
  lines.push(`• Первые / полные: ${report.mainPayments.length} · <b>${money(report.mainPaymentsTotal)}</b>`);
  lines.push(`• Доплаты: ${report.finalPayments.length} · <b>${money(report.finalPaymentsTotal)}</b>`);
  lines.push(`• Всего поступило: <b>${money(report.mainPaymentsTotal + report.finalPaymentsTotal)}</b>`);
  lines.push('', `📨 Успешно отправлено по базе: <b>${report.broadcastSent}</b>`);
  lines.push(`👤 Смена: <b>${escapeHtml(report.shiftManagers.join(', ') || 'не отмечена')}</b>`);

  const text = lines.join('\n');
  if (text.length <= 3900) return text;
  const compact = [
    ...lines.slice(0, 3),
    ...lines.slice(3, 15),
    `• … ещё ${Math.max(0, report.sales.length - 12)} заказов`,
    '',
    '<b>Фактические оплаты</b>',
    `• Первые / полные: ${report.mainPayments.length} · <b>${money(report.mainPaymentsTotal)}</b>`,
    `• Доплаты: ${report.finalPayments.length} · <b>${money(report.finalPaymentsTotal)}</b>`,
    `• Всего поступило: <b>${money(report.mainPaymentsTotal + report.finalPaymentsTotal)}</b>`,
    '',
    `📨 Успешно отправлено по базе: <b>${report.broadcastSent}</b>`,
    `👤 Смена: <b>${escapeHtml(report.shiftManagers.join(', ') || 'не отмечена')}</b>`,
  ].join('\n');
  return compact;
};

export const getExchangeOrderId = (orderId: string) => {
  const clean = String(orderId || '').trim();
  if (/E$/i.test(clean)) return clean.replace(/e$/i, 'E');
  if (/C$/i.test(clean)) return `${clean.slice(0, -1)}E`;
  return `${clean}E`;
};

export interface ExchangeHistoryEntry {
  orderId: string;
  status: string;
  items: string[];
  itemPrices: number[];
  itemColors: string[];
  itemSizes: string[];
  itemHeights: string[];
  cdekUuid: string;
  cdekNumber: string;
  cdekStatus: string;
  archivedAt: string;
}

interface ExchangeOrderSource {
  orderId: string;
  status?: unknown;
  items?: unknown;
  item?: unknown;
  itemPrices?: unknown;
  itemColors?: unknown;
  itemSizes?: unknown;
  itemHeights?: unknown;
  cdekUuid?: unknown;
  cdekNumber?: unknown;
  cdekStatus?: unknown;
  exchangeOriginalOrderId?: unknown;
  exchangeHistory?: unknown;
}

const stringList = (value: unknown) => Array.isArray(value)
  ? value.map(item => String(item || '').trim()).filter(Boolean)
  : [];

const numberList = (value: unknown) => Array.isArray(value)
  ? value.map(item => Number(item) || 0)
  : [];

/** Builds the atomic patch that turns the same CRM record into an exchange. */
export const buildExchangeStartPatch = (order: ExchangeOrderSource, nowIso: string) => {
  const currentItems = stringList(order.items);
  const fallbackItem = String(order.item || '').trim();
  const previousHistory = Array.isArray(order.exchangeHistory)
    ? order.exchangeHistory.filter(entry => entry && typeof entry === 'object').slice(-9)
    : [];
  const historyEntry: ExchangeHistoryEntry = {
    orderId: String(order.orderId || '').trim(),
    status: String(order.status || '').trim(),
    items: currentItems.length ? currentItems : (fallbackItem ? [fallbackItem] : []),
    itemPrices: numberList(order.itemPrices),
    itemColors: stringList(order.itemColors),
    itemSizes: stringList(order.itemSizes),
    itemHeights: stringList(order.itemHeights),
    cdekUuid: String(order.cdekUuid || '').trim(),
    cdekNumber: String(order.cdekNumber || '').trim(),
    cdekStatus: String(order.cdekStatus || '').trim(),
    archivedAt: nowIso,
  };

  return {
    status: 'Обмен',
    orderId: getExchangeOrderId(order.orderId),
    exchangeOriginalOrderId: String(order.exchangeOriginalOrderId || order.orderId).trim(),
    exchangeAt: nowIso,
    activityAt: nowIso,
    exchangeHistory: [...previousHistory, historyEntry],
    isShipped: false,
    isOverdue: false,
    isLate: false,
    exchangeCdekStatus: 'pending' as const,
    exchangeCdekError: '',
    updatedAt: nowIso,
  };
};

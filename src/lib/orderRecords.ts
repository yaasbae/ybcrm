export interface StoredOrderRecord {
  orderId?: unknown;
  clientName?: unknown;
  item?: unknown;
  items?: unknown;
  revenue?: unknown;
  date?: unknown;
  createdAt?: unknown;
  updatedAt?: unknown;
}

const hasText = (value: unknown) => Boolean(String(value || '').trim());

export const resolveStoredOrderIdentity = (
  firestoreId: string,
  record: StoredOrderRecord,
): { orderId: string; date: Date } | null => {
  const hasItems = Array.isArray(record.items) && record.items.some(hasText);
  const hasOrderContent = hasText(record.clientName)
    || hasText(record.item)
    || hasItems
    || Number(record.revenue || 0) > 0;

  // CDEK-only technical records are not CRM orders. They used to be rendered
  // as empty orders because a missing date was replaced with today's date.
  if (!hasOrderContent) return null;

  const orderId = String(record.orderId || firestoreId || '').trim();
  if (!orderId) return null;

  const rawDate = record.date || record.createdAt || record.updatedAt;
  if (!rawDate) return null;
  const date = new Date(String(rawDate));
  if (!Number.isFinite(date.getTime())) return null;

  return { orderId, date };
};

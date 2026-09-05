type ClientRecord = Record<string, any>;

export const normalizeClientPhone = (value: unknown) => {
  const digits = String(value || '').replace(/\D/g, '');
  if (digits.length === 10) return `7${digits}`;
  if (digits.startsWith('8')) return `7${digits.slice(1)}`;
  return digits;
};

// Keeps the form controlled while immediately replacing a Russian 8/+8 prefix.
export const normalizeClientPhoneInput = (value: unknown) => {
  const digits = String(value || '').replace(/\D/g, '');
  if (digits.startsWith('8')) return `7${digits.slice(1)}`;
  if (digits.length === 10) return `7${digits}`;
  return digits;
};

export const formatClientPhone = (value: unknown) => {
  const phone = normalizeClientPhone(value);
  return phone ? `+${phone}` : '';
};

const normalizeClientName = (value: unknown) => String(value || '')
  .trim()
  .toLowerCase()
  .replace(/ё/g, 'е')
  .replace(/\s+/g, ' ');

export const clientMatchesOrder = (client: ClientRecord, order: ClientRecord) => {
  const clientPhone = normalizeClientPhone(client.phone || client.userId || client.firestoreId);
  const orderPhone = normalizeClientPhone(order.clientPhone);
  if (clientPhone && orderPhone) return clientPhone === orderPhone;
  if (clientPhone || orderPhone) return false;
  const clientName = normalizeClientName(client.fullName || client.name);
  const orderName = normalizeClientName(order.clientName);
  return Boolean(clientName && orderName && clientName === orderName);
};

export const isClientPurchaseOrder = (order: ClientRecord) => {
  const status = String(order.status || '').toLowerCase();
  return !order.isBlogger
    && !status.includes('возврат')
    && !status.includes('вернули платёж')
    && !status.includes('отмена');
};

export const getClientPurchaseSummary = (orders: ClientRecord[]) => {
  const purchases = orders.filter(isClientPurchaseOrder);
  return {
    ordersCount: purchases.length,
    totalSpent: purchases.reduce((sum, order) => sum + (Number(order.revenue) || 0), 0),
  };
};

export const sortClientsBySales = (clients: ClientRecord[]) => [...clients].sort((a, b) => {
  const totalDifference = (Number(b.totalSpent ?? b.total) || 0) - (Number(a.totalSpent ?? a.total) || 0);
  if (totalDifference !== 0) return totalDifference;

  const orderDifference = (Number(b.ordersCount ?? b.count) || 0) - (Number(a.ordersCount ?? a.count) || 0);
  if (orderDifference !== 0) return orderDifference;

  return normalizeClientName(a.fullName || a.name)
    .localeCompare(normalizeClientName(b.fullName || b.name), 'ru');
});

const getValidTime = (value: unknown) => {
  const date = value instanceof Date ? value : new Date(String(value || ''));
  return Number.isFinite(date.getTime()) ? date.getTime() : null;
};

export const getPurchaseAfterContactSummary = (
  client: ClientRecord,
  orders: ClientRecord[],
) => {
  const contactTime = getValidTime(client.lastContactAt);
  if (contactTime === null) return { count: 0, total: 0, firstPurchaseAt: null, lastPurchaseAt: null };
  const contactDate = new Date(contactTime);
  const contactDayStart = new Date(
    contactDate.getFullYear(),
    contactDate.getMonth(),
    contactDate.getDate(),
  ).getTime();
  const purchases = orders
    .filter(order => clientMatchesOrder(client, order) && isClientPurchaseOrder(order))
    .map(order => {
      const preciseTime = getValidTime(order.createdAt);
      const fallbackTime = getValidTime(order.date);
      return { order, time: preciseTime ?? fallbackTime, precise: preciseTime !== null };
    })
    .filter(entry => entry.time !== null && entry.time >= (entry.precise ? contactTime : contactDayStart))
    .sort((a, b) => Number(a.time) - Number(b.time));

  return {
    count: purchases.length,
    total: purchases.reduce((sum, entry) => sum + (Number(entry.order.revenue) || 0), 0),
    firstPurchaseAt: purchases[0]?.time ? new Date(Number(purchases[0].time)) : null,
    lastPurchaseAt: purchases[purchases.length - 1]?.time
      ? new Date(Number(purchases[purchases.length - 1].time))
      : null,
  };
};

const clientKey = (client: ClientRecord) => {
  const phone = normalizeClientPhone(client.phone || client.userId || client.firestoreId);
  if (phone) return `phone:${phone}`;
  const name = normalizeClientName(client.fullName || client.name);
  return name ? `name:${name}` : '';
};

export const mergeOrderClientsWithContacts = (
  orderClients: ClientRecord[],
  contacts: ClientRecord[],
) => {
  const merged = new Map<string, ClientRecord>();

  orderClients.forEach((client, index) => {
    const key = clientKey(client) || `order:${index}`;
    merged.set(key, {
      ...client,
      fullName: client.fullName || client.name || '',
      phone: normalizeClientPhone(client.phone),
      totalSpent: Number(client.totalSpent ?? client.total ?? 0),
      ordersCount: Number(client.ordersCount ?? client.count ?? 0),
    });
  });

  contacts.forEach((contact, index) => {
    const key = clientKey(contact) || `contact:${contact.firestoreId || index}`;
    const orderClient = merged.get(key);
    merged.set(key, {
      ...(orderClient || {}),
      ...contact,
      fullName: contact.fullName || contact.name || orderClient?.fullName || '',
      phone: normalizeClientPhone(contact.phone || contact.userId || orderClient?.phone),
      totalSpent: orderClient
        ? Number(orderClient.totalSpent ?? orderClient.total ?? 0)
        : Number(contact.totalSpent ?? contact.total ?? 0),
      ordersCount: orderClient
        ? Number(orderClient.ordersCount ?? orderClient.count ?? 0)
        : Number(contact.ordersCount ?? contact.count ?? 0),
    });
  });

  return Array.from(merged.values());
};

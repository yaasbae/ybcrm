export type CdekCrmStatusPatch = {
  status?: string;
  isShipped?: boolean;
  cdekDeliveredAt?: string;
  cdekAcceptedAt?: string;
};

export type CdekOrderStatusWebhook = {
  uuid: string;
  status: string;
  cdekNumber: string;
  externalNumber: string;
};

export function getCdekCrmStatusPatch(
  cdekStatus: string,
  currentStatus = '',
  changedAt = new Date().toISOString(),
): CdekCrmStatusPatch {
  const normalized = String(cdekStatus || '').toUpperCase();
  if (/возврат|отмен/i.test(String(currentStatus || ''))) return {};
  if (normalized === 'DELIVERED') {
    return { status: 'Получен', isShipped: true, cdekDeliveredAt: changedAt };
  }
  if (normalized === 'RECEIVED_AT_SHIPMENT_WAREHOUSE') {
    return { status: 'Принят СДЭК', isShipped: true, cdekAcceptedAt: changedAt };
  }
  if (normalized === 'READY_FOR_SHIPMENT_IN_SENDER_CITY') {
    return { status: 'Отгружен', isShipped: true };
  }
  if (normalized === 'ACCEPTED_AT_PICK_UP_POINT') {
    return { status: 'Доставлен', isShipped: true };
  }
  if (
    normalized.startsWith('SENT_') ||
    normalized.startsWith('TAKEN_') ||
    normalized.startsWith('ACCEPTED_IN_') ||
    normalized.startsWith('ACCEPTED_AT_') ||
    normalized === 'IN_TRANSIT' ||
    normalized.startsWith('RECEIVED_AT_') ||
    normalized.startsWith('READY_FOR_SHIPMENT_IN_')
  ) {
    return { status: 'В пути', isShipped: true };
  }
  return {};
}

export function getCdekStatusLabel(status: string) {
  const normalized = String(status || '').toUpperCase();
  const labels: Record<string, string> = {
    CREATED: 'Накладная создана',
    ACCEPTED: 'Заказ принят системой СДЭК',
    RECEIVED_AT_SHIPMENT_WAREHOUSE: 'Принят СДЭК',
    READY_FOR_SHIPMENT_IN_SENDER_CITY: 'Готов к отправке',
    READY_FOR_SHIPMENT_IN_TRANSIT_CITY: 'Готов к отправке из транзитного города',
    TAKEN_BY_TRANSPORTER_FROM_SENDER_CITY: 'В пути из города отправителя',
    TAKEN_BY_TRANSPORTER_FROM_TRANSIT_CITY: 'В пути из транзитного города',
    SENT_TO_TRANSIT_CITY: 'Отправлен в транзитный город',
    ACCEPTED_IN_TRANSIT_CITY: 'Прибыл в транзитный город',
    ACCEPTED_AT_TRANSIT_WAREHOUSE: 'Принят на транзитном складе',
    SENT_TO_RECIPIENT_CITY: 'Направлен в город получателя',
    ACCEPTED_AT_RECIPIENT_CITY_WAREHOUSE: 'Прибыл на склад города получателя',
    ACCEPTED_AT_PICK_UP_POINT: 'Готов к выдаче в ПВЗ',
    ACCEPTED_BY_COURIER: 'Передан курьеру',
    DELIVERED: 'Получен',
  };
  return labels[normalized] || normalized.replace(/_/g, ' ');
}

export function parseCdekOrderStatusWebhook(payload: unknown): CdekOrderStatusWebhook | null {
  if (!payload || typeof payload !== 'object') return null;
  const root = payload as Record<string, unknown>;
  if (String(root.type || '').toUpperCase() !== 'ORDER_STATUS') return null;
  const attributes = root.attributes;
  if (!attributes || typeof attributes !== 'object') return null;
  const data = attributes as Record<string, unknown>;
  const uuid = String(root.uuid || '').trim();
  const status = String(data.code || '').trim().toUpperCase();
  const cdekNumber = String(data.cdek_number || '').trim();
  const externalNumber = String(data.number || '').trim();
  if (!/^[0-9a-f-]{32,40}$/i.test(uuid)) return null;
  if (!/^[A-Z0-9_]{2,80}$/.test(status)) return null;
  if (cdekNumber && !/^[A-Za-z0-9_-]{1,64}$/.test(cdekNumber)) return null;
  if (externalNumber && (externalNumber.length > 100 || /[\u0000-\u001f]/.test(externalNumber))) return null;
  if (!cdekNumber && !externalNumber) return null;
  return { uuid, status, cdekNumber, externalNumber };
}

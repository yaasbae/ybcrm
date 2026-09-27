const normalizeCdekStatus = (status?: string | null) => String(status || '').trim().toUpperCase();

const CDEK_PRE_MOVEMENT_STATUSES = new Set(['CREATED', 'ACCEPTED']);
const CDEK_TERMINAL_STATUSES = new Set([
  'DELIVERED',
  'REMOVED',
  'INVALID',
  'RETURNED_TO_SENDER',
  'RETURNED_TO_SENDER_CITY_WAREHOUSE',
]);

export const isCdekTerminalStatus = (status?: string | null) => {
  const normalized = normalizeCdekStatus(status);
  return CDEK_TERMINAL_STATUSES.has(normalized)
    || normalized.startsWith('RETURNED_')
    || normalized.startsWith('REMOVED_');
};

export const canDeleteCdekWaybill = (status?: string | null) =>
  CDEK_PRE_MOVEMENT_STATUSES.has(normalizeCdekStatus(status));

export const canEditCdekWaybill = canDeleteCdekWaybill;

export const canChangeCdekDelivery = (status?: string | null) => {
  const normalized = normalizeCdekStatus(status);
  return Boolean(normalized)
    && !CDEK_PRE_MOVEMENT_STATUSES.has(normalized)
    && !isCdekTerminalStatus(normalized)
    && normalized !== 'REFUSAL_REQUESTED';
};

export const canRequestCdekRefusal = (status?: string | null) => {
  const normalized = normalizeCdekStatus(status);
  return Boolean(normalized)
    && !CDEK_PRE_MOVEMENT_STATUSES.has(normalized)
    && !isCdekTerminalStatus(normalized)
    && normalized !== 'REFUSAL_REQUESTED';
};

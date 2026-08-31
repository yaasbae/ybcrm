export const MANAGER_BY_EMAIL: Record<string, string> = {
  'yb1@ybcrm.ru': 'Менеджер 1',
  'yb2@ybcrm.ru': 'Менеджер 2',
};

export const normalizeManagerEmail = (value: unknown) => String(value || '').trim().toLowerCase();

export const managerNameForEmail = (value: unknown) => MANAGER_BY_EMAIL[normalizeManagerEmail(value)] || '';

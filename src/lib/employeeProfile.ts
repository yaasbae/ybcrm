export const cleanEmployeeNamePart = (value: unknown) => String(value || '')
  .trim()
  .replace(/\s+/g, ' ')
  .slice(0, 80);

export const normalizeTelegramUsername = (value: unknown) => {
  const username = String(value || '').trim().replace(/^@+/, '').toLowerCase();
  return /^[a-z0-9_]{5,32}$/.test(username) ? username : '';
};

export const isTelegramUsernameInputValid = (value: unknown) => {
  const raw = String(value || '').trim();
  return !raw || Boolean(normalizeTelegramUsername(raw));
};

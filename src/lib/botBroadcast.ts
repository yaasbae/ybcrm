export const TELEGRAM_BOT_MESSAGE_LIMIT = 4096;

export const validateBotBroadcastMessage = (value: unknown) => {
  const message = String(value || '').trim();
  if (!message) return { message, error: 'Введите текст рассылки' };
  if (message.length > TELEGRAM_BOT_MESSAGE_LIMIT) {
    return { message, error: `Сообщение длиннее лимита Telegram на ${message.length - TELEGRAM_BOT_MESSAGE_LIMIT} симв.` };
  }
  return { message, error: '' };
};

export const normalizeBotSubscriberIds = (value: unknown): string[] => {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map(id => String(id || '').trim()).filter(id => /^\d+$/.test(id)))];
};

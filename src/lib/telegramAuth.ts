export function normalizeTelegramPhone(value: unknown): string {
  let digits = String(value || '').replace(/\D/g, '');
  if (digits.length === 11 && digits.startsWith('8')) digits = `7${digits.slice(1)}`;
  if (digits.length === 10) digits = `7${digits}`;
  return /^\d{10,15}$/.test(digits) ? `+${digits}` : '';
}

const labels: Record<string, string> = {
  App: 'сообщение в Telegram', Sms: 'SMS', Call: 'звонок',
  FlashCall: 'короткий звонок', MissedCall: 'пропущенный звонок',
  EmailCode: 'письмо на почту', SmsWord: 'слово из SMS', SmsPhrase: 'фраза из SMS',
};

export function telegramDelivery(result: any, now = Date.now()) {
  const type = String(result?.type?.className || '').replace(/^auth\.SentCodeType/, '');
  const next = String(result?.nextType?.className || '').replace(/^auth\.CodeType/, '');
  const messages: Record<string, string> = {
    App: 'Telegram сообщил, что код направлен в служебный чат «Telegram» на устройствах с этим аккаунтом. Это не подтверждение получения кода.',
    Sms: 'Telegram сообщил об отправке SMS на указанный номер.',
    Call: 'Telegram выбрал звонок: код будет продиктован голосом.',
    FlashCall: 'Telegram выбрал короткий звонок. Код — номер входящего звонка.',
    MissedCall: 'Telegram выбрал пропущенный звонок. Введите последние цифры номера звонящего.',
    EmailCode: 'Telegram направил код на почту, настроенную для входа в аккаунт.',
    SmsWord: 'Telegram отправляет SMS со словом. Введите слово целиком.',
    SmsPhrase: 'Telegram отправляет SMS с фразой. Введите фразу целиком.',
  };
  const supported = Boolean(labels[type]);
  return {
    deliveryType: type || 'unknown',
    deliveryLabel: labels[type] || 'способ не поддерживается',
    deliveryMessage: messages[type] || 'Telegram выбрал способ входа, который CRM пока не поддерживает. Код не подтверждён. Откройте официальное приложение Telegram.',
    supported,
    codeInputMode: ['SmsWord', 'SmsPhrase'].includes(type) ? 'text' as const : 'numeric' as const,
    nextDeliveryLabel: labels[next] || '',
    canResend: supported && Boolean(labels[next]),
    resendAt: now + (Number.isFinite(result?.timeout) ? Math.max(0, result.timeout) : 60) * 1000,
  };
}

export function telegramAuthError(error: any) {
  const code = String(error?.errorMessage || error?.message || '');
  if (code.includes('API_ID_INVALID') || code.includes('API_ID_PUBLISHED_FLOOD')) return { status: 503, error: 'Telegram отклонил API-настройки CRM. Требуется проверка API ID приложения.' };
  if (/FLOOD|PHONE_PASSWORD_FLOOD|PHONE_NUMBER_FLOOD/.test(code)) {
    const seconds = Math.max(1, Number(error?.seconds || code.match(/FLOOD(?:_PREMIUM)?_WAIT_(\d+)/)?.[1]) || 900);
    return { status: 429, error: `Telegram ограничил попытки. Повторите не раньше чем через ${Math.ceil(seconds / 60)} мин.`, retryAfterSeconds: seconds };
  }
  if (code.includes('PHONE_CODE_EXPIRED')) return { status: 400, error: 'Код истёк. Начните подключение заново.', restartRequired: true };
  if (code.includes('PHONE_CODE_INVALID')) return { status: 400, error: 'Неверный код. Введите последний полученный код в CRM.' };
  if (code.includes('PASSWORD_HASH_INVALID')) return { status: 400, error: 'Неверный пароль двухэтапной защиты Telegram.' };
  if (code.includes('PHONE_NUMBER_INVALID')) return { status: 400, error: 'Telegram не принимает этот номер. Проверьте номер с кодом страны.' };
  if (code.includes('PHONE_NUMBER_BANNED')) return { status: 400, error: 'Telegram заблокировал вход для этого номера. Обратитесь в поддержку Telegram.' };
  return { status: 502, error: 'Telegram не завершил запрос. Не запрашивайте код несколько раз подряд; повторите позже.' };
}

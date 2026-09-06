import { crmFetch } from './crmApi';

export function notifyTelegramOrderCreated(orderId: string) {
  const normalizedOrderId = String(orderId || '').replace(/^#+/, '').trim();
  if (!normalizedOrderId) return;

  void crmFetch('/api/telegram/order-created', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ orderId: normalizedOrderId }),
  })
    .then(async response => {
      if (response.ok) return;
      const payload = await response.json().catch(() => ({}));
      throw new Error(payload?.error || `Telegram вернул ${response.status}`);
    })
    .catch(error => {
      // Telegram is an auxiliary notification channel. Its outage must never
      // roll back or hide an order that has already been saved in CRM.
      console.warn('[telegram] Не удалось продублировать новый заказ:', error?.message || error);
    });
}

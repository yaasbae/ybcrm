import { auth } from '../firebase';

export type PushEventType =
  | 'order_created'
  | 'instagram_message'
  | 'payment_received'
  | 'cdek_status_changed'
  | 'payment_due'
  | 'order_overdue'
  | 'manager_assigned';

const urlBase64ToUint8Array = (value: string) => {
  const padding = '='.repeat((4 - value.length % 4) % 4);
  const base64 = (value + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = window.atob(base64);
  return Uint8Array.from([...raw].map(char => char.charCodeAt(0)));
};

const authHeaders = async () => {
  const token = await auth.currentUser?.getIdToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
};

export const getPushSupport = () => (
  typeof window !== 'undefined' &&
  'serviceWorker' in navigator &&
  'PushManager' in window &&
  'Notification' in window
);

export const getPushState = async () => {
  if (!getPushSupport()) return { supported: false, enabled: false, permission: 'unsupported' as const };
  const registration = await navigator.serviceWorker.register('/push-sw.js');
  const subscription = await registration.pushManager.getSubscription();
  return { supported: true, enabled: Boolean(subscription) && Notification.permission === 'granted', permission: Notification.permission };
};

export const enablePushNotifications = async () => {
  if (!getPushSupport()) throw new Error('Этот браузер не поддерживает push-уведомления');
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') throw new Error('Разрешение на уведомления не выдано');
  const headers = await authHeaders();
  const keyResponse = await fetch('/api/push/vapid-public-key', { headers });
  const keyPayload = await keyResponse.json();
  if (!keyResponse.ok || !keyPayload.publicKey) throw new Error(keyPayload.error || 'Push-сервис не настроен');
  const registration = await navigator.serviceWorker.register('/push-sw.js');
  const existing = await registration.pushManager.getSubscription();
  const subscription = existing || await registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(keyPayload.publicKey),
  });
  const response = await fetch('/api/push/subscribe', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify({ subscription: subscription.toJSON() }),
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error || 'Не удалось включить уведомления');
  return true;
};

export const disablePushNotifications = async () => {
  if (!getPushSupport()) return;
  const registration = await navigator.serviceWorker.register('/push-sw.js');
  const subscription = await registration.pushManager.getSubscription();
  if (!subscription) return;
  const headers = await authHeaders();
  await fetch('/api/push/unsubscribe', {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify({ endpoint: subscription.endpoint }),
  }).catch(() => null);
  await subscription.unsubscribe();
};

export const emitPushEvent = async (type: PushEventType, eventId: string, data: Record<string, unknown> = {}) => {
  try {
    const headers = await authHeaders();
    await fetch('/api/push/event', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify({ type, eventId, data }),
    });
  } catch (error) {
    console.warn('[push] event skipped:', error);
  }
};

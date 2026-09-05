import { auth } from '../firebase';

const PUSH_PREFERENCE_KEY = 'ybcrm_push_preference';
const PUSH_SERVER_KEY = 'ybcrm_push_server_key';

export type PushEventType =
  | 'order_created'
  | 'instagram_message'
  | 'payment_received'
  | 'payment_refunded'
  | 'cdek_status_changed'
  | 'payment_due'
  | 'order_overdue'
  | 'manager_assigned'
  | 'order_status_changed'
  | 'manager_shift_started'
  | 'production_changed'
  | 'stock_changed';

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

const fetchPublicKey = async () => {
  const headers = await authHeaders();
  const response = await fetch('/api/push/vapid-public-key', { headers });
  const payload = await response.json();
  if (!response.ok || !payload.publicKey) throw new Error(payload.error || 'Push-сервис не настроен');
  return String(payload.publicKey);
};

const subscriptionUsesKey = (subscription: PushSubscription, publicKey: Uint8Array) => {
  const currentKey = subscription.options?.applicationServerKey;
  if (!currentKey) return false;
  const currentBytes = new Uint8Array(currentKey);
  return currentBytes.length === publicKey.length && currentBytes.every((byte, index) => byte === publicKey[index]);
};

const getCurrentSubscription = async (registration: ServiceWorkerRegistration) => {
  const publicKeyValue = await fetchPublicKey();
  const publicKey = urlBase64ToUint8Array(publicKeyValue);
  let subscription = await registration.pushManager.getSubscription();
  const browserKey = subscription?.options?.applicationServerKey;
  const savedKeyMatches = window.localStorage.getItem(PUSH_SERVER_KEY) === publicKeyValue;
  if (subscription && (!savedKeyMatches || (browserKey && !subscriptionUsesKey(subscription, publicKey)))) {
    await subscription.unsubscribe().catch(() => false);
    subscription = null;
  }
  const current = subscription || await registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: publicKey,
  });
  window.localStorage.setItem(PUSH_SERVER_KEY, publicKeyValue);
  return current;
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

const saveSubscription = async (subscription: PushSubscription) => {
  const headers = await authHeaders();
  const response = await fetch('/api/push/subscribe', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify({ subscription: subscription.toJSON() }),
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error || 'Не удалось включить уведомления');
};

export const enablePushNotifications = async () => {
  if (!getPushSupport()) throw new Error('Этот браузер не поддерживает push-уведомления');
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') throw new Error('Разрешение на уведомления не выдано');
  const registration = await navigator.serviceWorker.register('/push-sw.js');
  const subscription = await getCurrentSubscription(registration);
  await saveSubscription(subscription);
  window.localStorage.setItem(PUSH_PREFERENCE_KEY, 'on');
  return true;
};

export const repairPushNotifications = async () => {
  const state = await getPushState();
  if (!state.supported || state.permission !== 'granted') return state;
  if (window.localStorage.getItem(PUSH_PREFERENCE_KEY) === 'off') return state;

  const registration = await navigator.serviceWorker.register('/push-sw.js');
  const subscription = await getCurrentSubscription(registration);
  await saveSubscription(subscription);
  window.localStorage.setItem(PUSH_PREFERENCE_KEY, 'on');
  return { supported: true, enabled: true, permission: Notification.permission };
};

export const disablePushNotifications = async () => {
  if (!getPushSupport()) return;
  window.localStorage.setItem(PUSH_PREFERENCE_KEY, 'off');
  window.localStorage.removeItem(PUSH_SERVER_KEY);
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
      keepalive: true,
    });
  } catch (error) {
    console.warn('[push] event skipped:', error);
  }
};

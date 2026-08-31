import React, { useEffect, useState } from 'react';
import { Bell, BellOff, Loader2 } from 'lucide-react';
import { disablePushNotifications, enablePushNotifications, getPushSupport, repairPushNotifications } from '../lib/pushNotifications';

export function PushNotificationButton() {
  const [enabled, setEnabled] = useState(false);
  const [supported, setSupported] = useState(true);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const refresh = () => repairPushNotifications()
      .then(state => { setSupported(state.supported); setEnabled(state.enabled); })
      .catch(() => { setSupported(getPushSupport()); setEnabled(false); })
      .finally(() => setLoading(false));
    void refresh();
    const onVisibility = () => {
      if (document.visibilityState === 'visible') void refresh();
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, []);

  useEffect(() => {
    const sync = () => Promise.allSettled([
      fetch('/api/tochka/reconcile-payments', { method: 'POST' }),
      fetch('/api/cdek/sync-statuses', { method: 'POST' }),
      fetch('/api/push/run-reminders', { method: 'POST' }),
    ]);
    void sync();
    const timer = window.setInterval(sync, 10 * 60 * 1000);
    return () => window.clearInterval(timer);
  }, []);

  const toggle = async () => {
    if (!supported) {
      window.alert('Уведомления недоступны в этом браузере. На iPhone откройте CRM как приложение с экрана «Домой» или в поддерживаемом браузере; в Telegram/Instagram-браузере push обычно не работает.');
      return;
    }
    setLoading(true);
    try {
      if (enabled) {
        await disablePushNotifications();
        setEnabled(false);
      } else {
        await enablePushNotifications();
        setEnabled(true);
      }
    } catch (error: any) {
      window.alert(error?.message || 'Не удалось изменить настройки уведомлений');
    } finally {
      setLoading(false);
    }
  };

  return (
    <button
      type="button"
      onClick={toggle}
      disabled={loading}
      className={`relative flex h-8 w-8 items-center justify-center rounded-[8px] border transition-colors ${
        enabled
          ? 'border-[#CDEEDC] bg-[#ECFDF3] text-[#12A05C]'
          : supported
            ? 'border-[#E6E9EF] bg-[#F6F7F9] text-[#8B95A5] hover:text-[#1F2937]'
            : 'border-[#F3D2D2] bg-[#FFF5F5] text-[#EF6B6B] hover:text-[#DC2626]'
      }`}
      title={enabled ? 'Push-уведомления включены' : supported ? 'Включить push-уведомления' : 'Уведомления недоступны в этом браузере'}
      aria-label={enabled ? 'Отключить push-уведомления' : supported ? 'Включить push-уведомления' : 'Уведомления недоступны в этом браузере'}
    >
      {loading ? <Loader2 size={15} className="animate-spin" /> : enabled ? <Bell size={15} /> : <BellOff size={15} />}
      {enabled && <span className="absolute right-1 top-1 h-1.5 w-1.5 rounded-full bg-[#12A05C] ring-2 ring-white" />}
    </button>
  );
}

import React, { useEffect, useState } from 'react';
import { Bell, BellOff, Loader2 } from 'lucide-react';
import { disablePushNotifications, enablePushNotifications, getPushState } from '../lib/pushNotifications';

export function PushNotificationButton() {
  const [enabled, setEnabled] = useState(false);
  const [supported, setSupported] = useState(true);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getPushState()
      .then(state => { setSupported(state.supported); setEnabled(state.enabled); })
      .finally(() => setLoading(false));
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

  if (!supported) return null;

  const toggle = async () => {
    setLoading(true);
    try {
      if (enabled) await disablePushNotifications();
      else await enablePushNotifications();
      setEnabled(!enabled);
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
      className={`relative flex h-8 w-8 items-center justify-center rounded-[8px] border transition-colors ${enabled ? 'border-[#CDEEDC] bg-[#ECFDF3] text-[#12A05C]' : 'border-[#E6E9EF] bg-[#F6F7F9] text-[#8B95A5] hover:text-[#1F2937]'}`}
      title={enabled ? 'Push-уведомления включены' : 'Включить push-уведомления'}
      aria-label={enabled ? 'Отключить push-уведомления' : 'Включить push-уведомления'}
    >
      {loading ? <Loader2 size={15} className="animate-spin" /> : enabled ? <Bell size={15} /> : <BellOff size={15} />}
      {enabled && <span className="absolute right-1 top-1 h-1.5 w-1.5 rounded-full bg-[#12A05C] ring-2 ring-white" />}
    </button>
  );
}

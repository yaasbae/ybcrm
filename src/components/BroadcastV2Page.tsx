import React, { useEffect, useMemo, useState } from 'react';
import { collection, getDocs, orderBy, query } from 'firebase/firestore';
import {
  AlertCircle,
  CheckCircle2,
  Clock,
  Image,
  Loader2,
  Play,
  RotateCcw,
  Send,
  ShieldAlert,
  Square,
  Users,
} from 'lucide-react';
import { db } from '../firebase';
import { cn } from '../lib/utils';

type BroadcastV2Status = {
  status: string;
  campaignId?: string;
  total: number;
  sent: number;
  failed: number;
  noTg: number;
  checked: number;
  nextIndex: number;
  maxAccounts: number;
  messagesPerAccount: number;
  activeFromHour: number;
  activeToHour: number;
  intervalsSec?: number[];
  startedAt?: string;
  finishedAt?: string;
  wakeAt?: string;
  accounts: Array<{
    phone: string;
    status: string;
    sent: number;
    failed: number;
    currentPhone?: string;
    wakeAt?: string;
    error?: string;
  }>;
  log: Array<{
    at: string;
    phone: string;
    status: string;
    account?: string;
    variant?: number;
    error?: string;
  }>;
};

type TgAccountStatus = {
  phone?: string;
  active?: boolean;
};

const DEFAULT_STATUS: BroadcastV2Status = {
  status: 'idle',
  total: 0,
  sent: 0,
  failed: 0,
  noTg: 0,
  checked: 0,
  nextIndex: 0,
  maxAccounts: 5,
  messagesPerAccount: 25,
  activeFromHour: 8,
  activeToHour: 21,
  accounts: [],
  log: [],
};

function normalizePhone(value: string): string {
  const digits = String(value || '').replace(/\D/g, '');
  return digits.length === 11 && digits.startsWith('8') ? `7${digits.slice(1)}` : digits;
}

function getContactPhone(contact: any): string {
  return normalizePhone(contact?.phone || contact?.userId || contact?.clientPhone || contact?.id || '');
}

function getContactName(contact: any): string {
  return String(contact?.fullName || contact?.name || contact?.clientName || contact?.fio || '').trim();
}

function formatTime(value?: string) {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  return date.toLocaleString('ru-RU', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' });
}

function statusLabel(status: string) {
  const map: Record<string, string> = {
    idle: 'Ожидает',
    running: 'Работает',
    sleeping: 'Спит по расписанию',
    stopping: 'Останавливается',
    stopped: 'Остановлено',
    done: 'Готово',
    waiting_accounts: 'Ждет аккаунты',
    flood_wait: 'FloodWait',
    limit_done: '25 отправок, сон',
    dead: 'Сессия умерла',
    error: 'Ошибка',
  };
  return map[status] || status;
}

function statusTone(status: string) {
  if (['running', 'done', 'sent'].includes(status)) return 'text-emerald-600 bg-emerald-50 border-emerald-100';
  if (['flood_wait', 'sleeping', 'limit_done'].includes(status)) return 'text-orange-600 bg-orange-50 border-orange-100';
  if (['dead', 'error', 'waiting_accounts'].includes(status)) return 'text-red-600 bg-red-50 border-red-100';
  return 'text-zinc-500 bg-zinc-50 border-zinc-100';
}

export const BroadcastV2Page: React.FC = () => {
  const [contacts, setContacts] = useState<any[]>([]);
  const [status, setStatus] = useState<BroadcastV2Status>(DEFAULT_STATUS);
  const [messageVariants, setMessageVariants] = useState<string[]>([
    'Привет! Это YAASBAE. Узнай подробности по новому костюму ниже.',
    '', '', '', '', '', '', '', '', '',
  ]);
  const [maxAccounts, setMaxAccounts] = useState<5 | 10>(5);
  const [contactButton, setContactButton] = useState(true);
  const [activeFromHour, setActiveFromHour] = useState(8);
  const [activeToHour, setActiveToHour] = useState(21);
  const [displayName, setDisplayName] = useState('YAASBAE Brand');
  const [customPhonesText, setCustomPhonesText] = useState('');
  const [images, setImages] = useState<Array<{ base64: string; dataUrl: string; name: string }>>([]);
  const [tgAccounts, setTgAccounts] = useState<TgAccountStatus[]>([]);
  const [isPreparingImages, setIsPreparingImages] = useState(false);
  const [isLoadingContacts, setIsLoadingContacts] = useState(true);
  const [isStarting, setIsStarting] = useState(false);
  const [actionError, setActionError] = useState('');

  const phones = useMemo(() => {
    const pastedPhones = customPhonesText
      .split(/[\s,;]+/)
      .map(normalizePhone)
      .filter(Boolean);
    if (pastedPhones.length > 0) return Array.from(new Set(pastedPhones));

    const unique = new Map<string, any>();
    contacts.forEach(contact => {
      const phone = getContactPhone(contact);
      if (phone) unique.set(phone, contact);
    });
    return Array.from(unique.keys());
  }, [contacts, customPhonesText]);

  const filledVariants = useMemo(
    () => messageVariants.map(v => v.trim()).filter(Boolean).slice(0, 10),
    [messageVariants]
  );
  const activeTgAccounts = useMemo(() => tgAccounts.filter(account => account.active !== false), [tgAccounts]);

  const progress = status.total > 0 ? Math.min(100, Math.round((status.checked / status.total) * 100)) : 0;
  const isRunning = ['running', 'sleeping'].includes(status.status);
  const isBusy = ['running', 'sleeping', 'stopping'].includes(status.status);

  const refreshStatus = async () => {
    const res = await fetch('/api/broadcast-v2/status');
    if (!res.ok) return;
    const data = await res.json();
    setStatus({ ...DEFAULT_STATUS, ...data, accounts: data.accounts || [], log: data.log || [] });
  };

  useEffect(() => {
    let cancelled = false;
    setIsLoadingContacts(true);
    getDocs(query(collection(db, 'contacts'), orderBy('totalSpent', 'desc')))
      .then(snap => {
        if (cancelled) return;
        setContacts(snap.docs.map(d => ({ id: d.id, ...d.data() })));
      })
      .catch(err => setActionError(err.message || 'Не удалось загрузить клиентов'))
      .finally(() => {
        if (!cancelled) setIsLoadingContacts(false);
      });
    refreshStatus().catch(() => {});
    fetch('/api/tg/auth/status')
      .then(res => res.ok ? res.json() : null)
      .then(data => {
        if (!cancelled && Array.isArray(data?.accounts)) setTgAccounts(data.accounts);
      })
      .catch(() => {});
    const timer = window.setInterval(() => refreshStatus().catch(() => {}), 5000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);

  const startV2 = async () => {
    setActionError('');
    setIsStarting(true);
    try {
      const res = await fetch('/api/broadcast-v2/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          phones,
          messageVariants: filledVariants,
          maxAccounts,
          contactButton,
          images: images.map(({ base64, name }) => ({ base64, name })),
          activeFromHour,
          activeToHour,
          displayName,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Не удалось запустить v2');
      await refreshStatus();
    } catch (err: any) {
      setActionError(err.message || String(err));
    } finally {
      setIsStarting(false);
    }
  };

  const handleImageUpload = async (files: FileList | null) => {
    if (!files?.length) return;
    setActionError('');
    setIsPreparingImages(true);
    try {
      const selected = Array.from(files).slice(0, 6);
      const prepared = await Promise.all(selected.map(file => new Promise<{ base64: string; dataUrl: string; name: string }>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
          const dataUrl = String(reader.result || '');
          const base64 = dataUrl.split(',')[1] || '';
          if (!base64) reject(new Error(`Не удалось прочитать ${file.name}`));
          else resolve({ base64, dataUrl, name: file.name });
        };
        reader.onerror = () => reject(new Error(`Не удалось прочитать ${file.name}`));
        reader.readAsDataURL(file);
      })));
      setImages(prev => [...prev, ...prepared].slice(0, 6));
    } catch (err: any) {
      setActionError(err.message || 'Не удалось подготовить фото');
    } finally {
      setIsPreparingImages(false);
    }
  };

  const stopV2 = async () => {
    setActionError('');
    try {
      const res = await fetch('/api/broadcast-v2/stop', { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Не удалось остановить v2');
      await refreshStatus();
    } catch (err: any) {
      setActionError(err.message || String(err));
    }
  };

  const clearV2 = async () => {
    setActionError('');
    try {
      const res = await fetch('/api/broadcast-v2/clear', { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Не удалось очистить v2');
      await refreshStatus();
    } catch (err: any) {
      setActionError(err.message || String(err));
    }
  };

  return (
    <div className="max-w-6xl mx-auto px-4 py-6 space-y-4 font-sans">
      <section className="bg-white border border-zinc-200 rounded-2xl shadow-sm overflow-hidden">
        <div className="p-5 border-b border-zinc-100 flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-2xl bg-zinc-900 text-white flex items-center justify-center shadow-lg">
              <Send size={22} />
            </div>
            <div>
              <p className="text-[10px] font-black uppercase tracking-[0.26em] text-blue-600">локальная тестовая версия</p>
              <h1 className="text-2xl font-black tracking-tight">Рассылка v2</h1>
              <p className="text-xs font-bold text-zinc-400 mt-1">Старая действующая рассылка не меняется. Это отдельный контур.</p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={startV2}
              disabled={isBusy || isStarting || phones.length === 0 || filledVariants.length === 0}
              className="h-11 px-5 rounded-xl bg-zinc-900 text-white text-[11px] font-black uppercase tracking-widest flex items-center gap-2 disabled:opacity-40"
            >
              {isStarting ? <Loader2 size={15} className="animate-spin" /> : <Play size={15} />}
              Старт v2
            </button>
            <button
              onClick={stopV2}
              disabled={!isRunning}
              className="h-11 px-4 rounded-xl border border-red-100 bg-red-50 text-red-600 text-[11px] font-black uppercase tracking-widest flex items-center gap-2 disabled:opacity-40"
            >
              <Square size={14} />
              Стоп
            </button>
            <button
              onClick={clearV2}
              disabled={isRunning}
              className="h-11 px-4 rounded-xl border border-zinc-200 bg-white text-zinc-600 text-[11px] font-black uppercase tracking-widest flex items-center gap-2 disabled:opacity-40"
            >
              <RotateCcw size={14} />
              Очистить
            </button>
          </div>
        </div>

        <div className="grid grid-cols-2 lg:grid-cols-5 border-b border-zinc-100">
          {[
            { label: 'Статус', value: statusLabel(status.status), icon: ShieldAlert },
            { label: 'База', value: isLoadingContacts ? 'загрузка' : `${phones.length} номеров`, icon: Users },
            { label: 'Отправлено', value: `${status.sent} / ${status.total}`, icon: CheckCircle2 },
            { label: 'Ошибки', value: `${status.failed} / нет TG ${status.noTg}`, icon: AlertCircle },
            { label: 'Интервалы', value: '63 / 76 / 91 / 108 / 195 сек', icon: Clock },
          ].map(item => (
            <div key={item.label} className="p-4 border-r border-zinc-100 last:border-r-0">
              <div className="flex items-center gap-2 text-zinc-400">
                <item.icon size={14} />
                <span className="text-[9px] font-black uppercase tracking-widest">{item.label}</span>
              </div>
              <p className="mt-2 text-lg font-black tracking-tight">{item.value}</p>
            </div>
          ))}
        </div>

        <div className="p-5 space-y-4">
          <div className="h-2 rounded-full bg-zinc-100 overflow-hidden">
            <div className="h-full bg-emerald-500 transition-all" style={{ width: `${progress}%` }} />
          </div>
          <div className="flex flex-wrap gap-2 text-[10px] font-bold text-zinc-400">
            <span>Проверено: {status.checked}</span>
            <span>Следующий индекс: {status.nextIndex}</span>
            <span>Лимит: {status.messagesPerAccount} сообщений на аккаунт/день</span>
            {status.wakeAt && <span>Проснется: {formatTime(status.wakeAt)}</span>}
          </div>
        </div>
      </section>

      {actionError && (
        <div className="p-3 rounded-xl border border-red-100 bg-red-50 text-red-600 text-xs font-bold">
          {actionError}
        </div>
      )}

      <section className="grid lg:grid-cols-[1fr_360px] gap-4">
        <div className="bg-white border border-zinc-200 rounded-2xl shadow-sm p-5 space-y-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="text-sm font-black uppercase tracking-[0.18em]">База и номера</h2>
              <p className="text-[10px] font-bold text-zinc-400 mt-1">
                По умолчанию берется база клиентов. Можно вставить номера вручную, тогда v2 отправит только по ним.
              </p>
            </div>
            <span className="text-[10px] font-black text-zinc-400 shrink-0">
              {phones.length} номеров · {activeTgAccounts.length}/{tgAccounts.length || activeTgAccounts.length} ТГ
            </span>
          </div>
          <textarea
            value={customPhonesText}
            onChange={e => setCustomPhonesText(e.target.value)}
            placeholder="Вставь номера через пробел, запятую или с новой строки. Если оставить пусто — пойдет вся база клиентов."
            className="w-full min-h-[110px] resize-y rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-3 text-xs font-medium focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-400"
          />
          <div className="grid sm:grid-cols-3 gap-2">
            <button
              onClick={() => setCustomPhonesText('')}
              className="h-10 rounded-xl border border-zinc-200 bg-white text-[10px] font-black uppercase tracking-widest text-zinc-600"
            >
              Вся база
            </button>
            <a
              href="/broadcast/settings"
              className="h-10 rounded-xl border border-blue-100 bg-blue-50 text-[10px] font-black uppercase tracking-widest text-blue-600 flex items-center justify-center"
            >
              Аккаунты ТГ
            </a>
            <div className="h-10 rounded-xl border border-zinc-200 bg-zinc-50 text-[10px] font-black uppercase tracking-widest text-zinc-400 flex items-center justify-center">
              25 на аккаунт
            </div>
          </div>
          <p className="text-[10px] font-bold text-zinc-400">
            V2 запускает все активные Telegram-аккаунты параллельно, но не больше лимита в настройках справа.
          </p>
        </div>

        <div className="bg-white border border-zinc-200 rounded-2xl shadow-sm p-5 space-y-4">
          <div>
            <h2 className="text-sm font-black uppercase tracking-[0.18em]">Фото</h2>
            <p className="text-[10px] font-bold text-zinc-400 mt-1">Фото отправится перед текстом. Можно до 6 штук.</p>
          </div>
          <label className="h-24 border border-dashed border-zinc-300 rounded-xl bg-zinc-50 flex flex-col items-center justify-center gap-2 cursor-pointer hover:border-blue-300 hover:bg-blue-50/40 transition-all">
            {isPreparingImages ? <Loader2 size={18} className="animate-spin text-blue-500" /> : <Image size={18} className="text-zinc-400" />}
            <span className="text-[10px] font-black uppercase tracking-widest text-zinc-500">Выбрать фото</span>
            <input
              type="file"
              accept="image/*"
              multiple
              className="hidden"
              onChange={e => handleImageUpload(e.target.files)}
            />
          </label>
          {images.length > 0 && (
            <div className="grid grid-cols-3 gap-2">
              {images.map((image, index) => (
                <div key={`${image.name}-${index}`} className="relative aspect-square rounded-xl overflow-hidden border border-zinc-200 bg-zinc-50">
                  <img src={image.dataUrl} alt={image.name} className="w-full h-full object-cover" />
                  <button
                    onClick={() => setImages(prev => prev.filter((_, i) => i !== index))}
                    className="absolute top-1 right-1 w-6 h-6 rounded-full bg-white/90 text-red-500 text-xs font-black shadow-sm"
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </section>

      <section className="grid lg:grid-cols-[1fr_360px] gap-4">
        <div className="bg-white border border-zinc-200 rounded-2xl shadow-sm p-5 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-sm font-black uppercase tracking-[0.18em]">Варианты текста</h2>
              <p className="text-[10px] font-bold text-zinc-400 mt-1">До 10 вариантов. v2 выбирает случайно, без повтора подряд у одного аккаунта.</p>
            </div>
            <span className="text-[10px] font-black text-zinc-400">{filledVariants.length}/10</span>
          </div>
          <div className="space-y-2">
            {messageVariants.map((value, index) => (
              <div key={index} className="flex gap-2 items-start">
                <span className="w-6 pt-3 text-center text-[10px] font-black text-purple-500">{index + 1}</span>
                <textarea
                  value={value}
                  onChange={e => {
                    const next = [...messageVariants];
                    next[index] = e.target.value;
                    setMessageVariants(next);
                  }}
                  placeholder={`Вариант ${index + 1}...`}
                  className="w-full min-h-[58px] resize-y rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2 text-xs font-medium focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-400"
                />
              </div>
            ))}
          </div>
        </div>

        <div className="bg-white border border-zinc-200 rounded-2xl shadow-sm p-5 space-y-4">
          <h2 className="text-sm font-black uppercase tracking-[0.18em]">Настройки v2</h2>
          <div className="space-y-3">
            <label className="block space-y-1">
              <span className="text-[9px] font-black uppercase tracking-widest text-zinc-400">Аккаунтов параллельно</span>
              <div className="grid grid-cols-2 gap-2">
                {[5, 10].map(count => (
                  <button
                    key={count}
                    onClick={() => setMaxAccounts(count as 5 | 10)}
                    className={cn(
                      'h-10 rounded-xl border text-xs font-black',
                      maxAccounts === count ? 'bg-zinc-900 text-white border-zinc-900' : 'bg-white text-zinc-500 border-zinc-200'
                    )}
                  >
                    до {count}
                  </button>
                ))}
              </div>
              <p className="text-[9px] font-bold text-zinc-400">
                Сейчас активных: {activeTgAccounts.length}. Если активных меньше лимита, пойдут все активные.
              </p>
            </label>

            <label className="block space-y-1">
              <span className="text-[9px] font-black uppercase tracking-widest text-zinc-400">Имя отправителя</span>
              <input
                value={displayName}
                onChange={e => setDisplayName(e.target.value)}
                className="w-full h-10 rounded-xl border border-zinc-200 bg-zinc-50 px-3 text-xs font-bold focus:outline-none focus:ring-2 focus:ring-blue-500/20"
              />
            </label>

            <div className="grid grid-cols-2 gap-2">
              <label className="block space-y-1">
                <span className="text-[9px] font-black uppercase tracking-widest text-zinc-400">Старт</span>
                <input
                  type="number"
                  min={0}
                  max={23}
                  value={activeFromHour}
                  onChange={e => setActiveFromHour(Number(e.target.value))}
                  className="w-full h-10 rounded-xl border border-zinc-200 bg-zinc-50 px-3 text-xs font-bold"
                />
              </label>
              <label className="block space-y-1">
                <span className="text-[9px] font-black uppercase tracking-widest text-zinc-400">Стоп</span>
                <input
                  type="number"
                  min={1}
                  max={24}
                  value={activeToHour}
                  onChange={e => setActiveToHour(Number(e.target.value))}
                  className="w-full h-10 rounded-xl border border-zinc-200 bg-zinc-50 px-3 text-xs font-bold"
                />
              </label>
            </div>

            <button
              onClick={() => setContactButton(v => !v)}
              className={cn(
                'w-full h-10 rounded-xl border text-xs font-black',
                contactButton ? 'bg-blue-50 text-blue-600 border-blue-100' : 'bg-zinc-50 text-zinc-400 border-zinc-200'
              )}
            >
              Ссылка на бот: {contactButton ? 'вкл' : 'выкл'}
            </button>
          </div>
        </div>
      </section>

      <section className="grid lg:grid-cols-[1fr_420px] gap-4">
        <div className="bg-white border border-zinc-200 rounded-2xl shadow-sm overflow-hidden">
          <div className="p-4 border-b border-zinc-100">
            <h2 className="text-sm font-black uppercase tracking-[0.18em]">Аккаунты v2</h2>
          </div>
          <div className="divide-y divide-zinc-100">
            {status.accounts.length === 0 ? (
              <div className="p-5 text-xs font-bold text-zinc-400">После старта здесь появятся воркеры аккаунтов.</div>
            ) : status.accounts.map(account => (
              <div key={account.phone} className="p-4 grid sm:grid-cols-[160px_1fr_auto] gap-3 items-center">
                <div>
                  <p className="text-sm font-black">+{account.phone}</p>
                  <p className="text-[10px] font-bold text-zinc-400">текущий: {account.currentPhone || '-'}</p>
                </div>
                <span className={cn('w-fit px-2.5 py-1 rounded-lg border text-[10px] font-black uppercase', statusTone(account.status))}>
                  {statusLabel(account.status)}
                </span>
                <div className="text-right text-xs font-black">
                  <p>{account.sent} отправлено</p>
                  <p className="text-zinc-400">{account.failed} ошибок</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="bg-white border border-zinc-200 rounded-2xl shadow-sm overflow-hidden">
          <div className="p-4 border-b border-zinc-100">
            <h2 className="text-sm font-black uppercase tracking-[0.18em]">Лог</h2>
          </div>
          <div className="max-h-[420px] overflow-y-auto divide-y divide-zinc-100">
            {status.log.length === 0 ? (
              <div className="p-5 text-xs font-bold text-zinc-400">Пока событий нет.</div>
            ) : [...status.log].reverse().map((entry, index) => (
              <div key={`${entry.at}-${index}`} className="p-3 text-xs">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-black">+{entry.phone}</span>
                  <span className={cn('px-2 py-0.5 rounded-md text-[9px] font-black uppercase', statusTone(entry.status))}>{entry.status}</span>
                </div>
                <p className="text-[10px] font-bold text-zinc-400 mt-1">
                  {formatTime(entry.at)} · {entry.account ? `акк +${entry.account}` : 'аккаунт -'} {entry.variant ? `· вариант ${entry.variant}` : ''}
                </p>
                {entry.error && <p className="text-[10px] text-red-500 mt-1 break-words">{entry.error}</p>}
              </div>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
};

export default BroadcastV2Page;

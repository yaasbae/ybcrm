import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Check, CircleAlert, ImagePlus, Instagram, KeyRound, Loader2, MessageCircle, Phone, PlugZap, Radio, Send, Settings2 } from 'lucide-react';
import { getDownloadURL, ref, uploadBytes } from 'firebase/storage';
import { auth, storage } from '../firebase';
import { cn } from '../lib/utils';
import { UnifiedInboxPage } from './UnifiedInboxPage';
import { normalizeTelegramPhone, type telegramDelivery } from '../lib/telegramAuth';

type Channel = { id: string; name: string; connected: boolean; username?: string; destination?: string; canPublish: boolean; canMessage: boolean };
type Tab = 'inbox' | 'publish' | 'connections';

const TelegramMark = ({ className = '' }: { className?: string }) => <Send className={className} />;

async function authedFetch(url: string, options: RequestInit = {}) {
  const token = await auth.currentUser?.getIdToken();
  return fetch(url, { ...options, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(options.headers || {}) } });
}

export const SocialHubPage: React.FC = () => {
  const [tab, setTab] = useState<Tab>('inbox');
  const [channels, setChannels] = useState<Channel[]>([]);
  const [loading, setLoading] = useState(true);
  const [text, setText] = useState('');
  const [imageUrl, setImageUrl] = useState('');
  const [imagePreview, setImagePreview] = useState('');
  const [selectedChannels, setSelectedChannels] = useState<string[]>(['instagram']);
  const [publishing, setPublishing] = useState(false);
  const [result, setResult] = useState('');
  const [telegramChatId, setTelegramChatId] = useState('');
  const [telegramChannelName, setTelegramChannelName] = useState('');
  const [saving, setSaving] = useState(false);
  const [managerPhone, setManagerPhone] = useState('+79809150588');
  const [managerCode, setManagerCode] = useState('');
  const [managerPassword, setManagerPassword] = useState('');
  const [managerAuthStep, setManagerAuthStep] = useState<'phone' | 'code' | '2fa'>('phone');
  const [managerAuthLoading, setManagerAuthLoading] = useState(false);
  const [managerDelivery, setManagerDelivery] = useState<ReturnType<typeof telegramDelivery> | null>(null);
  const [managerRetryAt, setManagerRetryAt] = useState(0);
  const [managerClock, setManagerClock] = useState(Date.now());
  const managerRetrySeconds = Math.max(0, Math.ceil((managerRetryAt - managerClock) / 1000));
  useEffect(() => {
    if (!managerRetryAt) return;
    const timer = window.setInterval(() => setManagerClock(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [managerRetryAt]);
  const fileRef = useRef<HTMLInputElement>(null);

  const loadChannels = async () => {
    setLoading(true);
    try {
      const response = await fetch('/api/social/channels');
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || 'Не удалось загрузить подключения');
      const nextChannels: Channel[] = payload.channels || [];
      setChannels(nextChannels);
      const availableIds = nextChannels.filter(channel => channel.canPublish).map(channel => channel.id);
      setSelectedChannels(current => {
        const valid = current.filter(id => availableIds.includes(id));
        return valid.length ? valid : availableIds.slice(0, 1);
      });
      const telegram = nextChannels.find((item: Channel) => item.id === 'telegram');
      setTelegramChatId(telegram?.destination || '');
      setTelegramChannelName(telegram?.username || '');
    } catch (error: any) {
      setResult(error.message || 'Не удалось загрузить подключения');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadChannels(); }, []);

  const publishable = useMemo(() => channels.filter(channel => channel.id === 'instagram' || channel.id === 'telegram'), [channels]);

  const selectImage = async (file?: File) => {
    if (!file) return;
    setResult('');
    const localUrl = URL.createObjectURL(file);
    setImagePreview(localUrl);
    try {
      const path = `social-publications/${Date.now()}_${file.name.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
      const target = ref(storage, path);
      await uploadBytes(target, file);
      setImageUrl(await getDownloadURL(target));
    } catch (error: any) {
      setResult(error.message || 'Не удалось загрузить изображение');
      setImagePreview('');
    }
  };

  const publish = async () => {
    if ((!text.trim() && !imageUrl) || !selectedChannels.length) return;
    setPublishing(true);
    setResult('');
    try {
      const response = await authedFetch('/api/social/publish', { method: 'POST', body: JSON.stringify({ text: text.trim(), imageUrl, channels: selectedChannels }) });
      const payload = await response.json();
      const summary = (payload.results || []).map((item: any) => `${item.success ? 'Готово' : 'Ошибка'} — ${item.channel}${item.error ? `: ${item.error}` : ''}`).join('\n');
      setResult(summary || payload.error || 'Публикация завершена');
      if (payload.success) { setText(''); setImageUrl(''); setImagePreview(''); if (fileRef.current) fileRef.current.value = ''; }
    } catch (error: any) {
      setResult(error.message || 'Не удалось опубликовать');
    } finally {
      setPublishing(false);
    }
  };

  const saveTelegram = async () => {
    setSaving(true);
    setResult('');
    try {
      const response = await authedFetch('/api/social/settings', { method: 'POST', body: JSON.stringify({ telegramChatId, telegramChannelName }) });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || 'Настройки не сохранены');
      setResult('Telegram-канал сохранён');
      await loadChannels();
    } catch (error: any) {
      setResult(error.message);
    } finally {
      setSaving(false);
    }
  };

  const normalizedManagerPhone = () => {
    return normalizeTelegramPhone(managerPhone);
  };

  const sendManagerCode = async (resend = false) => {
    const phone = normalizedManagerPhone();
    if (!phone) { setResult('Укажите корректный номер с кодом страны.'); return; }
    if (managerAuthLoading || managerRetrySeconds > 0) return;
    setManagerAuthLoading(true);
    setResult('');
    try {
      const response = await fetch(resend ? '/api/tg/auth/resend-code' : '/api/tg/auth/send-code', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ phone, purpose: 'manager' }) });
      const payload = await response.json();
      if (payload.retryAfterSeconds) { setManagerRetryAt(Date.now() + payload.retryAfterSeconds * 1000); setManagerClock(Date.now()); }
      if (payload.restartRequired) { setManagerAuthStep('phone'); setManagerDelivery(null); setManagerCode(''); setManagerPassword(''); }
      if (!response.ok) throw new Error(payload.error || 'Не удалось отправить код');
      setManagerPhone(phone);
      setManagerAuthStep('code');
      setManagerCode('');
      setManagerDelivery(payload);
      setManagerRetryAt(payload.resendAt || 0);
      setManagerClock(Date.now());
      setResult('');
    } catch (error: any) {
      setResult(error.message || 'Не удалось отправить код');
    } finally {
      setManagerAuthLoading(false);
    }
  };

  const signInManager = async () => {
    if (!managerCode.trim()) return;
    setManagerAuthLoading(true);
    setResult('');
    try {
      const response = await fetch('/api/tg/auth/sign-in', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ phone: normalizedManagerPhone(), code: managerCode.trim(), twoFaPassword: managerPassword, purpose: 'manager' }) });
      const payload = await response.json();
      if (payload.restartRequired) { setManagerAuthStep('phone'); setManagerDelivery(null); setManagerCode(''); setManagerPassword(''); setManagerRetryAt(0); }
      if (payload.retryAfterSeconds) { setManagerRetryAt(Date.now() + payload.retryAfterSeconds * 1000); setManagerClock(Date.now()); }
      if (!response.ok) throw new Error(payload.error || 'Не удалось подключить номер');
      if (payload.requires2FA) {
        setManagerAuthStep('2fa');
        setResult('Введите пароль двухэтапной аутентификации Telegram');
        return;
      }
      setManagerAuthStep('phone');
      setManagerCode('');
      setManagerPassword('');
      setManagerDelivery(null);
      setManagerRetryAt(0);
      setResult(`Номер ${payload.phone || normalizedManagerPhone()} подключён к общему чату`);
      await loadChannels();
    } catch (error: any) {
      setResult(error.message || 'Не удалось подключить номер');
    } finally {
      setManagerAuthLoading(false);
    }
  };

  const tabs: Array<{ id: Tab; label: string; icon: React.ElementType }> = [
    { id: 'inbox', label: 'Входящие', icon: MessageCircle },
    { id: 'publish', label: 'Публикация', icon: Radio },
    { id: 'connections', label: 'Подключения', icon: PlugZap },
  ];

  return <div className={cn('mx-auto max-w-[1880px] px-3 sm:px-5', tab === 'inbox' ? 'pb-3' : 'pb-10')}>
    <header className="flex flex-wrap items-center justify-between gap-4 py-5">
      <div><p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[#9CA3AF]">Все каналы в одном месте</p><h1 className="mt-1 text-2xl font-semibold tracking-tight text-[#1F2937]">Центр соцсетей</h1></div>
      <div className="flex items-center gap-2 rounded-xl border border-[#E6E9EF] bg-white px-3 py-2 text-xs text-[#6B7280]"><span className="h-2 w-2 rounded-full bg-emerald-500" />{channels.filter(channel => channel.connected).length} канала подключено</div>
    </header>
    <nav className="mb-4 flex gap-1 overflow-x-auto rounded-xl border border-[#E6E9EF] bg-white p-1.5">
      {tabs.map(item => <button key={item.id} onClick={() => { setTab(item.id); setResult(''); }} className={cn('flex h-11 min-w-[150px] flex-1 items-center justify-center gap-2 rounded-lg text-xs font-semibold transition-colors', tab === item.id ? 'bg-[#1F2937] text-white' : 'text-[#6B7280] hover:bg-[#F4F6F8]')}><item.icon className="h-4 w-4" />{item.label}</button>)}
    </nav>

    {tab === 'inbox' && <UnifiedInboxPage />}

    {tab === 'publish' && <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
      <section className="rounded-xl border border-[#E6E9EF] bg-white p-4 sm:p-6">
        <div className="mb-5"><h2 className="text-base font-semibold text-[#1F2937]">Новая публикация</h2><p className="mt-1 text-xs text-[#9CA3AF]">Один текст и изображение отправятся во все выбранные каналы.</p></div>
        <textarea value={text} onChange={event => setText(event.target.value)} rows={9} placeholder="Напишите текст публикации..." className="w-full resize-y rounded-xl border border-[#E6E9EF] px-4 py-3 text-sm leading-6 outline-none focus:border-[#7D7DE6] focus:ring-2 focus:ring-[#7D7DE6]/10" />
        <div className="mt-4 grid gap-3 sm:grid-cols-[180px_1fr]">
          <button onClick={() => fileRef.current?.click()} className="flex h-12 items-center justify-center gap-2 rounded-xl border border-dashed border-[#C7CCD4] text-xs font-semibold text-[#6B7280] hover:border-[#7D7DE6] hover:text-[#7D7DE6]"><ImagePlus className="h-4 w-4" />Добавить фото</button>
          <input value={imageUrl} onChange={event => { setImageUrl(event.target.value); setImagePreview(event.target.value); }} placeholder="или вставьте публичную ссылку на изображение" className="h-12 rounded-xl border border-[#E6E9EF] px-4 text-xs outline-none focus:border-[#7D7DE6]" />
          <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={event => selectImage(event.target.files?.[0])} />
        </div>
        {imagePreview && <div className="mt-4 overflow-hidden rounded-xl border border-[#E6E9EF] bg-[#F4F6F8]"><img src={imagePreview} alt="Предпросмотр публикации" className="max-h-[440px] w-full object-contain" /></div>}
      </section>
      <aside className="space-y-4">
        <section className="rounded-xl border border-[#E6E9EF] bg-white p-4"><h3 className="text-sm font-semibold text-[#1F2937]">Куда опубликовать</h3><div className="mt-3 space-y-2">{publishable.map(channel => {
          const selected = selectedChannels.includes(channel.id);
          const available = channel.canPublish;
          return <button key={channel.id} disabled={!available} onClick={() => setSelectedChannels(current => selected ? current.filter(id => id !== channel.id) : [...current, channel.id])} className={cn('flex w-full items-center gap-3 rounded-xl border p-3 text-left transition-colors', selected && available ? 'border-[#7D7DE6] bg-[#F1F2FB]' : 'border-[#E6E9EF]', !available && 'cursor-not-allowed opacity-50')}><span className={cn('grid h-10 w-10 place-items-center rounded-full', channel.id === 'instagram' ? 'bg-[#FCE8F1] text-[#E83E8C]' : 'bg-[#E8F4FF] text-[#229ED9]')}>{channel.id === 'instagram' ? <Instagram className="h-5 w-5" /> : <TelegramMark className="h-5 w-5" />}</span><span className="min-w-0 flex-1"><b className="block text-xs text-[#1F2937]">{channel.name}</b><small className="mt-1 block truncate text-[10px] text-[#9CA3AF]">{available ? channel.username || channel.destination || 'Готов к публикации' : 'Нужно настроить'}</small></span><span className={cn('grid h-5 w-5 place-items-center rounded-full border', selected && available ? 'border-[#7D7DE6] bg-[#7D7DE6] text-white' : 'border-[#C7CCD4]')}>{selected && available && <Check className="h-3 w-3" />}</span></button>;
        })}</div></section>
        {result && <div className="whitespace-pre-wrap rounded-xl border border-[#E6E9EF] bg-white px-4 py-3 text-xs leading-5 text-[#4B5563]">{result}</div>}
        <button onClick={publish} disabled={publishing || (!text.trim() && !imageUrl) || !selectedChannels.length} className="flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-[#1F2937] text-xs font-semibold text-white transition-colors hover:bg-[#111827] disabled:cursor-not-allowed disabled:opacity-40">{publishing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}Опубликовать</button>
      </aside>
    </div>}

    {tab === 'connections' && <div className="grid gap-4 lg:grid-cols-2">
      {loading ? <div className="grid h-40 place-items-center"><Loader2 className="h-5 w-5 animate-spin" /></div> : channels.map(channel => <section key={channel.id} className="rounded-xl border border-[#E6E9EF] bg-white p-5"><div className="flex items-start gap-3"><span className={cn('grid h-11 w-11 place-items-center rounded-xl', channel.id === 'instagram' ? 'bg-[#FCE8F1] text-[#E83E8C]' : channel.id === 'telegram' || channel.id === 'telegram_account' ? 'bg-[#E8F4FF] text-[#229ED9]' : 'bg-[#F4F6F8] text-[#9CA3AF]')}>{channel.id === 'instagram' ? <Instagram className="h-5 w-5" /> : channel.id === 'telegram' ? <TelegramMark className="h-5 w-5" /> : channel.id === 'telegram_account' ? <Phone className="h-5 w-5" /> : <MessageCircle className="h-5 w-5" />}</span><div className="min-w-0 flex-1"><div className="flex items-center justify-between gap-3"><h2 className="text-sm font-semibold text-[#1F2937]">{channel.name}</h2><span className={cn('rounded-full px-2.5 py-1 text-[10px] font-semibold', channel.connected ? 'bg-emerald-50 text-emerald-700' : 'bg-[#F4F6F8] text-[#9CA3AF]')}>{channel.connected ? 'Подключено' : 'Не подключено'}</span></div><p className="mt-1 text-xs text-[#9CA3AF]">{channel.username || (channel.connected ? 'Канал активен' : channel.id === 'telegram_account' ? 'Подключите рабочий номер для общего чата' : 'Подключение будет добавлено следующим этапом')}</p></div></div>
        {channel.id === 'telegram' && <div className="mt-4 space-y-3 border-t border-[#EEF0F4] pt-4"><input value={telegramChannelName} onChange={event => setTelegramChannelName(event.target.value)} placeholder="Название канала, например YAASBAE" className="h-11 w-full rounded-lg border border-[#E6E9EF] px-3 text-xs outline-none focus:border-[#229ED9]" /><input value={telegramChatId} onChange={event => setTelegramChatId(event.target.value)} placeholder="@channel или chat_id" className="h-11 w-full rounded-lg border border-[#E6E9EF] px-3 text-xs outline-none focus:border-[#229ED9]" /><button onClick={saveTelegram} disabled={saving} className="flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-[#229ED9] text-xs font-semibold text-white disabled:opacity-50">{saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Settings2 className="h-4 w-4" />}Сохранить Telegram-канал</button><p className="flex items-start gap-2 text-[10px] leading-4 text-[#9CA3AF]"><CircleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />Бот CRM должен быть администратором канала с правом публикации.</p></div>}
        {channel.id === 'telegram_account' && <div className="mt-4 space-y-3 border-t border-[#EEF0F4] pt-4">
          {channel.connected ? <div className="flex items-center gap-3 rounded-xl border border-emerald-200 bg-emerald-50 p-3"><span className="grid h-10 w-10 place-items-center rounded-full bg-white text-emerald-700"><Phone className="h-4 w-4" /></span><div><p className="text-xs font-semibold text-[#1F2937]">Номер менеджера подключён</p><p className="mt-1 text-[11px] text-[#6B7280]">{channel.username}</p></div></div> : <>
            <div><label htmlFor="manager-telegram-phone" className="mb-1.5 block text-[11px] font-semibold text-[#4B5563]">Номер менеджера</label><input id="manager-telegram-phone" value={managerPhone} onChange={event => setManagerPhone(event.target.value)} disabled={managerAuthStep !== 'phone'} inputMode="tel" placeholder="+7 980 915-05-88" className="h-11 w-full rounded-lg border border-[#E6E9EF] px-3 text-xs outline-none focus:border-[#229ED9] disabled:bg-[#F4F6F8]" /></div>
            {managerDelivery && <div role="status" aria-live="polite" className="rounded-xl border border-sky-200 bg-sky-50 p-3 text-xs leading-5 text-sky-900"><p className="font-semibold">Способ доставки: {managerDelivery.deliveryLabel}</p><p className="mt-1">{managerDelivery.deliveryMessage}</p><p className="mt-1">Код и пароль вводите только здесь, не отправляйте их в чат.</p></div>}
            {managerAuthStep !== 'phone' && <div><label htmlFor="manager-telegram-code" className="mb-1.5 block text-[11px] font-semibold text-[#4B5563]">Код подтверждения</label><input id="manager-telegram-code" value={managerCode} onChange={event => setManagerCode(event.target.value)} inputMode={managerDelivery?.codeInputMode || 'numeric'} autoComplete="one-time-code" placeholder="Код подтверждения" className="h-11 w-full rounded-lg border border-[#E6E9EF] px-3 text-xs outline-none focus:border-[#229ED9]" /></div>}
            {managerAuthStep === '2fa' && <div><label htmlFor="manager-telegram-password" className="mb-1.5 block text-[11px] font-semibold text-[#4B5563]">Пароль Telegram 2FA</label><input id="manager-telegram-password" type="password" value={managerPassword} onChange={event => setManagerPassword(event.target.value)} placeholder="Пароль двухэтапной защиты" className="h-11 w-full rounded-lg border border-[#E6E9EF] px-3 text-xs outline-none focus:border-[#229ED9]" /></div>}
            {managerAuthStep === 'phone' ? <button onClick={() => sendManagerCode()} disabled={managerAuthLoading || !managerPhone.trim() || managerRetrySeconds > 0} className="flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-[#229ED9] text-xs font-semibold text-white disabled:opacity-50">{managerAuthLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Phone className="h-4 w-4" />}{managerRetrySeconds > 0 ? `Повторный запрос через ${managerRetrySeconds} с` : 'Запросить код входа'}</button> : <div className="flex gap-2"><button disabled={managerAuthLoading} onClick={() => { setManagerAuthStep('phone'); setManagerCode(''); setManagerPassword(''); setManagerDelivery(null); setResult(''); }} className="h-11 rounded-lg border border-[#E6E9EF] px-4 text-xs font-semibold text-[#6B7280]">Назад</button><button onClick={signInManager} disabled={managerAuthLoading || !managerCode.trim() || (managerAuthStep === '2fa' && !managerPassword)} className="flex h-11 flex-1 items-center justify-center gap-2 rounded-lg bg-[#229ED9] text-xs font-semibold text-white disabled:opacity-50">{managerAuthLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <KeyRound className="h-4 w-4" />}Подключить номер</button></div>}
            {managerAuthStep === 'code' && managerDelivery && (managerDelivery.canResend ? <button onClick={() => sendManagerCode(true)} disabled={managerAuthLoading || managerRetrySeconds > 0} className="min-h-11 w-full rounded-lg border border-[#E6E9EF] px-3 py-2 text-xs font-semibold text-[#1F2937] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#229ED9] disabled:opacity-50">{managerRetrySeconds > 0 ? `Если код не пришёл: повторить через ${managerRetrySeconds} с` : `Код не пришёл — запросить: ${managerDelivery.nextDeliveryLabel}`}</button> : <p className="text-xs leading-5 text-amber-800">Telegram не разрешил альтернативную доставку. CRM не может принудительно отправить SMS.</p>)}
          </>}
          <p className="flex items-start gap-2 text-[10px] leading-4 text-[#9CA3AF]"><CircleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />Этот номер используется только для входящих и ответов. Аккаунты рассылки сюда не попадают.</p>
        </div>}
      </section>)}
      {result && <div role="status" aria-live="polite" className="rounded-xl border border-[#E6E9EF] bg-white px-4 py-3 text-xs text-[#4B5563]">{result}</div>}
    </div>}
  </div>;
};

export default SocialHubPage;

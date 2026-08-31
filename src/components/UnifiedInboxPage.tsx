import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, Globe2, Instagram, Loader2, MessageCircle, RefreshCw, Search, Send, UserRound } from 'lucide-react';
import { collection, limit, onSnapshot, orderBy, query } from 'firebase/firestore';
import { auth, db } from '../firebase';
import { cn } from '../lib/utils';
import { useInboxViewport } from '../lib/useInboxViewport';
import './unified-inbox.css';

type Channel = 'instagram' | 'telegram_bot' | 'telegram_account' | 'website';
type Message = { id: string; text: string; createdAt: string; direction: 'incoming' | 'outgoing'; attachments?: any[] };
type Conversation = {
  id: string;
  sourceId: string;
  channel: Channel;
  name: string;
  username?: string;
  updatedAt: string;
  lastMessage?: Message | null;
  recipientId?: string;
  accountPhone?: string;
  peerId?: string;
  unreadCount?: number;
  linkedClient?: { fullName?: string; name?: string; phone?: string } | null;
  localMessages?: Message[];
};

type BotMessage = Message & { userId: string; firstName?: string; username?: string; receivedAt: string };

async function api<T>(url: string, options: RequestInit = {}, authenticated = false): Promise<T> {
  const token = authenticated ? await auth.currentUser?.getIdToken() : '';
  const response = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.headers || {}),
    },
  });
  const raw = await response.text();
  const payload = raw ? JSON.parse(raw) : {};
  if (!response.ok) throw new Error(payload.error || 'Ошибка сервера');
  return payload;
}

const channelMeta: Record<Channel, { label: string; shortLabel: string; color: string; bg: string }> = {
  instagram: { label: 'Instagram', shortLabel: 'Instagram', color: 'text-[#C22973]', bg: 'bg-[#FCE8F1]' },
  telegram_bot: { label: 'Telegram · бот', shortLabel: 'Бот', color: 'text-[#1677A7]', bg: 'bg-[#E8F4FF]' },
  telegram_account: { label: 'Telegram · номер', shortLabel: 'Telegram', color: 'text-[#1677A7]', bg: 'bg-[#E8F4FF]' },
  website: { label: 'Чат на сайте', shortLabel: 'Сайт', color: 'text-[#2563EB]', bg: 'bg-[#EAF1FF]' },
};

function ChannelIcon({ channel, className = 'h-4 w-4' }: { channel: Channel; className?: string }) {
  if (channel === 'instagram') return <Instagram className={className} />;
  if (channel === 'website') return <Globe2 className={className} />;
  return <Send className={className} />;
}

function dateValue(value?: string) {
  const parsed = new Date(value || '').getTime();
  return Number.isNaN(parsed) ? 0 : parsed;
}

function formatTime(value?: string) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const today = new Date();
  return date.toDateString() === today.toDateString()
    ? date.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })
    : date.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' });
}

export const UnifiedInboxPage: React.FC = () => {
  const [remoteConversations, setRemoteConversations] = useState<Conversation[]>([]);
  const [botMessages, setBotMessages] = useState<BotMessage[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [messages, setMessages] = useState<Message[]>([]);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<'all' | 'instagram' | 'telegram' | 'website'>('all');
  const [draft, setDraft] = useState('');
  const [loading, setLoading] = useState(true);
  const [messagesLoading, setMessagesLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const [instagramNotice, setInstagramNotice] = useState('');
  const [mobileChat, setMobileChat] = useState(false);
  const inboxRef = useInboxViewport(mobileChat);
  const messagesRef = useRef<HTMLDivElement>(null);
  const followLatest = useRef(true);
  const activeConversationId = useRef(selectedId);
  activeConversationId.current = selectedId;

  const botConversations = useMemo(() => {
    const grouped = new Map<string, BotMessage[]>();
    botMessages.forEach(message => {
      const userId = String(message.userId || '');
      if (userId) grouped.set(userId, [...(grouped.get(userId) || []), message]);
    });
    return [...grouped.entries()].map(([userId, rows]): Conversation => {
      const sorted = rows.sort((a, b) => dateValue(a.receivedAt) - dateValue(b.receivedAt));
      const profile = [...sorted].reverse().find(item => item.firstName || item.username) || sorted[0];
      const localMessages = sorted.map(item => ({ ...item, createdAt: item.receivedAt, direction: item.direction || 'incoming' }));
      return {
        id: `telegram_bot:${userId}`,
        sourceId: userId,
        channel: 'telegram_bot',
        name: profile?.firstName || profile?.username || `Клиент ${userId}`,
        username: profile?.username,
        updatedAt: sorted.at(-1)?.receivedAt || '',
        lastMessage: localMessages.at(-1),
        localMessages,
      };
    });
  }, [botMessages]);

  const conversations = useMemo(
    () => [...remoteConversations, ...botConversations].sort((a, b) => dateValue(b.updatedAt) - dateValue(a.updatedAt)),
    [remoteConversations, botConversations],
  );
  const selected = conversations.find(item => item.id === selectedId) || null;

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return conversations.filter(item => {
      const channelMatch = filter === 'all' || item.channel === filter || (filter === 'telegram' && item.channel.startsWith('telegram'));
      const textMatch = !needle || [item.name, item.username, item.accountPhone, item.lastMessage?.text]
        .some(value => String(value || '').toLowerCase().includes(needle));
      return channelMatch && textMatch;
    });
  }, [conversations, filter, search]);

  const loadRemote = async (quiet = false) => {
    if (!quiet) setLoading(true);
    try {
      const [instagramResult, telegramResult, websiteResult] = await Promise.allSettled([
        api<any>('/api/instagram/conversations?limit=300'),
        api<any>('/api/tg-inbox/conversations?limit=80', {}, true),
        api<any>('/api/site-chat/conversations', {}, true),
      ]);
      const next: Conversation[] = [];
      if (instagramResult.status === 'fulfilled') {
        setInstagramNotice(String(instagramResult.value.notice || ''));
        (instagramResult.value.conversations || []).forEach((row: any) => next.push({
          id: `instagram:${row.id}`,
          sourceId: row.id,
          channel: 'instagram',
          name: row.linkedClient?.fullName || row.linkedClient?.name || row.customer?.username || row.customer?.name || 'Instagram клиент',
          username: row.customer?.username,
          recipientId: row.customer?.id,
          updatedAt: row.updatedAt || row.lastMessage?.createdAt || '',
          lastMessage: row.lastMessage,
          linkedClient: row.linkedClient,
        }));
      } else setInstagramNotice(`Instagram: ${instagramResult.reason?.message || 'не удалось загрузить диалоги'}`);
      if (telegramResult.status === 'fulfilled') {
        (telegramResult.value.conversations || []).forEach((row: any) => next.push({
          ...row,
          id: `telegram_account:${row.id}`,
          sourceId: row.id,
          channel: 'telegram_account',
        }));
      }
      if (websiteResult.status === 'fulfilled') {
        (websiteResult.value.conversations || []).forEach((row: any) => next.push({
          id: `website:${row.id}`,
          sourceId: row.id,
          channel: 'website',
          name: row.visitorName || row.visitorPhone || 'Посетитель сайта',
          username: row.visitorPhone || '',
          updatedAt: row.updatedAt || row.lastMessage?.createdAt || '',
          lastMessage: row.lastMessage,
          unreadCount: Number(row.unreadCount || 0),
        }));
      }
      const failures = [instagramResult, telegramResult, websiteResult].filter(item => item.status === 'rejected') as PromiseRejectedResult[];
      setError(failures.length === 3 ? failures[0].reason?.message || 'Не удалось загрузить диалоги' : '');
      setRemoteConversations(next);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => onSnapshot(
    query(collection(db, 'bot_messages'), orderBy('receivedAt', 'desc'), limit(500)),
    snapshot => setBotMessages(snapshot.docs.map(item => ({ id: item.id, ...item.data() } as BotMessage))),
    reason => setError(reason.message || 'Не удалось загрузить сообщения бота'),
  ), []);

  useEffect(() => {
    loadRemote();
    const timer = window.setInterval(() => loadRemote(true), 15000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!selectedId && conversations[0]) setSelectedId(conversations[0].id);
  }, [conversations, selectedId]);

  const loadMessages = async (conversation: Conversation, quiet = false) => {
    if (!quiet) setMessagesLoading(true);
    try {
      if (conversation.channel === 'telegram_bot') {
        setMessages(conversation.localMessages || []);
        return;
      }
      let result: { messages: Message[] };
      if (conversation.channel === 'instagram') {
        result = await api(`/api/instagram/conversations/${conversation.sourceId}/messages`);
      } else if (conversation.channel === 'telegram_account') {
        result = await api(`/api/tg-inbox/messages?accountPhone=${encodeURIComponent(conversation.accountPhone || '')}&peerId=${encodeURIComponent(conversation.peerId || '')}`, {}, true);
      } else {
        result = await api(`/api/site-chat/inbox/${conversation.sourceId}/messages`, {}, true);
      }
      if (activeConversationId.current === conversation.id) setMessages(result.messages || []);
    } catch (reason: any) {
      if (activeConversationId.current === conversation.id) setError(reason.message || 'Не удалось загрузить сообщения');
    } finally {
      if (activeConversationId.current === conversation.id) setMessagesLoading(false);
    }
  };

  useEffect(() => {
    if (!selected) return;
    followLatest.current = true;
    setMessages([]);
    setDraft('');
    loadMessages(selected);
    if (selected.channel === 'telegram_bot') return;
    const timer = window.setInterval(() => loadMessages(selected, true), 10000);
    return () => window.clearInterval(timer);
  }, [selectedId, selected?.channel]);

  useEffect(() => {
    if (selected?.channel === 'telegram_bot') setMessages(selected.localMessages || []);
  }, [selected?.localMessages]);

  useLayoutEffect(() => {
    const pane = messagesRef.current;
    if (!pane) return;
    // Keep the latest message above the composer when the mobile keyboard opens.
    const observer = new ResizeObserver(() => {
      if (followLatest.current) pane.scrollTop = pane.scrollHeight;
    });
    observer.observe(pane);
    return () => observer.disconnect();
  }, [selectedId, mobileChat]);

  useEffect(() => {
    // scrollIntoView also scrolls the CRM document and can hide the entire chat.
    // Only move the message pane, and don't pull a reader away from older messages.
    if (messagesLoading || !followLatest.current) return;
    const frame = requestAnimationFrame(() => {
      const pane = messagesRef.current;
      if (pane && followLatest.current) pane.scrollTop = pane.scrollHeight;
    });
    return () => cancelAnimationFrame(frame);
  }, [messages, messagesLoading, mobileChat]);

  const send = async () => {
    if (!selected || !draft.trim() || sending) return;
    setSending(true);
    setError('');
    try {
      const text = draft.trim();
      let result: any = {};
      if (selected.channel === 'instagram') {
        const contextMessage = [...messages].reverse().find(message => message.direction === 'incoming')?.text || '';
        result = await api(`/api/instagram/conversations/${selected.sourceId}/messages`, { method: 'POST', body: JSON.stringify({ recipientId: selected.recipientId, text, contextMessage }) });
      } else if (selected.channel === 'telegram_bot') {
        result = await api('/api/bot/reply', { method: 'POST', body: JSON.stringify({ userId: selected.sourceId, message: text }) });
      } else if (selected.channel === 'telegram_account') {
        result = await api('/api/tg-inbox/messages', { method: 'POST', body: JSON.stringify({ accountPhone: selected.accountPhone, peerId: selected.peerId, text }) }, true);
      } else {
        result = await api(`/api/site-chat/inbox/${selected.sourceId}/messages`, { method: 'POST', body: JSON.stringify({ text }) }, true);
      }
      if (activeConversationId.current === selected.id) {
        followLatest.current = true;
        if (result.message) setMessages(current => [...current, result.message]);
        setDraft('');
        await loadMessages(selected, true);
      }
      await loadRemote(true);
    } catch (reason: any) {
      setError(reason.message || 'Сообщение не отправлено');
    } finally {
      setSending(false);
    }
  };

  const filters: Array<{ id: typeof filter; label: string }> = [
    { id: 'all', label: 'Все' }, { id: 'instagram', label: 'Instagram' }, { id: 'telegram', label: 'Telegram' }, { id: 'website', label: 'Сайт' },
  ];

  const showInstagramNotice = Boolean(instagramNotice) && (filter === 'all' || filter === 'instagram');

  return <div ref={inboxRef} className={cn('unified-inbox', mobileChat && 'unified-inbox-mobile-chat')}>
    {error && <div role="alert" className="unified-inbox-notice mb-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-xs text-red-700">{error}</div>}
    {showInstagramNotice && <div className="unified-inbox-notice mb-3 flex items-start justify-between gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs leading-5 text-amber-800"><span>{instagramNotice}</span><button type="button" onClick={() => loadRemote()} disabled={loading} className="grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-amber-200 bg-white text-amber-800 transition-colors hover:bg-amber-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 disabled:opacity-50" aria-label="Обновить диалоги Instagram"><RefreshCw className={cn('h-4 w-4', loading && 'animate-spin')} /></button></div>}
    <section aria-label="Общий мессенджер" className="unified-inbox-grid rounded-xl border border-[#E6E9EF] bg-white">
      <aside className={cn('min-h-0 min-w-0 flex-col overflow-hidden border-r border-[#E6E9EF]', mobileChat ? 'hidden lg:flex' : 'flex')}>
        <div className="shrink-0 space-y-2 border-b border-[#E6E9EF] p-3">
          <label className="flex h-11 items-center gap-2 rounded-lg bg-[#F4F6F8] px-3"><Search className="h-4 w-4 text-[#9CA3AF]" /><input value={search} onChange={event => setSearch(event.target.value)} placeholder="Поиск по всем чатам" className="min-w-0 flex-1 bg-transparent text-sm outline-none" /></label>
          <div className="flex gap-1 overflow-x-auto">{filters.map(item => <button key={item.id} onClick={() => setFilter(item.id)} className={cn('h-8 shrink-0 rounded-lg px-3 text-[11px] font-semibold', filter === item.id ? 'bg-[#1F2937] text-white' : 'bg-[#F4F6F8] text-[#6B7280]')}>{item.label}</button>)}</div>
        </div>
        <div aria-label="Список диалогов" className="unified-inbox-scroll">
          {loading && <div className="grid h-40 place-items-center"><Loader2 className="h-5 w-5 animate-spin" /></div>}
          {!loading && !filtered.length && <div className="px-6 py-14 text-center text-sm text-[#9CA3AF]"><MessageCircle className="mx-auto mb-3 h-8 w-8" />Диалогов пока нет</div>}
          {filtered.map(item => {
            const meta = channelMeta[item.channel];
            return <button key={item.id} onClick={() => { setSelectedId(item.id); setMobileChat(true); }} className={cn('flex w-full gap-3 border-b border-[#EEF0F4] px-4 py-3 text-left hover:bg-[#F6F7F9]', selectedId === item.id && 'bg-[#EEF5FF]')}>
              <span className={cn('relative grid h-11 w-11 shrink-0 place-items-center rounded-full', meta.bg, meta.color)}><UserRound className="h-5 w-5" /><span className={cn('absolute -bottom-0.5 -right-0.5 grid h-5 w-5 place-items-center rounded-full border-2 border-white', meta.bg)}><ChannelIcon channel={item.channel} className="h-3 w-3" /></span></span>
              <span className="min-w-0 flex-1"><span className="flex items-center justify-between gap-2"><b className="truncate text-[13px] text-[#1F2937]">{item.name}</b><time className="shrink-0 text-[10px] text-[#9CA3AF]">{formatTime(item.updatedAt)}</time></span><span className="mt-0.5 flex items-center gap-1 text-[10px] font-medium text-[#9CA3AF]"><ChannelIcon channel={item.channel} className="h-3 w-3" />{item.channel === 'telegram_account' ? item.accountPhone : meta.shortLabel}</span><span className="mt-1 block truncate text-xs text-[#6B7280]">{item.lastMessage?.text || 'Нет текста сообщения'}</span></span>
              {!!item.unreadCount && <span className="mt-7 grid h-5 min-w-5 place-items-center rounded-full bg-[#2563EB] px-1 text-[9px] font-semibold text-white">{item.unreadCount}</span>}
            </button>;
          })}
        </div>
      </aside>

      <section aria-label="Переписка" className={cn('min-h-0 min-w-0 flex-col overflow-hidden', mobileChat ? 'flex' : 'hidden lg:flex')}>
        {selected ? <>
          <header className="flex h-16 shrink-0 items-center gap-3 border-b border-[#E6E9EF] px-4">
            <button onClick={() => setMobileChat(false)} aria-label="Назад к диалогам" className="grid h-11 w-11 shrink-0 place-items-center rounded-lg border border-[#E6E9EF] lg:hidden"><ArrowLeft className="h-4 w-4" /></button>
            <span className={cn('grid h-10 w-10 place-items-center rounded-full', channelMeta[selected.channel].bg, channelMeta[selected.channel].color)}><ChannelIcon channel={selected.channel} /></span>
            <div className="min-w-0"><h2 className="truncate text-sm font-semibold text-[#1F2937]">{selected.name}</h2><p className="truncate text-[11px] text-[#9CA3AF]">{selected.channel === 'telegram_account' ? `${channelMeta[selected.channel].label} · ${selected.accountPhone}` : channelMeta[selected.channel].label}</p></div>
          </header>
          <div ref={messagesRef} aria-label="Сообщения" onScroll={event => { const pane = event.currentTarget; followLatest.current = pane.scrollHeight - pane.scrollTop - pane.clientHeight < 96; }} className="unified-inbox-scroll space-y-2 bg-[#F4F6F8] p-4 sm:p-6">
            {messagesLoading ? <div className="grid h-full place-items-center"><Loader2 className="h-5 w-5 animate-spin" /></div> : messages.map(message => <div key={message.id} className={cn('flex items-end gap-1.5', message.direction === 'outgoing' ? 'justify-end' : 'justify-start')}>
              {message.direction === 'incoming' && <span className={cn('mb-1 grid h-6 w-6 shrink-0 place-items-center rounded-full', channelMeta[selected.channel].bg, channelMeta[selected.channel].color)}><ChannelIcon channel={selected.channel} className="h-3 w-3" /></span>}
              <div className={cn('min-w-0 max-w-[82%] rounded-2xl px-3 py-2.5 text-[13px] leading-5 shadow-sm', message.direction === 'outgoing' ? 'rounded-br-md bg-[#2563EB] text-white' : 'rounded-bl-md border border-[#E6E9EF] bg-white text-[#1F2937]')}><p className="whitespace-pre-wrap [overflow-wrap:anywhere]">{message.text || (message.attachments?.length ? 'Вложение' : '')}</p><time className={cn('mt-1 block text-right text-[9px]', message.direction === 'outgoing' ? 'text-white/70' : 'text-[#9CA3AF]')}>{formatTime(message.createdAt)}</time></div>
            </div>)}
          </div>
          <footer className="unified-inbox-composer border-t border-[#E6E9EF] bg-white p-3"><div className="flex items-end gap-2"><textarea aria-label="Текст сообщения" value={draft} onChange={event => setDraft(event.target.value)} onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing && window.matchMedia('(min-width: 1024px)').matches) { event.preventDefault(); send(); } }} rows={2} placeholder={`Сообщение в ${channelMeta[selected.channel].shortLabel}...`} className="min-h-11 min-w-0 flex-1 resize-none rounded-xl border border-[#E6E9EF] px-3 py-2.5 text-base outline-none focus:border-[#2563EB] lg:text-[13px]" /><button onClick={send} disabled={!draft.trim() || sending} aria-label="Отправить" className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-[#2563EB] text-white disabled:opacity-40">{sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}</button></div></footer>
        </> : <div className="grid h-full place-items-center text-sm text-[#9CA3AF]">Выберите диалог</div>}
      </section>

      <aside className="hidden min-h-0 min-w-0 overflow-y-auto overscroll-contain border-l border-[#E6E9EF] bg-white p-5 xl:block">
        {selected && <div className="space-y-5"><div className="text-center"><span className={cn('mx-auto grid h-16 w-16 place-items-center rounded-full', channelMeta[selected.channel].bg, channelMeta[selected.channel].color)}><UserRound className="h-7 w-7" /></span><h3 className="mt-3 text-sm font-semibold text-[#1F2937]">{selected.name}</h3><p className="mt-1 text-[11px] text-[#9CA3AF]">{selected.username ? `@${selected.username.replace(/^@/, '')}` : channelMeta[selected.channel].label}</p></div><div className="rounded-xl bg-[#F4F6F8] p-3"><p className="text-[10px] font-semibold uppercase tracking-wider text-[#9CA3AF]">Источник</p><p className="mt-2 flex items-center gap-2 text-xs font-semibold text-[#1F2937]"><ChannelIcon channel={selected.channel} className="h-4 w-4" />{channelMeta[selected.channel].label}</p>{selected.accountPhone && <p className="mt-1 text-[11px] text-[#6B7280]">Аккаунт {selected.accountPhone}</p>}</div>{selected.linkedClient && <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3"><p className="text-[10px] font-semibold uppercase tracking-wider text-emerald-700">Клиент CRM</p><p className="mt-2 text-xs font-semibold text-[#1F2937]">{selected.linkedClient.fullName || selected.linkedClient.name}</p><p className="mt-1 text-[11px] text-[#6B7280]">{selected.linkedClient.phone}</p></div>}<p className="text-[10px] leading-4 text-[#9CA3AF]">Объединение одного клиента между разными каналами добавим следующим этапом. Сейчас источник всегда виден в диалоге.</p></div>}
      </aside>
    </section>
  </div>;
};

export default UnifiedInboxPage;

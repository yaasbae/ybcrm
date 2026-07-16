import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  Check,
  Instagram,
  Link2,
  Loader2,
  MessageCircle,
  RefreshCw,
  Search,
  Send,
  UserRound,
} from 'lucide-react';
import { cn } from '../lib/utils';

type Message = {
  id: string;
  text: string;
  createdAt: string;
  direction: 'incoming' | 'outgoing';
  attachments?: any[];
};

type Client = {
  id: string;
  fullName?: string;
  name?: string;
  phone?: string;
  insta?: string;
  instagram?: string;
  totalSpent?: number;
  ordersCount?: number;
};

type Conversation = {
  id: string;
  updatedAt: string;
  customer?: { id?: string; name?: string; username?: string } | null;
  lastMessage?: Message | null;
  linkedClient?: Client | null;
};

async function api<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...(options?.headers || {}) },
  });
  const text = await response.text();
  const data = text ? JSON.parse(text) : {};
  if (!response.ok) throw new Error(data.error || 'Ошибка сервера');
  return data;
}

function displayName(conversation: Conversation) {
  return conversation.linkedClient?.fullName || conversation.linkedClient?.name ||
    conversation.customer?.username || conversation.customer?.name || 'Instagram клиент';
}

function formatTime(value?: string) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const today = new Date();
  if (date.toDateString() === today.toDateString()) return date.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
  return date.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' });
}

export const InstagramInboxPage: React.FC<{ embedded?: boolean }> = ({ embedded = false }) => {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(true);
  const [messagesLoading, setMessagesLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [draft, setDraft] = useState('');
  const [clientQuery, setClientQuery] = useState('');
  const [clients, setClients] = useState<Client[]>([]);
  const [clientLoading, setClientLoading] = useState(false);
  const [mobileChat, setMobileChat] = useState(false);
  const needsReconnect = /access token|session has expired|token.*expired|oauth/i.test(error);

  const selected = conversations.find((item) => item.id === selectedId) || null;
  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return conversations;
    return conversations.filter((item) => [displayName(item), item.customer?.username, item.lastMessage?.text]
      .some((value) => String(value || '').toLowerCase().includes(needle)));
  }, [conversations, query]);

  const loadConversations = async (quiet = false) => {
    if (!quiet) setLoading(true);
    setError('');
    try {
      const data = await api<{ conversations: Conversation[] }>('/api/instagram/conversations?limit=50');
      setConversations(data.conversations || []);
      setSelectedId((current) => current || data.conversations?.[0]?.id || '');
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  const loadMessages = async (conversationId: string) => {
    if (!conversationId) return;
    setMessagesLoading(true);
    setError('');
    try {
      const data = await api<{ messages: Message[] }>(`/api/instagram/conversations/${conversationId}/messages`);
      setMessages(data.messages || []);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setMessagesLoading(false);
    }
  };

  useEffect(() => {
    loadConversations();
    const timer = window.setInterval(() => loadConversations(true), 15000);
    const onFocus = () => loadConversations(true);
    window.addEventListener('focus', onFocus);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('focus', onFocus);
    };
  }, []);

  useEffect(() => {
    if (!selectedId) return;
    let active = true;
    const refresh = async () => {
      if (active) await loadMessages(selectedId);
    };
    refresh();
    const timer = window.setInterval(refresh, 10000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [selectedId]);

  useEffect(() => {
    if (!clientQuery.trim()) {
      setClients([]);
      return;
    }
    const timer = window.setTimeout(async () => {
      setClientLoading(true);
      try {
        const data = await api<{ clients: Client[] }>(`/api/instagram/client-search?q=${encodeURIComponent(clientQuery)}`);
        setClients(data.clients || []);
      } catch (e: any) {
        setError(e.message);
      } finally {
        setClientLoading(false);
      }
    }, 300);
    return () => window.clearTimeout(timer);
  }, [clientQuery]);

  const selectConversation = (conversation: Conversation) => {
    setSelectedId(conversation.id);
    setMobileChat(true);
  };

  const sendMessage = async () => {
    if (!selected || !draft.trim() || !selected.customer?.id || sending) return;
    setSending(true);
    setError('');
    try {
      const contextMessage = [...messages].reverse().find((message) => message.direction === 'incoming')?.text || '';
      const data = await api<{ message: Message }>(`/api/instagram/conversations/${selected.id}/messages`, {
        method: 'POST',
        body: JSON.stringify({ recipientId: selected.customer.id, text: draft.trim(), contextMessage }),
      });
      setMessages((current) => [...current, data.message]);
      setDraft('');
      await loadConversations(true);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSending(false);
    }
  };

  const linkClient = async (client: Client) => {
    if (!selected) return;
    try {
      const data = await api<{ linkedClient: Client }>(`/api/instagram/conversations/${selected.id}/link-client`, {
        method: 'POST',
        body: JSON.stringify({ clientId: client.id }),
      });
      setConversations((current) => current.map((item) => item.id === selected.id ? { ...item, linkedClient: data.linkedClient } : item));
      setClientQuery('');
      setClients([]);
    } catch (e: any) {
      setError(e.message);
    }
  };

  return (
    <div className={cn('w-full', embedded ? '' : 'mx-auto max-w-[1880px] px-3 pb-8 sm:px-5')}>
      {!embedded && <header className="flex flex-wrap items-center justify-between gap-3 py-5">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-[8px] bg-[#E83E8C] text-white">
            <Instagram className="h-5 w-5" />
          </div>
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[#9CA3AF]">Instagram</p>
            <h1 className="text-[24px] font-semibold leading-8 text-[#1F2937]">Диалоги с клиентами</h1>
          </div>
        </div>
        <button onClick={() => loadConversations()} disabled={loading} className="flex h-10 items-center gap-2 rounded-[8px] border border-[#E6E9EF] bg-white px-4 text-[12px] font-semibold text-[#1F2937] hover:bg-[#F6F7F9] disabled:opacity-50">
          <RefreshCw className={cn('h-4 w-4', loading && 'animate-spin')} /> Обновить
        </button>
      </header>}

      {error && (
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3 rounded-[8px] border border-red-200 bg-red-50 px-4 py-3 text-[12px] font-medium text-[#F06B6B]">
          <span className="flex min-w-0 items-center gap-2"><AlertTriangle className="h-4 w-4 shrink-0" /><span>{error}</span></span>
          {needsReconnect && <a href="/integrations" className="shrink-0 rounded-[8px] bg-[#1F2937] px-3 py-2 text-[11px] font-semibold text-white">Переподключить Instagram</a>}
        </div>
      )}

      <section className="grid min-h-[680px] overflow-hidden rounded-[8px] border border-[#E6E9EF] bg-white lg:h-[calc(100vh-210px)] lg:grid-cols-[320px_minmax(420px,1fr)_300px]">
        <aside className={cn('border-r border-[#E6E9EF]', mobileChat && 'hidden lg:block')}>
          <div className="border-b border-[#E6E9EF] p-3">
            <label className="flex h-10 items-center gap-2 rounded-[8px] border border-[#E6E9EF] bg-[#F6F7F9] px-3">
              <Search className="h-4 w-4 text-[#9CA3AF]" />
              <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Поиск диалога" className="min-w-0 flex-1 bg-transparent text-[13px] outline-none placeholder:text-[#9CA3AF]" />
            </label>
          </div>
          <div className="h-[620px] overflow-y-auto lg:h-[calc(100%-65px)]">
            {loading ? <div className="grid h-40 place-items-center"><Loader2 className="h-5 w-5 animate-spin text-[#7D7DE6]" /></div> : null}
            {!loading && !filtered.length ? <div className="px-5 py-10 text-center"><MessageCircle className="mx-auto h-7 w-7 text-[#CBD0D8]" /><p className="mt-3 text-[13px] font-medium text-[#6B7280]">Meta вернула 0 диалогов</p><p className="mt-2 text-[11px] leading-5 text-[#9CA3AF]">Список обновляется автоматически. В режиме тестирования Meta показывает только переписки с пользователями, добавленными в роли приложения; для реальных клиентов нужен опубликованный сценарий и расширенный доступ.</p></div> : null}
            {filtered.map((conversation) => (
              <button key={conversation.id} onClick={() => selectConversation(conversation)} className={cn('flex w-full gap-3 border-b border-[#EEF0F4] px-4 py-3 text-left hover:bg-[#F6F7F9]', selectedId === conversation.id && 'bg-[#F1F2FB]')}>
                <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-[#FCE8F1] text-[#E83E8C]"><UserRound className="h-5 w-5" /></span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center justify-between gap-2"><b className="truncate text-[13px] text-[#1F2937]">{displayName(conversation)}</b><time className="shrink-0 text-[10px] text-[#9CA3AF]">{formatTime(conversation.updatedAt)}</time></span>
                  <span className="mt-1 block truncate text-[12px] text-[#6B7280]">{conversation.lastMessage?.text || 'Вложение'}</span>
                  {conversation.linkedClient && <span className="mt-1 inline-flex items-center gap-1 text-[10px] font-semibold text-[#2EBA7F]"><Link2 className="h-3 w-3" /> Клиент CRM</span>}
                </span>
              </button>
            ))}
          </div>
        </aside>

        <main className={cn('flex min-h-[680px] flex-col', !mobileChat && 'hidden lg:flex')}>
          {selected ? (
            <>
              <div className="flex h-16 items-center gap-3 border-b border-[#E6E9EF] px-4">
                <button onClick={() => setMobileChat(false)} className="grid h-9 w-9 place-items-center rounded-[8px] border border-[#E6E9EF] lg:hidden"><ArrowLeft className="h-4 w-4" /></button>
                <span className="grid h-9 w-9 place-items-center rounded-full bg-[#FCE8F1] text-[#E83E8C]"><Instagram className="h-4 w-4" /></span>
                <div className="min-w-0"><h2 className="truncate text-[14px] font-semibold text-[#1F2937]">{displayName(selected)}</h2><p className="truncate text-[11px] text-[#9CA3AF]">@{selected.customer?.username || selected.customer?.name || selected.customer?.id}</p></div>
              </div>
              <div className="flex-1 space-y-2 overflow-y-auto bg-[#F8F9FB] p-4 sm:p-6">
                {messagesLoading ? <div className="grid h-full place-items-center"><Loader2 className="h-5 w-5 animate-spin text-[#7D7DE6]" /></div> : null}
                {!messagesLoading && messages.map((message) => (
                  <div key={message.id} className={cn('flex', message.direction === 'outgoing' ? 'justify-end' : 'justify-start')}>
                    <div className={cn('max-w-[82%] rounded-[8px] px-3 py-2.5 text-[13px] leading-5 shadow-sm', message.direction === 'outgoing' ? 'bg-[#7D7DE6] text-white' : 'border border-[#E6E9EF] bg-white text-[#1F2937]')}>
                      <p className="whitespace-pre-wrap break-words">{message.text || (message.attachments?.length ? 'Вложение' : '')}</p>
                      <time className={cn('mt-1 block text-right text-[9px]', message.direction === 'outgoing' ? 'text-white/70' : 'text-[#9CA3AF]')}>{formatTime(message.createdAt)}</time>
                    </div>
                  </div>
                ))}
              </div>
              <div className="border-t border-[#E6E9EF] bg-white p-3">
                <div className="flex items-end gap-2">
                  <textarea value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); } }} placeholder="Ответить клиенту..." rows={2} className="min-h-[44px] flex-1 resize-none rounded-[8px] border border-[#E6E9EF] px-3 py-2.5 text-[13px] outline-none focus:border-[#7D7DE6]" />
                  <button title="Отправить" onClick={sendMessage} disabled={!draft.trim() || sending} className="grid h-11 w-11 shrink-0 place-items-center rounded-[8px] bg-[#1F2937] text-white disabled:opacity-40">{sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}</button>
                </div>
              </div>
            </>
          ) : <div className="grid h-full place-items-center text-center text-[#9CA3AF]"><div><MessageCircle className="mx-auto mb-3 h-8 w-8" /><p className="text-[13px]">Выбери диалог</p></div></div>}
        </main>

        <aside className={cn('border-l border-[#E6E9EF] p-4', !mobileChat && 'hidden lg:block')}>
          <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[#9CA3AF]">Клиент CRM</p>
          {selected?.linkedClient ? (
            <div className="mt-4 border-b border-[#E6E9EF] pb-4">
              <div className="flex items-start gap-3"><span className="grid h-10 w-10 place-items-center rounded-full bg-emerald-50 text-[#2EBA7F]"><Check className="h-5 w-5" /></span><div className="min-w-0"><h3 className="text-[14px] font-semibold text-[#1F2937]">{selected.linkedClient.fullName || selected.linkedClient.name}</h3><p className="mt-1 text-[12px] text-[#6B7280]">{selected.linkedClient.phone || 'Телефон не указан'}</p><p className="mt-1 text-[11px] text-[#2EBA7F]">Диалог привязан</p></div></div>
            </div>
          ) : <p className="mt-3 text-[12px] leading-5 text-[#6B7280]">Совпадение по Instagram не найдено.</p>}
          <div className="mt-4">
            <label className="flex h-10 items-center gap-2 rounded-[8px] border border-[#E6E9EF] px-3"><Search className="h-4 w-4 text-[#9CA3AF]" /><input value={clientQuery} onChange={(e) => setClientQuery(e.target.value)} placeholder="Имя, телефон, Instagram" className="min-w-0 flex-1 text-[12px] outline-none" /></label>
            <div className="mt-2 max-h-[420px] overflow-y-auto">
              {clientLoading && <div className="grid h-16 place-items-center"><Loader2 className="h-4 w-4 animate-spin" /></div>}
              {clients.map((client) => <button key={client.id} onClick={() => linkClient(client)} className="flex w-full items-center justify-between gap-2 border-b border-[#EEF0F4] py-3 text-left hover:bg-[#F6F7F9]"><span className="min-w-0"><b className="block truncate text-[12px] text-[#1F2937]">{client.fullName || client.name}</b><small className="mt-1 block truncate text-[10px] text-[#9CA3AF]">{client.phone} {client.insta || client.instagram}</small></span><Link2 className="h-4 w-4 shrink-0 text-[#7D7DE6]" /></button>)}
            </div>
          </div>
          <div className="mt-5 border-t border-[#E6E9EF] pt-4"><span className="inline-flex items-center gap-1.5 rounded-[8px] bg-[#F1F2FB] px-2.5 py-1.5 text-[10px] font-semibold text-[#7D7DE6]"><MessageCircle className="h-3.5 w-3.5" /> AI база включена</span></div>
        </aside>
      </section>
    </div>
  );
};

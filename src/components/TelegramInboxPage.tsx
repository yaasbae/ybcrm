import React, { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, Loader2, MessageCircle, Search, Send, UserRound } from 'lucide-react';
import { collection, limit, onSnapshot, orderBy, query } from 'firebase/firestore';
import { db } from '../firebase';
import { cn } from '../lib/utils';

type TelegramMessage = {
  id: string;
  userId: string;
  firstName?: string;
  username?: string;
  text: string;
  receivedAt: string;
  direction?: 'incoming' | 'outgoing';
};

const messageTime = (value?: string) => {
  const date = new Date(value || '');
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
};

export const TelegramInboxPage: React.FC = () => {
  const [messages, setMessages] = useState<TelegramMessage[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [search, setSearch] = useState('');
  const [draft, setDraft] = useState('');
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const [mobileChat, setMobileChat] = useState(false);

  useEffect(() => onSnapshot(
    query(collection(db, 'bot_messages'), orderBy('receivedAt', 'desc'), limit(500)),
    snapshot => {
      setMessages(snapshot.docs.map(item => ({ id: item.id, ...item.data() } as TelegramMessage)));
      setLoading(false);
    },
    reason => {
      setError(reason.message || 'Не удалось загрузить Telegram');
      setLoading(false);
    },
  ), []);

  const conversations = useMemo(() => {
    const grouped = new Map<string, TelegramMessage[]>();
    messages.forEach(message => {
      const key = String(message.userId || '');
      if (!key) return;
      grouped.set(key, [...(grouped.get(key) || []), message]);
    });
    return [...grouped.entries()].map(([userId, rows]) => {
      const sorted = [...rows].sort((a, b) => new Date(a.receivedAt).getTime() - new Date(b.receivedAt).getTime());
      const profile = [...sorted].reverse().find(row => row.firstName || row.username) || sorted[0];
      return { userId, messages: sorted, profile, lastMessage: sorted[sorted.length - 1] };
    }).sort((a, b) => new Date(b.lastMessage.receivedAt).getTime() - new Date(a.lastMessage.receivedAt).getTime());
  }, [messages]);

  useEffect(() => {
    if (!selectedId && conversations[0]?.userId) setSelectedId(conversations[0].userId);
  }, [conversations, selectedId]);

  const filtered = conversations.filter(item => {
    const needle = search.trim().toLowerCase();
    return !needle || [item.profile.firstName, item.profile.username, item.lastMessage.text]
      .some(value => String(value || '').toLowerCase().includes(needle));
  });
  const selected = conversations.find(item => item.userId === selectedId);

  const send = async () => {
    if (!selected || !draft.trim() || sending) return;
    setSending(true);
    setError('');
    try {
      const response = await fetch('/api/bot/reply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: selected.userId, message: draft.trim() }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || 'Сообщение не отправлено');
      setDraft('');
    } catch (reason: any) {
      setError(reason.message);
    } finally {
      setSending(false);
    }
  };

  return (
    <div>
      {error && <div className="mb-3 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-xs text-red-700">{error}</div>}
      <section className="grid min-h-[680px] overflow-hidden rounded-xl border border-[#E6E9EF] bg-white lg:h-[calc(100vh-250px)] lg:grid-cols-[330px_minmax(420px,1fr)]">
        <aside className={cn('border-r border-[#E6E9EF]', mobileChat && 'hidden lg:block')}>
          <div className="border-b border-[#E6E9EF] p-3">
            <label className="flex h-11 items-center gap-2 rounded-lg bg-[#F4F6F8] px-3">
              <Search className="h-4 w-4 text-[#9CA3AF]" />
              <input value={search} onChange={event => setSearch(event.target.value)} placeholder="Поиск в Telegram" className="min-w-0 flex-1 bg-transparent text-sm outline-none" />
            </label>
          </div>
          <div className="h-[620px] overflow-y-auto lg:h-[calc(100%-68px)]">
            {loading && <div className="grid h-40 place-items-center"><Loader2 className="h-5 w-5 animate-spin" /></div>}
            {!loading && !filtered.length && <div className="px-6 py-14 text-center text-sm text-[#9CA3AF]"><MessageCircle className="mx-auto mb-3 h-8 w-8" />Сообщений пока нет</div>}
            {filtered.map(item => (
              <button key={item.userId} onClick={() => { setSelectedId(item.userId); setMobileChat(true); }} className={cn('flex w-full gap-3 border-b border-[#EEF0F4] px-4 py-3 text-left transition-colors hover:bg-[#F6F7F9]', selectedId === item.userId && 'bg-[#EEF5FF]')}>
                <span className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-[#E8F4FF] text-[#229ED9]"><UserRound className="h-5 w-5" /></span>
                <span className="min-w-0 flex-1"><span className="flex items-center justify-between gap-2"><b className="truncate text-[13px] text-[#1F2937]">{item.profile.firstName || item.profile.username || `Клиент ${item.userId}`}</b><time className="shrink-0 text-[10px] text-[#9CA3AF]">{messageTime(item.lastMessage.receivedAt)}</time></span><span className="mt-1 block truncate text-xs text-[#6B7280]">{item.lastMessage.text}</span></span>
              </button>
            ))}
          </div>
        </aside>
        <main className={cn('flex min-h-[680px] flex-col', !mobileChat && 'hidden lg:flex')}>
          {selected ? <>
            <header className="flex h-16 items-center gap-3 border-b border-[#E6E9EF] px-4">
              <button onClick={() => setMobileChat(false)} className="grid h-10 w-10 place-items-center rounded-lg border border-[#E6E9EF] lg:hidden"><ArrowLeft className="h-4 w-4" /></button>
              <span className="grid h-10 w-10 place-items-center rounded-full bg-[#E8F4FF] text-[#229ED9]"><UserRound className="h-5 w-5" /></span>
              <div><h2 className="text-sm font-semibold text-[#1F2937]">{selected.profile.firstName || 'Telegram клиент'}</h2><p className="text-[11px] text-[#9CA3AF]">{selected.profile.username ? `@${selected.profile.username}` : `ID ${selected.userId}`}</p></div>
            </header>
            <div className="flex-1 space-y-2 overflow-y-auto bg-[#F4F6F8] p-4 sm:p-6">
              {selected.messages.map(message => <div key={message.id} className={cn('flex', message.direction === 'outgoing' ? 'justify-end' : 'justify-start')}><div className={cn('max-w-[82%] rounded-xl px-3 py-2.5 text-[13px] leading-5 shadow-sm', message.direction === 'outgoing' ? 'bg-[#229ED9] text-white' : 'border border-[#E6E9EF] bg-white text-[#1F2937]')}><p className="whitespace-pre-wrap break-words">{message.text}</p><time className={cn('mt-1 block text-right text-[9px]', message.direction === 'outgoing' ? 'text-white/70' : 'text-[#9CA3AF]')}>{messageTime(message.receivedAt)}</time></div></div>)}
            </div>
            <footer className="border-t border-[#E6E9EF] bg-white p-3"><div className="flex items-end gap-2"><textarea value={draft} onChange={event => setDraft(event.target.value)} onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); send(); } }} rows={2} placeholder="Сообщение..." className="min-h-11 flex-1 resize-none rounded-xl border border-[#E6E9EF] px-3 py-2.5 text-[13px] outline-none focus:border-[#229ED9]" /><button onClick={send} disabled={!draft.trim() || sending} className="grid h-11 w-11 place-items-center rounded-xl bg-[#229ED9] text-white disabled:opacity-40">{sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}</button></div></footer>
          </> : <div className="grid h-full place-items-center text-sm text-[#9CA3AF]">Выберите диалог</div>}
        </main>
      </section>
    </div>
  );
};

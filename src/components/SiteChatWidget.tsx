import React, { useEffect, useRef, useState } from 'react';
import { Loader2, MessageCircle, Send, X } from 'lucide-react';
import { cn } from '../lib/utils';

type Message = { id: string; text: string; createdAt: string; direction: 'incoming' | 'outgoing' };

const conversationKey = 'ybcrm_site_chat_id';
const tokenKey = 'ybcrm_site_chat_token';

function getSessionValue(key: string, create: () => string) {
  const current = window.localStorage.getItem(key);
  if (current) return current;
  const value = create();
  window.localStorage.setItem(key, value);
  return value;
}

function formatTime(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
}

export const SiteChatWidget: React.FC = () => {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState('');
  const [visitorName, setVisitorName] = useState(() => window.localStorage.getItem('ybcrm_site_chat_name') || '');
  const [visitorPhone, setVisitorPhone] = useState(() => window.localStorage.getItem('ybcrm_site_chat_phone') || '');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const conversationId = useRef(getSessionValue(conversationKey, () => `web_${crypto.randomUUID().replace(/-/g, '')}`));
  const sessionToken = useRef(getSessionValue(tokenKey, () => `${crypto.randomUUID()}${crypto.randomUUID()}`));
  const endRef = useRef<HTMLDivElement>(null);

  const load = async () => {
    try {
      const response = await fetch(`/api/site-chat/conversations/${conversationId.current}/messages?token=${encodeURIComponent(sessionToken.current)}`);
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || 'Чат временно недоступен');
      setMessages(payload.messages || []);
      setError('');
    } catch (reason: any) {
      setError(reason.message || 'Не удалось загрузить чат');
    }
  };

  useEffect(() => {
    if (!open) return;
    load();
    const timer = window.setInterval(load, 5000);
    return () => window.clearInterval(timer);
  }, [open]);

  useEffect(() => endRef.current?.scrollIntoView({ behavior: 'smooth' }), [messages.length, open]);

  const send = async () => {
    if (!draft.trim() || sending) return;
    setSending(true);
    setError('');
    try {
      const params = new URLSearchParams(window.location.search);
      const utm = Object.fromEntries([...params.entries()].filter(([key]) => key.startsWith('utm_')));
      const response = await fetch(`/api/site-chat/conversations/${conversationId.current}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token: sessionToken.current,
          text: draft.trim(),
          visitorName: visitorName.trim(),
          visitorPhone: visitorPhone.trim(),
          pageUrl: window.location.href,
          utm,
        }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || 'Сообщение не отправлено');
      window.localStorage.setItem('ybcrm_site_chat_name', visitorName.trim());
      window.localStorage.setItem('ybcrm_site_chat_phone', visitorPhone.trim());
      setMessages(current => [...current, payload.message]);
      setDraft('');
    } catch (reason: any) {
      setError(reason.message || 'Сообщение не отправлено');
    } finally {
      setSending(false);
    }
  };

  return <div className="fixed bottom-4 right-4 z-[100] font-sans sm:bottom-6 sm:right-6">
    {open && <section className="mb-3 flex h-[min(620px,calc(100vh-100px))] w-[min(390px,calc(100vw-32px))] flex-col overflow-hidden rounded-2xl border border-[#E6E9EF] bg-white shadow-[0_24px_70px_rgba(31,41,55,0.22)]">
      <header className="flex h-16 shrink-0 items-center gap-3 bg-[#1F2937] px-4 text-white">
        <span className="grid h-10 w-10 place-items-center rounded-full bg-white/10"><MessageCircle className="h-5 w-5" /></span>
        <div className="min-w-0 flex-1"><h2 className="text-sm font-semibold">Напишите нам</h2><p className="mt-0.5 text-[11px] text-white/65">Ответим прямо в этом чате</p></div>
        <button onClick={() => setOpen(false)} aria-label="Закрыть чат" className="grid h-10 w-10 place-items-center rounded-xl hover:bg-white/10"><X className="h-5 w-5" /></button>
      </header>
      {!messages.length && <div className="grid grid-cols-2 gap-2 border-b border-[#EEF0F4] p-3"><input value={visitorName} onChange={event => setVisitorName(event.target.value)} placeholder="Ваше имя" className="h-10 rounded-lg border border-[#E6E9EF] px-3 text-xs outline-none focus:border-[#2563EB]" /><input value={visitorPhone} onChange={event => setVisitorPhone(event.target.value)} placeholder="Телефон" inputMode="tel" className="h-10 rounded-lg border border-[#E6E9EF] px-3 text-xs outline-none focus:border-[#2563EB]" /></div>}
      <div className="flex-1 space-y-2 overflow-y-auto bg-[#F4F6F8] p-4">
        {!messages.length && <div className="mx-auto mt-8 max-w-[260px] text-center"><span className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-[#EAF1FF] text-[#2563EB]"><MessageCircle className="h-5 w-5" /></span><p className="mt-3 text-sm font-semibold text-[#1F2937]">Чем можем помочь?</p><p className="mt-1 text-xs leading-5 text-[#6B7280]">Напишите вопрос — менеджер увидит его в CRM.</p></div>}
        {messages.map(message => <div key={message.id} className={cn('flex', message.direction === 'incoming' ? 'justify-end' : 'justify-start')}><div className={cn('max-w-[85%] rounded-2xl px-3 py-2.5 text-[13px] leading-5 shadow-sm', message.direction === 'incoming' ? 'rounded-br-md bg-[#2563EB] text-white' : 'rounded-bl-md border border-[#E6E9EF] bg-white text-[#1F2937]')}><p className="whitespace-pre-wrap break-words">{message.text}</p><time className={cn('mt-1 block text-right text-[9px]', message.direction === 'incoming' ? 'text-white/70' : 'text-[#9CA3AF]')}>{formatTime(message.createdAt)}</time></div></div>)}
        <div ref={endRef} />
      </div>
      {error && <p className="border-t border-red-100 bg-red-50 px-4 py-2 text-[11px] text-red-700">{error}</p>}
      <footer className="shrink-0 border-t border-[#E6E9EF] p-3"><div className="flex items-end gap-2"><textarea value={draft} onChange={event => setDraft(event.target.value)} onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); send(); } }} rows={2} placeholder="Введите сообщение..." className="min-h-11 flex-1 resize-none rounded-xl border border-[#E6E9EF] px-3 py-2.5 text-[13px] outline-none focus:border-[#2563EB]" /><button onClick={send} disabled={!draft.trim() || sending} aria-label="Отправить" className="grid h-11 w-11 place-items-center rounded-xl bg-[#2563EB] text-white disabled:opacity-40">{sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}</button></div></footer>
    </section>}
    <button onClick={() => setOpen(current => !current)} aria-label={open ? 'Закрыть чат' : 'Открыть чат'} className="ml-auto grid h-14 w-14 place-items-center rounded-full bg-[#2563EB] text-white shadow-[0_12px_30px_rgba(37,99,235,0.35)] transition-transform hover:scale-105 active:scale-95">{open ? <X className="h-6 w-6" /> : <MessageCircle className="h-6 w-6" />}</button>
  </div>;
};

export default SiteChatWidget;

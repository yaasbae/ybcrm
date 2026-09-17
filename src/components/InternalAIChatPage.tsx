import React, { FormEvent, KeyboardEvent, useEffect, useRef, useState } from 'react';
import { Bot, CircleStop, Plus, Send, ShieldCheck, Sparkles, User } from 'lucide-react';
import { crmFetch } from '../lib/crmApi';

type ChatMessage = {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  tool?: string | null;
  status?: 'error' | string;
};

const THREAD_STORAGE_KEY = 'ybcrm_internal_ai_thread';
const QUICK_PROMPTS = [
  'Что сегодня произошло в бизнесе?',
  'Покажи продажи за сегодня',
  'Какие сейчас остатки на складе?',
  'Покажи статус производства',
];

const TOOL_LABELS: Record<string, string> = {
  get_customer: 'Карточка клиента', search_customers: 'Поиск клиентов',
  get_order: 'Карточка заказа', search_orders: 'Поиск заказов',
  get_sales_summary: 'Продажи', get_payments: 'Платежи', get_inventory: 'Склад',
  get_production_status: 'Производство', get_finance_summary: 'Финансы',
  get_tasks: 'Задачи', get_supplier: 'Поставщики', search_communications: 'Коммуникации',
};

async function responsePayload(response: Response) {
  return response.json().catch(() => ({}));
}

export default function InternalAIChatPage() {
  const [threadId, setThreadId] = useState(() => window.localStorage.getItem(THREAD_STORAGE_KEY) || '');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(Boolean(threadId));
  const [error, setError] = useState('');
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!threadId) return;
    let active = true;
    void (async () => {
      try {
        const response = await crmFetch(`/api/ai-chat/${encodeURIComponent(threadId)}/messages`);
        const payload = await responsePayload(response);
        if (response.status === 404) {
          window.localStorage.removeItem(THREAD_STORAGE_KEY);
          if (active) { setThreadId(''); setMessages([]); }
          return;
        }
        if (!response.ok) throw new Error(payload.error || 'Не удалось загрузить диалог');
        if (active) setMessages(Array.isArray(payload) ? payload : []);
      } catch (cause) {
        if (active) setError(cause instanceof Error ? cause.message : 'Не удалось загрузить диалог');
      } finally {
        if (active) setHistoryLoading(false);
      }
    })();
    return () => { active = false; };
  }, [threadId]);

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }); }, [messages, loading]);

  const startNewChat = () => {
    window.localStorage.removeItem(THREAD_STORAGE_KEY);
    setThreadId(''); setMessages([]); setInput(''); setError(''); setHistoryLoading(false);
  };

  const send = async (text = input) => {
    const clean = text.trim();
    if (!clean || loading) return;
    const optimistic: ChatMessage = { id: `local-${Date.now()}`, role: 'user', text: clean };
    setMessages(current => [...current, optimistic]);
    setInput(''); setError(''); setLoading(true);
    try {
      const response = await crmFetch('/api/ai-chat/message', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: clean, ...(threadId ? { threadId } : {}) }),
      });
      const payload = await responsePayload(response);
      if (payload.threadId && payload.threadId !== threadId) {
        setThreadId(payload.threadId);
        window.localStorage.setItem(THREAD_STORAGE_KEY, payload.threadId);
      }
      if (!response.ok) throw new Error(payload.error || 'AI-чат временно недоступен');
      setMessages(current => [...current, payload.message]);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Не удалось получить ответ');
    } finally { setLoading(false); }
  };

  const submit = (event: FormEvent) => { event.preventDefault(); void send(); };
  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); void send(); }
  };

  return <div className="mx-auto flex min-h-[calc(100vh-150px)] max-w-4xl flex-col px-4 py-6 sm:px-6">
    <header className="mb-4 flex items-start justify-between gap-3">
      <div><div className="flex items-center gap-2"><Sparkles size={22} className="text-[#7D7DE6]"/><h2 className="text-2xl font-semibold text-slate-900">AI-чат CRM</h2></div><p className="mt-1 text-sm text-slate-500">Спрашивайте о заказах, клиентах, продажах, складе и производстве</p></div>
      <button onClick={startNewChat} className="flex min-h-11 shrink-0 items-center gap-2 rounded-lg border bg-white px-3 text-sm font-semibold hover:bg-slate-50" aria-label="Начать новый диалог"><Plus size={17}/><span className="hidden sm:inline">Новый чат</span></button>
    </header>

    <div className="mb-3 flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-xs text-emerald-800"><ShieldCheck size={17} className="shrink-0"/><span><b>Безопасный режим:</b> чат только читает данные и не может менять CRM, отправлять сообщения или проводить платежи.</span></div>

    <section aria-label="Диалог с AI" aria-live="polite" className="min-h-0 flex-1 overflow-y-auto rounded-2xl border bg-white p-3 shadow-sm sm:p-5">
      {historyLoading ? <div className="flex min-h-64 items-center justify-center text-sm text-slate-500">Загружаем диалог…</div> : messages.length === 0 ? <div className="flex min-h-64 flex-col items-center justify-center px-2 text-center"><div className="mb-4 rounded-2xl bg-violet-50 p-4 text-[#7D7DE6]"><Bot size={30}/></div><h3 className="text-lg font-semibold">Что хотите узнать?</h3><p className="mt-1 max-w-md text-sm text-slate-500">AI использует только разрешённые инструменты CRM. Финансовые данные доступны только владельцу.</p><div className="mt-6 grid w-full max-w-2xl gap-2 sm:grid-cols-2">{QUICK_PROMPTS.map(prompt => <button key={prompt} onClick={() => void send(prompt)} className="min-h-11 rounded-xl border px-3 py-2 text-left text-sm hover:border-violet-300 hover:bg-violet-50">{prompt}</button>)}</div></div> : <div className="space-y-4">{messages.map(message => <article key={message.id} className={`flex gap-3 ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}><div className={`mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${message.role === 'user' ? 'order-2 bg-slate-900 text-white' : 'bg-violet-100 text-violet-700'}`}>{message.role === 'user' ? <User size={15}/> : <Bot size={16}/>}</div><div className={`max-w-[85%] rounded-2xl px-4 py-3 text-sm leading-6 ${message.role === 'user' ? 'rounded-tr-md bg-slate-900 text-white' : message.status === 'error' ? 'rounded-tl-md border border-red-200 bg-red-50 text-red-800' : 'rounded-tl-md bg-slate-100 text-slate-800'}`}><div className="whitespace-pre-wrap break-words">{message.text}</div>{message.tool && <div className="mt-2 text-[11px] font-semibold uppercase tracking-wide text-violet-600">Источник: {TOOL_LABELS[message.tool] || message.tool}</div>}</div></article>)}{loading && <div className="flex items-center gap-3"><div className="flex h-8 w-8 items-center justify-center rounded-full bg-violet-100 text-violet-700"><Bot size={16}/></div><div className="rounded-2xl rounded-tl-md bg-slate-100 px-4 py-3 text-sm text-slate-500">Проверяю данные CRM…</div></div>}<div ref={endRef}/></div>}
    </section>

    {error && <div role="alert" className="mt-3 flex items-center justify-between gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"><span>{error}</span><button onClick={() => setError('')} className="min-h-11 shrink-0 font-semibold">Закрыть</button></div>}

    <form onSubmit={submit} className="mt-3 flex items-end gap-2 rounded-2xl border bg-white p-2 shadow-sm focus-within:border-violet-400">
      <label className="sr-only" htmlFor="ai-chat-message">Сообщение AI-помощнику</label><textarea id="ai-chat-message" rows={1} maxLength={2000} value={input} onChange={event => setInput(event.target.value)} onKeyDown={handleKeyDown} disabled={loading} placeholder="Например: покажи продажи за сегодня" className="max-h-36 min-h-11 flex-1 resize-y bg-transparent px-3 py-3 text-sm outline-none disabled:opacity-60"/>
      <button type="submit" disabled={!input.trim() || loading} className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-[#7D7DE6] text-white hover:bg-[#6f6fd8] disabled:cursor-not-allowed disabled:opacity-40" aria-label={loading ? 'Ожидаем ответ' : 'Отправить сообщение'}>{loading ? <CircleStop size={19}/> : <Send size={19}/>}</button>
    </form>
    <p className="mt-2 text-center text-[11px] text-slate-400">Enter — отправить, Shift + Enter — новая строка. Ответы AI стоит перепроверять перед бизнес-решениями.</p>
  </div>;
}

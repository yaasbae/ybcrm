import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, CircleHelp, MessageSquareText, RefreshCw, Search, Sparkles, XCircle } from 'lucide-react';
import { crmFetch } from '../lib/crmApi';

type TimestampValue = { _seconds?: number; seconds?: number };
type Incident = {
  id: string;
  status: string;
  text: string;
  source?: string;
  createdAt?: TimestampValue;
  telegram?: { senderName?: string; username?: string };
  triage?: {
    category?: string;
    priority?: string;
    summary?: string;
    likelyCause?: string;
    nextQuestion?: string;
    recommendedAction?: string;
    completedAt?: string;
  };
};

const STATUS_LABELS: Record<string, string> = {
  new: 'Новое', triaged: 'Разобрано', needs_info: 'Нужно уточнение', resolved: 'Решено', dismissed: 'Отклонено',
};
const CATEGORY_LABELS: Record<string, string> = {
  crm_error: 'Ошибка CRM', user_question: 'Вопрос', improvement: 'Предложение',
  integration: 'Интеграция', data_issue: 'Проблема данных', other: 'Другое',
};
const PRIORITY_LABELS: Record<string, string> = { low: 'Низкий', normal: 'Обычный', high: 'Высокий', critical: 'Критический' };

function dateLabel(value?: TimestampValue) {
  const seconds = value?._seconds ?? value?.seconds;
  return seconds ? new Date(seconds * 1000).toLocaleString('ru-RU') : '';
}

export default function AIIncidentsPage() {
  const [incidents, setIncidents] = useState<Incident[]>([]);
  const [loading, setLoading] = useState(true);
  const [workingId, setWorkingId] = useState('');
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('open');
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const response = await crmFetch('/api/ai-incidents?limit=100');
      const payload = await response.json().catch(() => []);
      if (!response.ok) throw new Error(payload.error || 'Не удалось загрузить обращения');
      setIncidents(payload);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Ошибка загрузки'); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const post = async (url: string, body?: unknown) => {
    const response = await crmFetch(url, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || 'Операция не выполнена');
    return payload;
  };

  const updateStatus = async (incident: Incident, status: string) => {
    setWorkingId(incident.id); setError('');
    try { await post(`/api/ai-incidents/${incident.id}/status`, { status }); await load(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Статус не изменён'); }
    finally { setWorkingId(''); }
  };

  const runTriage = async (incident: Incident) => {
    setWorkingId(incident.id); setError('');
    try {
      await post(`/api/ai-incidents/${incident.id}/triage`);
      const run = await crmFetch('/api/ai-jobs/run', { method: 'POST' });
      if (!run.ok) {
        const payload = await run.json().catch(() => ({}));
        throw new Error(payload.error || 'Задание поставлено в очередь, но worker не запущен');
      }
      await load();
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'AI-разбор не выполнен'); }
    finally { setWorkingId(''); }
  };

  const visible = useMemo(() => incidents.filter(incident => {
    if (filter === 'open' && ['resolved', 'dismissed'].includes(incident.status)) return false;
    if (filter === 'resolved' && incident.status !== 'resolved') return false;
    const haystack = `${incident.text} ${incident.triage?.summary || ''} ${incident.telegram?.senderName || ''}`.toLowerCase();
    return haystack.includes(query.trim().toLowerCase());
  }), [filter, incidents, query]);

  const openCount = incidents.filter(item => !['resolved', 'dismissed'].includes(item.status)).length;
  const criticalCount = incidents.filter(item => item.triage?.priority === 'critical' && item.status !== 'resolved').length;

  return <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
    <div className="mb-6 flex flex-wrap items-start justify-between gap-4"><div><h2 className="text-2xl font-semibold">AI-приёмная</h2><p className="mt-1 text-sm text-slate-500">Обращения менеджеров и безопасная первичная диагностика</p></div><button onClick={() => void load()} className="flex min-h-11 items-center gap-2 rounded-lg border bg-white px-4 py-2 text-sm font-semibold hover:bg-slate-50"><RefreshCw size={16}/> Обновить</button></div>

    <div className="mb-5 grid gap-3 sm:grid-cols-3"><div className="rounded-xl border bg-white p-4"><div className="text-xs font-medium uppercase tracking-wide text-slate-500">Открытые</div><div className="mt-2 text-2xl font-semibold">{openCount}</div></div><div className="rounded-xl border bg-white p-4"><div className="text-xs font-medium uppercase tracking-wide text-slate-500">Критические</div><div className="mt-2 text-2xl font-semibold text-red-600">{criticalCount}</div></div><div className="rounded-xl border bg-white p-4"><div className="text-xs font-medium uppercase tracking-wide text-slate-500">Всего обращений</div><div className="mt-2 text-2xl font-semibold">{incidents.length}</div></div></div>

    {error && <div role="alert" className="mb-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>}
    <div className="mb-4 flex flex-col gap-2 sm:flex-row"><label className="flex min-h-11 flex-1 items-center gap-2 rounded-lg border bg-white px-3"><Search size={16} className="text-slate-400"/><span className="sr-only">Поиск обращений</span><input value={query} onChange={event => setQuery(event.target.value)} placeholder="Поиск по тексту или менеджеру" className="w-full bg-transparent text-sm outline-none"/></label><div className="flex gap-2">{[{ id: 'open', label: 'Открытые' }, { id: 'resolved', label: 'Решённые' }, { id: 'all', label: 'Все' }].map(item => <button key={item.id} onClick={() => setFilter(item.id)} className={`min-h-11 rounded-lg border px-4 text-sm font-semibold ${filter === item.id ? 'border-slate-900 bg-slate-900 text-white' : 'bg-white hover:bg-slate-50'}`}>{item.label}</button>)}</div></div>

    <div className="space-y-3">{loading ? <div className="animate-pulse rounded-xl border bg-white p-8 text-center text-sm text-slate-500">Загрузка обращений…</div> : visible.length === 0 ? <div className="rounded-xl border bg-white p-8 text-center"><MessageSquareText className="mx-auto mb-3 text-slate-300"/><div className="font-medium">Обращений нет</div><p className="mt-1 text-sm text-slate-500">Подключите тему Telegram командой /ai_intake_here.</p></div> : visible.map(incident => <article key={incident.id} className="rounded-xl border bg-white p-4 sm:p-5"><div className="flex flex-wrap items-start justify-between gap-3"><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold">{STATUS_LABELS[incident.status] || incident.status}</span>{incident.triage?.category && <span className="rounded-full bg-blue-50 px-2.5 py-1 text-xs font-semibold text-blue-700">{CATEGORY_LABELS[incident.triage.category] || incident.triage.category}</span>}{incident.triage?.priority && <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${incident.triage.priority === 'critical' ? 'bg-red-100 text-red-700' : incident.triage.priority === 'high' ? 'bg-amber-100 text-amber-800' : 'bg-slate-100 text-slate-700'}`}>{PRIORITY_LABELS[incident.triage.priority] || incident.triage.priority}</span>}</div><p className="mt-3 whitespace-pre-wrap text-sm text-slate-800">{incident.text}</p><div className="mt-2 text-xs text-slate-500">{incident.telegram?.senderName || incident.telegram?.username || 'Telegram'}{dateLabel(incident.createdAt) ? ` · ${dateLabel(incident.createdAt)}` : ''} · {incident.id}</div></div></div>
      {incident.triage && <div className="mt-4 grid gap-3 rounded-xl border border-blue-100 bg-blue-50/50 p-4 sm:grid-cols-2"><div><div className="text-xs font-semibold uppercase text-blue-700">Краткий вывод</div><p className="mt-1 text-sm">{incident.triage.summary}</p></div><div><div className="text-xs font-semibold uppercase text-blue-700">Вероятная причина</div><p className="mt-1 text-sm">{incident.triage.likelyCause}</p></div><div><div className="text-xs font-semibold uppercase text-blue-700">Уточнение</div><p className="mt-1 text-sm">{incident.triage.nextQuestion || 'Дополнительный вопрос не требуется'}</p></div><div><div className="text-xs font-semibold uppercase text-blue-700">Рекомендация</div><p className="mt-1 text-sm">{incident.triage.recommendedAction}</p></div></div>}
      <div className="mt-4 flex flex-wrap gap-2"><button onClick={() => void runTriage(incident)} disabled={workingId === incident.id} className="flex min-h-11 items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50"><Sparkles size={16}/>{workingId === incident.id ? 'Проверяем…' : incident.triage ? 'Проверить заново' : 'Разобрать AI'}</button>{incident.status !== 'resolved' && <button onClick={() => void updateStatus(incident, 'resolved')} disabled={workingId === incident.id} className="flex min-h-11 items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"><CheckCircle2 size={16}/> Решено</button>}{incident.status !== 'dismissed' && <button onClick={() => void updateStatus(incident, 'dismissed')} disabled={workingId === incident.id} className="flex min-h-11 items-center gap-2 rounded-lg border px-4 py-2 text-sm font-semibold hover:bg-slate-50 disabled:opacity-50"><XCircle size={16}/> Отклонить</button>}{incident.status === 'needs_info' && <span className="flex min-h-11 items-center gap-2 rounded-lg bg-amber-50 px-3 text-xs font-medium text-amber-800"><CircleHelp size={15}/> Нужен ответ менеджера</span>}{incident.triage?.priority === 'critical' && <span className="flex min-h-11 items-center gap-2 rounded-lg bg-red-50 px-3 text-xs font-semibold text-red-700"><AlertTriangle size={15}/> Срочно</span>}</div>
    </article>)}</div>
  </div>;
}

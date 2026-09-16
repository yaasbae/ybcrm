import React, { useCallback, useEffect, useState } from 'react';
import { Activity, AlertTriangle, CheckCircle2, Clock3, History, PauseCircle, PlayCircle, RefreshCw, RotateCcw, ShieldCheck, XCircle } from 'lucide-react';
import { crmFetch } from '../lib/crmApi';

type Job = {
  id: string;
  type: string;
  status: string;
  risk: string;
  attempts?: number;
  error?: string;
  result?: Record<string, unknown>;
  createdAt?: { _seconds?: number; seconds?: number };
  finishedAt?: { _seconds?: number; seconds?: number };
};
type AuditEntry = { id: string; tool: string; status: string; user_id?: string; timestamp?: string; result?: Record<string, unknown> };

const STATUS_LABELS: Record<string, string> = {
  queued: 'Ожидает запуска', awaiting_approval: 'Нужно подтверждение', running: 'Выполняется',
  retry_wait: 'Повторная попытка', succeeded: 'Готово', dead_letter: 'Требует внимания', cancelled: 'Отменено',
};

const TYPE_LABELS: Record<string, string> = {
  'system.health_check': 'Проверка системы',
  'draft.task': 'Черновик задачи',
  'draft.supplier_message': 'Черновик сообщения поставщику',
};

function dateLabel(value?: { _seconds?: number; seconds?: number }) {
  const seconds = value?._seconds ?? value?.seconds;
  return seconds ? new Date(seconds * 1000).toLocaleString('ru-RU') : '';
}

export default function AIJobsPage() {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [enabled, setEnabled] = useState(false);
  const [audit, setAudit] = useState<AuditEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [error, setError] = useState('');
  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const [a, b, c] = await Promise.all([crmFetch('/api/ai-jobs'), crmFetch('/api/ai-jobs/runtime'), crmFetch('/api/ai-jobs/audit?limit=20')]);
      if (!a.ok || !b.ok || !c.ok) throw new Error('Не удалось загрузить очередь');
      setJobs(await a.json()); setEnabled((await b.json()).enabled === true); setAudit(await c.json());
    } catch (e) { setError(e instanceof Error ? e.message : 'Ошибка загрузки'); } finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  const post = async (url: string, body?: unknown) => {
    const response = await crmFetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || 'Операция не выполнена');
    await load();
    return payload;
  };
  const runHealthCheck = async () => {
    setActionLoading(true); setError('');
    try {
      await post('/api/ai-jobs', {
        type: 'system.health_check',
        idempotencyKey: `owner-health-check-${Date.now()}`,
        payload: { source: 'owner-dashboard' },
      });
      if (enabled) await post('/api/ai-jobs/run');
    } catch (e) { setError(e instanceof Error ? e.message : 'Проверка не выполнена'); }
    finally { setActionLoading(false); }
  };
  return <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
    <div className="mb-6 flex flex-wrap items-center justify-between gap-4"><div><h2 className="text-2xl font-semibold">AI-задания</h2><p className="mt-1 text-sm text-slate-500">Очередь, подтверждения и аварийная остановка агентов</p></div><div className="flex flex-wrap gap-2"><button onClick={() => void runHealthCheck()} disabled={actionLoading} className="flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold disabled:opacity-50"><Activity size={16}/> {actionLoading ? 'Проверяем…' : 'Проверить систему'}</button><button aria-label="Обновить очередь" title="Обновить очередь" onClick={() => void load()} className="rounded-lg border px-3 py-2"><RefreshCw size={15}/></button><button onClick={() => void post('/api/ai-jobs/runtime', { enabled: !enabled }).catch(e => setError(e.message))} className={`flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold text-white ${enabled ? 'bg-red-600' : 'bg-emerald-600'}`}>{enabled ? <PauseCircle size={16}/> : <PlayCircle size={16}/>} {enabled ? 'Остановить AI' : 'Включить AI'}</button></div></div>
    <div className={`mb-5 flex items-center gap-3 rounded-xl border p-4 ${enabled ? 'border-emerald-200 bg-emerald-50' : 'border-amber-200 bg-amber-50'}`}>{enabled ? <ShieldCheck className="text-emerald-600"/> : <AlertTriangle className="text-amber-600"/>}<div><div className="font-semibold">{enabled ? 'Исполнение разрешено' : 'Kill switch выключает исполнение'}</div><div className="text-sm text-slate-600">При выключенном режиме worker ничего не выполняет.</div></div></div>
    {error && <div className="mb-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>}
    <div className="overflow-hidden rounded-xl border bg-white">{loading ? <div className="p-8 text-center text-sm text-slate-500">Загрузка…</div> : jobs.length === 0 ? <div className="p-8 text-center"><Activity className="mx-auto mb-3 text-slate-300"/><div className="font-medium text-slate-700">Заданий пока нет</div><div className="mt-1 text-sm text-slate-500">Нажмите «Проверить систему», чтобы создать первое безопасное задание.</div></div> : jobs.map(job => <div key={job.id} className="flex flex-wrap items-center justify-between gap-3 border-b p-4 last:border-b-0"><div><div className="font-medium">{TYPE_LABELS[job.type] || job.type}</div><div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-500"><span>{job.id.slice(0,12)}</span><span>· попыток: {job.attempts || 0}</span><span>· риск: {job.risk}</span>{dateLabel(job.createdAt) && <span className="flex items-center gap-1"><Clock3 size={12}/>{dateLabel(job.createdAt)}</span>}</div>{job.status === 'succeeded' && job.result?.checkedAt && <div className="mt-2 text-xs font-medium text-emerald-700">Система ответила: всё работает · {new Date(String(job.result.checkedAt)).toLocaleString('ru-RU')}</div>}{job.error && <div className="mt-1 text-xs text-red-600">{job.error}</div>}</div><div className="flex items-center gap-2"><span className={`rounded-full px-3 py-1 text-xs font-semibold ${job.status === 'succeeded' ? 'bg-emerald-50 text-emerald-700' : job.status === 'dead_letter' ? 'bg-red-50 text-red-700' : 'bg-slate-100 text-slate-700'}`}>{STATUS_LABELS[job.status] || job.status}</span>{job.status === 'awaiting_approval' && <button aria-label="Подтвердить задание" title="Подтвердить задание" onClick={() => void post(`/api/ai-jobs/${job.id}/approve`).catch(e => setError(e.message))} className="rounded-lg bg-emerald-600 p-2 text-white"><CheckCircle2 size={16}/></button>}{!['succeeded','cancelled','dead_letter'].includes(job.status) && <button aria-label="Отменить задание" title="Отменить задание" onClick={() => void post(`/api/ai-jobs/${job.id}/cancel`).catch(e => setError(e.message))} className="rounded-lg bg-red-50 p-2 text-red-600"><XCircle size={16}/></button>}</div></div>)}</div>
    {jobs.some(job => job.status === 'dead_letter') && <div className="mt-3 flex justify-end"><span className="text-xs text-slate-500">Задания «Требует внимания» можно безопасно вернуть в очередь кнопкой повтора.</span></div>}
    {jobs.filter(job => job.status === 'dead_letter').map(job => <button key={`retry-${job.id}`} onClick={() => void post(`/api/ai-jobs/${job.id}/retry`).catch(e => setError(e.message))} className="mt-2 mr-2 inline-flex items-center gap-2 rounded-lg border border-red-200 bg-white px-3 py-2 text-xs font-semibold text-red-700"><RotateCcw size={14}/> Повторить: {TYPE_LABELS[job.type] || job.type}</button>)}
    <section className="mt-8"><div className="mb-3 flex items-center gap-2"><History size={18}/><h3 className="font-semibold">Последние действия AI</h3></div><div className="overflow-hidden rounded-xl border bg-white">{audit.length === 0 ? <div className="p-6 text-center text-sm text-slate-500">История пока пуста</div> : audit.map(entry => <div key={entry.id} className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-3 text-sm last:border-b-0"><div><div className="font-medium">{entry.tool}</div><div className="mt-1 text-xs text-slate-500">{entry.user_id || 'система'}{entry.timestamp ? ` · ${new Date(entry.timestamp).toLocaleString('ru-RU')}` : ''}</div></div><span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${entry.status === 'success' ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'}`}>{entry.status === 'success' ? 'Успешно' : 'Ошибка'}</span></div>)}</div></section>
  </div>;
}

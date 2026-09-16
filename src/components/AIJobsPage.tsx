import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Activity, AlertTriangle, CheckCircle2, Clock3, History, PauseCircle, PlayCircle, RefreshCw, RotateCcw, ShieldCheck, X, XCircle } from 'lucide-react';
import { crmFetch } from '../lib/crmApi';

type TimestampValue = { _seconds?: number; seconds?: number };
type Job = {
  id: string; type: string; status: string; risk: string; attempts?: number; error?: string;
  result?: Record<string, unknown>; payload?: Record<string, unknown>;
  createdAt?: TimestampValue; approvalExpiresAt?: TimestampValue;
};
type AuditEntry = { id: string; tool: string; status: string; user_id?: string; timestamp?: string };
type Filter = 'active' | 'approval' | 'errors' | 'completed' | 'all';

const STATUS_LABELS: Record<string, string> = {
  queued: 'Ожидает запуска', awaiting_approval: 'Нужно подтверждение', running: 'Выполняется',
  retry_wait: 'Повторная попытка', succeeded: 'Готово', dead_letter: 'Требует внимания', cancelled: 'Отменено',
};
const TYPE_LABELS: Record<string, string> = {
  'system.health_check': 'Проверка системы', 'draft.task': 'Черновик задачи',
  'draft.supplier_message': 'Черновик сообщения поставщику',
};
const FILTERS: Array<{ id: Filter; label: string; statuses?: string[] }> = [
  { id: 'active', label: 'В работе', statuses: ['queued', 'running', 'retry_wait'] },
  { id: 'approval', label: 'Нужно подтвердить', statuses: ['awaiting_approval'] },
  { id: 'errors', label: 'Ошибки', statuses: ['dead_letter'] },
  { id: 'completed', label: 'Завершено', statuses: ['succeeded', 'cancelled'] },
  { id: 'all', label: 'Все' },
];

function dateLabel(value?: TimestampValue) {
  const seconds = value?._seconds ?? value?.seconds;
  return seconds ? new Date(seconds * 1000).toLocaleString('ru-RU') : '';
}

function jobPreview(job: Job) {
  if (job.type === 'draft.task') return String(job.payload?.title || job.payload?.description || 'Создать черновик задачи');
  if (job.type === 'draft.supplier_message') return String(job.payload?.message || 'Подготовить черновик сообщения поставщику');
  return 'Безопасная техническая проверка без изменения данных CRM.';
}

export default function AIJobsPage() {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [enabled, setEnabled] = useState(false);
  const [audit, setAudit] = useState<AuditEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState<Filter>('active');
  const [approvalJob, setApprovalJob] = useState<Job | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const [jobsResponse, runtimeResponse, auditResponse] = await Promise.all([
        crmFetch('/api/ai-jobs'), crmFetch('/api/ai-jobs/runtime'), crmFetch('/api/ai-jobs/audit?limit=20'),
      ]);
      if (!jobsResponse.ok || !runtimeResponse.ok || !auditResponse.ok) throw new Error('Не удалось загрузить очередь');
      setJobs(await jobsResponse.json());
      setEnabled((await runtimeResponse.json()).enabled === true);
      setAudit(await auditResponse.json());
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
    await load();
    return payload;
  };

  const runHealthCheck = async () => {
    setActionLoading(true); setError('');
    try {
      await post('/api/ai-jobs', {
        type: 'system.health_check', idempotencyKey: `owner-health-check-${Date.now()}`,
        payload: { source: 'owner-dashboard' },
      });
      if (enabled) await post('/api/ai-jobs/run');
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Проверка не выполнена'); }
    finally { setActionLoading(false); }
  };

  const counts = useMemo(() => Object.fromEntries(FILTERS.map(item => [item.id,
    item.statuses ? jobs.filter(job => item.statuses?.includes(job.status)).length : jobs.length,
  ])), [jobs]);
  const visibleJobs = useMemo(() => {
    const selected = FILTERS.find(item => item.id === filter);
    return selected?.statuses ? jobs.filter(job => selected.statuses?.includes(job.status)) : jobs;
  }, [filter, jobs]);

  const handleApproval = async () => {
    if (!approvalJob) return;
    setActionLoading(true);
    try { await post(`/api/ai-jobs/${approvalJob.id}/approve`); setApprovalJob(null); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Подтверждение не выполнено'); }
    finally { setActionLoading(false); }
  };

  return <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
    <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
      <div><h2 className="text-2xl font-semibold">AI-задания</h2><p className="mt-1 text-sm text-slate-500">Очередь, подтверждения и аварийная остановка агентов</p></div>
      <div className="flex flex-wrap gap-2">
        <button onClick={() => void runHealthCheck()} disabled={actionLoading} className="flex min-h-11 items-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold transition-colors hover:bg-slate-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-600 disabled:opacity-50"><Activity size={16}/> {actionLoading ? 'Проверяем…' : 'Проверить систему'}</button>
        <button aria-label="Обновить очередь" title="Обновить очередь" onClick={() => void load()} className="min-h-11 min-w-11 rounded-lg border p-3 transition-colors hover:bg-slate-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-600"><RefreshCw size={16}/></button>
        <button onClick={() => void post('/api/ai-jobs/runtime', { enabled: !enabled }).catch(cause => setError(cause.message))} className={`flex min-h-11 items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 ${enabled ? 'bg-red-600 hover:bg-red-700 focus-visible:outline-red-600' : 'bg-emerald-600 hover:bg-emerald-700 focus-visible:outline-emerald-600'}`}>{enabled ? <PauseCircle size={16}/> : <PlayCircle size={16}/>} {enabled ? 'Остановить AI' : 'Включить AI'}</button>
      </div>
    </div>

    <div className={`mb-5 flex items-center gap-3 rounded-xl border p-4 ${enabled ? 'border-emerald-200 bg-emerald-50' : 'border-amber-200 bg-amber-50'}`}>{enabled ? <ShieldCheck className="text-emerald-600"/> : <AlertTriangle className="text-amber-600"/>}<div><div className="font-semibold">{enabled ? 'Исполнение разрешено' : 'AI безопасно остановлен'}</div><div className="text-sm text-slate-600">{enabled ? 'Worker может выполнять только разрешённые задания.' : 'Новые задания сохраняются, но не выполняются.'}</div></div></div>
    {error && <div role="alert" className="mb-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>}

    <div className="mb-4 grid grid-cols-2 gap-2 sm:flex sm:flex-wrap" role="tablist" aria-label="Фильтр заданий">
      {FILTERS.map(item => <button key={item.id} role="tab" aria-selected={filter === item.id} onClick={() => setFilter(item.id)} className={`min-h-11 rounded-lg border px-3 py-2 text-left text-sm font-medium transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-600 ${filter === item.id ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'}`}>{item.label} <span className={`ml-1 rounded-full px-2 py-0.5 text-xs ${filter === item.id ? 'bg-white/15' : 'bg-slate-100'}`}>{counts[item.id] || 0}</span></button>)}
    </div>

    <div className="overflow-hidden rounded-xl border bg-white">{loading ? <div className="animate-pulse p-8 text-center text-sm text-slate-500">Загрузка очереди…</div> : visibleJobs.length === 0 ? <div className="p-8 text-center"><Activity className="mx-auto mb-3 text-slate-300"/><div className="font-medium text-slate-700">В этом разделе заданий нет</div><div className="mt-1 text-sm text-slate-500">Безопасную проверку можно запустить кнопкой сверху.</div></div> : visibleJobs.map(job => <div key={job.id} className="flex flex-wrap items-center justify-between gap-4 border-b p-4 transition-colors last:border-b-0 hover:bg-slate-50/70"><div className="min-w-0"><div className="font-medium">{TYPE_LABELS[job.type] || job.type}</div><div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-500"><span>{job.id.slice(0,12)}</span><span>· попыток: {job.attempts || 0}</span><span>· риск: {job.risk}</span>{dateLabel(job.createdAt) && <span className="flex items-center gap-1"><Clock3 size={12}/>{dateLabel(job.createdAt)}</span>}</div>{job.status === 'succeeded' && job.result?.checkedAt && <div className="mt-2 text-xs font-medium text-emerald-700">Система ответила: всё работает · {new Date(String(job.result.checkedAt)).toLocaleString('ru-RU')}</div>}{job.error && <div className="mt-2 text-xs text-red-600">{job.error}</div>}</div><div className="flex items-center gap-2"><span className={`rounded-full px-3 py-1 text-xs font-semibold ${job.status === 'succeeded' ? 'bg-emerald-50 text-emerald-700' : job.status === 'dead_letter' ? 'bg-red-50 text-red-700' : job.status === 'awaiting_approval' ? 'bg-amber-50 text-amber-800' : 'bg-slate-100 text-slate-700'}`}>{STATUS_LABELS[job.status] || job.status}</span>{job.status === 'awaiting_approval' && <button onClick={() => setApprovalJob(job)} className="min-h-11 rounded-lg bg-emerald-600 px-3 py-2 text-xs font-semibold text-white hover:bg-emerald-700">Проверить</button>}{job.status === 'dead_letter' && <button onClick={() => void post(`/api/ai-jobs/${job.id}/retry`).catch(cause => setError(cause.message))} className="flex min-h-11 items-center gap-1 rounded-lg border border-red-200 px-3 py-2 text-xs font-semibold text-red-700 hover:bg-red-50"><RotateCcw size={14}/> Повторить</button>}{!['succeeded','cancelled','dead_letter'].includes(job.status) && <button aria-label="Отменить задание" title="Отменить задание" onClick={() => void post(`/api/ai-jobs/${job.id}/cancel`).catch(cause => setError(cause.message))} className="min-h-11 min-w-11 rounded-lg bg-red-50 p-3 text-red-600 hover:bg-red-100"><XCircle size={16}/></button>}</div></div>)}</div>

    <section className="mt-8"><div className="mb-3 flex items-center gap-2"><History size={18}/><h3 className="font-semibold">Последние действия AI</h3></div><div className="overflow-hidden rounded-xl border bg-white">{audit.length === 0 ? <div className="p-6 text-center text-sm text-slate-500">История пока пуста</div> : audit.map(entry => <div key={entry.id} className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-3 text-sm last:border-b-0"><div><div className="font-medium">{entry.tool}</div><div className="mt-1 text-xs text-slate-500">{entry.user_id || 'система'}{entry.timestamp ? ` · ${new Date(entry.timestamp).toLocaleString('ru-RU')}` : ''}</div></div><span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${entry.status === 'success' ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'}`}>{entry.status === 'success' ? 'Успешно' : 'Ошибка'}</span></div>)}</div></section>

    {approvalJob && <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" role="dialog" aria-modal="true" aria-labelledby="approval-title"><div className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-2xl"><div className="flex items-start justify-between gap-4"><div><h3 id="approval-title" className="text-lg font-semibold">Подтвердить действие?</h3><p className="mt-1 text-sm text-slate-500">После подтверждения задание попадёт в очередь выполнения.</p></div><button aria-label="Закрыть окно" onClick={() => setApprovalJob(null)} className="min-h-11 min-w-11 rounded-lg p-3 hover:bg-slate-100"><X size={18}/></button></div><div className="my-5 rounded-xl border bg-slate-50 p-4"><div className="text-sm font-semibold">{TYPE_LABELS[approvalJob.type] || approvalJob.type}</div><p className="mt-2 break-words text-sm text-slate-700">{jobPreview(approvalJob)}</p>{dateLabel(approvalJob.approvalExpiresAt) && <p className="mt-3 text-xs text-slate-500">Подтверждение действительно до {dateLabel(approvalJob.approvalExpiresAt)}</p>}</div><div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end"><button onClick={() => setApprovalJob(null)} className="min-h-11 rounded-lg border px-4 py-2 text-sm font-semibold hover:bg-slate-50">Отмена</button><button onClick={() => void handleApproval()} disabled={actionLoading} className="flex min-h-11 items-center justify-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"><CheckCircle2 size={16}/> {actionLoading ? 'Подтверждаем…' : 'Подтвердить'}</button></div></div></div>}
  </div>;
}

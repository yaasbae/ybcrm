import React, { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, PauseCircle, PlayCircle, RefreshCw, ShieldCheck, XCircle } from 'lucide-react';
import { crmFetch } from '../lib/crmApi';

type Job = { id: string; type: string; status: string; risk: string; attempts?: number; error?: string };

export default function AIJobsPage() {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [enabled, setEnabled] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const [a, b] = await Promise.all([crmFetch('/api/ai-jobs'), crmFetch('/api/ai-jobs/runtime')]);
      if (!a.ok || !b.ok) throw new Error('Не удалось загрузить очередь');
      setJobs(await a.json()); setEnabled((await b.json()).enabled === true);
    } catch (e) { setError(e instanceof Error ? e.message : 'Ошибка загрузки'); } finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  const post = async (url: string, body?: unknown) => {
    const response = await crmFetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || 'Операция не выполнена');
    await load();
  };
  return <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
    <div className="mb-6 flex flex-wrap items-center justify-between gap-4"><div><h2 className="text-2xl font-semibold">AI-задания</h2><p className="mt-1 text-sm text-slate-500">Очередь, подтверждения и аварийная остановка агентов</p></div><div className="flex gap-2"><button onClick={() => void load()} className="rounded-lg border px-3 py-2"><RefreshCw size={15}/></button><button onClick={() => void post('/api/ai-jobs/runtime', { enabled: !enabled }).catch(e => setError(e.message))} className={`flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold text-white ${enabled ? 'bg-red-600' : 'bg-emerald-600'}`}>{enabled ? <PauseCircle size={16}/> : <PlayCircle size={16}/>} {enabled ? 'Остановить AI' : 'Включить AI'}</button></div></div>
    <div className={`mb-5 flex items-center gap-3 rounded-xl border p-4 ${enabled ? 'border-emerald-200 bg-emerald-50' : 'border-amber-200 bg-amber-50'}`}>{enabled ? <ShieldCheck className="text-emerald-600"/> : <AlertTriangle className="text-amber-600"/>}<div><div className="font-semibold">{enabled ? 'Исполнение разрешено' : 'Kill switch выключает исполнение'}</div><div className="text-sm text-slate-600">При выключенном режиме worker ничего не выполняет.</div></div></div>
    {error && <div className="mb-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>}
    <div className="overflow-hidden rounded-xl border bg-white">{loading ? <div className="p-8 text-center text-sm text-slate-500">Загрузка…</div> : jobs.length === 0 ? <div className="p-8 text-center text-sm text-slate-500">Очередь пуста</div> : jobs.map(job => <div key={job.id} className="flex flex-wrap items-center justify-between gap-3 border-b p-4 last:border-b-0"><div><div className="font-medium">{job.type}</div><div className="mt-1 text-xs text-slate-500">{job.id.slice(0,12)} · попыток: {job.attempts || 0} · риск: {job.risk}</div>{job.error && <div className="mt-1 text-xs text-red-600">{job.error}</div>}</div><div className="flex items-center gap-2"><span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold">{job.status}</span>{job.status === 'awaiting_approval' && <button onClick={() => void post(`/api/ai-jobs/${job.id}/approve`).catch(e => setError(e.message))} className="rounded-lg bg-emerald-600 p-2 text-white"><CheckCircle2 size={16}/></button>}{!['succeeded','cancelled','dead_letter'].includes(job.status) && <button onClick={() => void post(`/api/ai-jobs/${job.id}/cancel`).catch(e => setError(e.message))} className="rounded-lg bg-red-50 p-2 text-red-600"><XCircle size={16}/></button>}</div></div>)}</div>
  </div>;
}

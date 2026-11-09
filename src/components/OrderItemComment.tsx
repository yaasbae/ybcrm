import React, { useEffect, useState } from 'react';
import { MessageSquare, Pencil } from 'lucide-react';
import { crmFetch } from '../lib/crmApi';
import { orderLines, type OrderWithItemComments } from '../lib/orderItemComments';

export function OrderItemComment({ order, index, editable = true }: {
  order: OrderWithItemComments & { orderId: string }; index: number; editable?: boolean;
}) {
  const saved = String(order.itemComments?.[index] || '');
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(saved);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [confirmed, setConfirmed] = useState<string | null>(null);
  useEffect(() => { setConfirmed(null); }, [saved]);
  const shown = confirmed ?? saved;
  const save = async () => {
    if (busy) return;
    setBusy(true); setError('');
    try {
      const response = await crmFetch(`/api/orders/${encodeURIComponent(order.orderId)}/item-comment`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ itemIndex: index, line: orderLines(order)[index], previousComment: shown, comment: draft }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Не удалось сохранить комментарий.');
      setConfirmed(String(result.comment || ''));
      setEditing(false);
    } catch (cause) { setError((cause as Error).message); }
    finally { setBusy(false); }
  };
  return <div className="mt-1.5 min-w-0 text-left" onClick={event => event.stopPropagation()}>
    {editing ? <div className="space-y-2">
      <label className="block text-xs text-[#475467]">Комментарий к товару
        <textarea autoFocus maxLength={1000} rows={3} value={draft} disabled={busy}
          onChange={event => setDraft(event.target.value)}
          className="mt-1 block w-full resize-y rounded-lg border border-[#D8DCE6] bg-white p-2 text-base text-[#344054] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#7D7DE6] sm:text-sm"
          placeholder="Например: готовы, только укоротить" />
      </label>
      {error && <p role="alert" className="text-xs text-red-700">{error}</p>}
      <div className="flex gap-2">
        <button type="button" disabled={busy} onClick={() => void save()} className="min-h-10 rounded-lg bg-[#1F2937] px-3 text-xs text-white disabled:opacity-50">{busy ? 'Сохраняем…' : 'Сохранить'}</button>
        <button type="button" disabled={busy} onClick={() => { setEditing(false); setDraft(shown); setError(''); }} className="min-h-10 rounded-lg border border-[#D8DCE6] px-3 text-xs">Отмена</button>
      </div>
    </div> : <>
      {shown && <p className="whitespace-pre-wrap break-words text-xs leading-5 text-[#475467]">{shown}</p>}
      {editable && <button type="button" onClick={() => { setDraft(shown); setError(''); setEditing(true); }} className="inline-flex min-h-9 items-center gap-1 text-[11px] text-[#667085] hover:text-[#5638F4] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#7D7DE6]">
        {shown ? <Pencil size={12} /> : <MessageSquare size={12} />}{shown ? 'Изменить комментарий' : 'Добавить комментарий'}
      </button>}
    </>}
  </div>;
}

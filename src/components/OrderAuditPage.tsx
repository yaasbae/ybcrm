import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  ChevronDown,
  Clock3,
  FileClock,
  Filter,
  Pencil,
  Plus,
  RefreshCcw,
  Search,
  ShieldCheck,
  Trash2,
  Truck,
  UserRound,
} from 'lucide-react';
import { collection, limit, onSnapshot, orderBy, query } from 'firebase/firestore';

import { db } from '../firebase';
import { cn } from '../lib/utils';
import { AccessAdminPanel } from './AccessAdminPanel';

const OWNER_EMAIL = 'ndtiger86@gmail.com';

type AuditLog = {
  id: string;
  action?: string;
  entityType?: string;
  entityId?: string;
  before?: Record<string, any> | null;
  after?: Record<string, any> | null;
  diff?: Record<string, { before?: unknown; after?: unknown }> | null;
  metadata?: Record<string, any> | null;
  actor?: Record<string, any> | null;
  createdAt?: any;
};

const ACTION_LABELS: Record<string, string> = {
  session_started: 'Вошёл в CRM',
  session_ended: 'Вышел из CRM',
  page_viewed: 'Открыл раздел',
  ui_clicked: 'Нажал кнопку',
  field_changed: 'Изменил поле',
  manager_profile_bound: 'Логин привязан к менеджеру',
  manager_shift_started: 'Начал смену',
  account_created: 'Аккаунт создан',
  account_access_updated: 'Права аккаунта изменены',
  order_created: 'Заказ создан',
  order_upserted: 'Заказ перезаписан',
  order_updated: 'Заказ изменён',
  order_deleted: 'Заказ удалён',
  cdek_waybill_created: 'Накладная СДЭК создана',
  cdek_waybill_recreated: 'Накладная СДЭК повторена',
  cdek_waybill_updated: 'Накладная СДЭК изменена',
};

const FIELD_LABELS: Record<string, string> = {
  status: 'Статус',
  manager: 'Менеджер',
  blogger: 'Блогер',
  source: 'Источник',
  clientName: 'Клиент',
  clientPhone: 'Телефон',
  clientInsta: 'Instagram',
  clientCity: 'Город',
  clientAddress: 'Адрес',
  item: 'Изделие',
  items: 'Изделия',
  revenue: 'Сумма',
  deliveryPrice: 'Доставка',
  paidAmount: 'Оплачено',
  paymentType: 'Способ оплаты',
  deliveryMethod: 'Способ доставки',
  cdekNumber: 'Номер СДЭК',
  deadlineDate: 'Срок',
  deleted: 'Удалён',
};

const HIDDEN_DIFF_FIELDS = new Set(['rawRow', 'updatedAt', 'createdAt', 'isFirebase']);

const toDate = (value: any): Date | null => {
  if (!value) return null;
  if (typeof value.toDate === 'function') return value.toDate();
  if (typeof value.seconds === 'number') return new Date(value.seconds * 1000);
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const formatDateTime = (value: any) => {
  const date = toDate(value);
  if (!date) return 'Время записывается…';
  return date.toLocaleString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
};

const compactValue = (value: unknown): string => {
  if (value === null || value === undefined || value === '') return '—';
  if (typeof value === 'boolean') return value ? 'Да' : 'Нет';
  if (Array.isArray(value)) return value.map(compactValue).join(', ') || '—';
  if (typeof value === 'object') {
    try {
      return JSON.stringify(value);
    } catch {
      return '[данные]';
    }
  }
  return String(value);
};

const getActionLabel = (log: AuditLog) => {
  if (log.action === 'order_updated' && log.metadata?.field === 'status') return 'Статус изменён';
  if (log.action === 'order_updated' && log.metadata?.field === 'manager') return 'Менеджер изменён';
  return ACTION_LABELS[log.action || ''] || log.action || 'Действие';
};

const getActorLabel = (log: AuditLog) => {
  const actor = log.actor || {};
  if (actor.email) return actor.name ? `${actor.name} · ${actor.email}` : String(actor.email);
  if (actor.service === 'cdek') return 'Система СДЭК';
  if (actor.type === 'mcp') return 'Интеграция CRM';
  if (actor.type === 'server') return actor.service ? `Система · ${actor.service}` : 'Система CRM';
  return 'Пользователь не определён';
};

const getActionTone = (log: AuditLog) => {
  const action = String(log.action || '');
  if (action.includes('deleted')) return { icon: Trash2, className: 'border-red-200 bg-red-50 text-red-600' };
  if (action.includes('created') || action === 'session_started' || action === 'manager_shift_started') return { icon: Plus, className: 'border-emerald-200 bg-emerald-50 text-emerald-700' };
  if (action.includes('cdek')) return { icon: Truck, className: 'border-blue-200 bg-blue-50 text-blue-700' };
  if (action === 'page_viewed') return { icon: FileClock, className: 'border-blue-200 bg-blue-50 text-blue-700' };
  if (action.includes('upserted')) return { icon: RefreshCcw, className: 'border-amber-200 bg-amber-50 text-amber-700' };
  return { icon: Pencil, className: 'border-violet-200 bg-violet-50 text-violet-700' };
};

const getVisibleDiff = (log: AuditLog) => Object.entries(log.diff || {})
  .filter(([field]) => !HIDDEN_DIFF_FIELDS.has(field));

export const OrderAuditPage: React.FC<{ userEmail: string }> = ({ userEmail }) => {
  const isOwner = userEmail.trim().toLowerCase() === OWNER_EMAIL;
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [actionFilter, setActionFilter] = useState('');
  const [period, setPeriod] = useState('30');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [adminSection, setAdminSection] = useState<'access' | 'logs'>('access');

  useEffect(() => {
    if (!isOwner) {
      setLoading(false);
      return;
    }
    const auditQuery = query(collection(db, 'audit_logs'), orderBy('createdAt', 'desc'), limit(3000));
    const unsubscribe = onSnapshot(auditQuery, snapshot => {
      setLogs(snapshot.docs.map(item => ({ id: item.id, ...item.data() } as AuditLog)));
      setLoading(false);
      setError('');
    }, auditError => {
      console.error('[audit] Не удалось загрузить журнал:', auditError);
      setError('Не удалось загрузить журнал. Проверьте права владельца и повторите вход.');
      setLoading(false);
    });
    return () => unsubscribe();
  }, [isOwner]);

  const filteredLogs = useMemo(() => {
    const queryText = search.trim().toLowerCase();
    const now = Date.now();
    const maxAge = period ? Number(period) * 86400000 : 0;
    return logs.filter(log => {
      const createdAt = toDate(log.createdAt)?.getTime() || now;
      if (maxAge && now - createdAt > maxAge) return false;
      if (actionFilter && actionFilter !== 'all') {
        const action = String(log.action || '');
        if (actionFilter === 'activity' && !/^(ui_clicked|field_changed|session_started|session_ended)$/.test(action)) return false;
        if (actionFilter === 'pages' && action !== 'page_viewed') return false;
        if (actionFilter === 'shifts' && !action.includes('manager_shift')) return false;
        if (actionFilter === 'created' && !action.includes('created')) return false;
        if (actionFilter === 'updated' && !(action.includes('updated') || action.includes('upserted'))) return false;
        if (actionFilter === 'deleted' && !action.includes('deleted')) return false;
        if (actionFilter === 'cdek' && !action.includes('cdek')) return false;
      }
      if (!queryText) return true;
      const searchable = [
        log.entityId,
        getActionLabel(log),
        getActorLabel(log),
        log.before?.clientName,
        log.after?.clientName,
        log.before?.clientPhone,
        log.after?.clientPhone,
        log.metadata?.source,
        log.metadata?.label,
        log.metadata?.pageLabel,
        log.metadata?.path,
        log.entityType,
      ].map(value => String(value || '').toLowerCase()).join(' ');
      return searchable.includes(queryText);
    });
  }, [actionFilter, logs, period, search]);

  const summary = useMemo(() => ({
    activity: filteredLogs.filter(log => /^(ui_clicked|field_changed)$/.test(String(log.action || ''))).length,
    pages: filteredLogs.filter(log => log.action === 'page_viewed').length,
    shifts: filteredLogs.filter(log => String(log.action || '').includes('manager_shift')).length,
  }), [filteredLogs]);

  if (!isOwner) {
    return (
      <div className="mx-auto mt-8 max-w-xl rounded-2xl border border-red-100 bg-white p-8 text-center shadow-sm">
        <ShieldCheck className="mx-auto h-10 w-10 text-red-500" />
        <h2 className="mt-4 text-xl font-semibold text-[#1F2937]">Доступ закрыт</h2>
        <p className="mt-2 text-sm text-[#6B7280]">Администрирование доступно только владельцу CRM.</p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-[1500px] space-y-4 px-4 py-6 sm:px-6 xl:px-8">
      <section className="overflow-hidden rounded-2xl border border-[#E6E9EF] bg-white shadow-[0_12px_36px_rgba(31,41,55,0.05)]">
        <div className="flex flex-col gap-4 border-b border-[#E6E9EF] p-5 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-center gap-3">
            <span className="grid h-12 w-12 shrink-0 place-items-center rounded-xl bg-[#1F2937] text-white">
              <FileClock className="h-5 w-5" />
            </span>
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-[#9CA3AF]">Только владелец</p>
              <h1 className="text-2xl font-semibold text-[#1F2937]">Админка</h1>
              <p className="mt-1 text-[12px] text-[#6B7280]">Аккаунты, доступы, уведомления и журнал действий</p>
            </div>
          </div>
          <div className="inline-flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-[11px] font-semibold text-emerald-700">
            <CheckCircle2 className="h-4 w-4" /> Доступ только у владельца
          </div>
        </div>

        <div className="flex gap-2 border-b border-[#E6E9EF] p-3">
          <button type="button" onClick={() => setAdminSection('access')} className={cn('h-10 rounded-lg px-4 text-[11px] font-semibold transition-colors', adminSection === 'access' ? 'bg-[#1F2937] text-white' : 'bg-[#F6F7F9] text-[#667085] hover:bg-[#EEF0F4]')}>Аккаунты и доступы</button>
          <button type="button" onClick={() => setAdminSection('logs')} className={cn('h-10 rounded-lg px-4 text-[11px] font-semibold transition-colors', adminSection === 'logs' ? 'bg-[#1F2937] text-white' : 'bg-[#F6F7F9] text-[#667085] hover:bg-[#EEF0F4]')}>Журнал действий</button>
        </div>

        {adminSection === 'logs' && <div className="grid grid-cols-2 divide-x divide-y divide-[#E6E9EF] sm:grid-cols-4 sm:divide-y-0">
          {[
            ['Показано', filteredLogs.length, 'text-[#1F2937]'],
            ['Клики / поля', summary.activity, 'text-violet-600'],
            ['Переходы', summary.pages, 'text-blue-600'],
            ['Смены', summary.shifts, 'text-emerald-600'],
          ].map(([label, value, tone]) => (
            <div key={String(label)} className="p-4">
              <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[#9CA3AF]">{label}</p>
              <p className={cn('mt-2 text-2xl font-semibold tabular-nums', tone)}>{value}</p>
            </div>
          ))}
        </div>}
      </section>

      {adminSection === 'access' ? <AccessAdminPanel /> : <>
      <section className="rounded-2xl border border-[#E6E9EF] bg-white shadow-[0_8px_28px_rgba(31,41,55,0.04)]">
        <div className="grid gap-3 border-b border-[#E6E9EF] p-4 md:grid-cols-[minmax(260px,1fr)_210px_180px]">
          <label className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#9CA3AF]" />
            <input
              value={search}
              onChange={event => setSearch(event.target.value)}
              placeholder="Номер заказа, клиент, телефон или сотрудник"
              className="h-11 w-full rounded-lg border border-[#E6E9EF] bg-[#F8F9FB] pl-10 pr-3 text-[13px] text-[#1F2937] outline-none focus:border-[#7D7DE6] focus:bg-white focus:ring-2 focus:ring-[#7D7DE6]/10"
            />
          </label>
          <label className="relative">
            <Filter className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#9CA3AF]" />
            <select value={actionFilter} onChange={event => setActionFilter(event.target.value)} className="h-11 w-full appearance-none rounded-lg border border-[#E6E9EF] bg-white pl-10 pr-8 text-[12px] font-medium text-[#344054] outline-none focus:border-[#7D7DE6]">
              <option value="">Все действия</option>
              <option value="activity">Клики и поля</option>
              <option value="pages">Переходы по разделам</option>
              <option value="shifts">Смены менеджеров</option>
              <option value="created">Создание</option>
              <option value="updated">Изменения</option>
              <option value="deleted">Удаление</option>
              <option value="cdek">СДЭК</option>
            </select>
            <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#9CA3AF]" />
          </label>
          <select value={period} onChange={event => setPeriod(event.target.value)} className="h-11 rounded-lg border border-[#E6E9EF] bg-white px-3 text-[12px] font-medium text-[#344054] outline-none focus:border-[#7D7DE6]">
            <option value="1">Сегодня</option>
            <option value="7">Последние 7 дней</option>
            <option value="30">Последние 30 дней</option>
            <option value="90">Последние 90 дней</option>
            <option value="">Всё загруженное</option>
          </select>
        </div>

        {loading ? (
          <div className="flex min-h-64 items-center justify-center gap-3 text-sm text-[#6B7280]">
            <RefreshCcw className="h-5 w-5 animate-spin" /> Загрузка журнала…
          </div>
        ) : error ? (
          <div className="m-4 flex items-start gap-3 rounded-xl border border-red-100 bg-red-50 p-4 text-sm text-red-700">
            <AlertCircle className="mt-0.5 h-5 w-5 shrink-0" /> {error}
          </div>
        ) : filteredLogs.length === 0 ? (
          <div className="flex min-h-64 flex-col items-center justify-center text-center">
            <Clock3 className="h-8 w-8 text-[#C5C9D1]" />
            <p className="mt-3 text-sm font-semibold text-[#344054]">Записей не найдено</p>
            <p className="mt-1 text-xs text-[#9CA3AF]">Измените период или параметры поиска.</p>
          </div>
        ) : (
          <div className="divide-y divide-[#EEF0F4]">
            {filteredLogs.map(log => {
              const tone = getActionTone(log);
              const ActionIcon = tone.icon;
              const diff = getVisibleDiff(log);
              const expanded = expandedId === log.id;
              const clientName = log.after?.clientName || log.before?.clientName || 'Клиент не указан';
              const isOrderEntity = log.entityType === 'order' || log.entityType === 'cdek';
              const entityLabel = isOrderEntity
                ? `#${String(log.entityId || '').replace(/^#+/, '')}`
                : String(log.metadata?.label || log.entityId || log.entityType || 'Событие');
              const entityContext = isOrderEntity
                ? clientName
                : String(log.metadata?.pageLabel || log.metadata?.path || log.entityType || 'CRM');
              return (
                <article key={log.id} className="transition-colors hover:bg-[#FAFBFC]">
                  <button
                    type="button"
                    onClick={() => setExpandedId(current => current === log.id ? null : log.id)}
                    className="grid min-h-[88px] w-full cursor-pointer grid-cols-[40px_minmax(0,1fr)_auto] items-start gap-3 px-4 py-4 text-left md:grid-cols-[40px_190px_160px_minmax(180px,1fr)_minmax(220px,1.2fr)_24px] md:items-center"
                    aria-expanded={expanded}
                  >
                    <span className={cn('grid h-10 w-10 place-items-center rounded-xl border', tone.className)}><ActionIcon className="h-4 w-4" /></span>
                    <div className="min-w-0">
                      <p className="text-[12px] font-semibold text-[#1F2937]">{getActionLabel(log)}</p>
                      <p className="mt-1 text-[10px] text-[#9CA3AF] md:hidden">{formatDateTime(log.createdAt)}</p>
                    </div>
                    <ChevronDown className={cn('mt-2 h-4 w-4 text-[#9CA3AF] transition-transform md:hidden', expanded && 'rotate-180')} />
                    <div className="hidden md:block">
                      <p className="truncate text-[11px] font-medium text-[#344054]">{entityLabel}</p>
                      <p className="mt-1 truncate text-[10px] text-[#9CA3AF]">{entityContext}</p>
                    </div>
                    <div className="hidden min-w-0 md:block">
                      <p className="truncate text-[11px] font-medium text-[#344054]"><UserRound className="mr-1.5 inline h-3.5 w-3.5 text-[#9CA3AF]" />{getActorLabel(log)}</p>
                      <p className="mt-1 text-[10px] text-[#9CA3AF]">{log.metadata?.source || log.actor?.type || 'crm'}</p>
                    </div>
                    <div className="hidden min-w-0 md:block">
                      <p className="text-[11px] font-medium tabular-nums text-[#344054]">{formatDateTime(log.createdAt)}</p>
                      <p className="mt-1 truncate text-[10px] text-[#9CA3AF]">{diff.length ? `${diff.length} измен.` : 'Запись события'}</p>
                    </div>
                    <ChevronDown className={cn('hidden h-4 w-4 text-[#9CA3AF] transition-transform md:block', expanded && 'rotate-180')} />
                  </button>

                  {expanded && (
                    <div className="border-t border-[#EEF0F4] bg-[#F8F9FB] px-4 py-4 md:pl-[244px]">
                      <div className="mb-3 grid gap-2 text-[11px] sm:grid-cols-2 md:hidden">
                        <p><span className="text-[#9CA3AF]">Действие:</span> <b>{entityLabel}</b></p>
                        <p><span className="text-[#9CA3AF]">Раздел:</span> <b>{entityContext}</b></p>
                        <p className="sm:col-span-2"><span className="text-[#9CA3AF]">Кто:</span> <b>{getActorLabel(log)}</b></p>
                      </div>
                      {diff.length ? (
                        <div className="space-y-2">
                          {diff.map(([field, values]) => (
                            <div key={field} className="grid gap-1 rounded-lg border border-[#E6E9EF] bg-white p-3 text-[11px] md:grid-cols-[150px_minmax(0,1fr)_20px_minmax(0,1fr)] md:items-start">
                              <b className="text-[#344054]">{FIELD_LABELS[field] || field}</b>
                              <span className="break-words text-[#9CA3AF] line-through">{compactValue(values.before)}</span>
                              <span className="hidden text-center text-[#C5C9D1] md:block">→</span>
                              <span className="break-words font-medium text-[#1F2937]">{compactValue(values.after)}</span>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <p className="text-[12px] text-[#6B7280]">{log.metadata?.label || 'Действие записано без изменения данных.'}</p>
                      )}
                    </div>
                  )}
                </article>
              );
            })}
          </div>
        )}
      </section>
      <p className="px-1 text-[10px] text-[#9CA3AF]">Показываются последние 3000 записей журнала. Доступ защищён аккаунтом владельца.</p>
      </>}
    </div>
  );
};

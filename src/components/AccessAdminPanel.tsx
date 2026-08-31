import React, { useEffect, useMemo, useState } from 'react';
import { BellRing, Check, RefreshCcw, Save, Search, ShieldCheck, UserPlus, Users } from 'lucide-react';

import { auth } from '../firebase';
import { cn } from '../lib/utils';

type AccountAccess = {
  uid: string;
  email: string;
  displayName: string;
  disabled: boolean;
  configured: boolean;
  role: string;
  allowedViews: string[];
  notificationTopics: string[];
  active: boolean;
  createdAt?: string | null;
  lastLoginAt?: string | null;
};

const PAGE_OPTIONS = [
  ['home', 'Главная'], ['calculator', 'Юнит'], ['finance', 'Финансы'], ['payroll', 'ФОТ'],
  ['analytics', 'Аналитика'], ['orders', 'Заказы'], ['clients', 'Клиенты'], ['marketing', 'Маркетинг'],
  ['products', 'Склад'], ['production', 'Производство'], ['storefront', 'Магазин'], ['handbook', 'Справочник'],
  ['cdek', 'СДЭК'], ['integrations', 'API'], ['social', 'Соцсети'], ['instagram', 'Instagram'],
  ['bot', 'Бот'], ['content', 'Контент'], ['broadcast', 'Рассылки'], ['broadcast-v2', 'Рассылки 2'], ['studio', 'Студия'], ['ai-agent', 'ИИ'],
] as const;

const NOTIFICATION_OPTIONS = [
  ['all', 'Все уведомления'], ['orders', 'Заказы'], ['payments', 'Оплаты'], ['cdek', 'СДЭК'],
  ['shifts', 'Смены'], ['social', 'Соцсети'], ['stock', 'Склад'], ['production', 'Производство'],
] as const;

const emptyNewAccount = {
  email: '',
  password: '',
  displayName: '',
  role: 'Сотрудник',
  allowedViews: [] as string[],
  notificationTopics: [] as string[],
};

const formatAccountDate = (value?: string | null) => {
  if (!value) return 'Ещё не входил';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Дата неизвестна' : date.toLocaleString('ru-RU');
};

const ownerRequest = async (path: string, init?: RequestInit) => {
  await auth.authStateReady();
  const token = await auth.currentUser?.getIdToken();
  if (!token) throw new Error('Войдите под аккаунтом владельца');
  const response = await fetch(path, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      ...(init?.headers || {}),
    },
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error || 'Ошибка CRM');
  return payload;
};

const ToggleCard: React.FC<{ checked: boolean; label: string; onClick: () => void; disabled?: boolean }> = ({ checked, label, onClick, disabled }) => (
  <button
    type="button"
    onClick={onClick}
    disabled={disabled}
    className={cn(
      'flex min-h-10 items-center gap-2 rounded-lg border px-3 py-2 text-left text-[11px] font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-60',
      checked ? 'border-violet-200 bg-violet-50 text-violet-800' : 'border-[#E6E9EF] bg-white text-[#667085] hover:bg-[#F8F9FB]'
    )}
  >
    <span className={cn('grid h-4 w-4 shrink-0 place-items-center rounded border', checked ? 'border-violet-500 bg-violet-500 text-white' : 'border-[#D0D5DD] bg-white')}>
      {checked && <Check className="h-3 w-3" />}
    </span>
    {label}
  </button>
);

export const AccessAdminPanel: React.FC = () => {
  const [accounts, setAccounts] = useState<AccountAccess[]>([]);
  const [selectedUid, setSelectedUid] = useState('');
  const [draft, setDraft] = useState<AccountAccess | null>(null);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [creating, setCreating] = useState(false);
  const [newAccount, setNewAccount] = useState(emptyNewAccount);

  const loadAccounts = async (preferredUid?: string) => {
    setLoading(true);
    setError('');
    try {
      const payload = await ownerRequest('/api/admin/accounts');
      const next = Array.isArray(payload.accounts) ? payload.accounts as AccountAccess[] : [];
      setAccounts(next);
      setNotice(payload.degraded ? 'Аккаунты загружены. Управление логинами временно восстанавливается — повторите сохранение через минуту.' : '');
      const uid = preferredUid || selectedUid || next[0]?.uid || '';
      const selected = next.find(account => account.uid === uid) || next[0] || null;
      setSelectedUid(selected?.uid || '');
      setDraft(selected ? { ...selected, allowedViews: [...selected.allowedViews], notificationTopics: [...selected.notificationTopics] } : null);
    } catch (loadError: any) {
      setError(loadError?.message || 'Не удалось загрузить аккаунты');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void loadAccounts(); }, []);

  const filteredAccounts = useMemo(() => {
    const value = search.trim().toLowerCase();
    if (!value) return accounts;
    return accounts.filter(account => `${account.email} ${account.displayName} ${account.role}`.toLowerCase().includes(value));
  }, [accounts, search]);

  const selectAccount = (account: AccountAccess) => {
    setSelectedUid(account.uid);
    setDraft({ ...account, allowedViews: [...account.allowedViews], notificationTopics: [...account.notificationTopics] });
    setCreating(false);
    setNotice('');
    setError('');
  };

  const toggleDraftList = (field: 'allowedViews' | 'notificationTopics', value: string) => {
    setDraft(current => {
      if (!current || current.role === 'owner') return current;
      const values = current[field];
      const next = field === 'notificationTopics' && value === 'all'
        ? (values.includes('all') ? [] : ['all'])
        : values.includes(value)
          ? values.filter(item => item !== value)
          : [...values.filter(item => item !== 'all'), value];
      return { ...current, [field]: next };
    });
  };

  const saveDraft = async () => {
    if (!draft || draft.role === 'owner') return;
    setSaving(true);
    setError('');
    setNotice('');
    try {
      await ownerRequest(`/api/admin/accounts/${encodeURIComponent(draft.uid)}`, {
        method: 'PATCH',
        body: JSON.stringify({
          displayName: draft.displayName,
          role: draft.role,
          active: draft.active,
          allowedViews: draft.allowedViews,
          notificationTopics: draft.notificationTopics,
        }),
      });
      setNotice('Права и уведомления сохранены');
      await loadAccounts(draft.uid);
    } catch (saveError: any) {
      setError(saveError?.message || 'Не удалось сохранить права');
    } finally {
      setSaving(false);
    }
  };

  const toggleNewList = (field: 'allowedViews' | 'notificationTopics', value: string) => {
    setNewAccount(current => {
      const values = current[field];
      const next = field === 'notificationTopics' && value === 'all'
        ? (values.includes('all') ? [] : ['all'])
        : values.includes(value)
          ? values.filter(item => item !== value)
          : [...values.filter(item => item !== 'all'), value];
      return { ...current, [field]: next };
    });
  };

  const createAccount = async () => {
    setSaving(true);
    setError('');
    setNotice('');
    try {
      const payload = await ownerRequest('/api/admin/accounts', { method: 'POST', body: JSON.stringify(newAccount) });
      setNewAccount(emptyNewAccount);
      setCreating(false);
      setNotice(`Аккаунт ${payload.email} создан`);
      await loadAccounts(payload.uid);
    } catch (createError: any) {
      setError(createError?.message || 'Не удалось создать аккаунт');
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <div className="flex min-h-72 items-center justify-center gap-3 rounded-2xl border border-[#E6E9EF] bg-white text-sm text-[#667085]"><RefreshCcw className="h-5 w-5 animate-spin" /> Загрузка аккаунтов…</div>;

  return (
    <section className="overflow-hidden rounded-2xl border border-[#E6E9EF] bg-white shadow-[0_8px_28px_rgba(31,41,55,0.04)]">
      <div className="flex flex-col gap-3 border-b border-[#E6E9EF] p-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-base font-semibold text-[#1F2937]">Аккаунты сотрудников</h2>
          <p className="mt-1 text-[11px] text-[#667085]">Создание логинов, доступ к разделам CRM и подписки на уведомления.</p>
        </div>
        <button type="button" onClick={() => { setCreating(true); setDraft(null); setNotice(''); setError(''); }} className="inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-[#1F2937] px-4 text-[11px] font-semibold text-white hover:bg-[#111827]">
          <UserPlus className="h-4 w-4" /> Добавить аккаунт
        </button>
      </div>

      {(error || notice) && <div className={cn('mx-4 mt-4 rounded-lg border px-3 py-2 text-[11px] font-medium', error ? 'border-red-100 bg-red-50 text-red-700' : 'border-emerald-100 bg-emerald-50 text-emerald-700')}>{error || notice}</div>}

      <div className="grid min-h-[620px] lg:grid-cols-[320px_minmax(0,1fr)]">
        <aside className="border-b border-[#E6E9EF] bg-[#FAFBFC] lg:border-b-0 lg:border-r">
          <label className="relative m-3 block">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#98A2B3]" />
            <input value={search} onChange={event => setSearch(event.target.value)} placeholder="Имя или почта" className="h-10 w-full rounded-lg border border-[#E6E9EF] bg-white pl-9 pr-3 text-[12px] outline-none focus:border-violet-300" />
          </label>
          <div className="max-h-[560px] overflow-y-auto border-t border-[#E6E9EF]">
            {filteredAccounts.map(account => (
              <button key={account.uid} type="button" onClick={() => selectAccount(account)} className={cn('flex w-full items-start gap-3 border-b border-[#EEF0F4] px-4 py-3 text-left transition-colors', selectedUid === account.uid && !creating ? 'bg-violet-50' : 'hover:bg-white')}>
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-white text-[#667085] ring-1 ring-[#E6E9EF]"><Users className="h-4 w-4" /></span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[12px] font-semibold text-[#1F2937]">{account.displayName || account.email}</span>
                  <span className="mt-0.5 block truncate text-[10px] text-[#667085]">{account.email}</span>
                  <span className={cn('mt-1 inline-flex rounded-full px-2 py-0.5 text-[9px] font-semibold', account.active ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-600')}>{account.role === 'owner' ? 'Владелец' : account.active ? account.role : 'Отключён'}</span>
                </span>
              </button>
            ))}
          </div>
        </aside>

        <div className="p-4 sm:p-6">
          {creating ? (
            <div className="space-y-6">
              <div>
                <h3 className="text-lg font-semibold text-[#1F2937]">Новый аккаунт</h3>
                <p className="mt-1 text-[11px] text-[#667085]">Логин создаётся сразу с указанными правами. Существующие аккаунты не меняются.</p>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <input value={newAccount.displayName} onChange={event => setNewAccount(current => ({ ...current, displayName: event.target.value }))} placeholder="Имя / должность" className="h-11 rounded-lg border border-[#E6E9EF] px-3 text-[12px] outline-none focus:border-violet-300" />
                <input value={newAccount.role} onChange={event => setNewAccount(current => ({ ...current, role: event.target.value }))} placeholder="Роль: менеджер, аутсорсер…" className="h-11 rounded-lg border border-[#E6E9EF] px-3 text-[12px] outline-none focus:border-violet-300" />
                <input type="email" value={newAccount.email} onChange={event => setNewAccount(current => ({ ...current, email: event.target.value }))} placeholder="login@ybcrm.ru" className="h-11 rounded-lg border border-[#E6E9EF] px-3 text-[12px] outline-none focus:border-violet-300" />
                <input type="password" value={newAccount.password} onChange={event => setNewAccount(current => ({ ...current, password: event.target.value }))} placeholder="Начальный пароль — минимум 8 символов" className="h-11 rounded-lg border border-[#E6E9EF] px-3 text-[12px] outline-none focus:border-violet-300" />
              </div>
              <AccessChoices allowedViews={newAccount.allowedViews} notificationTopics={newAccount.notificationTopics} onToggleView={value => toggleNewList('allowedViews', value)} onToggleNotification={value => toggleNewList('notificationTopics', value)} />
              <div className="flex gap-2">
                <button type="button" onClick={() => void createAccount()} disabled={saving} className="inline-flex h-10 items-center gap-2 rounded-lg bg-violet-600 px-4 text-[11px] font-semibold text-white disabled:opacity-50"><UserPlus className="h-4 w-4" />{saving ? 'Создаю…' : 'Создать аккаунт'}</button>
                <button type="button" onClick={() => { setCreating(false); setNewAccount(emptyNewAccount); if (accounts[0]) selectAccount(accounts[0]); }} className="h-10 rounded-lg border border-[#E6E9EF] px-4 text-[11px] font-semibold text-[#667085]">Отмена</button>
              </div>
            </div>
          ) : draft ? (
            <div className="space-y-6">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <div className="flex items-center gap-2"><h3 className="text-lg font-semibold text-[#1F2937]">{draft.displayName || draft.email}</h3>{draft.role === 'owner' && <ShieldCheck className="h-5 w-5 text-violet-600" />}</div>
                  <p className="mt-1 text-[12px] text-[#667085]">{draft.email}</p>
                  <p className="mt-1 text-[10px] text-[#98A2B3]">Последний вход: {formatAccountDate(draft.lastLoginAt)}</p>
                </div>
                {draft.role !== 'owner' && <label className="inline-flex items-center gap-2 text-[11px] font-semibold text-[#344054]"><input type="checkbox" checked={draft.active} onChange={event => setDraft(current => current ? { ...current, active: event.target.checked } : current)} /> Аккаунт активен</label>}
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="space-y-1"><span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[#98A2B3]">Имя / должность</span><input value={draft.displayName} disabled={draft.role === 'owner'} onChange={event => setDraft(current => current ? { ...current, displayName: event.target.value } : current)} className="h-11 w-full rounded-lg border border-[#E6E9EF] px-3 text-[12px] outline-none disabled:bg-[#F8F9FB]" /></label>
                <label className="space-y-1"><span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[#98A2B3]">Роль</span><input value={draft.role === 'owner' ? 'Владелец' : draft.role} disabled={draft.role === 'owner'} onChange={event => setDraft(current => current ? { ...current, role: event.target.value } : current)} className="h-11 w-full rounded-lg border border-[#E6E9EF] px-3 text-[12px] outline-none disabled:bg-[#F8F9FB]" /></label>
              </div>
              <AccessChoices allowedViews={draft.allowedViews} notificationTopics={draft.notificationTopics} disabled={draft.role === 'owner'} onToggleView={value => toggleDraftList('allowedViews', value)} onToggleNotification={value => toggleDraftList('notificationTopics', value)} />
              {draft.role === 'owner' ? (
                <div className="rounded-lg border border-violet-100 bg-violet-50 p-3 text-[11px] font-medium text-violet-800">У владельца всегда остаются все разделы и все уведомления.</div>
              ) : (
                <button type="button" onClick={() => void saveDraft()} disabled={saving} className="inline-flex h-10 items-center gap-2 rounded-lg bg-violet-600 px-4 text-[11px] font-semibold text-white disabled:opacity-50"><Save className="h-4 w-4" />{saving ? 'Сохраняю…' : 'Сохранить права'}</button>
              )}
            </div>
          ) : <div className="grid min-h-64 place-items-center text-sm text-[#98A2B3]">Выберите аккаунт</div>}
        </div>
      </div>
    </section>
  );
};

const AccessChoices: React.FC<{
  allowedViews: string[];
  notificationTopics: string[];
  onToggleView: (value: string) => void;
  onToggleNotification: (value: string) => void;
  disabled?: boolean;
}> = ({ allowedViews, notificationTopics, onToggleView, onToggleNotification, disabled }) => (
  <div className="grid gap-6 xl:grid-cols-[minmax(0,1.5fr)_minmax(280px,1fr)]">
    <div>
      <div className="mb-2 flex items-center justify-between gap-3"><p className="text-[11px] font-semibold text-[#344054]">Доступные разделы</p><span className="text-[10px] text-[#98A2B3]">{allowedViews.length} из {PAGE_OPTIONS.length}</span></div>
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">{PAGE_OPTIONS.map(([value, label]) => <ToggleCard key={value} checked={allowedViews.includes(value)} label={label} disabled={disabled} onClick={() => onToggleView(value)} />)}</div>
    </div>
    <div>
      <div className="mb-2 flex items-center gap-2"><BellRing className="h-4 w-4 text-violet-600" /><p className="text-[11px] font-semibold text-[#344054]">Какие уведомления получать</p></div>
      <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-1">{NOTIFICATION_OPTIONS.map(([value, label]) => <ToggleCard key={value} checked={notificationTopics.includes(value)} label={label} disabled={disabled} onClick={() => onToggleNotification(value)} />)}</div>
    </div>
  </div>
);

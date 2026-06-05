import React, { useMemo, useState, useEffect } from 'react';
import {
  TrendingUp, Calendar, Star, Search, Plus, Trash2, CheckCircle, Image, Video, Users
} from 'lucide-react';
import { formatCurrency, cn } from '../../lib/utils';
import { db } from '../../firebase';
import { doc, onSnapshot, setDoc } from 'firebase/firestore';
import { OrderData } from '../AnalyticsDashboard';
import { YAASBAE_BLOGGERS } from '../../data/bloggersYaasbae';

interface MarketingTabProps {
  stats: any;
  data: OrderData[];
  searchTerm: string;
  setSearchTerm: (s: string) => void;
  selectedMonth: string;
}

type BloggerPostType = 'Фото' | 'Рилс';

type BloggerCalendarEvent = {
  id: string;
  date: string;
  bloggerId: string;
  bloggerName: string;
  postType: BloggerPostType;
  note: string;
  done: boolean;
};

export const MarketingTab: React.FC<MarketingTabProps> = ({
  stats,
  data,
  searchTerm,
  setSearchTerm,
  selectedMonth,
}) => {
  const [marketingStats, setMarketingStats] = useState<any>({ bloggerMentions: 0, instagramViews: 0, marketingSales: 0 });
  const [salesGoals, setSalesGoals] = useState<any>({ targetSalesCount: 0, targetSalesAmount: 0, targetViews: 0 });
  const [bloggerSearch, setBloggerSearch] = useState('');
  const [calendarEvents, setCalendarEvents] = useState<BloggerCalendarEvent[]>([]);
  const [calendarDraft, setCalendarDraft] = useState({
    date: `${selectedMonth}-01`,
    bloggerId: YAASBAE_BLOGGERS[0]?.id || '',
    postType: 'Фото' as BloggerPostType,
    note: '',
  });

  useEffect(() => {
    const unsubMarketing = onSnapshot(doc(db, 'marketing_stats', selectedMonth), (snap) => {
      if (snap.exists()) setMarketingStats(snap.data());
      else setMarketingStats({ bloggerMentions: 0, instagramViews: 0, marketingSales: 0 });
    });
    const unsubGoals = onSnapshot(doc(db, 'sales_goals', selectedMonth), (snap) => {
      if (snap.exists()) setSalesGoals(snap.data());
      else setSalesGoals({ targetSalesCount: 0, targetSalesAmount: 0, targetViews: 0 });
    });
    const unsubCalendar = onSnapshot(doc(db, 'marketing_blogger_calendar', selectedMonth), (snap) => {
      const events = snap.exists() ? snap.data().events : [];
      setCalendarEvents(Array.isArray(events) ? events : []);
    });

    return () => {
      unsubMarketing();
      unsubGoals();
      unsubCalendar();
    };
  }, [selectedMonth]);

  useEffect(() => {
    setCalendarDraft((prev) => ({
      ...prev,
      date: prev.date?.startsWith(selectedMonth) ? prev.date : `${selectedMonth}-01`,
    }));
  }, [selectedMonth]);

  const saveMarketingStats = async (updates: any) => {
    const newStats = { ...marketingStats, ...updates };
    setMarketingStats(newStats);
    await setDoc(doc(db, 'marketing_stats', selectedMonth), newStats, { merge: true });
  };

  const saveSalesGoals = async (updates: any) => {
    const newGoals = { ...salesGoals, ...updates };
    setSalesGoals(newGoals);
    await setDoc(doc(db, 'sales_goals', selectedMonth), newGoals, { merge: true });
  };

  const saveCalendarEvents = async (events: BloggerCalendarEvent[]) => {
    setCalendarEvents(events);
    await setDoc(doc(db, 'marketing_blogger_calendar', selectedMonth), { events }, { merge: true });
  };

  const addCalendarEvent = async () => {
    const blogger = YAASBAE_BLOGGERS.find((item) => item.id === calendarDraft.bloggerId);
    if (!blogger || !calendarDraft.date) return;

    const nextEvents: BloggerCalendarEvent[] = [
      ...calendarEvents,
      {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        date: calendarDraft.date,
        bloggerId: blogger.id,
        bloggerName: blogger.name,
        postType: calendarDraft.postType,
        note: calendarDraft.note.trim(),
        done: false,
      },
    ].sort((a, b) => a.date.localeCompare(b.date));

    await saveCalendarEvents(nextEvents);
    setCalendarDraft((prev) => ({ ...prev, note: '' }));
  };

  const updateCalendarEvent = async (id: string, updates: Partial<BloggerCalendarEvent>) => {
    await saveCalendarEvents(calendarEvents.map((event) => (
      event.id === id ? { ...event, ...updates } : event
    )));
  };

  const deleteCalendarEvent = async (id: string) => {
    await saveCalendarEvents(calendarEvents.filter((event) => event.id !== id));
  };

  const filteredExcelBloggers = useMemo(() => {
    const query = bloggerSearch.trim().toLowerCase();
    if (!query) return YAASBAE_BLOGGERS;
    return YAASBAE_BLOGGERS.filter((blogger) => [
      blogger.name,
      blogger.phone,
      blogger.instagram,
      blogger.city,
      blogger.email,
      blogger.aliases,
    ].some((value) => value?.toLowerCase().includes(query)));
  }, [bloggerSearch]);

  const monthDays = useMemo(() => {
    const [year, month] = selectedMonth.split('-').map(Number);
    const daysCount = new Date(year, month, 0).getDate();
    return Array.from({ length: daysCount }, (_, index) => {
      const day = index + 1;
      const date = new Date(year, month - 1, day);
      const iso = `${selectedMonth}-${String(day).padStart(2, '0')}`;
      return {
        iso,
        day,
        weekday: date.toLocaleDateString('ru-RU', { weekday: 'short' }),
        events: calendarEvents.filter((event) => event.date === iso),
      };
    });
  }, [selectedMonth, calendarEvents]);

  const monthLabel = useMemo(() => {
    const [year, month] = selectedMonth.split('-').map(Number);
    return new Date(year, month - 1, 1).toLocaleDateString('ru-RU', { month: 'long', year: 'numeric' });
  }, [selectedMonth]);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Planning Block */}
        <div className="tg-card p-4 space-y-4">
          <div className="flex items-center gap-2 mb-2">
            <Calendar className="w-4 h-4 text-purple-500" />
            <h3 className="text-[11px] font-black text-zinc-900 uppercase tracking-widest">План продаж на месяц</h3>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1">
              <label className="text-[8px] font-black text-zinc-400 uppercase tracking-widest ml-1">Цель продаж (₽)</label>
              <input
                type="number"
                value={Number.isNaN(salesGoals.targetSalesAmount) ? "" : salesGoals.targetSalesAmount || ""}
                onChange={(e) => saveSalesGoals({ targetSalesAmount: Number(e.target.value) })}
                className="tg-input py-2 text-xs"
                placeholder="0"
              />
            </div>
            <div className="space-y-1">
              <label className="text-[8px] font-black text-zinc-400 uppercase tracking-widest ml-1">Цель охватов (Insta)</label>
              <input
                type="number"
                value={Number.isNaN(salesGoals.targetViews) ? "" : salesGoals.targetViews || ""}
                onChange={(e) => saveSalesGoals({ targetViews: Number(e.target.value) })}
                className="tg-input py-2 text-xs"
                placeholder="0"
              />
            </div>
          </div>
          <div className="p-3 bg-purple-50 rounded-xl">
            <div className="flex justify-between items-center mb-1.5">
              <span className="text-[9px] font-bold text-purple-600 uppercase">Прогресс выполнения</span>
              <span className="text-[10px] font-black text-purple-900">
                {(() => {
                  const [y, m] = selectedMonth.split('-').map(Number);
                  const currentMonthRevenue = data
                    .filter(o => o.date.getMonth() === m - 1 && o.date.getFullYear() === y)
                    .reduce((acc, curr) => acc + curr.revenue, 0);
                  return Math.round((currentMonthRevenue / (salesGoals.targetSalesAmount || 1)) * 100);
                })()}%
              </span>
            </div>
            <div className="h-1.5 w-full bg-purple-100 rounded-full overflow-hidden">
              <div
                className="h-full bg-purple-600"
                style={{
                  width: `${(() => {
                    const [y, m] = selectedMonth.split('-').map(Number);
                    const currentMonthRevenue = data
                      .filter(o => o.date.getMonth() === m - 1 && o.date.getFullYear() === y)
                      .reduce((acc, curr) => acc + curr.revenue, 0);
                    return Math.min(100, (currentMonthRevenue / (salesGoals.targetSalesAmount || 1)) * 100);
                  })()}%`
                }}
              />
            </div>
          </div>
        </div>

        {/* Performance Block */}
        <div className="tg-card p-4 space-y-4">
          <div className="flex items-center gap-2 mb-2">
            <TrendingUp className="w-4 h-4 text-emerald-500" />
            <h3 className="text-[11px] font-black text-zinc-900 uppercase tracking-widest">Маркетинговые показатели</h3>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-1">
              <label className="text-[8px] font-black text-zinc-400 uppercase tracking-widest ml-1">Отметки</label>
              <input
                type="number"
                value={Number.isNaN(marketingStats.bloggerMentions) ? "" : marketingStats.bloggerMentions || ""}
                onChange={(e) => saveMarketingStats({ bloggerMentions: Number(e.target.value) })}
                className="tg-input py-2 text-xs"
                placeholder="0"
              />
            </div>
            <div className="space-y-1">
              <label className="text-[8px] font-black text-zinc-400 uppercase tracking-widest ml-1">Просмотры</label>
              <input
                type="number"
                value={Number.isNaN(marketingStats.instagramViews) ? "" : marketingStats.instagramViews || ""}
                onChange={(e) => saveMarketingStats({ instagramViews: Number(e.target.value) })}
                className="tg-input py-2 text-xs"
                placeholder="0"
              />
            </div>
            <div className="space-y-1">
              <label className="text-[8px] font-black text-zinc-400 uppercase tracking-widest ml-1">Продажи</label>
              <input
                type="number"
                value={Number.isNaN(marketingStats.marketingSales) ? "" : marketingStats.marketingSales || ""}
                onChange={(e) => saveMarketingStats({ marketingSales: Number(e.target.value) })}
                className="tg-input py-2 text-xs"
                placeholder="0"
              />
            </div>
          </div>
          <div className="flex items-center justify-between p-2 bg-slate-50 rounded-lg">
            <div className="flex items-center gap-2">
              <Star className="w-3 h-3 text-amber-500" />
              <span className="text-[9px] font-bold text-slate-500 uppercase">Блогерские заказы: {stats.bloggerOrdersCount}</span>
            </div>
            <span className="text-[10px] font-black text-slate-900">{formatCurrency(stats.bloggerRevenue)}</span>
          </div>
        </div>
      </div>

      <div className="tg-card overflow-hidden">
        <div className="p-3 border-b border-zinc-100 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div className="flex items-center gap-3">
            <h3 className="text-[10px] font-semibold text-zinc-900 uppercase tracking-widest">База блогеров (Контент)</h3>
            <p className="text-[8px] text-zinc-400 font-medium uppercase tracking-wider">Всего: <span className="text-zinc-900">{stats.bloggersList.length}</span></p>
          </div>
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3 h-3 text-zinc-300" />
            <input
              type="text"
              placeholder="Поиск..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-7 pr-3 py-1.5 bg-zinc-50 border border-zinc-100 rounded-lg text-[10px] font-medium focus:outline-none focus:ring-1 focus:ring-zinc-200 transition-all w-full sm:w-48"
            />
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="text-[9px] font-bold text-zinc-400 uppercase tracking-widest bg-zinc-50/50">
                <th className="px-3 py-2 border-none w-10">#</th>
                <th className="px-3 py-2 border-none">Блогер</th>
                <th className="px-3 py-2 border-none hidden md:table-cell">Город</th>
                <th className="px-3 py-2 border-none">Instagram</th>
                <th className="px-3 py-2 border-none text-center">Сотрудничеств</th>
                <th className="px-3 py-2 border-none hidden md:table-cell">Заказы</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-50/50">
              {stats.bloggersList
                .filter((b: any) => !searchTerm || b.name?.toLowerCase().includes(searchTerm.toLowerCase()))
                .map((blogger: any, i: number) => (
                <tr key={i} className="group hover:bg-zinc-50/50 transition-colors">
                  <td className="px-3 py-2 text-[9px] text-zinc-300 font-mono italic">{i + 1}</td>
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-2">
                      <div className="w-5 h-5 bg-zinc-100 rounded flex items-center justify-center text-[7px] font-semibold text-zinc-500 border border-zinc-200 group-hover:bg-zinc-900 group-hover:text-white transition-all shrink-0">
                        {blogger.name?.charAt(0) || '?'}
                      </div>
                      <div className="flex flex-col">
                        <span className="text-[10px] font-semibold text-zinc-900 leading-tight">{blogger.name || 'Неизвестно'}</span>
                        <div className="md:hidden flex items-center gap-2 mt-0.5">
                          <span className="text-[8px] text-zinc-400 font-medium uppercase">{blogger.city || '—'}</span>
                          {blogger.insta && (
                            <a
                              href={blogger.insta.startsWith('http') ? blogger.insta : `https://instagram.com/${blogger.insta.replace('@', '')}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-[8px] text-zinc-500 font-semibold hover:underline"
                            >
                              @{blogger.insta.replace('@', '')}
                            </a>
                          )}
                        </div>
                      </div>
                    </div>
                  </td>
                  <td className="px-3 py-2 text-[9px] text-zinc-500 font-medium hidden md:table-cell">{blogger.city || '—'}</td>
                  <td className="px-3 py-2">
                    {blogger.insta ? (
                      <a
                        href={blogger.insta.startsWith('http') ? blogger.insta : `https://instagram.com/${blogger.insta.replace('@', '')}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 px-1.5 py-0.5 bg-zinc-100 text-zinc-600 text-[8px] font-semibold rounded hover:bg-zinc-900 hover:text-white transition-colors border border-zinc-200 uppercase tracking-widest"
                      >
                        <Star size={8} className="text-zinc-400" />
                        {blogger.insta.includes('/') ? 'Профиль' : `@${blogger.insta.replace('@', '')}`}
                      </a>
                    ) : (
                      <span className="text-zinc-300 text-[8px] font-semibold uppercase">ТГ/ВК</span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-center">
                    <span className="text-[10px] font-semibold text-zinc-900 tracking-tight">{blogger.count}</span>
                  </td>
                  <td className="px-3 py-2 hidden md:table-cell">
                    <div className="flex flex-wrap gap-1">
                      {blogger.orders.map((id: string) => (
                        <span key={id} className="text-[7px] px-1 py-0.5 bg-zinc-50 text-zinc-400 rounded border border-zinc-100 font-bold">#{id}</span>
                      ))}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="tg-card overflow-hidden">
        <div className="p-4 border-b border-zinc-100 flex flex-col lg:flex-row lg:items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-zinc-900 text-white flex items-center justify-center shadow-sm">
              <Users className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-[12px] font-black text-zinc-900 uppercase tracking-[0.22em]">Блогеры YAASBAE</h3>
              <p className="text-[9px] text-zinc-400 font-bold uppercase tracking-widest">Файл Блогеры_YAASBAE.xlsx · {YAASBAE_BLOGGERS.length} записей</p>
            </div>
          </div>
          <div className="relative w-full lg:w-80">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-zinc-300" />
            <input
              type="text"
              placeholder="Поиск по имени, телефону, Instagram..."
              value={bloggerSearch}
              onChange={(e) => setBloggerSearch(e.target.value)}
              className="w-full pl-9 pr-3 py-3 bg-zinc-50 border border-zinc-100 rounded-xl text-[12px] font-semibold focus:outline-none focus:ring-2 focus:ring-zinc-200 transition-all"
            />
          </div>
        </div>
        <div className="overflow-x-auto max-h-[520px]">
          <table className="w-full text-left border-collapse">
            <thead className="sticky top-0 z-10 bg-white">
              <tr className="text-[9px] font-black text-zinc-400 uppercase tracking-widest border-b border-zinc-100">
                <th className="px-4 py-3 border-none w-12">#</th>
                <th className="px-4 py-3 border-none">Блогер</th>
                <th className="px-4 py-3 border-none">Контакты</th>
                <th className="px-4 py-3 border-none hidden lg:table-cell">Город</th>
                <th className="px-4 py-3 border-none text-center">Заказы</th>
                <th className="px-4 py-3 border-none hidden xl:table-cell">Последний заказ</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-50">
              {filteredExcelBloggers.slice(0, 220).map((blogger, index) => (
                <tr key={blogger.id} className="hover:bg-zinc-50/70 transition-colors">
                  <td className="px-4 py-3 text-[10px] text-zinc-300 font-black">{index + 1}</td>
                  <td className="px-4 py-3 min-w-[220px]">
                    <p className="text-[12px] font-black text-zinc-900 leading-tight">{blogger.name || 'Без имени'}</p>
                    {blogger.aliases && (
                      <p className="mt-1 text-[9px] font-semibold text-zinc-400 line-clamp-1">{blogger.aliases}</p>
                    )}
                  </td>
                  <td className="px-4 py-3 min-w-[190px]">
                    <p className="text-[10px] font-semibold text-zinc-500">{blogger.phone || '—'}</p>
                    {blogger.instagram ? (
                      <a
                        href={blogger.instagram.startsWith('http') ? blogger.instagram : `https://instagram.com/${blogger.instagram.replace('@', '')}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="mt-1 inline-flex text-[9px] font-black text-blue-600 uppercase tracking-widest hover:underline"
                      >
                        {blogger.instagram}
                      </a>
                    ) : (
                      <p className="mt-1 text-[9px] font-semibold text-zinc-300">Instagram не указан</p>
                    )}
                  </td>
                  <td className="px-4 py-3 hidden lg:table-cell text-[10px] font-semibold text-zinc-500">{blogger.city || '—'}</td>
                  <td className="px-4 py-3 text-center">
                    <span className="inline-flex min-w-9 justify-center rounded-lg bg-emerald-50 px-2 py-1 text-[11px] font-black text-emerald-600 border border-emerald-100">
                      {blogger.orders}
                    </span>
                  </td>
                  <td className="px-4 py-3 hidden xl:table-cell text-[10px] font-semibold text-zinc-500">{blogger.lastOrder || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {filteredExcelBloggers.length > 220 && (
            <div className="px-4 py-3 border-t border-zinc-100 text-[10px] font-bold text-zinc-400 uppercase tracking-widest">
              Показано 220 из {filteredExcelBloggers.length}. Уточни поиск, чтобы быстрее найти нужного блогера.
            </div>
          )}
        </div>
      </div>

      <div className="tg-card overflow-hidden">
        <div className="p-4 border-b border-zinc-100 flex flex-col xl:flex-row xl:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-purple-100 text-purple-700 flex items-center justify-center">
              <Calendar className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-[12px] font-black text-zinc-900 uppercase tracking-[0.22em]">Календарь блогеров</h3>
              <p className="text-[9px] text-zinc-400 font-bold uppercase tracking-widest">{monthLabel} · фото / рилс / отметки</p>
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-[160px_1fr_110px_1fr_auto] gap-2 w-full xl:max-w-[980px]">
            <input
              type="date"
              value={calendarDraft.date}
              onChange={(e) => setCalendarDraft((prev) => ({ ...prev, date: e.target.value }))}
              className="tg-input py-2.5 text-[11px]"
            />
            <select
              value={calendarDraft.bloggerId}
              onChange={(e) => setCalendarDraft((prev) => ({ ...prev, bloggerId: e.target.value }))}
              className="tg-input py-2.5 text-[11px]"
            >
              {YAASBAE_BLOGGERS.map((blogger) => (
                <option key={blogger.id} value={blogger.id}>{blogger.name}</option>
              ))}
            </select>
            <select
              value={calendarDraft.postType}
              onChange={(e) => setCalendarDraft((prev) => ({ ...prev, postType: e.target.value as BloggerPostType }))}
              className="tg-input py-2.5 text-[11px]"
            >
              <option value="Фото">Фото</option>
              <option value="Рилс">Рилс</option>
            </select>
            <input
              value={calendarDraft.note}
              onChange={(e) => setCalendarDraft((prev) => ({ ...prev, note: e.target.value }))}
              placeholder="Что отмечает / комментарий"
              className="tg-input py-2.5 text-[11px]"
            />
            <button
              type="button"
              onClick={addCalendarEvent}
              className="h-11 px-4 rounded-xl bg-zinc-900 text-white flex items-center justify-center gap-2 text-[10px] font-black uppercase tracking-widest hover:bg-zinc-700 transition-colors"
            >
              <Plus className="w-4 h-4" />
              Добавить
            </button>
          </div>
        </div>
        <div className="p-4">
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 2xl:grid-cols-7 gap-3">
            {monthDays.map((day) => (
              <div
                key={day.iso}
                className={cn(
                  'min-h-32 rounded-xl border bg-white p-3 transition-colors',
                  day.events.length ? 'border-zinc-200 shadow-sm' : 'border-zinc-100'
                )}
              >
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="text-[16px] font-black text-zinc-900 leading-none">{day.day}</p>
                    <p className="mt-1 text-[8px] font-black text-zinc-400 uppercase tracking-widest">{day.weekday}</p>
                  </div>
                  <span className="text-[8px] font-black text-zinc-300 uppercase tracking-widest">{day.events.length || ''}</span>
                </div>
                <div className="mt-3 space-y-2">
                  {day.events.map((event) => (
                    <div
                      key={event.id}
                      className={cn(
                        'rounded-lg border p-2',
                        event.done ? 'border-emerald-100 bg-emerald-50' : 'border-purple-100 bg-purple-50/70'
                      )}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="truncate text-[10px] font-black text-zinc-900">{event.bloggerName}</p>
                          <p className="mt-0.5 flex items-center gap-1 text-[8px] font-black uppercase tracking-widest text-zinc-500">
                            {event.postType === 'Рилс' ? <Video className="w-3 h-3" /> : <Image className="w-3 h-3" />}
                            {event.postType}
                          </p>
                        </div>
                        <div className="flex items-center gap-1 shrink-0">
                          <button
                            type="button"
                            onClick={() => updateCalendarEvent(event.id, { done: !event.done })}
                            className={cn(
                              'w-6 h-6 rounded-lg flex items-center justify-center border transition-colors',
                              event.done ? 'bg-emerald-600 text-white border-emerald-600' : 'bg-white text-zinc-400 border-zinc-200'
                            )}
                            title={event.done ? 'Отмечено' : 'Отметить'}
                          >
                            <CheckCircle className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => deleteCalendarEvent(event.id)}
                            className="w-6 h-6 rounded-lg flex items-center justify-center border border-zinc-200 bg-white text-red-400 hover:bg-red-50 transition-colors"
                            title="Удалить"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                      {event.note && (
                        <p className="mt-2 text-[9px] font-semibold text-zinc-500 leading-snug">{event.note}</p>
                      )}
                    </div>
                  ))}
                  {!day.events.length && (
                    <p className="text-[9px] font-semibold text-zinc-300">Нет отметок</p>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};

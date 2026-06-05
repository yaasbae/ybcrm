import React, { useMemo, useState, useEffect } from 'react';
import {
  Calendar, Search, Plus, Trash2, CheckCircle, Image, Video, Users
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

type BloggerPerformance = {
  id: string;
  name: string;
  phone: string;
  instagram: string;
  city: string;
  sourceOrders: number;
  crmOrders: number;
  total: number;
  orderIds: string[];
};

const normalizeBloggerName = (value: string) => (
  String(value || '')
    .toLowerCase()
    .replace(/[@.,]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
);

export const MarketingTab: React.FC<MarketingTabProps> = ({
  stats,
  data,
  selectedMonth,
}) => {
  const [bloggerSearch, setBloggerSearch] = useState('');
  const [handbookProducts, setHandbookProducts] = useState<string[]>([]);
  const [handbookBloggers, setHandbookBloggers] = useState<string[]>([]);
  const [calendarEvents, setCalendarEvents] = useState<BloggerCalendarEvent[]>([]);
  const [calendarDraft, setCalendarDraft] = useState({
    date: `${selectedMonth}-01`,
    bloggerId: YAASBAE_BLOGGERS[0]?.id || '',
    postType: 'Фото' as BloggerPostType,
    note: '',
  });

  useEffect(() => {
    const unsubCalendar = onSnapshot(doc(db, 'marketing_blogger_calendar', selectedMonth), (snap) => {
      const events = snap.exists() ? snap.data().events : [];
      setCalendarEvents(Array.isArray(events) ? events : []);
    });
    const unsubHandbook = onSnapshot(doc(db, 'settings', 'handbook'), (snap) => {
      const handbook = snap.exists() ? snap.data() : {};
      const productNames = handbook.productNames;
      const bloggers = handbook.bloggers;
      setHandbookProducts(Array.isArray(productNames) ? productNames.filter(Boolean) : []);
      setHandbookBloggers(Array.isArray(bloggers) ? bloggers.filter(Boolean) : []);
    });

    return () => {
      unsubCalendar();
      unsubHandbook();
    };
  }, [selectedMonth]);

  useEffect(() => {
    setCalendarDraft((prev) => ({
      ...prev,
      date: prev.date?.startsWith(selectedMonth) ? prev.date : `${selectedMonth}-01`,
    }));
  }, [selectedMonth]);

  const saveCalendarEvents = async (events: BloggerCalendarEvent[]) => {
    setCalendarEvents(events);
    await setDoc(doc(db, 'marketing_blogger_calendar', selectedMonth), { events }, { merge: true });
  };

  const allBloggerOptions = useMemo(() => {
    const options = YAASBAE_BLOGGERS.map((blogger) => ({ id: blogger.id, name: blogger.name }));
    handbookBloggers.forEach((name) => {
      const key = normalizeBloggerName(name);
      if (!key || options.some((item) => normalizeBloggerName(item.name) === key)) return;
      options.push({ id: `handbook-${key}`, name });
    });
    return options;
  }, [handbookBloggers]);

  const addCalendarEvent = async () => {
    const blogger = allBloggerOptions.find((item) => item.id === calendarDraft.bloggerId);
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

  const bloggerIndex = useMemo(() => {
    const index = new Map<string, typeof YAASBAE_BLOGGERS[number]>();
    YAASBAE_BLOGGERS.forEach((blogger) => {
      [blogger.name, blogger.instagram, ...blogger.aliases.split(/[;,]/)]
        .map(normalizeBloggerName)
        .filter(Boolean)
        .forEach((key) => index.set(key, blogger));
    });
    return index;
  }, []);

  const bloggerPerformance = useMemo(() => {
    const result = new Map<string, BloggerPerformance>();
    const orders: OrderData[] = Array.isArray(stats?.uniqueOrders) ? stats.uniqueOrders : data;

    orders.forEach((order) => {
      const selectedBlogger = String(order.blogger || '').trim();
      if (!selectedBlogger) return;
      const status = String(order.status || '').toLowerCase();
      if (status.includes('возврат') || status.includes('отмена')) return;

      const matched = bloggerIndex.get(normalizeBloggerName(selectedBlogger));
      const id = matched?.id || `custom-${normalizeBloggerName(selectedBlogger)}`;
      const current = result.get(id) || {
        id,
        name: matched?.name || selectedBlogger,
        phone: matched?.phone || '',
        instagram: matched?.instagram || '',
        city: matched?.city || '',
        sourceOrders: matched?.orders || 0,
        crmOrders: 0,
        total: 0,
        orderIds: [],
      };

      result.set(id, {
        ...current,
        crmOrders: current.crmOrders + 1,
        total: current.total + (Number(order.revenue) || 0),
        orderIds: [...current.orderIds, order.orderId],
      });
    });

    return result;
  }, [bloggerIndex, data, stats?.uniqueOrders]);

  const filteredExcelBloggers = useMemo<BloggerPerformance[]>(() => {
    const query = bloggerSearch.trim().toLowerCase();
    const baseRows = YAASBAE_BLOGGERS.map((blogger) => {
      const performance = bloggerPerformance.get(blogger.id);
      return {
        id: blogger.id,
        name: blogger.name,
        phone: blogger.phone,
        instagram: blogger.instagram,
        city: blogger.city,
        sourceOrders: blogger.orders,
        crmOrders: performance?.crmOrders || 0,
        total: performance?.total || 0,
        orderIds: performance?.orderIds || [],
      };
    });
    const manualRows: BloggerPerformance[] = handbookBloggers
      .filter((name) => {
        const key = normalizeBloggerName(name);
        return key && !baseRows.some((item) => normalizeBloggerName(item.name) === key);
      })
      .map((name) => {
        const id = `handbook-${normalizeBloggerName(name)}`;
        const performance = Array.from(bloggerPerformance.values())
          .find((item) => normalizeBloggerName(item.name) === normalizeBloggerName(name));
        return performance || {
          id,
          name,
          phone: '',
          instagram: '',
          city: '',
          sourceOrders: 0,
          crmOrders: 0,
          total: 0,
          orderIds: [],
        };
      });
    const manualIds = new Set(manualRows.map((item) => item.id));
    const extraRows = Array.from(bloggerPerformance.values())
      .filter((blogger) => !YAASBAE_BLOGGERS.some((item) => item.id === blogger.id) && !manualIds.has(blogger.id));
    return [...baseRows, ...manualRows, ...extraRows]
      .filter((blogger) => !query || [
        blogger.name,
        blogger.phone,
        blogger.instagram,
        blogger.city,
      ].some((value) => value?.toLowerCase().includes(query)))
      .sort((a, b) => b.total - a.total || b.crmOrders - a.crmOrders || b.sourceOrders - a.sourceOrders || a.name.localeCompare(b.name, 'ru'));
  }, [bloggerPerformance, bloggerSearch, handbookBloggers]);

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
      <div className="tg-card overflow-hidden">
        <div className="p-4 border-b border-zinc-100 flex flex-col lg:flex-row lg:items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-zinc-900 text-white flex items-center justify-center shadow-sm">
              <Users className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-[12px] font-black text-zinc-900 uppercase tracking-[0.22em]">Рейтинг блогеров</h3>
              <p className="text-[9px] text-zinc-400 font-bold uppercase tracking-widest">
                {YAASBAE_BLOGGERS.length} из Excel · сортировка по сумме заказов в CRM
              </p>
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
                <th className="px-4 py-3 border-none text-center">Заказы CRM</th>
                <th className="px-4 py-3 border-none text-right">Сумма</th>
                <th className="px-4 py-3 border-none hidden xl:table-cell">ID заказов</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-50">
              {filteredExcelBloggers.slice(0, 220).map((blogger, index) => (
                <tr key={blogger.id} className="hover:bg-zinc-50/70 transition-colors">
                  <td className="px-4 py-3 text-[10px] text-zinc-300 font-black">{index + 1}</td>
                  <td className="px-4 py-3 min-w-[220px]">
                    <p className="text-[12px] font-black text-zinc-900 leading-tight">{blogger.name || 'Без имени'}</p>
                    <p className="mt-1 text-[9px] font-semibold text-zinc-400">
                      В Excel заказов: {blogger.sourceOrders || 0}
                    </p>
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
                    <span className={cn(
                      'inline-flex min-w-9 justify-center rounded-lg px-2 py-1 text-[11px] font-black border',
                      blogger.crmOrders > 0 ? 'bg-emerald-50 text-emerald-600 border-emerald-100' : 'bg-zinc-50 text-zinc-300 border-zinc-100'
                    )}>
                      {blogger.crmOrders}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <span className={cn(
                      'text-[12px] font-black tabular-nums',
                      blogger.total > 0 ? 'text-emerald-600' : 'text-zinc-300'
                    )}>
                      {formatCurrency(blogger.total)}
                    </span>
                  </td>
                  <td className="px-4 py-3 hidden xl:table-cell">
                    <div className="flex flex-wrap gap-1">
                      {blogger.orderIds.slice(0, 6).map((id) => (
                        <span key={id} className="text-[8px] px-1.5 py-0.5 bg-zinc-50 text-zinc-400 rounded border border-zinc-100 font-black">#{id}</span>
                      ))}
                      {blogger.orderIds.length > 6 && (
                        <span className="text-[8px] px-1.5 py-0.5 bg-zinc-900 text-white rounded font-black">+{blogger.orderIds.length - 6}</span>
                      )}
                      {!blogger.orderIds.length && <span className="text-[9px] font-semibold text-zinc-300">—</span>}
                    </div>
                  </td>
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
              {allBloggerOptions.map((blogger) => (
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
            <select
              value={calendarDraft.note}
              onChange={(e) => setCalendarDraft((prev) => ({ ...prev, note: e.target.value }))}
              className="tg-input py-2.5 text-[11px]"
            >
              <option value="">Что отмечает</option>
              {handbookProducts.map((product) => (
                <option key={product} value={product}>{product}</option>
              ))}
            </select>
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

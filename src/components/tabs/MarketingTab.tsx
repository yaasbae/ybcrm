import React, { useMemo, useState, useEffect } from 'react';
import {
  Calendar, Search, Plus, Trash2, CheckCircle, Image, Video, Users, Truck, Clock3, ArrowDown
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
  orderId?: string;
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

type ManualBloggerProfile = {
  id: string;
  name: string;
  phone: string;
  instagram: string;
  city: string;
  createdAt?: string;
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
  const [manualBloggers, setManualBloggers] = useState<ManualBloggerProfile[]>([]);
  const [showAddBlogger, setShowAddBlogger] = useState(false);
  const [newBloggerDraft, setNewBloggerDraft] = useState({ name: '', phone: '', instagram: '', city: '' });
  const [calendarEvents, setCalendarEvents] = useState<BloggerCalendarEvent[]>([]);
  const [calendarDraft, setCalendarDraft] = useState({
    date: `${selectedMonth}-01`,
    bloggerId: YAASBAE_BLOGGERS[0]?.id || '',
    postType: 'Фото' as BloggerPostType,
    note: '',
    orderId: undefined as string | undefined,
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
    const unsubManualBloggers = onSnapshot(doc(db, 'settings', 'marketingBloggers'), (snap) => {
      const bloggers = snap.exists() ? snap.data().bloggers : [];
      setManualBloggers(Array.isArray(bloggers) ? bloggers.filter((item) => item?.name) : []);
    });

    return () => {
      unsubCalendar();
      unsubHandbook();
      unsubManualBloggers();
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

  const addManualBlogger = async () => {
    const name = newBloggerDraft.name.trim();
    if (!name) return;

    const normalizedName = normalizeBloggerName(name);
    const profile: ManualBloggerProfile = {
      id: `manual-${normalizedName || Date.now()}`,
      name,
      phone: newBloggerDraft.phone.trim(),
      instagram: newBloggerDraft.instagram.trim(),
      city: newBloggerDraft.city.trim(),
      createdAt: new Date().toISOString(),
    };
    const withoutDuplicate = manualBloggers.filter((item) => normalizeBloggerName(item.name) !== normalizedName);
    const nextManualBloggers = [...withoutDuplicate, profile].sort((a, b) => a.name.localeCompare(b.name, 'ru'));
    const nextHandbookBloggers = Array.from(new Set([...handbookBloggers, name].map((item) => item.trim()).filter(Boolean))).sort((a, b) => a.localeCompare(b, 'ru'));

    await setDoc(doc(db, 'settings', 'marketingBloggers'), { bloggers: nextManualBloggers }, { merge: true });
    await setDoc(doc(db, 'settings', 'handbook'), { bloggers: nextHandbookBloggers }, { merge: true });
    setNewBloggerDraft({ name: '', phone: '', instagram: '', city: '' });
    setShowAddBlogger(false);
  };

  const allBloggerOptions = useMemo(() => {
    const options = YAASBAE_BLOGGERS.map((blogger) => ({ id: blogger.id, name: blogger.name }));
    manualBloggers.forEach((blogger) => {
      const key = normalizeBloggerName(blogger.name);
      if (!key || options.some((item) => normalizeBloggerName(item.name) === key)) return;
      options.push({ id: blogger.id, name: blogger.name });
    });
    handbookBloggers.forEach((name) => {
      const key = normalizeBloggerName(name);
      if (!key || options.some((item) => normalizeBloggerName(item.name) === key)) return;
      options.push({ id: `handbook-${key}`, name });
    });
    data.forEach((order) => {
      const name = String(order.blogger || (order.isBlogger ? order.clientName : '') || '').trim();
      const key = normalizeBloggerName(name);
      if (!key || options.some((item) => normalizeBloggerName(item.name) === key)) return;
      options.push({ id: `order-${key}`, name });
    });
    return options;
  }, [data, handbookBloggers, manualBloggers]);

  const bloggerOrders = useMemo(() => {
    return data
      .filter(order => order.orderKind
        ? order.orderKind === 'blogger'
        : Boolean(order.isBlogger) || String(order.source || '').toLowerCase().includes('блогер'))
      .filter(order => {
        const status = String(order.status || '').toLowerCase();
        return !status.includes('возврат') && !status.includes('вернули платёж') && !status.includes('отмена');
      })
      .map(order => {
        const bloggerName = String(order.blogger || order.clientName || '').trim() || 'Блогер не указан';
        const scheduledEvent = calendarEvents.find(event => (
          event.orderId === order.orderId
          || (!event.orderId && normalizeBloggerName(event.bloggerName) === normalizeBloggerName(bloggerName))
        ));
        const status = String(order.status || 'Новый');
        const received = ['получен', 'доставлен'].includes(status.trim().toLowerCase());
        return { order, bloggerName, scheduledEvent, received };
      })
      .sort((a, b) => {
        if (a.received !== b.received) return a.received ? 1 : -1;
        if (Boolean(a.scheduledEvent) !== Boolean(b.scheduledEvent)) return a.scheduledEvent ? 1 : -1;
        return b.order.date.getTime() - a.order.date.getTime();
      });
  }, [calendarEvents, data]);

  const scheduleBloggerOrder = (order: OrderData, bloggerName: string) => {
    const blogger = allBloggerOptions.find(item => normalizeBloggerName(item.name) === normalizeBloggerName(bloggerName));
    const today = new Date();
    const todayKey = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    setCalendarDraft(prev => ({
      ...prev,
      date: todayKey.startsWith(selectedMonth) ? todayKey : `${selectedMonth}-01`,
      bloggerId: blogger?.id || prev.bloggerId,
      note: String(order.item || '').trim(),
      orderId: order.orderId,
    }));
    document.getElementById('blogger-calendar')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

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
        orderId: calendarDraft.orderId,
      },
    ].sort((a, b) => a.date.localeCompare(b.date));

    await saveCalendarEvents(nextEvents);
    setCalendarDraft((prev) => ({ ...prev, note: '', orderId: undefined }));
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
    const savedRows: BloggerPerformance[] = manualBloggers
      .filter((blogger) => {
        const key = normalizeBloggerName(blogger.name);
        return key && !baseRows.some((item) => normalizeBloggerName(item.name) === key);
      })
      .map((blogger) => {
        const performance = Array.from(bloggerPerformance.values())
          .find((item) => normalizeBloggerName(item.name) === normalizeBloggerName(blogger.name));
        return {
          id: blogger.id,
          name: blogger.name,
          phone: blogger.phone,
          instagram: blogger.instagram,
          city: blogger.city,
          sourceOrders: 0,
          crmOrders: performance?.crmOrders || 0,
          total: performance?.total || 0,
          orderIds: performance?.orderIds || [],
        };
      });
    const manualRows: BloggerPerformance[] = handbookBloggers
      .filter((name) => {
        const key = normalizeBloggerName(name);
        return key
          && !baseRows.some((item) => normalizeBloggerName(item.name) === key)
          && !savedRows.some((item) => normalizeBloggerName(item.name) === key);
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
    const manualIds = new Set([...savedRows, ...manualRows].map((item) => item.id));
    const extraRows = Array.from(bloggerPerformance.values())
      .filter((blogger) => !YAASBAE_BLOGGERS.some((item) => item.id === blogger.id) && !manualIds.has(blogger.id));
    return [...baseRows, ...savedRows, ...manualRows, ...extraRows]
      .filter((blogger) => !query || [
        blogger.name,
        blogger.phone,
        blogger.instagram,
        blogger.city,
      ].some((value) => value?.toLowerCase().includes(query)))
      .sort((a, b) => b.total - a.total || b.crmOrders - a.crmOrders || b.sourceOrders - a.sourceOrders || a.name.localeCompare(b.name, 'ru'));
  }, [bloggerPerformance, bloggerSearch, handbookBloggers, manualBloggers]);

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
        <div className="flex flex-col gap-3 border-b border-zinc-100 p-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-violet-100 text-violet-700">
              <Truck className="h-4 w-4" />
            </div>
            <div>
              <h3 className="text-[12px] font-black uppercase tracking-[0.22em] text-zinc-900">Заказы и будущие отметки</h3>
              <p className="text-[9px] font-bold uppercase tracking-widest text-zinc-400">Блогеры, которым отправили товар · получение · план публикации</p>
            </div>
          </div>
          <div className="flex gap-2 text-[10px] font-black uppercase tracking-widest">
            <span className="rounded-lg bg-amber-50 px-3 py-2 text-amber-700">Едут: {bloggerOrders.filter(item => !item.received).length}</span>
            <span className="rounded-lg bg-violet-50 px-3 py-2 text-violet-700">Без даты: {bloggerOrders.filter(item => item.received && !item.scheduledEvent).length}</span>
          </div>
        </div>
        <div className="divide-y divide-zinc-100">
          {bloggerOrders.slice(0, 100).map(({ order, bloggerName, received, scheduledEvent }) => (
            <div key={order.orderId} className="grid gap-3 p-4 md:grid-cols-[100px_minmax(180px,1fr)_minmax(180px,1fr)_160px_170px] md:items-center">
              <div>
                <p className="text-[9px] font-black uppercase tracking-widest text-zinc-400">Заказ</p>
                <p className="mt-1 text-[12px] font-black text-zinc-900">#{order.orderId}</p>
              </div>
              <div className="min-w-0">
                <p className="truncate text-[12px] font-black text-zinc-900">{bloggerName}</p>
                <p className="mt-1 truncate text-[10px] font-semibold text-zinc-400">{order.clientInsta ? `@${String(order.clientInsta).replace(/^@/, '')}` : order.clientPhone || 'Контакт не указан'}</p>
              </div>
              <div className="min-w-0">
                <p className="truncate text-[11px] font-bold text-zinc-700">{order.item || 'Изделие не указано'}</p>
                <p className="mt-1 text-[9px] font-semibold text-zinc-400">Доставка {formatCurrency(Number(order.deliveryPrice) || 0)} · {order.manager || 'менеджер не указан'}</p>
              </div>
              <span className={cn(
                'inline-flex w-fit items-center gap-1.5 rounded-lg px-2.5 py-2 text-[9px] font-black uppercase tracking-wider',
                received ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'
              )}>
                {received ? <CheckCircle className="h-3.5 w-3.5" /> : <Clock3 className="h-3.5 w-3.5" />}
                {received ? 'Товар получен' : order.status || 'Ожидает товар'}
              </span>
              {scheduledEvent ? (
                <div className="rounded-lg border border-violet-100 bg-violet-50 px-3 py-2">
                  <p className="text-[9px] font-black uppercase tracking-widest text-violet-700">Отметка {scheduledEvent.date}</p>
                  <p className="mt-1 text-[9px] font-semibold text-violet-500">{scheduledEvent.postType}{scheduledEvent.done ? ' · выполнено' : ''}</p>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => scheduleBloggerOrder(order, bloggerName)}
                  className="inline-flex h-9 items-center justify-center gap-2 rounded-lg bg-zinc-900 px-3 text-[9px] font-black uppercase tracking-widest text-white hover:bg-black"
                >
                  Назначить дату <ArrowDown className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          ))}
          {!bloggerOrders.length && (
            <div className="p-8 text-center text-[11px] font-semibold text-zinc-400">Блогерские заказы появятся здесь сразу после создания в разделе «Заказы».</div>
          )}
        </div>
      </div>

      <div className="tg-card overflow-hidden">
        <div className="p-4 border-b border-zinc-100 flex flex-col lg:flex-row lg:items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-zinc-900 text-white flex items-center justify-center shadow-sm">
              <Users className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-[12px] font-black text-zinc-900 uppercase tracking-[0.22em]">Рейтинг и база блогеров</h3>
              <p className="text-[9px] text-zinc-400 font-bold uppercase tracking-widest">
                {YAASBAE_BLOGGERS.length} из Excel · сортировка по сумме заказов в CRM
              </p>
            </div>
          </div>
          <div className="flex w-full flex-col gap-2 sm:flex-row lg:w-auto">
            <button
              type="button"
              onClick={() => setShowAddBlogger((value) => !value)}
              className="inline-flex h-11 shrink-0 items-center justify-center gap-2 rounded-xl bg-zinc-900 px-4 text-[10px] font-black uppercase tracking-widest text-white shadow-sm transition-colors hover:bg-black"
            >
              <Plus className="h-4 w-4" />
              Новый блогер
            </button>
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
        </div>
        {showAddBlogger && (
          <div className="grid gap-3 border-b border-zinc-100 bg-zinc-50/40 p-4 md:grid-cols-[minmax(0,1.4fr)_160px_190px_160px_140px]">
            <input
              type="text"
              placeholder="ФИО блогера"
              value={newBloggerDraft.name}
              onChange={(e) => setNewBloggerDraft((prev) => ({ ...prev, name: e.target.value }))}
              className="h-11 rounded-xl border border-zinc-200 bg-white px-4 text-[12px] font-bold text-zinc-900 outline-none focus:ring-2 focus:ring-zinc-200"
            />
            <input
              type="text"
              placeholder="Телефон"
              value={newBloggerDraft.phone}
              onChange={(e) => setNewBloggerDraft((prev) => ({ ...prev, phone: e.target.value }))}
              className="h-11 rounded-xl border border-zinc-200 bg-white px-4 text-[12px] font-bold text-zinc-900 outline-none focus:ring-2 focus:ring-zinc-200"
            />
            <input
              type="text"
              placeholder="Instagram"
              value={newBloggerDraft.instagram}
              onChange={(e) => setNewBloggerDraft((prev) => ({ ...prev, instagram: e.target.value }))}
              className="h-11 rounded-xl border border-zinc-200 bg-white px-4 text-[12px] font-bold text-zinc-900 outline-none focus:ring-2 focus:ring-zinc-200"
            />
            <input
              type="text"
              placeholder="Город"
              value={newBloggerDraft.city}
              onChange={(e) => setNewBloggerDraft((prev) => ({ ...prev, city: e.target.value }))}
              className="h-11 rounded-xl border border-zinc-200 bg-white px-4 text-[12px] font-bold text-zinc-900 outline-none focus:ring-2 focus:ring-zinc-200"
            />
            <button
              type="button"
              onClick={addManualBlogger}
              disabled={!newBloggerDraft.name.trim()}
              className={cn(
                'h-11 rounded-xl px-4 text-[10px] font-black uppercase tracking-widest transition-colors',
                newBloggerDraft.name.trim()
                  ? 'bg-blue-600 text-white hover:bg-blue-700'
                  : 'cursor-not-allowed bg-zinc-100 text-zinc-300'
              )}
            >
              Добавить
            </button>
          </div>
        )}
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

      <div id="blogger-calendar" className="tg-card scroll-mt-4 overflow-hidden">
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

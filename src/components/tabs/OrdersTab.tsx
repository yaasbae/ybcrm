import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  PieChart, Pie, Cell, ResponsiveContainer, Tooltip
} from 'recharts';
import {
  TrendingUp, Users, ShoppingBag,
  Calendar, Award, AlertCircle, Search, Plus,
  X, MapPin, Star, RefreshCcw,
  Tag, Trash2, Phone, UserCircle, ChevronRight, QrCode
} from 'lucide-react';
import { formatCurrency, cn } from '../../lib/utils';
import { motion, AnimatePresence } from 'motion/react';
import { OrderData } from '../AnalyticsDashboard';
import { db } from '../../firebase';
import { collection, getDocs, orderBy, query } from 'firebase/firestore';

const STATUS_OPTIONS = ['Новый', 'В работе', 'Оплачен', 'Отгружен', 'Доставлен', 'Возврат', 'Отмена', 'Обмен'];
const DELIVERY_OPTIONS = ['СДЭК', 'Почта РФ', 'Боксберри', 'Самовывоз', 'Курьер', 'DBS'];
const SOURCE_OPTIONS = ['Instagram', 'WhatsApp', 'ТГ', 'Блогер', 'Контент', 'Сарафан', 'Повторный'];

const OrderRow = React.memo(({
  order,
  updateOrderData,
  onDelete,
  handbookSources,
  handbookDeliveries,
  handbookSizes,
  handbookColors,
  handbookHeights,
  handbookLabels,
  handbookManagers,
  handbookBloggers,
}: {
  order: OrderData;
  updateOrderData: (id: string, field: string, value: any) => void;
  onDelete: (id: string) => void;
  handbookSources: string[];
  handbookDeliveries: string[];
  handbookSizes: string[];
  handbookColors: string[];
  handbookHeights: string[];
  handbookLabels: string[];
  handbookManagers: string[];
  handbookBloggers: string[];
}) => {
  const nameParts = (order.clientName || '').split(/\s+/);
  const surname = nameParts[0] || '';
  const otherNames = nameParts.slice(1).join(' ');

  const statusColor =
    order.status?.toLowerCase().includes('оплачен') ? 'text-emerald-700 bg-emerald-50 border-emerald-100' :
    order.status?.toLowerCase().includes('отгружен') || order.status?.toLowerCase().includes('доставлен') ? 'text-blue-700 bg-blue-50 border-blue-100' :
    order.status?.toLowerCase().includes('возврат') || order.status?.toLowerCase().includes('отмена') ? 'text-red-600 bg-red-50 border-red-100' :
    'text-zinc-500 bg-zinc-50 border-zinc-100';

  const fieldInput = (label: string, value: string, list: string, onChange: (v: string) => void) => (
    <div key={label} className="flex flex-col gap-0.5 min-w-[72px]">
      <span className="text-[8px] font-black text-zinc-300 uppercase tracking-wider leading-none px-1">{label}</span>
      <input
        type="text"
        list={list}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="—"
        className="bg-zinc-50 border border-zinc-100 rounded-md px-2 py-1 text-[10px] text-zinc-700 font-medium focus:bg-white focus:border-blue-200 focus:ring-1 focus:ring-blue-100 outline-none w-full"
      />
    </div>
  );

  return (
    <tr className={cn(
      "group border-b border-zinc-100 transition-colors",
      order.isOverdue && !order.isShipped ? "bg-red-50/40" : "hover:bg-zinc-50/60"
    )}>

      {/* Дата / ID */}
      <td className="px-3 py-3 align-top w-[90px]">
        <input
          type="text"
          value={order.date.toLocaleDateString('ru-RU')}
          onChange={(e) => {
            const parts = e.target.value.split('.');
            if (parts.length === 3) {
              const d = new Date(parseInt(parts[2]), parseInt(parts[1]) - 1, parseInt(parts[0]));
              if (!isNaN(d.getTime())) updateOrderData(order.orderId, 'date', d);
            }
          }}
          className="bg-transparent text-[9px] text-zinc-400 font-semibold focus:bg-white focus:ring-1 focus:ring-blue-100 rounded px-1 outline-none w-full mb-1"
        />
        <div className="flex items-center gap-1.5">
          {order.isFirebase && (
            <div title="Заказ из CRM" className="w-1.5 h-1.5 rounded-full bg-blue-500 shrink-0" />
          )}
          <input
            type="text"
            value={order.orderId}
            onChange={(e) => updateOrderData(order.orderId, 'orderId', e.target.value)}
            className="bg-transparent text-[11px] font-black text-zinc-900 tracking-tight focus:bg-white focus:ring-1 focus:ring-blue-100 rounded px-1 outline-none w-full"
          />
        </div>
      </td>

      {/* Клиент */}
      <td className="px-2 py-3 align-top w-[150px]">
        <input
          type="text"
          value={surname}
          onChange={(e) => {
            const n = [e.target.value, otherNames].filter(Boolean).join(' ');
            updateOrderData(order.orderId, 'clientName', n);
          }}
          placeholder="ФАМИЛИЯ"
          className="bg-transparent text-[11px] font-black text-zinc-900 uppercase tracking-tight focus:bg-white focus:ring-1 focus:ring-blue-100 rounded px-1 outline-none w-full leading-tight"
        />
        <input
          type="text"
          value={otherNames}
          onChange={(e) => {
            const n = [surname, e.target.value].filter(Boolean).join(' ');
            updateOrderData(order.orderId, 'clientName', n);
          }}
          placeholder="Имя Отчество"
          className="bg-transparent text-[9px] font-medium text-zinc-500 focus:bg-white focus:ring-1 focus:ring-blue-100 rounded px-1 outline-none w-full mt-0.5"
        />
        <input
          type="text"
          value={order.clientPhone}
          onChange={(e) => updateOrderData(order.orderId, 'clientPhone', e.target.value.replace(/[^0-9]/g, ''))}
          placeholder="телефон"
          className="bg-transparent font-mono text-[9px] text-zinc-400 focus:text-zinc-900 focus:bg-white focus:ring-1 focus:ring-blue-100 rounded px-1 outline-none w-full mt-1"
        />
      </td>

      {/* Статус / Доставка */}
      <td className="px-2 py-3 align-top w-[160px]">
        <select
          value={order.status}
          onChange={(e) => updateOrderData(order.orderId, 'status', e.target.value)}
          className={cn(
            "w-full text-[10px] font-black px-2 py-1.5 rounded-lg border uppercase tracking-wide outline-none cursor-pointer mb-2",
            statusColor
          )}
        >
          {STATUS_OPTIONS.map(opt => <option key={opt} value={opt}>{opt}</option>)}
        </select>
        <div className="flex gap-1 mb-2">
          <select
            value={order.source}
            onChange={(e) => updateOrderData(order.orderId, 'source', e.target.value)}
            className="flex-1 bg-amber-50 border border-amber-100 text-[9px] font-bold text-amber-700 outline-none cursor-pointer rounded-md px-1 py-1 truncate"
          >
            <option value="">Источник</option>
            {(handbookSources.length ? handbookSources : SOURCE_OPTIONS).map(opt => <option key={opt} value={opt}>{opt}</option>)}
          </select>
          <select
            value={order.deliveryMethod}
            onChange={(e) => updateOrderData(order.orderId, 'deliveryMethod', e.target.value)}
            className="flex-1 bg-blue-50 border border-blue-100 text-[9px] font-bold text-blue-700 outline-none cursor-pointer rounded-md px-1 py-1 truncate"
          >
            <option value="">Доставка</option>
            {(handbookDeliveries.length ? handbookDeliveries : DELIVERY_OPTIONS).map(opt => <option key={opt} value={opt}>{opt}</option>)}
          </select>
        </div>
        <div className="flex gap-1">
          <button
            onClick={() => updateOrderData(order.orderId, 'status', 'Оплачен')}
            className={cn(
              "flex-1 text-[8px] font-black py-1 rounded-md border transition-all uppercase tracking-tight",
              order.status === 'Оплачен'
                ? "bg-emerald-500 border-emerald-500 text-white"
                : "bg-white border-emerald-300 text-emerald-600 hover:bg-emerald-50"
            )}
          >
            ✓ Оплачен
          </button>
          <button
            onClick={() => updateOrderData(order.orderId, 'isRecommended', order.isRecommended ? null : true)}
            className={cn(
              "flex-1 text-[8px] font-black py-1 rounded-md border transition-all uppercase tracking-tight",
              order.isRecommended
                ? "bg-zinc-800 border-zinc-800 text-white"
                : "bg-white border-zinc-200 text-zinc-500 hover:bg-zinc-50"
            )}
          >
            ★ Реком.
          </button>
        </div>
      </td>

      {/* Финансы */}
      <td className="px-3 py-3 align-top w-[120px] text-right">
        <div className="space-y-1.5">
          <div>
            <div className="text-[8px] font-bold text-zinc-300 uppercase tracking-widest mb-0.5">Цена</div>
            <input
              type="number"
              value={order.revenue ?? ''}
              onChange={(e) => updateOrderData(order.orderId, 'revenue', parseFloat(e.target.value) || 0)}
              className="w-full bg-transparent text-[13px] font-black text-zinc-900 text-right focus:bg-white focus:ring-1 focus:ring-blue-100 rounded px-1 outline-none"
            />
          </div>
          <div>
            <div className="text-[8px] font-bold text-zinc-300 uppercase tracking-widest mb-0.5">Доставка</div>
            <input
              type="number"
              value={order.deliveryPrice ?? ''}
              onChange={(e) => updateOrderData(order.orderId, 'deliveryPrice', parseFloat(e.target.value) || 0)}
              className="w-full bg-transparent text-[11px] font-semibold text-zinc-500 text-right focus:bg-white focus:ring-1 focus:ring-blue-100 rounded px-1 outline-none"
            />
          </div>
          <div className="border-t border-zinc-100 pt-1.5">
            <div className="text-[8px] font-bold text-emerald-400 uppercase tracking-widest mb-0.5">Оплачено</div>
            <input
              type="number"
              value={order.paidAmount ?? ''}
              onChange={(e) => updateOrderData(order.orderId, 'paidAmount', parseFloat(e.target.value) || 0)}
              className="w-full bg-transparent text-[13px] font-black text-emerald-600 text-right focus:bg-white focus:ring-1 focus:ring-blue-100 rounded px-1 outline-none"
            />
          </div>
        </div>
      </td>

      {/* Изделие */}
      <td className="px-3 py-3 align-top">
        <input
          type="text"
          list="product-list"
          value={order.item}
          onChange={(e) => updateOrderData(order.orderId, 'item', e.target.value)}
          placeholder="Название изделия..."
          className="w-full bg-transparent text-[12px] font-bold text-zinc-900 focus:bg-white focus:ring-1 focus:ring-blue-100 rounded-md px-2 py-1 outline-none mb-2 border border-transparent hover:border-zinc-100"
        />
        <div className="flex gap-2 mb-2">
          {fieldInput('Цвет',   order.rawRow?.[1] || '', 'color-list',  (v) => updateOrderData(order.orderId, 'rawRow[1]', v))}
          {fieldInput('Размер', order.rawRow?.[8] || '', 'size-list',   (v) => updateOrderData(order.orderId, 'rawRow[8]', v))}
          {fieldInput('Рост',   order.height  || '',     'height-list', (v) => updateOrderData(order.orderId, 'height', v))}
        </div>
        <div className="flex gap-2">
          {fieldInput('Метка',    order.label   || '', 'label-list',   (v) => updateOrderData(order.orderId, 'label', v))}
          {fieldInput('Менеджер', order.manager || '', 'manager-list', (v) => updateOrderData(order.orderId, 'manager', v))}
          {fieldInput('Блогер',   order.blogger || '', 'blogger-list', (v) => updateOrderData(order.orderId, 'blogger', v))}
        </div>
      </td>

      {/* Срок / Удалить */}
      <td className="px-3 py-3 align-top w-[60px]">
        <div className="flex flex-col items-center gap-1">
          <span className={cn(
            "text-[10px] font-black px-2 py-1 rounded-lg w-full text-center",
            order.isOverdue && !order.isShipped
              ? "bg-red-500 text-white animate-pulse shadow-sm shadow-red-200"
              : order.isShipped
                ? "bg-zinc-100 text-zinc-400"
                : "bg-blue-50 text-blue-600 border border-blue-100"
          )}>
            {order.deadlineDate.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' })}
          </span>
          {order.isOverdue && !order.isShipped && (
            <span className="text-[7px] font-black text-red-500 uppercase tracking-tight">просрочен</span>
          )}
          {order.paymentUrl && (
            <a
              href={`/pay/${order.orderId}`}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-1 w-full flex items-center justify-center gap-0.5 py-1 rounded-md border border-violet-200 bg-violet-50 text-violet-500 hover:bg-violet-500 hover:text-white hover:border-violet-500 transition-all"
              title="Открыть страницу оплаты"
            >
              <QrCode size={10} />
            </a>
          )}
          {order.isFirebase && (
            <button
              onClick={() => {
                if (window.confirm(`Удалить заказ ${order.orderId}?`)) onDelete(order.orderId);
              }}
              className="mt-1 w-full flex items-center justify-center gap-0.5 py-1 rounded-md border border-red-100 bg-red-50 text-red-400 hover:bg-red-500 hover:text-white hover:border-red-500 transition-all"
              title="Удалить заказ"
            >
              <Trash2 size={10} />
            </button>
          )}
        </div>
      </td>

    </tr>
  );
});

const OrderCard = React.memo(({
  order,
  updateOrderData
}: {
  order: OrderData;
  updateOrderData: (id: string, field: string, value: any) => void;
}) => {
  return (
    <div className={cn(
      "p-4 flex flex-col gap-3 transition-colors",
      order.isOverdue && !order.isShipped ? "bg-red-50/30" : "bg-white"
    )}>
      {/* Card Header */}
      <div className="flex items-start justify-between">
        <div className="flex flex-col">
          <div className="flex items-center gap-2">
            <span className="text-[12px] font-black text-zinc-900 tracking-tighter uppercase flex items-center gap-1.5">
              {order.isFirebase && <div title="Заказ из БД" className="w-2 h-2 rounded-full bg-blue-500 animate-pulse shrink-0" />}
              {order.orderId}
            </span>
            <span className={cn(
              "text-[8px] font-black px-1.5 py-0.5 rounded uppercase",
              order.status?.toLowerCase().includes('оплачен') ? "bg-emerald-500 text-white shadow-sm shadow-emerald-500/20" :
              order.status?.toLowerCase().includes('возврат') ? "bg-red-500 text-white shadow-sm shadow-red-500/20" :
              "bg-zinc-100 text-zinc-500"
            )}>
              {order.status}
            </span>
          </div>
          <p className="text-[9px] font-medium text-zinc-400 mt-0.5">{order.date.toLocaleDateString('ru-RU')}</p>
        </div>
        <div className="flex flex-col items-end">
          <p className="text-[11px] font-black text-zinc-900">{formatCurrency(order.revenue)}</p>
          <div className="flex items-center gap-1.5 mt-0.5">
            <p className="text-[8px] font-bold text-zinc-400 uppercase tracking-tighter">Срок:</p>
            <p className={cn(
              "text-[9px] font-black",
              order.isOverdue && !order.isShipped ? "text-red-500" : "text-blue-500"
            )}>
              {order.deadlineDate.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' })}
            </p>
          </div>
        </div>
      </div>

      {/* Client Info Mobile */}
      <div className="bg-zinc-50/50 p-2.5 rounded-xl border border-zinc-100/50 space-y-1.5">
        <div className="flex items-center gap-2">
          <Users className="w-3 h-3 text-zinc-400" />
          <p className="text-[10px] font-black text-zinc-900 uppercase tracking-tight truncate flex-1">{order.clientName}</p>
        </div>
        <div className="flex items-center gap-2">
          <Phone className="w-2.5 h-2.5 text-zinc-300" />
          <p className="text-[9px] font-mono text-zinc-400">+{order.clientPhone}</p>
        </div>
      </div>

      {/* Product Details Mobile */}
      <div className="space-y-1.5">
        <div className="flex items-center gap-2">
          <ShoppingBag className="w-3 h-3 text-blue-500" />
          <p className="text-[9px] font-bold text-zinc-700 italic truncate flex-1">{order.item}</p>
        </div>
        <div className="flex flex-wrap gap-1">
          {([1, 12] as number[]).map(idx => (
            <div key={idx} className="px-1.5 py-0.5 bg-white border border-zinc-100 rounded text-[8px] font-bold text-zinc-500 uppercase tracking-tighter">
              {order.rawRow?.[idx]}
            </div>
          ))}
          <div className="px-1.5 py-0.5 bg-amber-50 border border-amber-100 rounded text-[8px] font-black text-amber-600 uppercase tracking-tighter">
            {order.source}
          </div>
          <div className="px-1.5 py-0.5 bg-blue-50 border border-blue-100 rounded text-[8px] font-black text-blue-600 uppercase tracking-tighter">
            {order.deliveryMethod}
          </div>
        </div>
      </div>

      {/* Quick Actions Mobile */}
      <div className="flex items-center gap-2 pt-1">
        <button
          onClick={() => updateOrderData(order.orderId, 'status', 'Оплачен')}
          className={cn(
            "flex-1 py-2 rounded-lg text-[8px] font-black uppercase tracking-widest border transition-all",
            order.status === 'Оплачен' ? "bg-emerald-500 border-emerald-600 text-white" : "bg-white border-zinc-200 text-zinc-400"
          )}
        >
          Оплатить
        </button>
        <button
          onClick={() => updateOrderData(order.orderId, 'isShipped', !order.isShipped)}
          className={cn(
            "flex-1 py-2 rounded-lg text-[8px] font-black uppercase tracking-widest border transition-all",
            order.isShipped ? "bg-zinc-800 border-black text-white" : "bg-white border-zinc-200 text-zinc-400"
          )}
        >
          Отгрузить
        </button>
      </div>
    </div>
  );
});

interface OrdersTabProps {
  data: OrderData[];
  stats: any;
  filteredOrders: OrderData[];
  pagedOrders: OrderData[];
  displayCount: number;
  setDisplayCount: (n: number) => void;
  ordersFilterMonth: number;
  setOrdersFilterMonth: (n: number) => void;
  slaFilterMonth: number;
  setSlaFilterMonth: (n: number) => void;
  filteredSlaStats: any;
  searchTerm: string;
  setSearchTerm: (s: string) => void;
  updateOrderData: (id: string, field: string, value: any) => void;
  deleteOrder: (id: string) => void;
  newOrder: Partial<OrderData>;
  setNewOrder: (o: Partial<OrderData>) => void;
  handleCreateOrder: () => void;
  handbookProducts: string[];
  handbookColors: string[];
  handbookSizes: string[];
  handbookHeights: string[];
  handbookCompositions: string[];
  handbookSources: string[];
  handbookLabels: string[];
  handbookDeliveries: string[];
  handbookManagers: string[];
  handbookBloggers: string[];
  exportToCsv: () => void;
  refreshing: boolean;
  lastUpdated: Date | null;
  autoRefresh: boolean;
  setAutoRefresh: (v: boolean) => void;
  fetchData: (isManual?: boolean) => void;
}

export const OrdersTab: React.FC<OrdersTabProps> = ({
  data,
  stats,
  filteredOrders,
  pagedOrders,
  displayCount,
  setDisplayCount,
  ordersFilterMonth,
  setOrdersFilterMonth,
  slaFilterMonth,
  setSlaFilterMonth,
  filteredSlaStats,
  searchTerm,
  setSearchTerm,
  updateOrderData,
  deleteOrder,
  newOrder,
  setNewOrder,
  handleCreateOrder,
  handbookProducts,
  handbookColors,
  handbookSizes,
  handbookHeights,
  handbookCompositions,
  handbookSources,
  handbookLabels,
  handbookDeliveries,
  handbookManagers,
  handbookBloggers,
  exportToCsv,
  refreshing,
  lastUpdated,
  autoRefresh,
  setAutoRefresh,
  fetchData,
}) => {
  const [contacts, setContacts] = useState<any[]>([]);
  const [clientQuery, setClientQuery] = useState('');
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [phoneQuery, setPhoneQuery] = useState('');
  const [showPhoneSuggestions, setShowPhoneSuggestions] = useState(false);
  const suggestionsRef = useRef<HTMLDivElement>(null);
  const phoneSuggestionsRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    getDocs(query(collection(db, 'contacts'), orderBy('totalSpent', 'desc')))
      .then(snap => setContacts(snap.docs.map(d => d.data())))
      .catch(() => {});
  }, []);

  const clientSuggestions = useMemo(() => {
    if (!clientQuery || clientQuery.length < 2) return [];
    const q = clientQuery.toLowerCase();
    return contacts.filter(c =>
      (c.fullName || '').toLowerCase().includes(q) ||
      (c.phone || '').includes(q)
    ).slice(0, 8);
  }, [contacts, clientQuery]);

  const phoneSuggestions = useMemo(() => {
    if (!phoneQuery || phoneQuery.length < 2) return [];
    return contacts.filter(c =>
      (c.phone || '').includes(phoneQuery)
    ).slice(0, 8);
  }, [contacts, phoneQuery]);

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (suggestionsRef.current && !suggestionsRef.current.contains(e.target as Node)) {
        setShowSuggestions(false);
      }
      if (phoneSuggestionsRef.current && !phoneSuggestionsRef.current.contains(e.target as Node)) {
        setShowPhoneSuggestions(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  const selectClient = (client: any) => {
    setNewOrder({
      ...newOrder,
      clientName: client.fullName || client.name || '',
      clientPhone: client.phone || '',
    });
    setClientQuery(client.fullName || client.name || '');
    setPhoneQuery(client.phone || '');
    setShowSuggestions(false);
    setShowPhoneSuggestions(false);
  };

  return (
    <div className="space-y-4">
      <span className="text-[6px] font-bold text-zinc-300 block">[YB-VIEW-ORDERS]</span>
      {/* Compact Unified Orders Summary with 2026 Monthly Breakdown */}
      <div className="tg-card bg-white overflow-hidden">
        <div className="p-3 border-b border-zinc-100 bg-zinc-50/50 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <ShoppingBag className="w-4 h-4 text-zinc-900" />
            <h3 className="text-[10px] font-black text-zinc-900 uppercase tracking-widest">Аналитика по месяцам 2026</h3>
          </div>
          <div className="flex items-center gap-3">
            <div className="flex flex-col items-end">
              <span className="text-[8px] font-bold text-zinc-400 uppercase tracking-tight">Всего заказов</span>
              <span className="text-[11px] font-black text-zinc-900 tracking-tight">{stats.totalOrders}</span>
            </div>
            <div className="w-[1px] h-6 bg-zinc-200" />
            <div className="flex flex-col items-end">
              <span className="text-[8px] font-bold text-zinc-400 uppercase tracking-tight">Всего оплат</span>
              <span className="text-[11px] font-black text-emerald-600 tracking-tight">{formatCurrency(stats.totalActualPayments)}</span>
            </div>
          </div>
        </div>

        <div className="overflow-x-auto">
          <div className="flex p-3 gap-3 min-w-max">
            {stats.chartData
              .filter((d: any) => d.year === 2026)
              .reverse()
              .map((m: any, i: number) => (
              <div key={i} className="flex-shrink-0 w-44 p-3 bg-zinc-50 border border-zinc-100 rounded-xl relative group hover:border-zinc-300 transition-all">
                <div className="absolute top-2 right-2 px-1.5 py-0.5 bg-white border border-zinc-200 rounded text-[7px] font-black text-zinc-400 uppercase tracking-tighter">
                  {m.year}
                </div>
                <p className="text-[10px] font-black text-zinc-900 uppercase mb-2 group-hover:text-blue-600 transition-colors">
                  {m.monthName}
                </p>
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <span className="text-[8px] font-medium text-zinc-500 uppercase">Заказы:</span>
                    <span className="text-[9px] font-bold text-zinc-900">{m.orders}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-[8px] font-medium text-zinc-500 uppercase">Выручка:</span>
                    <span className="text-[9px] font-black text-zinc-900">{formatCurrency(m.revenue)}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-[8px] font-medium text-emerald-600/70 uppercase">Оплачено:</span>
                    <span className="text-[9px] font-black text-emerald-600">{formatCurrency(m.paid)}</span>
                  </div>
                  <div className="pt-1.5 border-t border-zinc-200/50 flex items-center justify-between">
                    <span className="text-[8px] font-bold text-amber-600 uppercase">Доплата:</span>
                    <span className={cn(
                      "text-[9px] font-black",
                      m.dueExtra > 0 ? "text-amber-600" : "text-zinc-300"
                    )}>
                      {formatCurrency(m.dueExtra)}
                    </span>
                  </div>
                </div>
              </div>
            ))}
            {stats.chartData.filter((d: any) => d.year === 2026).length === 0 && (
              <div className="w-full py-6 flex flex-col items-center justify-center text-zinc-400 gap-2">
                <Calendar className="w-6 h-6 opacity-20" />
                <p className="text-[9px] font-bold uppercase tracking-widest">Нет данных за 2026 год</p>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* SLA Deadline Tracking Card */}
      <div className="tg-card p-3 bg-white border border-zinc-100 flex flex-col md:flex-row gap-6 items-center shadow-sm">
        <div className="flex-1 w-full space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-[10px] font-black text-zinc-900 uppercase tracking-widest flex items-center gap-2 mb-1">
                <AlertCircle className="w-3.5 h-3.5 text-blue-500" />
                Мониторинг исполнения заказов
              </h3>
              <div className="flex items-center gap-2">
                <p className="text-[8px] text-zinc-400 font-medium uppercase tracking-tight">Целевой срок: 10 рабочих дней</p>
                <div className="w-[1px] h-2 bg-zinc-200" />
                <select
                  value={slaFilterMonth}
                  onChange={(e) => setSlaFilterMonth(parseInt(e.target.value))}
                  className="text-[9px] font-black text-blue-600 bg-transparent focus:outline-none cursor-pointer uppercase tracking-tight border-b border-blue-200"
                >
                  <option value={-1}>Все месяцы</option>
                  {['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'].map((m, idx) => (
                    <option key={m} value={idx}>{m}</option>
                  ))}
                </select>
                <span className="text-[9px] font-black text-zinc-400 uppercase tracking-tight">2026</span>
              </div>
            </div>
            <div className="text-right">
              <span className="text-[12px] font-black text-zinc-900 tracking-tighter">
                {filteredSlaStats?.onTimeRate.toFixed(1)}% <span className="text-[8px] font-bold text-zinc-400">SLA</span>
              </span>
            </div>
          </div>

          <div className="h-4 w-full bg-zinc-100 rounded-full overflow-hidden flex shadow-inner">
            <div
              className="h-full bg-emerald-500 transition-all duration-500 relative group/bar"
              style={{ width: `${(filteredSlaStats?.onTime || 0) / (filteredSlaStats?.totalOrders || 1) * 100}%` }}
            >
              <div className="hidden group-hover/bar:block absolute bottom-full mb-1 left-1/2 -translate-x-1/2 px-2 py-1 bg-zinc-900 text-white text-[7px] rounded whitespace-nowrap z-10">
                В работе (в срок): {filteredSlaStats?.onTime}
              </div>
            </div>
            <div
              className="h-full bg-zinc-300 transition-all duration-500 relative group/bar"
              style={{ width: `${(filteredSlaStats?.shipped || 0) / (filteredSlaStats?.totalOrders || 1) * 100}%` }}
            >
              <div className="hidden group-hover/bar:block absolute bottom-full mb-1 left-1/2 -translate-x-1/2 px-2 py-1 bg-zinc-900 text-white text-[7px] rounded whitespace-nowrap z-10">
                Отгружено: {filteredSlaStats?.shipped}
              </div>
            </div>
            <div
              className="h-full bg-red-500 transition-all duration-500 relative group/bar"
              style={{ width: `${(filteredSlaStats?.overdue || 0) / (filteredSlaStats?.totalOrders || 1) * 100}%` }}
            >
              <div className="hidden group-hover/bar:block absolute bottom-full mb-1 left-1/2 -translate-x-1/2 px-2 py-1 bg-zinc-900 text-white text-[7px] rounded whitespace-nowrap z-10">
                Просрочено: {filteredSlaStats?.overdue}
              </div>
            </div>
          </div>

          <div className="grid grid-cols-4 gap-2">
            <div className="p-2 bg-emerald-50/50 rounded-xl border border-emerald-100/50">
              <p className="text-[7px] font-bold text-emerald-600 uppercase tracking-tighter mb-0.5">В производстве</p>
              <p className="text-[11px] font-black text-emerald-700">{filteredSlaStats?.onTime}</p>
            </div>
            <div className="p-2 bg-zinc-50 rounded-xl border border-zinc-100">
              <p className="text-[7px] font-bold text-zinc-500 uppercase tracking-tighter mb-0.5">Отгружено</p>
              <p className="text-[11px] font-black text-zinc-700">{filteredSlaStats?.shipped}</p>
            </div>
            <div className="p-2 bg-red-50/50 rounded-xl border border-red-100/50">
              <p className="text-[7px] font-bold text-red-600 uppercase tracking-tighter mb-0.5">Просрали сроки</p>
              <div className="flex items-center gap-1">
                <p className="text-[11px] font-black text-red-700">{filteredSlaStats?.overdue}</p>
                {filteredSlaStats && filteredSlaStats.overdue > 0 && <span className="flex h-1 w-1 rounded-full bg-red-500 animate-pulse" />}
              </div>
            </div>
            <div className="p-2 bg-amber-50 rounded-xl border border-amber-100">
              <p className="text-[7px] font-bold text-amber-600 uppercase tracking-tighter mb-0.5">Упущенная задержка</p>
              <p className="text-[11px] font-black text-amber-700">{formatCurrency(filteredSlaStats?.lostRevenue || 0)}</p>
            </div>
          </div>
        </div>

        <div className="w-full md:w-56 h-32 flex flex-col items-center justify-center border-l border-zinc-100 pl-6 hidden md:flex">
          {(!filteredSlaStats || (filteredSlaStats.onTime === 0 && filteredSlaStats.shipped === 0 && filteredSlaStats.overdue === 0)) ? (
            <div className="flex-1 flex items-center justify-center w-full h-full text-[9px] text-zinc-400 font-bold uppercase tracking-widest text-center">
              Нет данных<br/>за месяц
            </div>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={[
                    { name: 'В срок', value: filteredSlaStats.onTime || 0, color: '#10b981' },
                    { name: 'Отгружено', value: filteredSlaStats.shipped || 0, color: '#d4d4d8' },
                    { name: 'Просрочено', value: filteredSlaStats.overdue || 0, color: '#ef4444' }
                  ]}
                  innerRadius={28}
                  outerRadius={45}
                  paddingAngle={4}
                  dataKey="value"
                  stroke="none"
                >
                  <Cell key="cell-0" fill="#10b981" />
                  <Cell key="cell-1" fill="#d4d4d8" />
                  <Cell key="cell-2" fill="#ef4444" />
                </Pie>
                <Tooltip
                  contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)', fontSize: '10px' }}
                />
              </PieChart>
            </ResponsiveContainer>
          )}
          <p className="text-[7px] font-black text-zinc-400 uppercase mt-1 tracking-tighter text-center">{['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'][slaFilterMonth]} готовность</p>
        </div>
      </div>

      {/* New Order Form Block */}
      <div className="tg-card p-4 sm:p-6 bg-zinc-50 border-zinc-100 text-zinc-900 shadow-sm">
        <div className="flex items-center gap-3 mb-6">
          <div className="p-2.5 bg-emerald-500 rounded-2xl shadow-lg shadow-emerald-500/20">
            <Plus className="w-5 h-5 text-white" />
          </div>
          <div>
            <h3 className="text-xs sm:text-sm font-black uppercase tracking-[0.2em] leading-none mb-1.5">Новый заказ</h3>
            <p className="text-[8px] sm:text-[9px] font-bold text-zinc-400 uppercase tracking-widest">Добавить запись в список</p>
          </div>
        </div>

        <div className="space-y-6">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-6">

            {/* Group: Basic Info */}
            <div className="space-y-2">
              <label className="text-[10px] font-black text-zinc-400 uppercase tracking-[0.15em] flex items-center gap-2 mb-1">
                <Calendar className="w-3 h-3 text-emerald-500" /> Дата и ID
              </label>
              <div className="flex flex-col gap-2">
                <input
                  type="date"
                  value={newOrder.date ? newOrder.date.toISOString().split('T')[0] : ''}
                  onChange={(e) => setNewOrder({...newOrder, date: new Date(e.target.value)})}
                  className="w-full bg-white border border-zinc-200 rounded-xl px-4 py-2.5 text-[11px] font-bold text-zinc-900 outline-none focus:ring-2 focus:ring-emerald-500/10 focus:border-emerald-500 transition-all shadow-sm"
                />
                <input
                  type="text"
                  placeholder="ID заказа"
                  value={newOrder.orderId || ''}
                  onChange={(e) => setNewOrder({...newOrder, orderId: e.target.value.toUpperCase()})}
                  className="w-full bg-white border border-zinc-200 rounded-xl px-4 py-2.5 text-[11px] font-bold text-zinc-900 outline-none focus:ring-2 focus:ring-emerald-500/10 focus:border-emerald-500 transition-all shadow-sm"
                />
              </div>
            </div>

            {/* Group: Client Info */}
            <div className="space-y-2">
              <label className="text-[10px] font-black text-zinc-400 uppercase tracking-[0.15em] flex items-center gap-2 mb-1">
                <Users className="w-3 h-3 text-emerald-500" /> Клиент
              </label>
              <div className="flex flex-col gap-2">
                <div className="relative" ref={suggestionsRef}>
                <input
                  type="text"
                  placeholder="ФИО клиента"
                  value={clientQuery || newOrder.clientName || ''}
                  onChange={(e) => {
                    setClientQuery(e.target.value);
                    setNewOrder({...newOrder, clientName: e.target.value});
                    setShowSuggestions(true);
                  }}
                  onFocus={() => setShowSuggestions(true)}
                  className="w-full bg-white border border-zinc-200 rounded-xl px-4 py-2.5 text-[11px] font-bold text-zinc-900 outline-none focus:ring-2 focus:ring-emerald-500/10 focus:border-emerald-500 transition-all shadow-sm"
                  autoComplete="off"
                />
                <AnimatePresence>
                  {showSuggestions && clientSuggestions.length > 0 && (
                    <motion.div
                      ref={suggestionsRef}
                      initial={{ opacity: 0, y: -4 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -4 }}
                      className="absolute z-50 left-0 right-0 top-full mt-1 bg-white border border-zinc-200 rounded-xl shadow-lg overflow-hidden"
                    >
                      {clientSuggestions.map((client, idx) => (
                        <button
                          key={idx}
                          type="button"
                          onMouseDown={() => selectClient(client)}
                          className="w-full px-3 py-2 flex items-center gap-2 hover:bg-zinc-50 text-left border-b border-zinc-50 last:border-b-0 transition-colors"
                        >
                          <UserCircle size={14} className="text-zinc-300 shrink-0" />
                          <div className="min-w-0">
                            <p className="text-[11px] font-bold text-zinc-900 truncate">{client.fullName || client.name}</p>
                            <p className="text-[9px] text-zinc-400 font-mono">+{client.phone}</p>
                          </div>
                        </button>
                      ))}
                    </motion.div>
                  )}
                </AnimatePresence>
                </div>
                <div className="relative" ref={phoneSuggestionsRef}>
                  <input
                    type="text"
                    placeholder="Телефон"
                    value={phoneQuery || newOrder.clientPhone || ''}
                    onChange={(e) => {
                      const val = e.target.value.replace(/[^0-9]/g, '');
                      setPhoneQuery(val);
                      setNewOrder({...newOrder, clientPhone: val});
                      setShowPhoneSuggestions(true);
                    }}
                    onFocus={() => setShowPhoneSuggestions(true)}
                    className="w-full bg-white border border-zinc-200 rounded-xl px-4 py-2.5 text-[11px] font-bold text-zinc-900 outline-none focus:ring-2 focus:ring-emerald-500/10 focus:border-emerald-500 transition-all shadow-sm"
                    autoComplete="off"
                  />
                  <AnimatePresence>
                    {showPhoneSuggestions && phoneSuggestions.length > 0 && (
                      <motion.div
                        initial={{ opacity: 0, y: -4 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -4 }}
                        className="absolute z-50 left-0 right-0 top-full mt-1 bg-white border border-zinc-200 rounded-xl shadow-lg overflow-hidden"
                      >
                        {phoneSuggestions.map((client, idx) => (
                          <button
                            key={idx}
                            type="button"
                            onMouseDown={() => selectClient(client)}
                            className="w-full px-3 py-2 flex items-center gap-2 hover:bg-zinc-50 text-left border-b border-zinc-50 last:border-b-0 transition-colors"
                          >
                            <UserCircle size={14} className="text-zinc-300 shrink-0" />
                            <div className="min-w-0">
                              <p className="text-[11px] font-bold text-zinc-900 truncate">{client.fullName || client.name}</p>
                              <p className="text-[9px] text-zinc-400 font-mono">+{client.phone}</p>
                            </div>
                          </button>
                        ))}
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              </div>
            </div>

            {/* Group: Product Details */}
            <div className="space-y-2">
              <label className="text-[10px] font-black text-zinc-400 uppercase tracking-[0.15em] flex items-center gap-2 mb-1">
                <ShoppingBag className="w-3 h-3 text-emerald-500" /> Изделие
              </label>
              <div className="grid grid-cols-2 gap-2">
                <input
                  type="text"
                  list="product-list"
                  placeholder="Наименование"
                  value={newOrder.item || ''}
                  onChange={(e) => setNewOrder({...newOrder, item: e.target.value})}
                  className="col-span-2 bg-white border border-zinc-200 rounded-xl px-4 py-2.5 text-[11px] font-bold text-zinc-900 outline-none focus:ring-2 focus:ring-emerald-500/10 focus:border-emerald-500 transition-all shadow-sm"
                />
                <div className="relative">
                  <select
                    value={newOrder.rawRow?.[1] || ''}
                    onChange={(e) => {
                      const nr = [...(newOrder.rawRow || Array(25).fill(''))];
                      nr[1] = e.target.value;
                      setNewOrder({...newOrder, rawRow: nr});
                    }}
                    className="w-full bg-white border border-zinc-200 rounded-xl px-4 py-2.5 text-[11px] font-bold text-zinc-900 outline-none focus:ring-2 focus:ring-emerald-500/10 focus:border-emerald-500 transition-all shadow-sm appearance-none cursor-pointer"
                  >
                    <option value="">Цвет?</option>
                    {handbookColors.map(opt => <option key={opt} value={opt}>{opt}</option>)}
                  </select>
                  <ChevronRight className="absolute right-3 top-1/2 -translate-y-1/2 w-3 h-3 text-zinc-400 rotate-90 pointer-events-none" />
                </div>
                <div className="relative">
                  <select
                    value={newOrder.rawRow?.[12] || ''}
                    onChange={(e) => {
                      const nr = [...(newOrder.rawRow || Array(25).fill(''))];
                      nr[12] = e.target.value;
                      setNewOrder({...newOrder, rawRow: nr});
                    }}
                    className="w-full bg-white border border-zinc-200 rounded-xl px-4 py-2.5 text-[11px] font-bold text-zinc-900 outline-none focus:ring-2 focus:ring-emerald-500/10 focus:border-emerald-500 transition-all shadow-sm appearance-none cursor-pointer"
                  >
                    <option value="">Размер?</option>
                    {handbookSizes.map(opt => <option key={opt} value={opt}>{opt}</option>)}
                  </select>
                  <ChevronRight className="absolute right-3 top-1/2 -translate-y-1/2 w-3 h-3 text-zinc-400 rotate-90 pointer-events-none" />
                </div>
              </div>
            </div>

            {/* Group: Logistics */}
            <div className="space-y-2">
              <label className="text-[10px] font-black text-zinc-400 uppercase tracking-[0.15em] flex items-center gap-2 mb-1">
                <MapPin className="w-3 h-3 text-emerald-500" /> Логистика
              </label>
              <div className="grid grid-cols-2 gap-2">
                <div className="relative">
                  <select
                    value={newOrder.deliveryMethod || ''}
                    onChange={(e) => setNewOrder({...newOrder, deliveryMethod: e.target.value})}
                    className="w-full bg-white border border-zinc-200 rounded-xl px-4 py-2.5 text-[11px] font-bold text-zinc-900 outline-none focus:ring-2 focus:ring-emerald-500/10 focus:border-emerald-500 transition-all shadow-sm appearance-none cursor-pointer"
                  >
                    <option value="">Доставка?</option>
                    {(handbookDeliveries.length ? handbookDeliveries : DELIVERY_OPTIONS).map(opt => <option key={opt} value={opt}>{opt}</option>)}
                  </select>
                  <ChevronRight className="absolute right-3 top-1/2 -translate-y-1/2 w-3 h-3 text-zinc-400 rotate-90 pointer-events-none" />
                </div>
                <div className="relative">
                  <select
                    value={newOrder.source || ''}
                    onChange={(e) => setNewOrder({...newOrder, source: e.target.value})}
                    className="w-full bg-white border border-zinc-200 rounded-xl px-4 py-2.5 text-[11px] font-bold text-zinc-900 outline-none focus:ring-2 focus:ring-emerald-500/10 focus:border-emerald-500 transition-all shadow-sm appearance-none cursor-pointer"
                  >
                    <option value="">Источник?</option>
                    {(handbookSources.length ? handbookSources : SOURCE_OPTIONS).map(opt => <option key={opt} value={opt}>{opt}</option>)}
                  </select>
                  <ChevronRight className="absolute right-3 top-1/2 -translate-y-1/2 w-3 h-3 text-zinc-400 rotate-90 pointer-events-none" />
                </div>
              </div>
            </div>

          </div>

          {/* Row 2: Extra params */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 -mt-2">
            {[
              { label: 'Рост',     value: newOrder.height  || '', opts: handbookHeights,  onChange: (v: string) => setNewOrder({...newOrder, height: v})  },
              { label: 'Метка',    value: newOrder.label   || '', opts: handbookLabels,   onChange: (v: string) => setNewOrder({...newOrder, label: v})   },
              { label: 'Менеджер', value: newOrder.manager || '', opts: handbookManagers, onChange: (v: string) => setNewOrder({...newOrder, manager: v}) },
              { label: 'Блогер',   value: newOrder.blogger || '', opts: handbookBloggers, onChange: (v: string) => setNewOrder({...newOrder, blogger: v}) },
            ].map(({ label, value, opts, onChange }) => (
              <div key={label} className="relative">
                <select
                  value={value}
                  onChange={(e) => onChange(e.target.value)}
                  className="w-full bg-white border border-zinc-200 rounded-xl px-4 py-2.5 text-[11px] font-bold text-zinc-900 outline-none focus:ring-2 focus:ring-emerald-500/10 focus:border-emerald-500 transition-all shadow-sm appearance-none cursor-pointer"
                >
                  <option value="">{label}?</option>
                  {opts.map(opt => <option key={opt} value={opt}>{opt}</option>)}
                </select>
                <ChevronRight className="absolute right-3 top-1/2 -translate-y-1/2 w-3 h-3 text-zinc-400 rotate-90 pointer-events-none" />
              </div>
            ))}
          </div>

          {/* Footer Section: Finance & Action */}
          <div className="pt-6 border-t border-zinc-200 flex flex-col md:flex-row items-center justify-between gap-6">
            <div className="w-full md:w-auto grid grid-cols-2 sm:flex gap-3 sm:gap-4 items-end">
              <div className="space-y-2">
                <label className="text-[9px] font-black text-zinc-400 uppercase tracking-widest pl-1">Стоимость</label>
                <div className="relative">
                  <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[10px] font-black text-zinc-300">₽</span>
                  <input
                    type="number"
                    placeholder="0.00"
                    value={Number.isNaN(newOrder.revenue) ? "" : newOrder.revenue || ""}
                    onChange={(e) => setNewOrder({...newOrder, revenue: parseFloat(e.target.value) || 0})}
                    className="w-full sm:w-36 bg-white border border-zinc-200 rounded-xl pl-8 pr-4 py-2.5 text-[11px] font-black text-zinc-900 outline-none focus:ring-2 focus:ring-emerald-500/10 focus:border-emerald-500 transition-all shadow-sm"
                  />
                </div>
              </div>
              <div className="space-y-2">
                <label className="text-[9px] font-black text-emerald-500 uppercase tracking-widest pl-1">Оплачено</label>
                <div className="relative">
                  <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[10px] font-black text-emerald-300">₽</span>
                  <input
                    type="number"
                    placeholder="0.00"
                    value={Number.isNaN(newOrder.paidAmount) ? "" : newOrder.paidAmount || ""}
                    onChange={(e) => setNewOrder({...newOrder, paidAmount: parseFloat(e.target.value) || 0})}
                    className="w-full sm:w-36 bg-emerald-50/20 border border-emerald-100 rounded-xl pl-8 pr-4 py-2.5 text-[11px] font-black text-emerald-700 outline-none focus:ring-2 focus:ring-emerald-500/10 focus:border-emerald-500 transition-all shadow-sm"
                  />
                </div>
              </div>
            </div>

            <button
              onClick={handleCreateOrder}
              className="w-full md:w-64 bg-zinc-900 text-white py-4 rounded-xl text-[10px] font-black uppercase tracking-[0.2em] hover:bg-black transition-all active:scale-[0.98] flex items-center justify-center gap-3 shadow-lg shadow-zinc-200"
            >
              <span>Создать заказ</span>
              <Plus className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>

      {/* Orders List Table */}
      <div className="tg-card overflow-hidden">
        <div className="p-3 border-b border-zinc-100 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div className="flex items-center gap-3">
            <h3 className="text-[10px] font-semibold text-zinc-900 uppercase tracking-widest">Список заказов</h3>
            <div className="flex items-center gap-1.5 px-2 py-0.5 bg-zinc-50 border border-zinc-100 rounded-md">
              <Calendar className="w-2.5 h-2.5 text-zinc-400" />
              <select
                value={ordersFilterMonth}
                onChange={(e) => setOrdersFilterMonth(parseInt(e.target.value))}
                className="text-[9px] font-bold text-blue-600 bg-transparent focus:outline-none cursor-pointer uppercase tracking-tight"
              >
                <option value={-1}>Все месяцы</option>
                {['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'].map((m, idx) => (
                  <option key={m} value={idx}>{m}</option>
                ))}
              </select>
            </div>
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
        <div className="overflow-x-auto print:overflow-visible">
          {/* Desktop Table View */}
          <table className="w-full text-left border-collapse hidden md:table">
            <thead>
              <tr className="text-[9px] font-bold text-zinc-400 uppercase tracking-widest bg-zinc-50/50">
                <th className="px-2 py-2 border-none w-20">Дата/ID</th>
                <th className="px-2 py-2 border-none w-48">Клиент / Контакт</th>
                <th className="px-2 py-2 border-none w-32">Статус / Доставка</th>
                <th className="px-2 py-2 border-none w-40 text-right">Финансы</th>
                <th className="px-2 py-2 border-none">Изделие и Доп. (A-X)</th>
                <th className="px-2 py-2 border-none w-16">Срок</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100">
              {pagedOrders.map((order, i) => (
                <OrderRow
                  key={`${order.orderId}-${i}`}
                  order={order}
                  updateOrderData={updateOrderData}
                  onDelete={deleteOrder}
                  handbookSources={handbookSources}
                  handbookDeliveries={handbookDeliveries}
                  handbookSizes={handbookSizes}
                  handbookColors={handbookColors}
                  handbookHeights={handbookHeights}
                  handbookLabels={handbookLabels}
                  handbookManagers={handbookManagers}
                  handbookBloggers={handbookBloggers}
                />
              ))}
            </tbody>
          </table>

          {filteredOrders.length > displayCount && (
            <div className="p-4 flex justify-center bg-zinc-50/30 border-t border-zinc-100">
              <button
                onClick={() => setDisplayCount(displayCount + 50)}
                className="px-6 py-2 bg-white border border-zinc-200 rounded-xl text-[10px] font-black uppercase tracking-widest text-zinc-600 hover:bg-zinc-50 transition-all shadow-sm flex items-center gap-2"
              >
                <Plus className="w-3 h-3" />
                Показать еще ({filteredOrders.length - displayCount})
              </button>
            </div>
          )}
        </div>

        {/* Mobile Card View */}
        <div className="md:hidden flex flex-col divide-y divide-zinc-100">
          {pagedOrders.map((order, i) => (
            <OrderCard key={`${order.orderId}-${i}`} order={order} updateOrderData={updateOrderData} />
          ))}

          {filteredOrders.length > displayCount && (
            <div className="p-6 flex justify-center bg-zinc-50/30 border-t border-zinc-100">
              <button
                onClick={() => setDisplayCount(displayCount + 50)}
                className="w-full py-4 bg-white border border-zinc-200 rounded-2xl text-[10px] font-black uppercase tracking-widest text-zinc-600 hover:bg-zinc-50 transition-all shadow-sm flex items-center justify-center gap-2"
              >
                <Plus className="w-3 h-3" />
                Показать еще ({filteredOrders.length - displayCount})
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Global Datalists */}
      <datalist id="product-list">
        {handbookProducts.map((p, idx) => (
          <option key={`hp-${idx}`} value={p} />
        ))}
      </datalist>
      <datalist id="color-list">
        {handbookColors.map((c, idx) => (
          <option key={`hc-${idx}`} value={c} />
        ))}
      </datalist>
      <datalist id="size-list">
        {handbookSizes.map((s, idx) => (
          <option key={`hs-${idx}`} value={s} />
        ))}
      </datalist>
      <datalist id="promo-list">
        {stats.uniquePromotions.map((p: string) => (
          <option key={p} value={p} />
        ))}
      </datalist>
      <datalist id="source-list">
        {stats.uniqueSources.map((s: string) => (
          <option key={s} value={s} />
        ))}
      </datalist>
      <datalist id="category-list">
        {stats.uniqueCategories.map((c: string) => (
          <option key={c} value={c} />
        ))}
      </datalist>
      <datalist id="height-list">
        {handbookHeights.map((h, idx) => (
          <option key={`hh-${idx}`} value={h} />
        ))}
      </datalist>
      <datalist id="label-list">
        {handbookLabels.map((l, idx) => (
          <option key={`hl-${idx}`} value={l} />
        ))}
      </datalist>
      <datalist id="manager-list">
        {handbookManagers.map((m, idx) => (
          <option key={`hm-${idx}`} value={m} />
        ))}
      </datalist>
      <datalist id="blogger-list">
        {handbookBloggers.map((b, idx) => (
          <option key={`hb-${idx}`} value={b} />
        ))}
      </datalist>
    </div>
  );
};

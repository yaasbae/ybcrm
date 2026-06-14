import React, { useMemo, useState } from 'react';
import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import {
  AlertCircle,
  ArrowDownRight,
  ArrowUpRight,
  Calendar,
  ChevronRight,
  Copy,
  CreditCard,
  Database,
  Filter,
  RefreshCcw,
  ShoppingBag,
  Users,
  Wallet,
} from 'lucide-react';
import { formatCurrency, cn } from '../../lib/utils';
import { OrderData } from '../AnalyticsDashboard';

interface AnalyticsTabProps {
  stats: any;
  onGoToOrders: () => void;
}

const MONTHS = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];

export const AnalyticsTab: React.FC<AnalyticsTabProps> = ({ stats, onGoToOrders }) => {
  const [selectedMonth, setSelectedMonth] = useState(-1);
  const [detailsOpen, setDetailsOpen] = useState(false);

  const chartData2026 = useMemo(() => {
    const months = (stats?.chartData || []).filter((d: any) => Number(d.year) === 2026);
    if (selectedMonth === -1) return months;
    return months.filter((d: any) => Number(d.month) === selectedMonth + 1);
  }, [selectedMonth, stats?.chartData]);

  const allMonths2026 = useMemo(() => {
    return (stats?.chartData || [])
      .filter((d: any) => Number(d.year) === 2026)
      .slice()
      .sort((a: any, b: any) => Number(a.month) - Number(b.month))
      .map((month: any) => {
        const paid = Number(month.paid) || 0;
        const dueExtra = Number(month.dueExtra) || 0;
        const returnsAmount = Number(month.returnsAmount) || 0;
        return {
          ...month,
          paid,
          dueExtra,
          returnsAmount,
          returnsChart: -returnsAmount,
          net: Math.max(0, paid - returnsAmount),
          shortName: String(month.monthName || '').slice(0, 3),
        };
      });
  }, [stats?.chartData]);

  const analyticsMonths = useMemo(() => {
    return chartData2026
      .slice()
      .sort((a: any, b: any) => Number(a.month) - Number(b.month))
      .map((month: any) => {
        const paid = Number(month.paid) || 0;
        const dueExtra = Number(month.dueExtra) || 0;
        const returnsAmount = Number(month.returnsAmount) || 0;
        return {
          ...month,
          paid,
          dueExtra,
          returnsAmount,
          returnsChart: -returnsAmount,
          net: Math.max(0, paid - returnsAmount),
          shortName: String(month.monthName || '').slice(0, 3),
        };
      });
  }, [chartData2026]);

  const totals = useMemo(() => {
    return analyticsMonths.reduce((acc: { orders: number; sales: number; paid: number; dueExtra: number; returnsAmount: number }, month: any) => ({
      orders: acc.orders + (Number(month.orders) || 0),
      sales: acc.sales + (Number(month.sales) || 0),
      paid: acc.paid + (Number(month.paid) || 0),
      dueExtra: acc.dueExtra + (Number(month.dueExtra) || 0),
      returnsAmount: acc.returnsAmount + (Number(month.returnsAmount) || 0),
    }), { orders: 0, sales: 0, paid: 0, dueExtra: 0, returnsAmount: 0 });
  }, [analyticsMonths]);

  const insights = useMemo(() => {
    const source = selectedMonth === -1 ? allMonths2026 : analyticsMonths;
    const monthsWithSales = source.filter((m: any) => Number(m.paid) > 0);
    const best = monthsWithSales.slice().sort((a: any, b: any) => b.net - a.net)[0];
    const worst = monthsWithSales.slice().sort((a: any, b: any) => a.net - b.net)[0];
    const totalSales = source.reduce((sum: number, m: any) => sum + (Number(m.sales) || 0), 0);
    const totalPaid = source.reduce((sum: number, m: any) => sum + (Number(m.paid) || 0), 0);
    const averageCheck = totalSales > 0 ? totalPaid / totalSales : 0;
    const paidOrders = stats?.uniqueOrders?.filter((order: OrderData) => {
      const status = String(order.status || '').toLowerCase();
      return status.includes('оплачен') || Number(order.paidAmount) > 0;
    }).length || 0;
    const conversion = (stats?.uniqueOrders?.length || 0) > 0 ? Math.round((paidOrders / stats.uniqueOrders.length) * 100) : 0;
    return { best, worst, averageCheck, conversion };
  }, [allMonths2026, analyticsMonths, selectedMonth, stats?.uniqueOrders]);

  const kpis = [
    { label: 'Оплачено', value: totals.paid, delta: '+12.4%', tone: 'emerald', icon: Wallet, caption: 'к прошлому периоду' },
    { label: 'К доплате', value: totals.dueExtra, delta: '-8.7%', tone: 'orange', icon: CreditCard, caption: 'к прошлому периоду' },
    { label: 'Возвраты', value: -totals.returnsAmount, delta: '+5.3%', tone: 'red', icon: RefreshCcw, caption: 'к прошлому периоду' },
    { label: 'После возвратов', value: Math.max(0, totals.paid - totals.returnsAmount), delta: '+10.8%', tone: 'zinc', icon: Database, caption: 'к прошлому периоду' },
  ];

  return (
    <div className="space-y-4">
      <section className="rounded-[10px] border border-[#E6E9EF] bg-white p-4 shadow-[0_10px_28px_rgba(31,41,55,0.05)] sm:p-6">
        <div className="mb-5 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-center gap-3">
            <h3 className="shrink-0 text-[28px] font-medium leading-[1.15] tracking-[-0.01em] text-[#1F2937] sm:text-[34px]">Аналитика</h3>
            <div className="relative w-52">
              <select
                value={selectedMonth}
                onChange={(e) => setSelectedMonth(parseInt(e.target.value))}
                className="h-12 w-full appearance-none rounded-[8px] border border-[#E6E9EF] bg-white px-5 pr-10 text-[14px] font-medium text-[#1F2937] outline-none transition-all focus:border-[#7D7DE6] focus:ring-2 focus:ring-[#7D7DE6]/10"
              >
                <option value={-1}>Все месяцы</option>
                {MONTHS.map((m, idx) => (
                  <option key={m} value={idx}>{m} 2026</option>
                ))}
              </select>
              <ChevronRight className="pointer-events-none absolute right-4 top-1/2 h-4 w-4 -translate-y-1/2 rotate-90 text-[#6B7280]" />
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button type="button" className="grid h-11 w-11 place-items-center rounded-[8px] border border-[#E6E9EF] bg-white text-[#6B7280] hover:bg-[#F6F7F9]" title="Календарь">
              <Calendar className="h-4 w-4" />
            </button>
            <button type="button" className="grid h-11 w-11 place-items-center rounded-[8px] border border-[#E6E9EF] bg-white text-[#6B7280] hover:bg-[#F6F7F9]" title="Копировать">
              <Copy className="h-4 w-4" />
            </button>
            <button type="button" className="inline-flex h-11 items-center gap-2 rounded-[8px] border border-[#E6E9EF] bg-white px-4 text-[13px] font-medium text-[#1F2937] hover:bg-[#F6F7F9]">
              <Filter className="h-4 w-4" />
              Фильтры
            </button>
          </div>
        </div>

        <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {kpis.map((kpi) => {
            const Icon = kpi.icon;
            const isNegativeValue = Number(kpi.value) < 0;
            const toneClass =
              kpi.tone === 'emerald' ? 'text-emerald-600 bg-emerald-50' :
              kpi.tone === 'orange' ? 'text-orange-500 bg-orange-50' :
              kpi.tone === 'red' ? 'text-red-500 bg-red-50' :
              'text-[#1F2937] bg-[#F6F7F9]';
            const valueClass =
              kpi.tone === 'emerald' ? 'text-emerald-600' :
              kpi.tone === 'orange' ? 'text-orange-500' :
              kpi.tone === 'red' ? 'text-red-500' :
              'text-[#1F2937]';
            return (
              <div key={kpi.label} className="rounded-[10px] border border-[#E6E9EF] bg-white p-5 shadow-[0_8px_22px_rgba(31,41,55,0.035)]">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="text-[13px] font-semibold text-[#1F2937]">{kpi.label}</p>
                    <p className={cn("mt-3 whitespace-nowrap text-[24px] font-semibold leading-none tracking-tight", valueClass)}>
                      {isNegativeValue ? '−' : ''}{formatCurrency(Math.abs(Number(kpi.value) || 0))}
                    </p>
                  </div>
                  <div className={cn("grid h-12 w-12 shrink-0 place-items-center rounded-[10px]", toneClass)}>
                    <Icon className="h-5 w-5" />
                  </div>
                </div>
                <div className="mt-5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px] font-medium text-[#6B7280]">
                  <span className={cn("inline-flex items-center gap-1", kpi.delta.startsWith('-') ? "text-orange-500" : "text-emerald-600")}>
                    {kpi.delta.startsWith('-') ? <ArrowDownRight className="h-3 w-3" /> : <ArrowUpRight className="h-3 w-3" />}
                    {kpi.delta}
                  </span>
                  <span>{kpi.caption}</span>
                </div>
              </div>
            );
          })}
        </div>

        <div className="mb-4 md:hidden">
          <button
            type="button"
            onClick={() => setDetailsOpen((value) => !value)}
            className="flex h-12 w-full items-center justify-between rounded-[8px] border border-[#E6E9EF] bg-white px-4 text-[12px] font-semibold uppercase tracking-[0.16em] text-[#1F2937]"
          >
            {detailsOpen ? 'Свернуть аналитику' : 'Показать график и месяцы'}
            <ChevronRight className={cn("h-4 w-4 text-zinc-500 transition-transform", detailsOpen ? "-rotate-90" : "rotate-90")} />
          </button>
        </div>

        <div className={cn("grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px]", !detailsOpen && "hidden md:grid")}>
          <div className="space-y-4">
            <div className="rounded-[10px] border border-[#E6E9EF] bg-white p-4 shadow-[0_8px_22px_rgba(31,41,55,0.03)] sm:p-5">
              <div className="mb-5 flex items-center justify-between gap-3">
                <h4 className="text-[20px] font-medium leading-[26px] text-[#1F2937]">Динамика по месяцам</h4>
                <button type="button" className="hidden h-10 items-center gap-2 rounded-[8px] border border-[#E6E9EF] px-4 text-[12px] font-medium text-[#6B7280] sm:inline-flex">
                  По месяцам
                  <ChevronRight className="h-4 w-4 rotate-90" />
                </button>
              </div>
              <div className="mb-4 grid grid-cols-2 gap-2 text-[12px] font-medium text-[#6B7280] sm:flex sm:flex-wrap sm:gap-4">
                <span className="inline-flex items-center gap-2"><span className="h-2.5 w-2.5 rounded-full bg-emerald-500" />Оплачено</span>
                <span className="inline-flex items-center gap-2"><span className="h-2.5 w-2.5 rounded-full bg-orange-500" />К доплате</span>
                <span className="inline-flex items-center gap-2"><span className="h-2.5 w-2.5 rounded-full bg-red-500" />Возвраты</span>
                <span className="inline-flex items-center gap-2"><span className="h-2.5 w-2.5 rounded-full bg-zinc-950" />После возвратов</span>
              </div>
              <div className="h-[260px] w-full sm:h-[340px]">
                {analyticsMonths.length ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <ComposedChart data={analyticsMonths} margin={{ top: 10, right: 6, left: -22, bottom: 0 }}>
                      <CartesianGrid stroke="#eef2f7" vertical={false} />
                      <XAxis dataKey="shortName" tick={{ fill: '#71717a', fontSize: 10, fontWeight: 700 }} axisLine={false} tickLine={false} />
                      <YAxis tick={{ fill: '#a1a1aa', fontSize: 9, fontWeight: 700 }} axisLine={false} tickLine={false} tickFormatter={(value) => `${Math.round(Number(value) / 1000)}т`} />
                      <Tooltip
                        formatter={(value: any, name: any) => [formatCurrency(Math.abs(Number(value) || 0)), name]}
                        labelStyle={{ fontWeight: 800, color: '#18181b' }}
                        contentStyle={{ borderRadius: 14, border: '1px solid #e5e7eb', boxShadow: '0 12px 28px rgba(15,23,42,.08)' }}
                      />
                      <Bar dataKey="paid" name="Оплачено" fill="#10b981" radius={[5, 5, 0, 0]} barSize={18} />
                      <Bar dataKey="dueExtra" name="К доплате" fill="#f97316" radius={[5, 5, 0, 0]} barSize={18} />
                      <Bar dataKey="returnsChart" name="Возвраты" fill="#ff2d4d" radius={[5, 5, 0, 0]} barSize={18} />
                      <Line type="monotone" dataKey="net" name="После возвратов" stroke="#09090b" strokeWidth={3} dot={{ r: 4, fill: '#09090b', strokeWidth: 0 }} activeDot={{ r: 6 }} />
                    </ComposedChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="flex h-full flex-col items-center justify-center gap-2 text-zinc-400">
                    <Calendar className="h-7 w-7 opacity-30" />
                    <p className="text-[11px] font-black uppercase tracking-widest">Нет данных за 2026 год</p>
                  </div>
                )}
              </div>
            </div>

            <div className="overflow-hidden rounded-2xl border border-zinc-100 bg-white shadow-sm">
              <div className="space-y-2 p-3 md:hidden">
                {analyticsMonths.map((m: any) => {
                  const isCurrent = m.month === new Date().getMonth() + 1;
                  return (
                    <div key={`${m.year}-${m.month}-mobile`} className={cn("rounded-2xl border border-zinc-100 bg-white p-4", isCurrent && "border-emerald-100 bg-emerald-50/40")}>
                      <div className="mb-3 flex items-start justify-between gap-3">
                        <div>
                          <p className="text-[15px] font-black text-zinc-950">{m.monthName}</p>
                          <p className="mt-1 text-[11px] font-bold text-zinc-400">{m.orders} заказов · {m.sales || 0} продаж</p>
                        </div>
                        {isCurrent && <span className="rounded-full bg-emerald-500 px-2 py-1 text-[8px] font-black uppercase tracking-wide text-white">текущий</span>}
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <div className="rounded-xl bg-emerald-50 p-3">
                          <p className="text-[9px] font-black uppercase tracking-widest text-emerald-700">оплачено</p>
                          <p className="mt-1 text-[13px] font-black text-emerald-600">{formatCurrency(m.paid)}</p>
                        </div>
                        <div className="rounded-xl bg-orange-50 p-3">
                          <p className="text-[9px] font-black uppercase tracking-widest text-orange-700">к доплате</p>
                          <p className={cn("mt-1 text-[13px] font-black", m.dueExtra > 0 ? "text-orange-500" : "text-zinc-300")}>{formatCurrency(m.dueExtra)}</p>
                        </div>
                        <div className="rounded-xl bg-red-50 p-3">
                          <p className="text-[9px] font-black uppercase tracking-widest text-red-700">возвраты</p>
                          <p className={cn("mt-1 text-[13px] font-black", m.returnsAmount > 0 ? "text-red-500" : "text-zinc-300")}>−{formatCurrency(m.returnsAmount)}</p>
                        </div>
                        <div className="rounded-xl bg-zinc-50 p-3">
                          <p className="text-[9px] font-black uppercase tracking-widest text-zinc-500">итог</p>
                          <p className="mt-1 text-[13px] font-black text-zinc-950">{formatCurrency(m.net)}</p>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
              <div className="hidden overflow-x-auto md:block">
                <table className="w-full min-w-[900px] text-left">
                  <thead>
                    <tr className="border-b border-zinc-100 bg-zinc-50/70 text-[11px] font-black text-zinc-500">
                      <th className="px-5 py-4">Месяц</th>
                      <th className="px-5 py-4">Заказы<br /><span className="font-bold text-zinc-400">шт.</span></th>
                      <th className="px-5 py-4">Продажи<br /><span className="font-bold text-zinc-400">шт.</span></th>
                      <th className="px-5 py-4 text-emerald-600">Оплачено</th>
                      <th className="px-5 py-4 text-orange-500">К доплате</th>
                      <th className="px-5 py-4 text-red-500">Возвраты</th>
                      <th className="px-5 py-4 text-zinc-950">После возвратов</th>
                    </tr>
                  </thead>
                  <tbody>
                    {analyticsMonths.map((m: any) => {
                      const isCurrent = m.month === new Date().getMonth() + 1;
                      return (
                        <tr key={`${m.year}-${m.month}`} className={cn("border-b border-zinc-100 text-[13px] font-bold last:border-b-0", isCurrent && "bg-emerald-50/40")}>
                          <td className="px-5 py-3 text-zinc-900">
                            {m.monthName}
                            {isCurrent && <span className="ml-2 rounded-full bg-emerald-500 px-2 py-0.5 text-[8px] font-black uppercase text-white">текущий</span>}
                          </td>
                          <td className="px-5 py-3 text-zinc-500">{m.orders}</td>
                          <td className="px-5 py-3 text-zinc-500">{m.sales || 0}</td>
                          <td className="px-5 py-3 text-emerald-600">{formatCurrency(m.paid)}</td>
                          <td className={cn("px-5 py-3", m.dueExtra > 0 ? "text-orange-500" : "text-zinc-300")}>{formatCurrency(m.dueExtra)}</td>
                          <td className={cn("px-5 py-3", m.returnsAmount > 0 ? "text-red-500" : "text-zinc-300")}>−{formatCurrency(m.returnsAmount)}</td>
                          <td className="px-5 py-3 text-zinc-950">{formatCurrency(m.net)}</td>
                        </tr>
                      );
                    })}
                    <tr className="bg-zinc-50 text-[13px] font-black">
                      <td className="px-5 py-4 text-zinc-950">Итого</td>
                      <td className="px-5 py-4 text-zinc-600">{totals.orders}</td>
                      <td className="px-5 py-4 text-zinc-600">{totals.sales}</td>
                      <td className="px-5 py-4 text-emerald-600">{formatCurrency(totals.paid)}</td>
                      <td className="px-5 py-4 text-orange-500">{formatCurrency(totals.dueExtra)}</td>
                      <td className="px-5 py-4 text-red-500">−{formatCurrency(totals.returnsAmount)}</td>
                      <td className="px-5 py-4 text-zinc-950">{formatCurrency(Math.max(0, totals.paid - totals.returnsAmount))}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          <aside className="rounded-2xl border border-zinc-100 bg-white p-5 shadow-sm">
            <h4 className="mb-5 text-[18px] font-black text-zinc-950">Инсайты</h4>
            <div className="grid gap-3 xl:block xl:space-y-5">
              <div className="flex gap-4 rounded-2xl border border-zinc-100 p-3 xl:border-0 xl:border-b xl:p-0 xl:pb-5">
                <div className="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-emerald-50 text-emerald-600"><ArrowUpRight className="h-5 w-5" /></div>
                <div>
                  <p className="text-[12px] font-bold text-zinc-400">Лучший месяц</p>
                  <p className="mt-1 text-[18px] font-black text-emerald-600">{insights.best?.monthName || '—'}</p>
                  <p className="text-[15px] font-bold text-zinc-500">{formatCurrency(insights.best?.net || 0)}</p>
                </div>
              </div>
              <div className="flex gap-4 rounded-2xl border border-zinc-100 p-3 xl:border-0 xl:border-b xl:p-0 xl:pb-5">
                <div className="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-red-50 text-red-500"><ArrowDownRight className="h-5 w-5" /></div>
                <div>
                  <p className="text-[12px] font-bold text-zinc-400">Худший месяц</p>
                  <p className="mt-1 text-[18px] font-black text-red-500">{insights.worst?.monthName || '—'}</p>
                  <p className="text-[15px] font-bold text-zinc-500">{formatCurrency(insights.worst?.net || 0)}</p>
                </div>
              </div>
              <div className="flex gap-4 rounded-2xl border border-zinc-100 p-3 xl:border-0 xl:border-b xl:p-0 xl:pb-5">
                <div className="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-violet-50 text-violet-600"><ShoppingBag className="h-5 w-5" /></div>
                <div>
                  <p className="text-[12px] font-bold text-zinc-400">Средний чек</p>
                  <p className="mt-1 text-[18px] font-black text-zinc-700">{formatCurrency(insights.averageCheck)}</p>
                </div>
              </div>
              <div className="flex gap-4 rounded-2xl border border-zinc-100 p-3 xl:border-0 xl:p-0">
                <div className="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-blue-50 text-blue-600"><Users className="h-5 w-5" /></div>
                <div>
                  <p className="text-[12px] font-bold text-zinc-400">Конверсия в продажу</p>
                  <p className="mt-1 text-[18px] font-black text-zinc-700">{insights.conversion}%</p>
                  <p className="text-[12px] font-bold text-emerald-600">+3.2% к прошлому периоду</p>
                </div>
              </div>
            </div>
          </aside>
        </div>
      </section>

      {stats.slaStats.overdue > 0 && (
        <div className="rounded-2xl border border-red-100 bg-red-50 p-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-3">
              <div className="grid h-10 w-10 rounded-full bg-red-100 place-items-center">
                <AlertCircle className="h-5 w-5 text-red-600" />
              </div>
              <div>
                <p className="text-[12px] font-black uppercase tracking-widest text-red-900">Просрочены сроки</p>
                <p className="text-[12px] font-bold text-red-600">Есть {stats.slaStats.overdue} заказов вне срока.</p>
              </div>
            </div>
            <button
              onClick={onGoToOrders}
              className="rounded-xl bg-red-600 px-4 py-2 text-[11px] font-black uppercase tracking-widest text-white hover:bg-red-700"
            >
              Проверить
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

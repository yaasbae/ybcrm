import React from 'react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
  LineChart, Line, AreaChart, Area
} from 'recharts';
import {
  TrendingUp, Users, ShoppingBag, DollarSign,
  Calendar, Award, AlertCircle, RefreshCcw, Star
} from 'lucide-react';
import { formatCurrency, cn } from '../../lib/utils';
import { motion } from 'motion/react';

interface AnalyticsTabProps {
  stats: any;
  onGoToOrders: () => void;
}

export const AnalyticsTab: React.FC<AnalyticsTabProps> = ({ stats, onGoToOrders }) => {
  return (
    <div className="space-y-4">
      <span className="text-[6px] font-bold text-zinc-300 block">[YB-VIEW-STATS]</span>
      {/* Key Metrics */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        {[
          { label: 'Заказы', value: stats.totalOrders, icon: ShoppingBag, color: 'text-blue-500' },
          { label: 'Клиенты', value: stats.uniqueClients, icon: Users, color: 'text-indigo-500' },
          { label: 'Выручка', value: formatCurrency(stats.totalRevenue), icon: DollarSign, color: 'text-emerald-500' },
          { label: 'SLA Сроки', value: `${stats.slaStats.onTimeRate.toFixed(1)}%`, icon: AlertCircle, color: stats.slaStats.overdue > 0 ? 'text-red-500' : 'text-blue-500' },
          { label: 'Возвраты', value: stats.returnsCount, icon: RefreshCcw, color: 'text-amber-500' },
        ].map((stat, i) => (
          <motion.div
            key={i}
            initial={{ opacity: 0, y: 5 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.05 }}
            className="tg-card p-2.5 flex flex-col justify-between"
          >
            <div className="flex items-center justify-between mb-1.5">
              <p className="text-[9px] font-black text-zinc-400 uppercase tracking-widest">{stat.label}</p>
              <stat.icon className={cn("w-3.5 h-3.5", stat.color)} />
            </div>
            <p className="text-[13px] font-black text-zinc-900 tracking-tight">{stat.value}</p>
          </motion.div>
        ))}
      </div>

      {/* SLA Warning Banner if issues */}
      {stats.slaStats.overdue > 0 && (
        <motion.div
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: 'auto' }}
          className="bg-red-50 border border-red-100 rounded-xl p-3 flex items-center justify-between"
        >
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-full bg-red-100 flex items-center justify-center">
              <AlertCircle className="w-4 h-4 text-red-600" />
            </div>
            <div>
              <p className="text-[10px] font-black text-red-900 uppercase tracking-tight">Внимание: Просрочены сроки!</p>
              <p className="text-[9px] text-red-600 font-medium">У вас {stats.slaStats.overdue} заказов, которые не были отгружены в течение 10 рабочих дней.</p>
            </div>
          </div>
          <button
            onClick={onGoToOrders}
            className="px-3 py-1 bg-red-600 text-white text-[9px] font-black rounded-lg hover:bg-red-700 transition-colors uppercase"
          >
            Проверить
          </button>
        </motion.div>
      )}

      {/* Main Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="tg-card p-3">
          <h3 className="text-[9px] font-black text-zinc-400 uppercase tracking-widest mb-4 flex items-center gap-2">
            <TrendingUp className="w-3 h-3 text-zinc-400" />
            Динамика выручки
          </h3>
          <div className="h-[180px]">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={stats.chartData} margin={{ top: 5, right: 5, left: -25, bottom: 0 }}>
                <defs>
                  <linearGradient id="colorRev" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="var(--accent)" stopOpacity={0.1}/>
                    <stop offset="95%" stopColor="var(--accent)" stopOpacity={0}/>
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                <XAxis dataKey="period" axisLine={false} tickLine={false} tick={{ fontSize: 8, fill: '#94a3b8', fontWeight: 'bold' }} />
                <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 8, fill: '#94a3b8', fontWeight: 'bold' }} tickFormatter={(value) => `${value/1000}k`} />
                <Tooltip
                  contentStyle={{ borderRadius: '8px', border: '1px solid #f1f5f9', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)', fontSize: '10px', fontWeight: 'bold' }}
                  formatter={(value: number) => [formatCurrency(value), 'Выручка']}
                />
                <Area type="monotone" dataKey="revenue" stroke="var(--accent)" strokeWidth={2} fillOpacity={1} fill="url(#colorRev)" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="tg-card p-3">
          <h3 className="text-[9px] font-semibold text-zinc-400 uppercase tracking-widest mb-3 flex items-center gap-2">
            <Star className="w-3 h-3 text-zinc-400" />
            Активность блогеров
          </h3>
          <div className="h-[180px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={stats.bloggersByMonth} margin={{ top: 5, right: 5, left: -25, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fontSize: 8, fill: '#94a3b8', fontWeight: 'bold' }} />
                <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 8, fill: '#94a3b8', fontWeight: 'bold' }} />
                <Tooltip
                  contentStyle={{ borderRadius: '8px', border: '1px solid #f1f5f9', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)', fontSize: '10px', fontWeight: 'bold' }}
                  formatter={(value: number) => [value, 'Блогеров']}
                />
                <Bar dataKey="count" fill="var(--accent)" radius={[2, 2, 0, 0]} barSize={16} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* LTV & Top Products */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-1 border-none space-y-4">
          <div className="tg-card p-2.5">
            <h3 className="text-[9px] font-semibold text-zinc-400 uppercase tracking-widest mb-2 flex items-center gap-2">
              <Award className="w-3 h-3 text-zinc-400" />
              LTV по годам
            </h3>
            <div className="space-y-2">
              {Object.entries(stats.ltvByYear).map(([year, ltv]: any) => (
                <div key={year} className="flex items-center justify-between">
                  <div>
                    <p className="text-[8px] font-medium text-zinc-400 uppercase tracking-wider">{year} год</p>
                    <p className="text-[10px] font-semibold text-zinc-900">{formatCurrency(ltv)}</p>
                  </div>
                  <div className="w-16 h-1 bg-zinc-100 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-zinc-900 rounded-full"
                      style={{ width: `${Math.min(100, (ltv / stats.totalRevenue) * 500)}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="tg-card p-2.5">
            <h3 className="text-[9px] font-semibold text-zinc-400 uppercase tracking-widest mb-2 flex items-center gap-2">
              <TrendingUp className="w-3 h-3 text-zinc-400" />
              Лучшие месяцы
            </h3>
            <div className="space-y-1.5">
              {stats.bestMonths.map((m: any, i: number) => (
                <div key={i} className="flex items-center justify-between p-1.5 bg-zinc-50 rounded-lg border border-zinc-100">
                  <div>
                    <p className="text-[8px] font-medium text-zinc-400 uppercase tracking-tight">{m.period}</p>
                    <p className="text-[9px] font-semibold text-zinc-900">{formatCurrency(m.revenue)}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-[8px] text-zinc-400 font-medium uppercase">Заказов</p>
                    <p className="text-[9px] font-semibold text-zinc-900">{m.orders}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="lg:col-span-2 tg-card p-2.5">
          <h3 className="text-[9px] font-semibold text-zinc-400 uppercase tracking-widest mb-3 flex items-center gap-2">
            <ShoppingBag className="w-3 h-3 text-zinc-400" />
            Топ 10 изделий
          </h3>
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead>
                <tr className="text-[9px] font-semibold text-zinc-400 uppercase tracking-widest border-b border-zinc-50">
                  <th className="pb-1.5">#</th>
                  <th className="pb-1.5">Изделие</th>
                  <th className="pb-1.5 text-center">Продано</th>
                  <th className="pb-1.5 text-right">Выручка</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-50">
                {stats.topProducts.map((product: any, i: number) => (
                  <tr key={i} className="text-[9px]">
                    <td className="py-1.5 text-zinc-300 font-mono italic">{i + 1}</td>
                    <td className="py-1.5 text-zinc-600 font-medium">{product.name}</td>
                    <td className="py-1.5 text-center text-zinc-900 font-semibold">{product.count}</td>
                    <td className="py-1.5 text-right text-zinc-900 font-semibold">{formatCurrency(product.total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Comparison Section - Compact */}
      <div className="tg-card bg-zinc-900 p-3 text-white overflow-hidden relative">
        <div className="absolute top-0 right-0 w-32 h-32 bg-zinc-400/10 rounded-full -mr-16 -mt-16 blur-xl" />
        <div className="flex flex-col md:flex-row items-center justify-between gap-3 relative z-10">
          <div className="space-y-1.5 max-w-xl">
            <h2 className="text-[10px] font-semibold uppercase tracking-widest">Сравнение периодов</h2>
            <p className="text-[9px] text-zinc-400 leading-normal">
              Анализ продаж год к году. В текущем месяце {stats.growthText}.
            </p>
            <div className="flex gap-2 pt-0.5">
              <div className="bg-white/5 px-2 py-1 rounded-lg border border-white/5">
                <p className="text-[7px] text-zinc-500 font-medium uppercase tracking-widest">Пик</p>
                <p className="text-[9px] font-semibold uppercase">
                  {stats.chartData.reduce((prev: any, current: any) => (prev.revenue > current.revenue) ? prev : current).period}
                </p>
              </div>
              <div className="bg-white/5 px-2 py-1 rounded-lg border border-white/5">
                <p className="text-[7px] text-zinc-500 font-medium uppercase tracking-widest">Блогеры</p>
                <p className="text-[9px] font-semibold uppercase">
                  {Math.max(...stats.chartData.map((d: any) => d.bloggers))}
                </p>
              </div>
            </div>
          </div>
          <div className="w-full md:w-32 h-16">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={stats.chartData.slice(-6)}>
                <Bar dataKey="revenue" fill="#ffffff" radius={[1, 1, 0, 0]} fillOpacity={0.1} />
                <Bar dataKey="revenue" fill="#ffffff" radius={[1, 1, 0, 0]} barSize={4} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>
    </div>
  );
};

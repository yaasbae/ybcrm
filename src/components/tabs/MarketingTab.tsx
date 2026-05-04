import React, { useState, useEffect } from 'react';
import {
  TrendingUp, Calendar, Star, Search
} from 'lucide-react';
import { formatCurrency, cn } from '../../lib/utils';
import { db } from '../../firebase';
import { doc, onSnapshot, setDoc } from 'firebase/firestore';
import { OrderData } from '../AnalyticsDashboard';

interface MarketingTabProps {
  stats: any;
  data: OrderData[];
  searchTerm: string;
  setSearchTerm: (s: string) => void;
  selectedMonth: string;
}

export const MarketingTab: React.FC<MarketingTabProps> = ({
  stats,
  data,
  searchTerm,
  setSearchTerm,
  selectedMonth,
}) => {
  const [marketingStats, setMarketingStats] = useState<any>({ bloggerMentions: 0, instagramViews: 0, marketingSales: 0 });
  const [salesGoals, setSalesGoals] = useState<any>({ targetSalesCount: 0, targetSalesAmount: 0, targetViews: 0 });

  useEffect(() => {
    const unsubMarketing = onSnapshot(doc(db, 'marketing_stats', selectedMonth), (snap) => {
      if (snap.exists()) setMarketingStats(snap.data());
      else setMarketingStats({ bloggerMentions: 0, instagramViews: 0, marketingSales: 0 });
    });
    const unsubGoals = onSnapshot(doc(db, 'sales_goals', selectedMonth), (snap) => {
      if (snap.exists()) setSalesGoals(snap.data());
      else setSalesGoals({ targetSalesCount: 0, targetSalesAmount: 0, targetViews: 0 });
    });

    return () => {
      unsubMarketing();
      unsubGoals();
    };
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
    </div>
  );
};

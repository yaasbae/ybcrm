import React, { useState, useEffect, useMemo } from 'react';
import { 
  ShoppingBag, Users, DollarSign, TrendingUp, 
  ArrowRight, Calculator, UserCircle, Star, 
  LayoutDashboard, RefreshCcw, AlertCircle, Plus,
  Search, Phone, User, Package, Bot, TrendingDown,
  Calendar as CalendarIcon, CheckCircle2
} from 'lucide-react';
import Papa from 'papaparse';
import { motion } from 'motion/react';
import { formatCurrency, cn } from '../lib/utils';
import { db } from '../firebase';
import { collection, onSnapshot, query, orderBy, doc } from 'firebase/firestore';

interface HomeProps {
  sheetId: string;
  onNavigate: (view: 'calculator' | 'analytics' | 'order-form' | 'products' | 'ai-agent' | 'finance', tab?: 'analytics' | 'clients' | 'marketing' | 'orders') => void;
  selectedMonth: string;
  setSelectedMonth: (month: string) => void;
}

interface OrderData {
  orderId: string;
  date: Date;
  revenue: number;
  productName: string;
  clientName: string;
  clientPhone: string;
  source: string;
  isBlogger: boolean;
}

interface ExpenseData {
  amount: number;
  date: Date;
}

export const Home: React.FC<HomeProps> = ({ sheetId, onNavigate, selectedMonth, setSelectedMonth }) => {
  const [data, setData] = useState<OrderData[]>([]);
  const [fsOrders, setFsOrders] = useState<any[]>([]);
  const [expenses, setExpenses] = useState<ExpenseData[]>([]);
  const [marketingStats, setMarketingStats] = useState<any>(null);
  const [salesGoals, setSalesGoals] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [searchTerm, setSearchTerm] = useState("");

  useEffect(() => {
    // Fetch Expenses for balance calculation
    const q = query(collection(db, 'expenses'), orderBy('date', 'desc'));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const exData = snapshot.docs.map(doc => ({
        amount: doc.data().amount,
        date: doc.data().date?.toDate ? doc.data().date.toDate() : new Date(doc.data().date)
      }));
      setExpenses(exData);
    });

    // Fetch Firestore Orders
    const qOrders = query(collection(db, 'orders'));
    const unsubscribeOrders = onSnapshot(qOrders, (snapshot) => {
      let ords = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));
      // Sort orders client side
      ords.sort((a: any, b: any) => {
        const dateA = new Date(a.orderDate || a.date || 0).getTime();
        const dateB = new Date(b.orderDate || b.date || 0).getTime();
        return dateB - dateA;
      });
      setFsOrders(ords);
    });

    return () => {
      unsubscribe();
      unsubscribeOrders();
    };
  }, []);

  useEffect(() => {
    // Fetch Marketing Stats for selected Month
    const unsubMarketing = onSnapshot(doc(db, 'marketing_stats', selectedMonth), (doc) => {
      if (doc.exists()) setMarketingStats(doc.data());
      else setMarketingStats(null);
    });

    // Fetch Sales Goals for selected Month
    const unsubGoals = onSnapshot(doc(db, 'sales_goals', selectedMonth), (doc) => {
      if (doc.exists()) setSalesGoals(doc.data());
      else setSalesGoals(null);
    });

    return () => {
      unsubMarketing();
      unsubGoals();
    };
  }, [selectedMonth]);

  const fetchData = async () => {
    try {
      setLoading(true);
      const url = `https://docs.google.com/spreadsheets/d/${sheetId}/export?format=csv&t=${Date.now()}`;
      const response = await fetch(url);
      if (!response.ok) throw new Error("Не удалось загрузить данные.");
      const csvText = await response.text();

      Papa.parse(csvText, {
        header: false,
        skipEmptyLines: true,
        complete: (results) => {
          const rows = results.data as string[][];
          if (!rows || rows.length < 2) {
            setLoading(false);
            return;
          }

          const parsed: OrderData[] = [];
          let lastOrderId = "";
          let lastDate = new Date();
          let lastSource = "";

          for (let i = 1; i < rows.length; i++) {
            const row = rows[i];
            if (!row || row.length < 5) continue;

            const rawOrderId = String(row[0] || "").trim();
            if (rawOrderId && !rawOrderId.toLowerCase().includes('номер')) {
              lastOrderId = rawOrderId.replace('#', '').trim();
              const dateStr = row[4];
              if (dateStr) {
                const parts = String(dateStr).split('.');
                if (parts.length === 3) {
                  const day = parseInt(parts[0], 10);
                  const month = parseInt(parts[1], 10) - 1;
                  const year = parseInt(parts[2], 10);
                  if (!isNaN(day) && !isNaN(month) && !isNaN(year)) {
                    lastDate = new Date(year, month, day);
                  }
                }
              }
              lastSource = String(row[17] || "");
            }

            if (!lastOrderId) continue;

            const revenueStr = String(row[14] || "");
            let cleanRevenue = revenueStr.replace(/\s/g, '').replace(',', '.').replace('₽', '').replace('(', '-').replace(')', '');
            const revenue = Math.abs(parseFloat(cleanRevenue) || 0);

            parsed.push({
              orderId: lastOrderId,
              date: lastDate,
              revenue,
              productName: String(row[1] || "").trim(),
              clientName: String(row[18] || "").trim(),
              clientPhone: String(row[19] || "").replace(/[^0-9]/g, ''),
              source: lastSource,
              isBlogger: lastSource.toLowerCase().includes('контент') || lastSource.toLowerCase().includes('блогер')
            });
          }
          setData(parsed);
          setLoading(false);
        },
        error: (err) => {
          setError(err.message);
          setLoading(false);
        }
      });
    } catch (err: any) {
      setError(err.message);
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, [sheetId]);

  const dailyStats = useMemo(() => {
    // Combine Sheet data and Firestore data
    const today = new Date();
    today.setHours(0,0,0,0);

    const fsToday = fsOrders.filter(o => {
      const date = o.orderDate ? new Date(o.orderDate) : new Date();
      date.setHours(0,0,0,0);
      return date.getTime() === today.getTime();
    });

    // Get final payments received today
    const fsFinalToday = fsOrders.filter(o => {
      if (!o.finalPaymentDate) return false;
      const fDate = new Date(o.finalPaymentDate);
      fDate.setHours(0,0,0,0);
      return fDate.getTime() === today.getTime();
    });

    const sheetToday = data.filter(d => {
      const dDate = new Date(d.date);
      dDate.setHours(0,0,0,0);
      return dDate.getTime() === today.getTime();
    });

    // Total actual cash received today
    const cashFromPrepayments = fsToday.reduce((a, b) => a + (Number(b.prepaymentAmount) || 0), 0);
    const cashFromFinals = fsFinalToday.reduce((a, b) => a + (Number(b.remainingAmount) || (Number(b.price) - Number(b.prepaymentAmount)) || 0), 0);
    const cashFromSheets = sheetToday.reduce((a, b) => a + (b.revenue || 0), 0);
    
    const totalTodayCash = cashFromPrepayments + cashFromFinals + cashFromSheets;
    
    const expensesToday = expenses.filter(e => {
      const eDate = new Date(e.date);
      eDate.setHours(0,0,0,0);
      return eDate.getTime() === today.getTime();
    }).reduce((a, b) => a + b.amount, 0);

    const totalOrdersCount = fsToday.length + (sheetToday.length > 0 ? 1 : 0); // Simplification

    const bloggerOrders = fsOrders.filter(o => {
      const date = o.orderDate ? new Date(o.orderDate) : new Date();
      date.setHours(0,0,0,0);
      return date.getTime() === today.getTime() && o.saleSource === 'Блогер';
    }).length + sheetToday.filter(d => d.isBlogger).length;

    // Kanban Statuses
    const kanbanCounts = {
      new: fsOrders.filter(o => o.status === 'Новый').length,
      production: fsOrders.filter(o => o.status === 'В производстве').length,
      ready: fsOrders.filter(o => o.status === 'Готов к отгрузке').length,
      shipped: fsOrders.filter(o => o.status === 'Отгружен').length,
    };

    const [selYear, selMonth] = selectedMonth.split('-').map(Number);
    const startOfSelectedMonth = new Date(selYear, selMonth - 1, 1);
    const endOfSelectedMonth = new Date(selYear, selMonth, 0, 23, 59, 59);

    const monthlyFsOrders = fsOrders.filter(o => {
      const d = o.orderDate ? new Date(o.orderDate) : new Date();
      return d >= startOfSelectedMonth && d <= endOfSelectedMonth;
    });

    const monthlySheetOrders = data.filter(o => 
      o.date >= startOfSelectedMonth && o.date <= endOfSelectedMonth
    );

    const monthlyOrdersCount = monthlyFsOrders.length + monthlySheetOrders.length;
    
    const monthlyRevenue = monthlyFsOrders.reduce((acc, b) => {
      let sum = Number(b.prepaymentAmount) || 0;
      if (b.paymentStatus === 'paid') sum += (Number(b.remainingAmount) || (Number(b.price) - (Number(b.prepaymentAmount)||0)));
      return acc + sum;
    }, 0) + monthlySheetOrders.reduce((a, b) => a + b.revenue, 0);

    const monthlyBloggerOrders = fsOrders.filter(o => {
      const d = o.orderDate ? new Date(o.orderDate) : new Date();
      return d >= startOfSelectedMonth && d <= endOfSelectedMonth && o.saleSource === 'Блогер';
    }).length + monthlySheetOrders.filter(d => d.isBlogger).length;

    // Financial balance - Filtered for selected month
    const relevantFsOrders = fsOrders.filter(o => {
      const d = o.orderDate ? new Date(o.orderDate) : new Date();
      return d >= startOfSelectedMonth && d <= endOfSelectedMonth;
    });

    const relevantSheetOrders = data.filter(d => d.date >= startOfSelectedMonth && d.date <= endOfSelectedMonth);
    const relevantExpenses = expenses.filter(e => e.date >= startOfSelectedMonth && e.date <= endOfSelectedMonth);

    const totalIncomesReceived = relevantFsOrders.reduce((a, b) => {
      let sum = Number(b.prepaymentAmount) || 0;
      if (b.paymentStatus === 'paid') sum += (Number(b.remainingAmount) || (Number(b.price) - (Number(b.prepaymentAmount)||0)));
      return a + sum;
    }, 0) + relevantSheetOrders.reduce((a, b) => a + b.revenue, 0);

    const totalExpenses = relevantExpenses.reduce((a, b) => a + b.amount, 0);

    // Products
    const productCounts = new Map<string, number>();
    fsToday.forEach(o => {
      const name = o.products || "Товар";
      productCounts.set(name, (productCounts.get(name) || 0) + 1);
    });
    sheetToday.forEach(d => {
      if (d.productName) {
        productCounts.set(d.productName, (productCounts.get(d.productName) || 0) + 1);
      }
    });

    const topProducts = Array.from(productCounts.entries())
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count);

    return {
      date: today,
      totalRevenue: totalTodayCash,
      totalOrders: totalOrdersCount,
      monthlyOrdersCount,
      monthlyRevenue,
      bloggerOrders: monthlyBloggerOrders + (marketingStats?.bloggerMentions || 0),
      marketingSales: marketingStats?.marketingSales || 0,
      marketingViews: marketingStats?.instagramViews || 0,
      targetSales: salesGoals?.targetSalesCount || 0,
      targetSalesAmount: salesGoals?.targetSalesAmount || 0,
      targetViews: salesGoals?.targetViews || 0,
      topProducts,
      totalIncomes: totalIncomesReceived,
      totalExpenses,
      expensesToday,
      kanbanCounts,
      balance: totalIncomesReceived - totalExpenses
    };
  }, [data, fsOrders, expenses, marketingStats, salesGoals]);

  return (
    <div className="min-h-screen font-sans selection:bg-pink-100" style={{ backgroundColor: 'var(--bg)', color: 'var(--text)' }}>
      <div className="max-w-5xl mx-auto px-4 py-6 space-y-8">
        
        {/* Compact Hero Section / Daily Summary removed - moved to App layout */}
        <section className="space-y-4">
          <span className="text-[7px] font-bold text-zinc-300 opacity-50 block mb-1">[YB-H-ROOT]</span>
          {loading ? (
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              {[1, 2, 3, 4].map(i => (
                <div key={i} className="h-20 bg-slate-100 animate-pulse rounded-xl" />
              ))}
            </div>
          ) : error ? (
            <div className="p-4 bg-red-50 rounded-xl border border-red-100 flex items-center gap-3 text-red-600 text-xs text-slate-900">
              <AlertCircle className="w-4 h-4" />
              <p className="font-bold">{error}</p>
            </div>
          ) : dailyStats ? (
            <div className="space-y-6">
              {/* Infographic Workspace */}
              <div className="rounded-2xl p-5 shadow-sm overflow-hidden relative" style={{ backgroundColor: 'var(--card-bg)', border: '1px solid var(--card-border)' }}>
                <span className="absolute top-2 left-2 text-[6px] font-bold text-zinc-400 opacity-40 z-20">[YB-H-DASH]</span>
                {/* Background Decor */}
                <div className="absolute top-0 right-0 w-64 h-64 rounded-full blur-3xl -mr-32 -mt-32 opacity-30" style={{ backgroundColor: 'var(--accent)' }} />
                
                <div className="relative space-y-8">
                  {/* Financial & General Pulse */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-8 items-center">
                    <div className="space-y-4">
                      <div className="flex items-center gap-2">
                        <span className="text-[6px] font-bold text-zinc-300 mr-1">[YB-H-BAL]</span>
                        <DollarSign className="w-3.5 h-3.5 text-slate-400" />
                        <span className="text-[9px] font-bold uppercase tracking-widest" style={{ color: 'var(--text-muted)' }}>Баланс за выбранный месяц</span>
                      </div>
                      <div>
                        <p className={cn("text-3xl font-black tracking-tighter leading-none")} style={{ color: dailyStats.balance >= 0 ? 'var(--text)' : '#f97316' }}>
                          {formatCurrency(dailyStats.balance)}
                        </p>
                        <div className="flex items-center gap-3 mt-2 text-[9px] font-bold uppercase tracking-wider">
                           <span className="text-emerald-500">Приход: {formatCurrency(dailyStats.totalIncomes)}</span>
                           <span style={{ color: 'var(--text-muted)' }}>Расход: {formatCurrency(dailyStats.totalExpenses)}</span>
                        </div>
                      </div>
                    </div>

                    <div className="space-y-4">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span className="text-[6px] font-bold text-zinc-300 mr-1">[YB-H-GOAL]</span>
                          <Bot className="w-3.5 h-3.5 text-purple-500" />
                          <h3 className="text-[10px] font-bold uppercase tracking-widest" style={{ color: 'var(--text-muted)' }}>План продаж (Месяц)</h3>
                        </div>
                        <span className="text-[9px] font-bold px-1.5 py-0.5 rounded leading-none border" style={{ backgroundColor: 'var(--bg)', color: 'var(--text-muted)', borderColor: 'var(--card-border)' }}>
                          Цель: {formatCurrency(dailyStats.targetSalesAmount)}
                        </span>
                      </div>
                      <div className="space-y-2">
                        <div className="flex justify-between items-end">
                          <div className="space-y-0.5">
                            <p className="text-xl font-black leading-none" style={{ color: 'var(--text)' }}>
                              {formatCurrency(dailyStats.monthlyRevenue)}
                            </p>
                            <p className="text-[9px] font-bold uppercase" style={{ color: 'var(--text-muted)' }}>Общая выручка</p>
                          </div>
                          <div className="text-right space-y-0.5">
                            <p className="text-xs font-black text-purple-600 leading-none">
                              {dailyStats.marketingViews.toLocaleString()}
                            </p>
                            <p className="text-[9px] text-slate-400 font-bold uppercase">Просмотров Insta</p>
                          </div>
                        </div>
                        <div className="h-1.5 w-full bg-slate-50 rounded-full overflow-hidden">
                          <motion.div 
                            initial={{ width: 0 }}
                            animate={{ width: `${Math.min(100, (dailyStats.monthlyRevenue / (dailyStats.targetSalesAmount || 1)) * 100)}%` }}
                            className="h-full bg-purple-500 shadow-[0_0_8px_rgba(168,85,247,0.4)]" 
                          />
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Marketing & Traffic Infographic */}
                  <div className="space-y-4 pt-4 border-t border-slate-50">
                    <span className="text-[6px] font-bold text-zinc-300 block">[YB-H-MKT]</span>
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2 text-slate-400">
                        <Star className="w-3.5 h-3.5 text-amber-500" />
                        <h3 className="text-[10px] font-bold uppercase tracking-widest">Маркетинг и охваты</h3>
                      </div>
                      <div className="flex gap-2">
                         <span className="text-[9px] font-bold text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded">
                          Продаж: {dailyStats.marketingSales}
                        </span>
                        <span className="text-[9px] font-bold text-amber-600 bg-amber-50 px-2 py-0.5 rounded">
                          Отметки: {dailyStats.bloggerOrders}
                        </span>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      {/* Views Progress */}
                      <div className="tg-card p-3 bg-slate-50 border-none">
                        <div className="flex justify-between items-center mb-2">
                          <span className="text-[9px] font-bold uppercase text-slate-400">Охваты (Views)</span>
                          <span className="text-[10px] font-black text-slate-900">{Math.round((dailyStats.marketingViews / (dailyStats.targetViews || 1)) * 100)}%</span>
                        </div>
                        <div className="h-1 bg-slate-200 rounded-full overflow-hidden">
                          <motion.div 
                            initial={{ width: 0 }}
                            animate={{ width: `${Math.min(100, (dailyStats.marketingViews / (dailyStats.targetViews || 1)) * 100)}%` }}
                            className="h-full bg-slate-900" 
                          />
                        </div>
                        <p className="text-[8px] mt-1.5 text-slate-400 font-medium">
                          План: {dailyStats.targetViews.toLocaleString()} охватов
                        </p>
                      </div>
                      {/* Marketing Efficiency */}
                      <div className="tg-card p-3 bg-emerald-50 border-none">
                        <div className="flex justify-between items-center mb-1">
                          <span className="text-[9px] font-bold uppercase text-emerald-600">Маркетинговые продажи</span>
                          <TrendingUp className="w-3 h-3 text-emerald-600" />
                        </div>
                        <p className="text-lg font-black text-emerald-700 leading-none">{dailyStats.marketingSales} шт</p>
                        <p className="text-[8px] mt-1 text-emerald-600/60 font-medium uppercase tracking-widest">Конверсия из маркетинга</p>
                      </div>
                    </div>
                  </div>

                  {/* Kanban Pipeline Infographic */}
                  <div className="space-y-4 pt-4 border-t border-slate-50">
                    <span className="text-[6px] font-bold text-zinc-300 block">[YB-H-PB]</span>
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2 text-slate-400">
                        <LayoutDashboard className="w-3.5 h-3.5" />
                        <h3 className="text-[10px] font-bold uppercase tracking-widest">Произовдственный конвейер</h3>
                      </div>
                      <span className="text-[9px] font-bold text-slate-400 uppercase tracking-widest bg-slate-50 px-2 py-0.5 rounded">
                        В работе: {dailyStats.kanbanCounts.new + dailyStats.kanbanCounts.production + dailyStats.kanbanCounts.ready}
                      </span>
                    </div>

                    <div className="grid grid-cols-4 gap-2">
                      {[
                        { label: 'Новые', count: dailyStats.kanbanCounts.new, color: 'bg-slate-100 text-slate-600', icon: Plus },
                        { label: 'Пошив', count: dailyStats.kanbanCounts.production, color: 'bg-blue-50 text-blue-600', icon: RefreshCcw },
                        { label: 'Готовы', count: dailyStats.kanbanCounts.ready, color: 'bg-emerald-50 text-emerald-600', icon: CheckCircle2 },
                        { label: 'Отгруз.', count: dailyStats.kanbanCounts.shipped, color: 'bg-slate-50 text-slate-400', icon: Package }
                      ].map((s, i) => (
                        <div key={i} className={cn("rounded-xl p-2.5 flex flex-col justify-between h-16 transition-all border border-transparent hover:border-slate-100", s.color)}>
                          <div className="flex justify-between items-start">
                            <s.icon className="w-3 h-3 opacity-50" />
                            <span className="text-lg font-black leading-none">{s.count}</span>
                          </div>
                          <span className="text-[8px] font-bold uppercase tracking-tighter leading-none truncate">{s.label}</span>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Calendar Activity Strip - Expanded to 30 Days */}
                  <div className="space-y-4 pt-4 border-t border-slate-50">
                    <span className="text-[6px] font-bold text-zinc-300 block">[YB-H-CAL]</span>
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2 text-slate-400">
                        <CalendarIcon className="w-3.5 h-3.5" />
                        <h3 className="text-[10px] font-bold uppercase tracking-widest">Календарь активности</h3>
                      </div>
                      <span className="text-[8px] font-bold text-slate-400 uppercase tracking-widest">Последние 30 дней</span>
                    </div>
                    <div className="grid grid-cols-6 sm:grid-cols-10 md:grid-cols-15 lg:grid-cols-[repeat(15,minmax(0,1fr))] gap-1">
                      {Array.from({ length: 30 }).map((_, i) => {
                        const offset = i - 29;
                        const d = new Date();
                        d.setDate(d.getDate() + offset);
                        const isToday = offset === 0;
                        const hasOrders = fsOrders.some(o => {
                          const oDate = new Date(o.orderDate || Date.now());
                          oDate.setHours(0,0,0,0);
                          const compDate = new Date(d);
                          compDate.setHours(0,0,0,0);
                          return oDate.getTime() === compDate.getTime();
                        });

                        return (
                          <div 
                            key={offset} 
                            className={cn(
                              "flex flex-col items-center py-1.5 rounded-md transition-all border shrink-0",
                              isToday ? "bg-slate-900 border-slate-900 text-white shadow-md shadow-slate-200" : "bg-white border-slate-50 text-slate-400"
                            )}
                          >
                            <span className="text-[5px] font-bold uppercase tracking-tighter mb-0.5 opacity-60">
                              {d.toLocaleDateString('ru-RU', { weekday: 'short' })}
                            </span>
                            <span className="text-[8px] font-black leading-none">{d.getDate()}</span>
                            {hasOrders && (
                              <div className={cn("w-0.5 h-0.5 rounded-full mt-0.5", isToday ? "bg-white" : "bg-emerald-400")} />
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
              </div>

              {/* Today's Sales List Integrated */}
              {dailyStats.topProducts.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  <h3 className="text-[9px] font-bold text-slate-400 uppercase tracking-widest flex items-center gap-2 mr-2 self-center">
                    <TrendingUp className="w-3 h-3" /> Топ сегодня:
                  </h3>
                  {dailyStats.topProducts.slice(0, 5).map((p, i) => (
                    <div key={i} className="flex items-center gap-1.5 px-2 py-1 bg-white rounded-lg border border-slate-100 shadow-sm">
                      <span className="text-[10px] font-medium text-slate-600">{p.name}</span>
                      <span className="text-[9px] font-black text-slate-900 bg-slate-50 px-1 py-0.5 rounded leading-none">{p.count}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <div className="p-8 bg-slate-50 rounded-xl text-center border border-dashed border-slate-200">
              <p className="text-slate-400 text-xs font-bold uppercase tracking-widest">Нет данных</p>
            </div>
          )}
        </section>

        {/* Footer Info - Compact */}
        <footer className="pt-8 border-t border-slate-100 flex justify-between items-center text-slate-400 text-[8px] font-bold uppercase tracking-[0.2em]">
          <div className="flex items-center gap-3">
            <span>© 2026 YBCRM</span>
            <span className="opacity-30">•</span>
            <span>SYSTEM v2.2</span>
          </div>
          <div className="flex items-center gap-1.5 opacity-50">
            <RefreshCcw className="w-2.5 h-2.5" />
            <span>FINANCE SYNC ACTIVE</span>
          </div>
        </footer>
      </div>
    </div>
  );
};

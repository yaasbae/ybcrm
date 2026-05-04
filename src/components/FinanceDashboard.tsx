import React, { useState, useEffect, useMemo } from 'react';
import { 
  ArrowLeft, DollarSign, TrendingUp, TrendingDown, 
  Plus, Calendar as CalendarIcon, PieChart, 
  ArrowRight, Save, Trash2, AlertCircle, 
  ChevronRight, ChevronLeft, Briefcase, CreditCard,
  Building, UserCheck, Filter, Download
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { cn, formatCurrency } from '../lib/utils';
import { db, OperationType, handleFirestoreError } from '../firebase';
import { collection, onSnapshot, doc, setDoc, query, orderBy, deleteDoc, addDoc, serverTimestamp, getDocs } from 'firebase/firestore';

interface FinanceDashboardProps {
  onBack: () => void;
}

interface Expense {
  id: string;
  category: 'rent' | 'payroll' | 'credit' | 'marketing' | 'other';
  amount: number;
  date: Date;
  description: string;
  isRecurring?: boolean;
}

interface Income {
  id: string;
  source: string;
  amount: number;
  date: Date;
}

export const FinanceDashboard: React.FC<FinanceDashboardProps> = ({ onBack }) => {
  const [activeTab, setActiveTab] = useState<'dds' | 'calendar' | 'expenses'>('dds');
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [orders, setOrders] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [newExpense, setNewExpense] = useState({
    category: 'other' as const,
    amount: '',
    description: '',
    date: new Date().toISOString().split('T')[0]
  });

  const [currentDate, setCurrentDate] = useState(new Date());

  useEffect(() => {
    // Fetch Expenses
    const qExpenses = query(collection(db, 'expenses'), orderBy('date', 'desc'));
    const unsubscribeExpenses = onSnapshot(qExpenses, (snapshot) => {
      const exData = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data(),
        date: doc.data().date?.toDate ? doc.data().date.toDate() : new Date(doc.data().date)
      })) as Expense[];
      setExpenses(exData);
    });

    // Fetch Orders for Incomes
    const qOrders = query(collection(db, 'orders'));
    const unsubscribeOrders = onSnapshot(qOrders, (snapshot) => {
      let ordData = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data(),
        // Normalize date from OrderForm (usually string "DD.MM.YYYY" or ISO)
        date: doc.data().orderDate ? new Date(doc.data().orderDate) : (doc.data().date ? new Date(doc.data().date) : new Date())
      }));
      // Sort client side
      ordData.sort((a: any, b: any) => {
        const dateA = new Date(a.date || 0).getTime();
        const dateB = new Date(b.date || 0).getTime();
        return dateB - dateA;
      });
      setOrders(ordData);
      setLoading(false);
    });

    return () => {
      unsubscribeExpenses();
      unsubscribeOrders();
    };
  }, []);

  const handleAddExpense = async () => {
    if (!newExpense.amount || !newExpense.description) return;
    try {
      await addDoc(collection(db, 'expenses'), {
        category: newExpense.category,
        amount: Number(newExpense.amount),
        description: newExpense.description,
        date: new Date(newExpense.date),
        createdAt: serverTimestamp()
      });
      setIsModalOpen(false);
      setNewExpense({
        category: 'other',
        amount: '',
        description: '',
        date: new Date().toISOString().split('T')[0]
      });
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, 'expenses');
    }
  };

  const handleDeleteExpense = async (id: string) => {
    try {
      await deleteDoc(doc(db, 'expenses', id));
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, 'expenses');
    }
  };

  const financialStats = useMemo(() => {
    let totalReceived = 0;
    let totalOwed = 0;
    
    orders.forEach(o => {
      const prepayment = Number(o.prepaymentAmount) || 0;
      const price = Number(o.price) || 0;
      const remains = Number(o.remainingAmount) || (price - prepayment);
      
      totalReceived += prepayment;
      if (o.paymentStatus === 'paid') {
        totalReceived += remains;
      } else {
        totalOwed += remains;
      }
    });

    const totalExpenses = expenses.reduce((a, b) => a + b.amount, 0);
    const balance = totalReceived - totalExpenses;

    // Monthly breakdown
    const monthlyData: { [key: string]: { income: number; expense: number; expected: number } } = {};
    
    orders.forEach(o => {
      // Handle Order Date (Prepayment Month)
      const orderDate = o.date ? (typeof o.date === 'string' ? new Date(o.date) : o.date) : new Date();
      const oMonth = orderDate.toLocaleString('default', { month: 'short', year: 'numeric' });
      
      if (!monthlyData[oMonth]) monthlyData[oMonth] = { income: 0, expense: 0, expected: 0 };
      const prepayment = Number(o.prepaymentAmount) || 0;
      monthlyData[oMonth].income += prepayment;
      monthlyData[oMonth].expected += (Number(o.price) || 0);
      
      // Handle Final Payment Date if paid
      if (o.paymentStatus === 'paid' && o.finalPaymentDate) {
        const finalDate = new Date(o.finalPaymentDate);
        const finalMonth = finalDate.toLocaleString('default', { month: 'short', year: 'numeric' });
        if (!monthlyData[finalMonth]) monthlyData[finalMonth] = { income: 0, expense: 0, expected: 0 };
        monthlyData[finalMonth].income += (Number(o.price) || 0) - prepayment;
      }
    });

    expenses.forEach(e => {
      const month = e.date?.toLocaleString('default', { month: 'short', year: 'numeric' });
      if (month) {
        if (!monthlyData[month]) monthlyData[month] = { income: 0, expense: 0, expected: 0 };
        monthlyData[month].expense += e.amount;
      }
    });

    return { received: totalReceived, owed: totalOwed, expenses: totalExpenses, balance, monthlyData };
  }, [orders, expenses]);

  const categories = {
    rent: { label: 'Аренда', icon: Building, color: 'text-orange-500', bg: 'bg-orange-50' },
    payroll: { label: 'ФОТ (Зарплаты)', icon: UserCheck, color: 'text-blue-500', bg: 'bg-blue-50' },
    credit: { label: 'Кредиты', icon: CreditCard, color: 'text-red-500', bg: 'bg-red-50' },
    marketing: { label: 'Маркетинг', icon: TrendingUp, color: 'text-indigo-500', bg: 'bg-indigo-50' },
    other: { label: 'Прочее', icon: Briefcase, color: 'text-slate-500', bg: 'bg-slate-50' }
  };

  return (
    <div className="min-h-screen bg-slate-50/50">
      <div className="max-w-5xl mx-auto px-4 py-8 space-y-8">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <button 
              onClick={onBack}
              className="p-2 hover:bg-slate-100 rounded-full transition-colors"
            >
              <ArrowLeft size={20} />
            </button>
            <div>
              <h1 className="text-2xl font-bold tracking-tight text-slate-900">Финансы & ДДС</h1>
              <p className="text-slate-500 text-sm">Управление денежными потоками и расходами</p>
            </div>
          </div>
          <button 
            onClick={() => setIsModalOpen(true)}
            className="bg-slate-900 text-white px-4 py-2 rounded-xl text-sm font-bold flex items-center gap-2 hover:bg-slate-800 transition-all shadow-lg active:scale-95"
          >
            <Plus size={18} />
            Добавить расход
          </button>
        </div>

        {/* Global Stats */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
          <div className="bg-white p-6 rounded-2xl border border-slate-100 shadow-sm space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Получено (Касса)</span>
              <div className="p-2 bg-emerald-50 text-emerald-500 rounded-lg">
                <TrendingUp size={16} />
              </div>
            </div>
            <p className="text-2xl font-black text-slate-900">{formatCurrency(financialStats.received)}</p>
            <p className="text-[10px] text-emerald-500 font-bold uppercase tracking-widest leading-none">Реальные приходы</p>
          </div>

          <div className="bg-white p-6 rounded-2xl border border-slate-100 shadow-sm space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Дебиторка (Долги)</span>
              <div className="p-2 bg-orange-50 text-orange-500 rounded-lg">
                <AlertCircle size={16} />
              </div>
            </div>
            <p className="text-2xl font-black text-slate-900">{formatCurrency(financialStats.owed)}</p>
            <p className="text-[10px] text-orange-500 font-bold uppercase tracking-widest leading-none">Ожидаемые доплаты</p>
          </div>

          <div className="bg-white p-6 rounded-2xl border border-slate-100 shadow-sm space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Расходы</span>
              <div className="p-2 bg-red-50 text-red-500 rounded-lg">
                <TrendingDown size={16} />
              </div>
            </div>
            <p className="text-2xl font-black text-slate-900">{formatCurrency(financialStats.expenses)}</p>
            <p className="text-[10px] text-red-500 font-bold uppercase tracking-widest leading-none">ФОТ, аренда и пр.</p>
          </div>

          <div className="bg-white p-6 rounded-2xl border border-slate-100 shadow-sm space-y-2 border-l-4 border-l-slate-900">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Итого Чистыми</span>
              <div className={cn("p-2 rounded-lg", financialStats.balance >= 0 ? "bg-slate-900 text-white" : "bg-orange-50 text-orange-500")}>
                <DollarSign size={16} />
              </div>
            </div>
            <p className="text-2xl font-black text-slate-900">{formatCurrency(financialStats.balance)}</p>
            <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest leading-none">Сальдо в кассе</p>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex gap-2 p-1 bg-slate-100/50 rounded-2xl w-fit">
          {[
            { id: 'dds', label: 'ДДС (Потоки)', icon: PieChart },
            { id: 'calendar', label: 'Календарь', icon: CalendarIcon },
            { id: 'expenses', label: 'Расходы', icon: Trash2 },
          ].map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as any)}
              className={cn(
                "px-4 py-2 rounded-xl text-xs font-bold uppercase tracking-widest transition-all flex items-center gap-2",
                activeTab === tab.id ? "bg-white text-slate-900 shadow-sm" : "text-slate-400 hover:text-slate-600"
              )}
            >
              <tab.icon size={14} />
              {tab.label}
            </button>
          ))}
        </div>

        {/* Content */}
        <AnimatePresence mode="wait">
          {activeTab === 'dds' && (
            <motion.div
              layout
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              className="space-y-6"
            >
              <div className="bg-white rounded-3xl border border-slate-100 shadow-sm overflow-hidden">
                <div className="p-6 border-b border-slate-50 flex items-center justify-between">
                  <h3 className="text-sm font-bold uppercase tracking-widest">Движение денежных средств</h3>
                  <Download size={16} className="text-slate-400 cursor-pointer hover:text-slate-600" />
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead>
                      <tr className="bg-slate-50/50">
                        <th className="px-6 py-4 text-left text-[10px] font-bold text-slate-400 uppercase tracking-widest">Период</th>
                        <th className="px-6 py-4 text-right text-[10px] font-bold text-slate-400 uppercase tracking-widest">Заказы (План)</th>
                        <th className="px-6 py-4 text-right text-[10px] font-bold text-slate-400 uppercase tracking-widest">Касса (Факт)</th>
                        <th className="px-6 py-4 text-right text-[10px] font-bold text-slate-400 uppercase tracking-widest">Расход</th>
                        <th className="px-6 py-4 text-right text-[10px] font-bold text-slate-400 uppercase tracking-widest">Сальдо</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-50">
                      {Object.entries(financialStats.monthlyData).sort((a,b) => b[0].localeCompare(a[0])).map(([period, values]) => (
                        <tr key={period} className="hover:bg-slate-50/50 transition-colors">
                          <td className="px-6 py-4 text-sm font-bold text-slate-700">{period}</td>
                          <td className="px-6 py-4 text-right text-xs font-bold text-slate-400">{formatCurrency(values.expected)}</td>
                          <td className="px-6 py-4 text-right text-sm font-bold text-emerald-600">+{formatCurrency(values.income)}</td>
                          <td className="px-6 py-4 text-right text-sm font-bold text-red-500">-{formatCurrency(values.expense)}</td>
                          <td className={cn("px-6 py-4 text-right text-sm font-black", values.income - values.expense >= 0 ? "text-slate-900" : "text-orange-500")}>
                            {formatCurrency(values.income - values.expense)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </motion.div>
          )}

          {activeTab === 'expenses' && (
            <motion.div
              layout
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              className="grid grid-cols-1 md:grid-cols-3 gap-8"
            >
              <div className="md:col-span-2 space-y-4">
                {expenses.length > 0 ? (
                  expenses.map((expense) => {
                    const category = categories[expense.category as keyof typeof categories] || categories.other;
                    return (
                      <div key={expense.id} className="bg-white p-4 rounded-2xl border border-slate-100 shadow-sm flex items-center justify-between group hover:border-slate-200 transition-all">
                        <div className="flex items-center gap-4">
                          <div className={cn("p-3 rounded-xl", category.bg, category.color)}>
                            <category.icon size={20} />
                          </div>
                          <div>
                            <h4 className="font-bold text-slate-900 text-sm">{expense.description}</h4>
                            <div className="flex items-center gap-2 text-[10px] font-bold text-slate-400 uppercase tracking-widest">
                              <span>{category.label}</span>
                              <span>•</span>
                              <span>{expense.date.toLocaleDateString('ru-RU')}</span>
                            </div>
                          </div>
                        </div>
                        <div className="flex items-center gap-6">
                          <div className="text-right">
                            <p className="text-base font-black text-red-500">-{formatCurrency(expense.amount)}</p>
                          </div>
                          <button 
                            onClick={() => handleDeleteExpense(expense.id)}
                            className="p-2 text-slate-300 hover:text-red-500 transition-colors"
                          >
                            <Trash2 size={16} />
                          </button>
                        </div>
                      </div>
                    );
                  })
                ) : (
                  <div className="bg-slate-50 rounded-3xl border border-dashed border-slate-200 p-12 text-center">
                    <p className="text-slate-400 font-bold uppercase tracking-widest text-sm">Расходов пока нет</p>
                  </div>
                )}
              </div>

              <div className="space-y-6">
                <div className="bg-white p-6 rounded-2xl border border-slate-100 shadow-sm">
                  <h3 className="text-xs font-bold uppercase tracking-widest text-slate-400 mb-6">Категории расходов</h3>
                  <div className="space-y-4">
                    {Object.entries(categories).map(([key, cat]) => {
                      const total = expenses.filter(e => e.category === key).reduce((a, b) => a + b.amount, 0);
                      return (
                        <div key={key} className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <div className={cn("w-2 h-2 rounded-full", cat.color.replace('text-', 'bg-'))} />
                            <span className="text-xs font-bold text-slate-600">{cat.label}</span>
                          </div>
                          <span className="text-xs font-bold text-slate-900">{formatCurrency(total)}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            </motion.div>
          )}

          {activeTab === 'calendar' && (
            <motion.div
              layout
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
            >
              <div className="bg-white rounded-3xl border border-slate-100 shadow-sm overflow-hidden">
                <div className="p-6 border-b border-slate-50 flex items-center justify-between">
                  <div className="flex items-center gap-4">
                    <button onClick={() => {
                      const newDate = new Date(currentDate);
                      newDate.setMonth(newDate.getMonth() - 1);
                      setCurrentDate(newDate);
                    }} className="p-2 hover:bg-slate-50 rounded-full">
                      <ChevronLeft size={20} />
                    </button>
                    <h3 className="text-sm font-bold uppercase tracking-widest">
                      {currentDate.toLocaleString('default', { month: 'long', year: 'numeric' })}
                    </h3>
                    <button onClick={() => {
                      const newDate = new Date(currentDate);
                      newDate.setMonth(newDate.getMonth() + 1);
                      setCurrentDate(newDate);
                    }} className="p-2 hover:bg-slate-50 rounded-full">
                      <ChevronRight size={20} />
                    </button>
                  </div>
                </div>
                <div className="p-4 overflow-x-auto">
                   <div className="min-w-[800px] space-y-4">
                     <div className="grid grid-cols-7 gap-2">
                        {['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'].map(d => (
                          <div key={d} className="text-center py-2 text-[10px] font-black text-slate-400 uppercase tracking-widest">{d}</div>
                        ))}
                     </div>
                     <div className="grid grid-cols-7 gap-2">
                        {/* Placeholder for calendar logic - basic view */}
                        {Array.from({ length: 31 }).map((_, i) => {
                          const day = i + 1;
                          const currentDateObj = new Date(currentDate.getFullYear(), currentDate.getMonth(), day);
                          const dateString = currentDateObj.toISOString().split('T')[0];

                          const dayExpenses = expenses.filter(e => e.date.getDate() === day && e.date.getMonth() === currentDate.getMonth() && e.date.getFullYear() === currentDate.getFullYear());
                          
                          // Prepayments (received on order creation date)
                          const dayPrepayments = orders.filter(o => {
                            const oDate = o.date ? new Date(o.date) : null;
                            return oDate && oDate.getDate() === day && oDate.getMonth() === currentDate.getMonth() && oDate.getFullYear() === currentDate.getFullYear();
                          }).reduce((a, b) => a + (Number(b.prepaymentAmount) || 0), 0);

                          // Final payments (received on finalPaymentDate)
                          const dayFinalPayments = orders.filter(o => {
                            if (!o.finalPaymentDate) return false;
                            const fDate = new Date(o.finalPaymentDate);
                            return fDate.getDate() === day && fDate.getMonth() === currentDate.getMonth() && fDate.getFullYear() === currentDate.getFullYear();
                          }).reduce((a, b) => a + (Number(b.remainingAmount) || 0) + (b.paymentStatus === 'paid' && !b.prepaymentAmount ? Number(b.price) : 0), 0);
                          
                          const totalDayIncome = dayPrepayments + dayFinalPayments;

                          return (
                            <div key={i} className={cn(
                              "min-h-[100px] p-2 bg-slate-50 border border-slate-100 rounded-xl space-y-2 relative group hover:border-slate-300 transition-all",
                              dayExpenses.length > 0 && "bg-red-50/20",
                              totalDayIncome > 0 && "bg-emerald-50/20"
                            )}>
                              <span className="text-[10px] font-bold text-slate-400">{day}</span>
                              <div className="space-y-1 mt-1">
                                {dayPrepayments > 0 && (
                                  <div className="text-[8px] font-bold text-emerald-600 bg-emerald-100/50 rounded px-1 flex justify-between">
                                    <span>Пр:</span>
                                    <span>+{formatCurrency(dayPrepayments)}</span>
                                  </div>
                                )}
                                {dayFinalPayments > 0 && (
                                  <div className="text-[8px] font-bold text-blue-600 bg-blue-100/50 rounded px-1 flex justify-between">
                                    <span>Доп:</span>
                                    <span>+{formatCurrency(dayFinalPayments)}</span>
                                  </div>
                                )}
                                {dayExpenses.map(e => (
                                  <div key={e.id} className="text-[8px] font-bold text-red-600 bg-red-100/50 rounded px-1 flex justify-between">
                                    <span>Р:</span>
                                    <span>-{formatCurrency(e.amount)}</span>
                                  </div>
                                ))}
                              </div>
                            </div>
                          );
                        })}
                     </div>
                   </div>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Add Expense Modal */}
      <AnimatePresence>
        {isModalOpen && (
          <div className="fixed inset-0 z-[200] flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsModalOpen(false)}
              className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm"
            />
            <motion.div 
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="bg-white w-full max-w-md rounded-[2rem] shadow-2xl relative z-10 overflow-hidden"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="p-8 space-y-6">
                <div className="flex justify-between items-center">
                  <h2 className="text-xl font-bold tracking-tight">Новый расход</h2>
                  <button onClick={() => setIsModalOpen(false)} className="p-2 hover:bg-slate-100 rounded-full transition-colors text-slate-400">
                    <Trash2 size={20} />
                  </button>
                </div>

                <div className="space-y-4">
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-bold uppercase tracking-widest text-slate-400 ml-1">Описание</label>
                    <input 
                      type="text"
                      placeholder="Например: Аренда склада"
                      value={newExpense.description}
                      onChange={e => setNewExpense({...newExpense, description: e.target.value})}
                      className="w-full bg-slate-50 border-none rounded-2xl px-4 py-3 text-sm focus:ring-2 focus:ring-slate-200 outline-none transition-all"
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-1.5">
                      <label className="text-[10px] font-bold uppercase tracking-widest text-slate-400 ml-1">Сумма (₽)</label>
                      <input 
                        type="number"
                        placeholder="0.00"
                        value={Number.isNaN(newExpense.amount) || newExpense.amount === undefined || newExpense.amount === null ? "" : newExpense.amount}
                        onChange={e => setNewExpense({...newExpense, amount: e.target.value})}
                        className="w-full bg-slate-50 border-none rounded-2xl px-4 py-3 text-sm focus:ring-2 focus:ring-slate-200 outline-none transition-all"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-[10px] font-bold uppercase tracking-widest text-slate-400 ml-1">Дата</label>
                      <input 
                        type="date"
                        value={newExpense.date}
                        onChange={e => setNewExpense({...newExpense, date: e.target.value})}
                        className="w-full bg-slate-50 border-none rounded-2xl px-4 py-3 text-sm focus:ring-2 focus:ring-slate-200 outline-none transition-all"
                      />
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-[10px] font-bold uppercase tracking-widest text-slate-400 ml-1">Категория</label>
                    <div className="grid grid-cols-2 gap-2">
                       {Object.entries(categories).map(([key, cat]) => (
                         <button
                           key={key}
                           onClick={() => setNewExpense({...newExpense, category: key as any})}
                           className={cn(
                             "flex items-center gap-2 p-3 rounded-xl border transition-all text-[10px] font-bold uppercase tracking-widest",
                             newExpense.category === key 
                               ? "bg-slate-900 text-white border-slate-900" 
                               : "bg-white text-slate-600 border-slate-100 hover:border-slate-200"
                           )}
                         >
                           <cat.icon size={14} />
                           {cat.label}
                         </button>
                       ))}
                    </div>
                  </div>
                </div>

                <div className="pt-4">
                  <button 
                    onClick={handleAddExpense}
                    className="w-full bg-slate-900 text-white py-4 rounded-2xl font-bold uppercase text-[11px] tracking-widest hover:bg-slate-800 transition-all shadow-xl active:scale-95"
                  >
                    Зафиксировать расход
                  </button>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
};

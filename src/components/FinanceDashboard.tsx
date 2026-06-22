import React, { useState, useEffect, useMemo } from 'react';
import { 
  ArrowLeft, DollarSign, TrendingUp, TrendingDown, 
  Plus, Calendar as CalendarIcon, PieChart, 
  Trash2, AlertCircle,
  ChevronRight, ChevronLeft, Briefcase, CreditCard,
  Building, UserCheck, Download, RefreshCcw,
  Wallet, Database, ReceiptText, Lock, ShieldCheck
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { cn, formatCurrency } from '../lib/utils';
import { auth, db, OperationType, handleFirestoreError } from '../firebase';
import { collection, onSnapshot, doc, query, orderBy, deleteDoc, addDoc, serverTimestamp } from 'firebase/firestore';

interface FinanceDashboardProps {
  onBack: () => void;
  userEmail?: string;
}

interface TochkaFinanceSummary {
  configured?: boolean;
  totalBalance: number;
  totalExpected: number;
  actualIncome?: number;
  actualExpenses?: number;
  monthKey: string;
  generatedAt: string;
  accounts: Array<{
    accountId: string;
    maskedAccountId: string;
    status: string;
    currency: string;
    balances: {
      openingAvailable: number;
      closingAvailable: number;
      expected: number;
    };
  }>;
  incomingSources: Array<{ key: string; label: string; amount: number; count: number }>;
  cards: Array<{ mask: string; label: string; kind: string; expenses: number; operations: any[] }>;
  accountExpenses: Array<{ maskedAccountId: string; amount: number; operations: any[] }>;
  expenseCategories?: Array<{ category: string; amount: number; count: number }>;
  operations?: Array<{
    id: string;
    date: string;
    maskedAccountId: string;
    cardMask?: string;
    amount: number;
    absAmount: number;
    direction: 'income' | 'expense';
    category: string;
    description: string;
    counterparty?: string;
  }>;
  operationFetches?: Array<{ account: string; ok: boolean; source: string; errors: any[] }>;
  operationsStatus: string;
  message?: string;
}

interface Expense {
  id: string;
  category: 'rent' | 'payroll' | 'credit' | 'marketing' | 'other';
  amount: number;
  date: Date;
  description: string;
  isRecurring?: boolean;
}

const monthNames = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];
const FINANCE_OWNER_EMAIL = 'ndtiger86@gmail.com';

const manualReturnOperations = [
  { date: new Date(2026, 0, 26), amount: 17900 },
  { date: new Date(2026, 0, 26), amount: 15000 },
  { date: new Date(2026, 0, 13), amount: 5900 },
  { date: new Date(2026, 2, 31), amount: 13550 },
  { date: new Date(2026, 2, 11), amount: 11250 },
  { date: new Date(2026, 2, 6), amount: 11900 },
  { date: new Date(2026, 2, 6), amount: 10000 },
  { date: new Date(2026, 3, 29), amount: 8450 },
  { date: new Date(2026, 3, 20), amount: 11900 },
  { date: new Date(2026, 3, 15), amount: 11900 },
  { date: new Date(2026, 3, 13), amount: 10900 },
  { date: new Date(2026, 3, 13), amount: 10000 },
  { date: new Date(2026, 3, 2), amount: 17250 },
  { date: new Date(2026, 4, 27), amount: 16250 },
  { date: new Date(2026, 4, 22), amount: 9950 },
  { date: new Date(2026, 4, 15), amount: 20550 },
  { date: new Date(2026, 4, 12), amount: 6000 },
  { date: new Date(2026, 4, 12), amount: 4400 },
  { date: new Date(2026, 4, 11), amount: 15600 },
  { date: new Date(2026, 4, 9), amount: 18900 },
];

const normalizeDate = (value: any): Date => {
  if (value?.toDate) return value.toDate();
  const date = value ? new Date(value) : new Date();
  return Number.isNaN(date.getTime()) ? new Date() : date;
};

const getOrderRevenue = (order: any): number => {
  if (Number(order.revenue) > 0) return Number(order.revenue) || 0;
  if (Array.isArray(order.itemPrices)) {
    return order.itemPrices.reduce((sum: number, value: any) => sum + (Number(value) || 0), 0);
  }
  return Number(order.price) || 0;
};

const isActiveSale = (order: any): boolean => {
  const status = String(order.status || '').toLowerCase();
  return getOrderRevenue(order) > 0 && !status.includes('возврат') && !status.includes('отмена');
};

export const FinanceDashboard: React.FC<FinanceDashboardProps> = ({ onBack, userEmail }) => {
  const [activeTab, setActiveTab] = useState<'dds' | 'calendar' | 'expenses'>('dds');
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [orders, setOrders] = useState<any[]>([]);
  const [tochkaSummary, setTochkaSummary] = useState<TochkaFinanceSummary | null>(null);
  const [tochkaLoading, setTochkaLoading] = useState(false);
  const [tochkaError, setTochkaError] = useState('');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [newExpense, setNewExpense] = useState({
    category: 'other' as const,
    amount: '',
    description: '',
    date: new Date().toISOString().split('T')[0]
  });

  const [currentDate, setCurrentDate] = useState(new Date());
  const canViewFinance = String(userEmail || '').toLowerCase() === FINANCE_OWNER_EMAIL;

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

    // Fetch Orders for Incomes from the CRM source of truth.
    const qOrders = query(collection(db, 'orders_new'));
    const unsubscribeOrders = onSnapshot(qOrders, (snapshot) => {
      let ordData = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data(),
        date: normalizeDate(doc.data().date || doc.data().orderDate)
      }));
      // Sort client side
      ordData.sort((a: any, b: any) => {
        const dateA = new Date(a.date || 0).getTime();
        const dateB = new Date(b.date || 0).getTime();
        return dateB - dateA;
      });
      setOrders(ordData);
    });

    return () => {
      unsubscribeExpenses();
      unsubscribeOrders();
    };
  }, []);

  useEffect(() => {
    if (!canViewFinance) return;
    let cancelled = false;
    const loadTochkaFinance = async () => {
      setTochkaLoading(true);
      setTochkaError('');
      try {
        const token = await auth.currentUser?.getIdToken();
        if (!token) throw new Error('Нужно войти в аккаунт владельца');
        const monthKey = `${currentDate.getFullYear()}-${String(currentDate.getMonth() + 1).padStart(2, '0')}`;
        const response = await fetch(`/api/tochka/finance-summary?month=${monthKey}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data?.error || 'Не удалось получить сводку Точки');
        if (!cancelled) setTochkaSummary(data);
      } catch (error: any) {
        if (!cancelled) setTochkaError(error?.message || 'Не удалось получить сводку Точки');
      } finally {
        if (!cancelled) setTochkaLoading(false);
      }
    };
    loadTochkaFinance();
    return () => {
      cancelled = true;
    };
  }, [canViewFinance, currentDate]);

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
    const monthlyData: Record<string, {
      year: number;
      month: number;
      label: string;
      orders: number;
      sales: number;
      planned: number;
      income: number;
      owed: number;
      delivery: number;
      returns: number;
      expense: number;
      net: number;
    }> = {};

    const ensureMonth = (date: Date) => {
      const year = date.getFullYear();
      const month = date.getMonth();
      const key = `${year}-${month + 1}`;
      if (!monthlyData[key]) {
        monthlyData[key] = {
          year,
          month,
          label: `${monthNames[month]} ${year} г.`,
          orders: 0,
          sales: 0,
          planned: 0,
          income: 0,
          owed: 0,
          delivery: 0,
          returns: 0,
          expense: 0,
          net: 0,
        };
      }
      return monthlyData[key];
    };

    orders.forEach(order => {
      const orderDate = normalizeDate(order.date || order.orderDate);
      const month = ensureMonth(orderDate);
      const revenue = getOrderRevenue(order);
      const delivery = Number(order.deliveryPrice ?? order.shippingCost) || 0;
      const paid = Number(order.paidAmount ?? order.paymentAmount ?? order.prepaymentAmount) || 0;
      const due = Math.max(0, revenue + delivery - paid);
      const status = String(order.status || '').toLowerCase();

      month.orders += 1;
      if (status.includes('возврат')) {
        month.returns += Number(order.refundAmount) || paid || revenue;
        return;
      }
      if (!isActiveSale(order)) return;

      month.sales += 1;
      month.planned += revenue + delivery;
      month.income += paid;
      month.owed += due;
      month.delivery += delivery;
    });

    manualReturnOperations.forEach(operation => {
      ensureMonth(operation.date).returns += operation.amount;
    });

    expenses.forEach(expense => {
      ensureMonth(expense.date).expense += Number(expense.amount) || 0;
    });

    const monthlyRows = Object.values(monthlyData)
      .map(month => ({
        ...month,
        net: month.income - month.returns - month.expense,
      }))
      .sort((a, b) => (b.year * 12 + b.month) - (a.year * 12 + a.month));

    const totalReceived = monthlyRows.reduce((sum, month) => sum + month.income, 0);
    const totalOwed = monthlyRows.reduce((sum, month) => sum + month.owed, 0);
    const totalExpenses = monthlyRows.reduce((sum, month) => sum + month.expense, 0);
    const totalReturns = monthlyRows.reduce((sum, month) => sum + month.returns, 0);
    const totalPlanned = monthlyRows.reduce((sum, month) => sum + month.planned, 0);
    const totalSales = monthlyRows.reduce((sum, month) => sum + month.sales, 0);
    const totalOrders = monthlyRows.reduce((sum, month) => sum + month.orders, 0);
    const balance = totalReceived - totalReturns - totalExpenses;

    return {
      received: totalReceived,
      owed: totalOwed,
      expenses: totalExpenses,
      returns: totalReturns,
      planned: totalPlanned,
      sales: totalSales,
      orders: totalOrders,
      balance,
      monthlyRows,
    };
  }, [orders, expenses]);

  const categories = {
    rent: { label: 'Аренда', icon: Building, color: 'text-orange-500', bg: 'bg-orange-50' },
    payroll: { label: 'ФОТ (Зарплаты)', icon: UserCheck, color: 'text-blue-500', bg: 'bg-blue-50' },
    credit: { label: 'Кредиты', icon: CreditCard, color: 'text-red-500', bg: 'bg-red-50' },
    marketing: { label: 'Маркетинг', icon: TrendingUp, color: 'text-indigo-500', bg: 'bg-indigo-50' },
    other: { label: 'Прочее', icon: Briefcase, color: 'text-slate-500', bg: 'bg-slate-50' }
  };

  const metricCardClass = "rounded-[10px] border border-[#E6E9EF] bg-white p-5 shadow-[0_8px_22px_rgba(31,41,55,0.03)]";
  const tochkaIncomingTotal = (tochkaSummary?.incomingSources || []).reduce((sum, source) => sum + (Number(source.amount) || 0), 0);
  const tochkaCardsExpenseTotal = (tochkaSummary?.cards || []).reduce((sum, card) => sum + (Number(card.expenses) || 0), 0);

  if (!canViewFinance) {
    return (
      <div className="min-h-screen bg-[#F6F7F9]">
        <div className="mx-auto flex min-h-screen w-full max-w-[920px] items-center justify-center px-4">
          <div className="w-full rounded-[10px] border border-[#E6E9EF] bg-white p-8 text-center shadow-[0_12px_32px_rgba(31,41,55,0.06)]">
            <div className="mx-auto mb-5 flex h-12 w-12 items-center justify-center rounded-[10px] bg-[#1F2937] text-white">
              <Lock size={22} />
            </div>
            <h1 className="text-[24px] font-semibold text-[#1F2937]">Финансы доступны только владельцу</h1>
            <p className="mt-2 text-[14px] font-medium text-[#6B7280]">Доступ открыт для {FINANCE_OWNER_EMAIL}. Сейчас вошел: {userEmail || 'неизвестный аккаунт'}.</p>
            <button
              onClick={onBack}
              className="mt-6 inline-flex h-10 items-center justify-center rounded-[8px] border border-[#E6E9EF] bg-white px-4 text-[13px] font-semibold text-[#1F2937] hover:bg-[#F6F7F9]"
            >
              Вернуться назад
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#F6F7F9]">
      <div className="mx-auto w-full max-w-[1760px] px-4 py-8 space-y-5 sm:px-6 lg:px-8">
        {/* Header */}
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div className="flex items-center gap-4">
            <button 
              onClick={onBack}
              className="inline-flex h-10 w-10 items-center justify-center rounded-[8px] border border-[#E6E9EF] bg-white text-[#1F2937] transition-colors hover:bg-[#F6F7F9]"
            >
              <ArrowLeft size={20} />
            </button>
            <div>
              <h1 className="text-[34px] font-medium leading-10 tracking-tight text-[#1F2937]">Финансы & ДДС</h1>
              <p className="text-[14px] font-medium text-[#6B7280]">Управление денежными потоками и расходами</p>
            </div>
          </div>
          <button 
            onClick={() => setIsModalOpen(true)}
            className="inline-flex h-11 items-center justify-center gap-2 rounded-[8px] bg-[#1F2937] px-5 text-[13px] font-semibold text-white shadow-[0_10px_24px_rgba(31,41,55,0.14)] transition-all hover:bg-[#111827] active:scale-95"
          >
            <Plus size={18} />
            Добавить расход
          </button>
        </div>

        <div className="grid grid-cols-1 gap-3 xl:grid-cols-[1.1fr_1fr]">
          <div className="rounded-[10px] border border-[#E6E9EF] bg-white p-5 shadow-[0_8px_22px_rgba(31,41,55,0.03)]">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.16em] text-[#6B7280]">
                  <ShieldCheck size={15} className="text-emerald-500" />
                  Точка банк
                </div>
                <h2 className="mt-2 text-[20px] font-semibold leading-[26px] text-[#1F2937]">Действующий баланс и движения</h2>
                <p className="mt-1 text-[12px] font-medium text-[#6B7280]">
                  {tochkaLoading ? 'Обновляю данные банка...' : tochkaError || tochkaSummary?.message || 'Баланс читается напрямую из Точки.'}
                </p>
              </div>
              <button
                onClick={() => setCurrentDate(new Date(currentDate))}
                className="inline-flex h-9 items-center justify-center gap-2 rounded-[8px] border border-[#E6E9EF] bg-white px-3 text-[11px] font-semibold uppercase tracking-[0.12em] text-[#6B7280] hover:bg-[#F6F7F9]"
              >
                <RefreshCcw size={14} />
                Обновить
              </button>
            </div>

            <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-3">
              <div className="rounded-[8px] border border-[#E6E9EF] bg-[#F6F7F9] p-4">
                <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-[#6B7280]">Баланс счета</p>
                <p className="mt-2 text-[24px] font-black leading-tight text-[#1F2937]">{formatCurrency(tochkaSummary?.totalBalance || 0)}</p>
              </div>
              <div className="rounded-[8px] border border-orange-100 bg-orange-50/70 p-4">
                <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-orange-500">Ожидается</p>
                <p className="mt-2 text-[24px] font-black leading-tight text-orange-500">{formatCurrency(tochkaSummary?.totalExpected || 0)}</p>
              </div>
              <div className="rounded-[8px] border border-emerald-100 bg-emerald-50/70 p-4">
                <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-emerald-600">Приходы CRM</p>
                <p className="mt-2 text-[24px] font-black leading-tight text-emerald-600">{formatCurrency(tochkaIncomingTotal)}</p>
              </div>
            </div>

            <div className="mt-4 overflow-hidden rounded-[8px] border border-[#E6E9EF]">
              <div className="grid grid-cols-[1.1fr_0.7fr_0.8fr] bg-[#F6F7F9] px-4 py-3 text-[10px] font-bold uppercase tracking-[0.14em] text-[#9CA3AF]">
                <span>Счет</span>
                <span>Статус</span>
                <span className="text-right">Баланс</span>
              </div>
              {(tochkaSummary?.accounts || []).map(account => (
                <div key={account.accountId} className="grid grid-cols-[1.1fr_0.7fr_0.8fr] border-t border-[#E6E9EF] px-4 py-3 text-[13px] font-bold text-[#1F2937]">
                  <span>{account.maskedAccountId}</span>
                  <span className="text-[#6B7280]">{account.status || 'активен'}</span>
                  <span className="text-right">{formatCurrency(account.balances.closingAvailable)}</span>
                </div>
              ))}
              {!tochkaSummary?.accounts?.length && (
                <div className="px-4 py-5 text-[13px] font-semibold text-[#6B7280]">Счета пока не загрузились.</div>
              )}
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3">
            <div className="rounded-[10px] border border-[#E6E9EF] bg-white p-5 shadow-[0_8px_22px_rgba(31,41,55,0.03)]">
              <h3 className="text-[13px] font-semibold uppercase tracking-[0.16em] text-[#1F2937]">Приходы по источникам</h3>
              <div className="mt-4 grid grid-cols-2 gap-3">
                {(tochkaSummary?.incomingSources || [
                  { key: 'qr', label: 'QR / СБП', amount: 0, count: 0 },
                  { key: 'dolyami', label: 'Долями', amount: 0, count: 0 },
                  { key: 'split', label: 'Сплиты', amount: 0, count: 0 },
                  { key: 'other', label: 'Другое', amount: 0, count: 0 },
                ]).map(source => (
                  <div key={source.key} className="rounded-[8px] border border-[#E6E9EF] bg-[#F6F7F9] p-3">
                    <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-[#6B7280]">{source.label}</p>
                    <p className="mt-2 text-[18px] font-black text-[#1F2937]">{formatCurrency(source.amount)}</p>
                    <p className="text-[11px] font-bold text-[#9CA3AF]">{source.count} оплат</p>
                  </div>
                ))}
              </div>
            </div>

            <div className="rounded-[10px] border border-[#E6E9EF] bg-white p-5 shadow-[0_8px_22px_rgba(31,41,55,0.03)]">
              <div className="flex items-center justify-between">
                <h3 className="text-[13px] font-semibold uppercase tracking-[0.16em] text-[#1F2937]">Расходы по картам</h3>
                <span className="text-[13px] font-black text-red-500">{formatCurrency(tochkaCardsExpenseTotal)}</span>
              </div>
              <div className="mt-4 space-y-2">
                {(tochkaSummary?.cards || []).map(card => (
                  <div key={card.mask} className="flex items-center justify-between rounded-[8px] border border-[#E6E9EF] px-3 py-3">
                    <div>
                      <p className="text-[13px] font-bold text-[#1F2937]">*{card.mask}</p>
                      <p className="text-[11px] font-semibold text-[#6B7280]">{card.label}</p>
                    </div>
                    <p className="text-[13px] font-black text-[#1F2937]">{formatCurrency(card.expenses || 0)}</p>
                  </div>
                ))}
              </div>
              <p className="mt-3 text-[11px] font-medium leading-4 text-[#6B7280]">
                {tochkaSummary?.operations?.length
                  ? 'Ниже показаны операции, где Точка отдала маску карты или описание списания.'
                  : 'Если здесь пусто, Точка пока не отдала операции по картам через текущие права API.'}
              </p>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-3 xl:grid-cols-[0.8fr_1.2fr]">
          <div className="rounded-[10px] border border-[#E6E9EF] bg-white p-5 shadow-[0_8px_22px_rgba(31,41,55,0.03)]">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="text-[13px] font-semibold uppercase tracking-[0.16em] text-[#1F2937]">Куда ушли деньги</h3>
                <p className="mt-1 text-[12px] font-medium text-[#6B7280]">Категории расходов по выписке Точки</p>
              </div>
              <span className="text-[18px] font-black text-red-500">{formatCurrency(tochkaSummary?.actualExpenses || 0)}</span>
            </div>
            <div className="mt-4 space-y-2">
              {(tochkaSummary?.expenseCategories || []).map(category => (
                <div key={category.category} className="rounded-[8px] border border-[#E6E9EF] bg-[#F6F7F9] p-3">
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-[13px] font-bold text-[#1F2937]">{category.category}</p>
                    <p className="text-[13px] font-black text-red-500">{formatCurrency(category.amount)}</p>
                  </div>
                  <p className="mt-1 text-[11px] font-semibold text-[#9CA3AF]">{category.count} операций</p>
                </div>
              ))}
              {!tochkaSummary?.expenseCategories?.length && (
                <div className="rounded-[8px] border border-dashed border-[#E6E9EF] p-4 text-[12px] font-semibold leading-5 text-[#6B7280]">
                  Расходных операций за месяц пока нет в ответе API. Баланс уже читается, следующий шаг — включить/проверить права на выписки и операции.
                </div>
              )}
            </div>
          </div>

          <div className="overflow-hidden rounded-[10px] border border-[#E6E9EF] bg-white shadow-[0_8px_22px_rgba(31,41,55,0.03)]">
            <div className="flex items-center justify-between border-b border-[#E6E9EF] px-5 py-4">
              <div>
                <h3 className="text-[13px] font-semibold uppercase tracking-[0.16em] text-[#1F2937]">Детальный отчет операций</h3>
                <p className="mt-1 text-[12px] font-medium text-[#6B7280]">Дата, счет/карта, категория, контрагент и сумма</p>
              </div>
              <span className="text-[11px] font-bold uppercase tracking-[0.14em] text-[#9CA3AF]">{tochkaSummary?.operations?.length || 0} операций</span>
            </div>
            <div className="max-h-[420px] overflow-auto">
              <table className="w-full min-w-[900px] table-fixed">
                <thead className="sticky top-0 bg-[#F6F7F9]">
                  <tr>
                    <th className="px-4 py-3 text-left text-[10px] font-semibold uppercase tracking-[0.14em] text-[#9CA3AF]">Дата</th>
                    <th className="px-4 py-3 text-left text-[10px] font-semibold uppercase tracking-[0.14em] text-[#9CA3AF]">Счет / карта</th>
                    <th className="px-4 py-3 text-left text-[10px] font-semibold uppercase tracking-[0.14em] text-[#9CA3AF]">Категория</th>
                    <th className="px-4 py-3 text-left text-[10px] font-semibold uppercase tracking-[0.14em] text-[#9CA3AF]">Описание</th>
                    <th className="px-4 py-3 text-right text-[10px] font-semibold uppercase tracking-[0.14em] text-[#9CA3AF]">Сумма</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#E6E9EF]">
                  {(tochkaSummary?.operations || []).map(operation => (
                    <tr key={operation.id} className="hover:bg-[#F6F7F9]">
                      <td className="px-4 py-3 text-[12px] font-bold text-[#6B7280]">
                        {new Date(operation.date).toLocaleDateString('ru-RU')}
                      </td>
                      <td className="px-4 py-3 text-[12px] font-bold text-[#1F2937]">
                        {operation.cardMask ? `*${operation.cardMask}` : operation.maskedAccountId}
                      </td>
                      <td className="px-4 py-3 text-[12px] font-bold text-[#6B7280]">{operation.category}</td>
                      <td className="truncate px-4 py-3 text-[12px] font-semibold text-[#1F2937]" title={operation.description}>
                        {operation.description}
                      </td>
                      <td className={cn("px-4 py-3 text-right text-[12px] font-black", operation.direction === 'expense' ? "text-red-500" : "text-emerald-600")}>
                        {operation.direction === 'expense' ? '-' : '+'}{formatCurrency(operation.absAmount)}
                      </td>
                    </tr>
                  ))}
                  {!tochkaSummary?.operations?.length && (
                    <tr>
                      <td colSpan={5} className="px-4 py-8 text-center text-[13px] font-semibold text-[#6B7280]">
                        Операций пока нет. {tochkaSummary?.operationFetches?.[0]?.errors?.[0]?.message || ''}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        {/* Global Stats */}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <div className={cn(metricCardClass, "space-y-2")}>
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-bold uppercase tracking-[0.16em] text-[#6B7280]">Получено (Касса)</span>
              <div className="rounded-[8px] bg-emerald-50 p-2 text-emerald-500">
                <TrendingUp size={16} />
              </div>
            </div>
            <p className="text-[28px] font-black leading-tight text-[#1F2937]">{formatCurrency(financialStats.received)}</p>
            <p className="text-[10px] font-bold uppercase tracking-[0.16em] leading-none text-emerald-500">Реальные приходы</p>
          </div>

          <div className={cn(metricCardClass, "space-y-2")}>
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-bold uppercase tracking-[0.16em] text-[#6B7280]">Дебиторка (Долги)</span>
              <div className="rounded-[8px] bg-orange-50 p-2 text-orange-500">
                <AlertCircle size={16} />
              </div>
            </div>
            <p className="text-[28px] font-black leading-tight text-[#1F2937]">{formatCurrency(financialStats.owed)}</p>
            <p className="text-[10px] font-bold uppercase tracking-[0.16em] leading-none text-orange-500">Ожидаемые доплаты</p>
          </div>

          <div className={cn(metricCardClass, "space-y-2")}>
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-bold uppercase tracking-[0.16em] text-[#6B7280]">Расходы</span>
              <div className="rounded-[8px] bg-red-50 p-2 text-red-500">
                <TrendingDown size={16} />
              </div>
            </div>
            <p className="text-[28px] font-black leading-tight text-[#1F2937]">{formatCurrency(financialStats.expenses)}</p>
            <p className="text-[10px] font-bold uppercase tracking-[0.16em] leading-none text-red-500">ФОТ, аренда и пр.</p>
          </div>

          <div className={cn(metricCardClass, "space-y-2 border-l-4 border-l-[#1F2937]")}>
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-bold uppercase tracking-[0.16em] text-[#6B7280]">Итого чистыми</span>
              <div className={cn("rounded-[8px] p-2", financialStats.balance >= 0 ? "bg-[#1F2937] text-white" : "bg-orange-50 text-orange-500")}>
                <DollarSign size={16} />
              </div>
            </div>
            <p className="text-[28px] font-black leading-tight text-[#1F2937]">{formatCurrency(financialStats.balance)}</p>
            <p className="text-[10px] font-bold uppercase tracking-[0.16em] leading-none text-[#6B7280]">Сальдо в кассе</p>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <div className={metricCardClass}>
            <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.16em] text-[#6B7280]">
              <ReceiptText size={14} />
              Заказы CRM
            </div>
            <p className="mt-2 text-[22px] font-black leading-tight text-[#1F2937]">{financialStats.orders}</p>
            <p className="text-[11px] font-bold text-[#6B7280]">{financialStats.sales} продаж</p>
          </div>
          <div className={metricCardClass}>
            <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.16em] text-[#6B7280]">
              <Wallet size={14} />
              Сумма заказов
            </div>
            <p className="mt-2 text-[22px] font-black leading-tight text-[#1F2937]">{formatCurrency(financialStats.planned)}</p>
            <p className="text-[11px] font-bold text-[#6B7280]">товары + доставка</p>
          </div>
          <div className="rounded-[10px] border border-red-100 bg-red-50/60 p-5 shadow-[0_8px_22px_rgba(31,41,55,0.03)]">
            <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.16em] text-red-400">
              <RefreshCcw size={14} />
              Возвраты
            </div>
            <p className="mt-2 text-[22px] font-black leading-tight text-red-500">-{formatCurrency(financialStats.returns)}</p>
            <p className="text-[11px] font-bold text-red-300">учтены в чистом итоге</p>
          </div>
          <div className={metricCardClass}>
            <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.16em] text-[#6B7280]">
              <Database size={14} />
              После возвратов
            </div>
            <p className="mt-2 text-[22px] font-black leading-tight text-[#1F2937]">{formatCurrency(Math.max(0, financialStats.received - financialStats.returns))}</p>
            <p className="text-[11px] font-bold text-[#6B7280]">до ручных расходов</p>
          </div>
        </div>

        {/* Tabs */}
        <div className="inline-flex max-w-full gap-1 overflow-x-auto rounded-[10px] border border-[#E6E9EF] bg-white p-1 shadow-[0_8px_22px_rgba(31,41,55,0.03)]">
          {[
            { id: 'dds', label: 'ДДС (Потоки)', icon: PieChart },
            { id: 'calendar', label: 'Календарь', icon: CalendarIcon },
            { id: 'expenses', label: 'Расходы', icon: Trash2 },
          ].map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as any)}
              className={cn(
                "inline-flex h-9 items-center gap-2 rounded-[8px] px-4 text-[11px] font-semibold uppercase tracking-[0.12em] transition-all",
                activeTab === tab.id ? "bg-[#1F2937] text-white shadow-sm" : "text-[#6B7280] hover:bg-[#F6F7F9] hover:text-[#1F2937]"
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
              <div className="overflow-hidden rounded-[10px] border border-[#E6E9EF] bg-white shadow-[0_8px_22px_rgba(31,41,55,0.03)]">
                <div className="flex items-center justify-between border-b border-[#E6E9EF] px-5 py-4">
                  <h3 className="text-[13px] font-semibold uppercase tracking-[0.16em] text-[#1F2937]">Движение денежных средств</h3>
                  <Download size={16} className="text-slate-400 cursor-pointer hover:text-slate-600" />
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[1120px] table-fixed">
                    <thead>
                      <tr className="bg-[#F6F7F9]">
                        <th className="px-5 py-4 text-left text-[10px] font-semibold uppercase tracking-[0.14em] text-[#9CA3AF]">Период</th>
                        <th className="px-5 py-4 text-right text-[10px] font-semibold uppercase tracking-[0.14em] text-[#9CA3AF]">Заказы</th>
                        <th className="px-5 py-4 text-right text-[10px] font-semibold uppercase tracking-[0.14em] text-[#9CA3AF]">Сумма заказов</th>
                        <th className="px-5 py-4 text-right text-[10px] font-semibold uppercase tracking-[0.14em] text-emerald-500">Оплачено</th>
                        <th className="px-5 py-4 text-right text-[10px] font-semibold uppercase tracking-[0.14em] text-orange-500">К доплате</th>
                        <th className="px-5 py-4 text-right text-[10px] font-semibold uppercase tracking-[0.14em] text-red-500">Возвраты</th>
                        <th className="px-5 py-4 text-right text-[10px] font-semibold uppercase tracking-[0.14em] text-[#9CA3AF]">Расход</th>
                        <th className="px-5 py-4 text-right text-[10px] font-semibold uppercase tracking-[0.14em] text-[#9CA3AF]">Сальдо</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#E6E9EF]">
                      {financialStats.monthlyRows.map((values) => (
                        <tr key={`${values.year}-${values.month}`} className="hover:bg-slate-50/50 transition-colors">
                          <td className="px-5 py-4 text-[13px] font-bold text-[#1F2937]">{values.label}</td>
                          <td className="px-5 py-4 text-right text-[13px] font-bold text-[#6B7280]">{values.orders} / {values.sales}</td>
                          <td className="px-5 py-4 text-right text-[13px] font-bold text-[#1F2937]">{formatCurrency(values.planned)}</td>
                          <td className="px-5 py-4 text-right text-[13px] font-bold text-emerald-600">+{formatCurrency(values.income)}</td>
                          <td className={cn("px-5 py-4 text-right text-[13px] font-bold", values.owed > 0 ? "text-orange-500" : "text-slate-300")}>{formatCurrency(values.owed)}</td>
                          <td className={cn("px-5 py-4 text-right text-[13px] font-bold", values.returns > 0 ? "text-red-500" : "text-slate-300")}>-{formatCurrency(values.returns)}</td>
                          <td className={cn("px-5 py-4 text-right text-[13px] font-bold", values.expense > 0 ? "text-red-500" : "text-slate-300")}>-{formatCurrency(values.expense)}</td>
                          <td className={cn("px-5 py-4 text-right text-[13px] font-black", values.net >= 0 ? "text-[#1F2937]" : "text-orange-500")}>
                            {formatCurrency(values.net)}
                          </td>
                        </tr>
                      ))}
                      <tr className="bg-[#F6F7F9] text-[13px] font-black">
                        <td className="px-5 py-4 text-[#1F2937]">Итого</td>
                        <td className="px-5 py-4 text-right text-[#6B7280]">{financialStats.orders} / {financialStats.sales}</td>
                        <td className="px-5 py-4 text-right text-[#1F2937]">{formatCurrency(financialStats.planned)}</td>
                        <td className="px-5 py-4 text-right text-emerald-600">+{formatCurrency(financialStats.received)}</td>
                        <td className="px-5 py-4 text-right text-orange-500">{formatCurrency(financialStats.owed)}</td>
                        <td className="px-5 py-4 text-right text-red-500">-{formatCurrency(financialStats.returns)}</td>
                        <td className="px-5 py-4 text-right text-red-500">-{formatCurrency(financialStats.expenses)}</td>
                        <td className="px-5 py-4 text-right text-[#1F2937]">{formatCurrency(financialStats.balance)}</td>
                      </tr>
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
                          const dayExpenses = expenses.filter(e => e.date.getDate() === day && e.date.getMonth() === currentDate.getMonth() && e.date.getFullYear() === currentDate.getFullYear());
                          
                          const dayOrders = orders.filter(o => {
                            const oDate = o.date ? new Date(o.date) : null;
                            return oDate && oDate.getDate() === day && oDate.getMonth() === currentDate.getMonth() && oDate.getFullYear() === currentDate.getFullYear();
                          });
                          const dayIncome = dayOrders
                            .filter(isActiveSale)
                            .reduce((sum, order) => sum + (Number(order.paidAmount ?? order.paymentAmount ?? order.prepaymentAmount) || 0), 0);
                          const dayDue = dayOrders
                            .filter(isActiveSale)
                            .reduce((sum, order) => {
                              const revenue = getOrderRevenue(order);
                              const delivery = Number(order.deliveryPrice ?? order.shippingCost) || 0;
                              const paid = Number(order.paidAmount ?? order.paymentAmount ?? order.prepaymentAmount) || 0;
                              return sum + Math.max(0, revenue + delivery - paid);
                            }, 0);
                          
                          return (
                            <div key={i} className={cn(
                              "min-h-[100px] p-2 bg-slate-50 border border-slate-100 rounded-xl space-y-2 relative group hover:border-slate-300 transition-all",
                              dayExpenses.length > 0 && "bg-red-50/20",
                              dayIncome > 0 && "bg-emerald-50/20"
                            )}>
                              <span className="text-[10px] font-bold text-slate-400">{day}</span>
                              <div className="space-y-1 mt-1">
                                {dayIncome > 0 && (
                                  <div className="text-[8px] font-bold text-emerald-600 bg-emerald-100/50 rounded px-1 flex justify-between">
                                    <span>Опл:</span>
                                    <span>+{formatCurrency(dayIncome)}</span>
                                  </div>
                                )}
                                {dayDue > 0 && (
                                  <div className="text-[8px] font-bold text-orange-600 bg-orange-100/60 rounded px-1 flex justify-between">
                                    <span>Долг:</span>
                                    <span>{formatCurrency(dayDue)}</span>
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

import React, { useState, useEffect, useMemo } from 'react';
import { 
  ArrowLeft, TrendingUp, TrendingDown,
  Plus, Calendar as CalendarIcon, PieChart, 
  Trash2,
  ChevronRight, ChevronLeft, Briefcase, CreditCard,
  Building, UserCheck, Download, RefreshCcw,
  Wallet, ReceiptText, Lock, ShieldCheck, Factory,
  Landmark, Scale, PackageCheck, Sparkles, AlertTriangle, CheckCircle2, Link2, FileSpreadsheet, X
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { cn, formatCurrency } from '../lib/utils';
import { auth, db, OperationType, handleFirestoreError } from '../firebase';
import { collection, onSnapshot, doc, query, orderBy, deleteDoc, addDoc, serverTimestamp, setDoc } from 'firebase/firestore';
import { BarChart, Bar, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { buildFinanceReport, parseFinanceDate, type FinancePeriod } from '../lib/financeAccounting';

interface FinanceDashboardProps {
  onBack: () => void;
  userEmail?: string;
}

interface TochkaFinanceSummary {
  configured?: boolean;
  totalBalance: number;
  operatingBalance?: number;
  reservedBalance?: number;
  totalExpected: number;
  actualIncome?: number;
  actualExpenses?: number;
  actualRefunds?: number;
  monthKey: string;
  generatedAt: string;
  accounts: Array<{
    accountId: string;
    maskedAccountId: string;
    label?: string;
    role?: 'operating' | 'reserved';
    status: string;
    currency: string;
    balances: {
      openingAvailable: number;
      closingAvailable: number;
      expected: number;
    };
  }>;
  incomingSources: Array<{ key: string; label: string; amount: number; count: number }>;
  paymentBreakdown?: {
    salesAmount: number;
    salesCount: number;
    actualIncome: number;
    currentMonthOrderReceipts: number;
    priorMonthDopayments: number;
    unmatchedIncome: number;
    remainingForSelectedOrders: number;
    remainingFromSelectedMonth?: number;
    refunds?: number;
  };
  monthlyComparison?: Array<{
    monthKey: string;
    sales: number;
    orders: number;
    income: number;
    expenses: number;
    net: number;
    currentOrderReceipts: number;
    priorOrderReceipts: number;
    unmatchedIncome: number;
    refunds?: number;
  }>;
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
    isInternalTransfer?: boolean;
    isRefund?: boolean;
  }>;
  operationFetches?: Array<{ account: string; ok: boolean; source: string; errors: any[] }>;
  operationsStatus: string;
  message?: string;
}

interface Expense {
  id: string;
  category: 'rent' | 'payroll' | 'credit' | 'marketing' | 'production' | 'other';
  amount: number;
  date: Date;
  description: string;
  isRecurring?: boolean;
  status?: 'planned' | 'paid';
  paid?: boolean;
}

const monthNames = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];
const FINANCE_OWNER_EMAIL = 'ndtiger86@gmail.com';
const TOCHKA_EXPENSE_CATEGORY_OVERRIDES_STORAGE_KEY = 'ybcrm:tochka-expense-category-overrides';
const TOCHKA_CUSTOM_EXPENSE_CATEGORIES_STORAGE_KEY = 'ybcrm:tochka-custom-expense-categories';

const normalizeDate = (value: any): Date => {
  const date = parseFinanceDate(value);
  return date.getTime() > 0 ? date : new Date();
};

const getOrderRevenue = (order: any): number => {
  if (Number(order.revenue) > 0) return Number(order.revenue) || 0;
  if (Array.isArray(order.itemPrices)) {
    return order.itemPrices.reduce((sum: number, value: any) => sum + (Number(value) || 0), 0);
  }
  return Number(order.price) || 0;
};

const isActiveSale = (order: any): boolean => {
  if (order.isBlogger) return false;
  const status = String(order.status || '').toLowerCase();
  return getOrderRevenue(order) > 0 && !status.includes('возврат') && !status.includes('отмена');
};

export const FinanceDashboard: React.FC<FinanceDashboardProps> = ({ onBack, userEmail }) => {
  const [activeTab, setActiveTab] = useState<'overview' | 'pnl' | 'dds' | 'balance' | 'unit' | 'reconciliation' | 'bank' | 'calendar' | 'expenses'>('overview');
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [orders, setOrders] = useState<any[]>([]);
  const [products, setProducts] = useState<any[]>([]);
  const [reconciliationOverrides, setReconciliationOverrides] = useState<Record<string, string>>({});
  const [tochkaSummary, setTochkaSummary] = useState<TochkaFinanceSummary | null>(null);
  const [tochkaLoading, setTochkaLoading] = useState(false);
  const [tochkaError, setTochkaError] = useState('');
  const [tochkaRefreshKey, setTochkaRefreshKey] = useState(0);
  const [tochkaPeriod, setTochkaPeriod] = useState<'month' | 'quarter' | 'halfYear' | 'year'>('month');
  const [expandedExpenseCategories, setExpandedExpenseCategories] = useState<Record<string, boolean>>({});
  const [expenseCategoryOverrides, setExpenseCategoryOverrides] = useState<Record<string, string>>({});
  const [customExpenseCategories, setCustomExpenseCategories] = useState<string[]>([]);
  const [newExpenseCategoryName, setNewExpenseCategoryName] = useState('');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [expenseEntryMode, setExpenseEntryMode] = useState<'planned' | 'paid'>('paid');
  const [newExpense, setNewExpense] = useState({
    category: 'other' as const,
    amount: '',
    description: '',
    date: new Date().toISOString().split('T')[0]
  });

  const [currentDate, setCurrentDate] = useState(new Date());
  const canViewFinance = String(userEmail || '').toLowerCase() === FINANCE_OWNER_EMAIL;

  useEffect(() => {
    try {
      const savedOverrides = window.localStorage.getItem(TOCHKA_EXPENSE_CATEGORY_OVERRIDES_STORAGE_KEY);
      const savedCategories = window.localStorage.getItem(TOCHKA_CUSTOM_EXPENSE_CATEGORIES_STORAGE_KEY);
      if (savedOverrides) setExpenseCategoryOverrides(JSON.parse(savedOverrides));
      if (savedCategories) setCustomExpenseCategories(JSON.parse(savedCategories));
    } catch (error) {
      console.warn('Не удалось прочитать статьи расходов', error);
    }
  }, []);

  useEffect(() => {
    try {
      window.localStorage.setItem(TOCHKA_EXPENSE_CATEGORY_OVERRIDES_STORAGE_KEY, JSON.stringify(expenseCategoryOverrides));
    } catch (error) {
      console.warn('Не удалось сохранить переносы расходов', error);
    }
  }, [expenseCategoryOverrides]);

  useEffect(() => {
    try {
      window.localStorage.setItem(TOCHKA_CUSTOM_EXPENSE_CATEGORIES_STORAGE_KEY, JSON.stringify(customExpenseCategories));
    } catch (error) {
      console.warn('Не удалось сохранить статьи расходов', error);
    }
  }, [customExpenseCategories]);

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

    const qProducts = query(collection(db, 'products'), orderBy('name', 'asc'));
    const unsubscribeProducts = onSnapshot(qProducts, (snapshot) => {
      setProducts(snapshot.docs.map(productDoc => ({ id: productDoc.id, ...productDoc.data() })));
    });

    const unsubscribeReconciliations = canViewFinance
      ? onSnapshot(collection(db, 'finance_reconciliations'), (snapshot) => {
        const next: Record<string, string> = {};
        snapshot.docs.forEach(item => {
          const data = item.data();
          if (data.operationId && data.orderId) next[String(data.operationId)] = String(data.orderId);
        });
        setReconciliationOverrides(next);
      }, error => console.warn('Не удалось загрузить ручную сверку', error))
      : () => undefined;

    return () => {
      unsubscribeExpenses();
      unsubscribeOrders();
      unsubscribeProducts();
      unsubscribeReconciliations();
    };
  }, [canViewFinance]);

  useEffect(() => {
    if (!canViewFinance) return;
    let cancelled = false;
    const loadTochkaFinance = async () => {
      setTochkaLoading(true);
      setTochkaError('');
      try {
        const token = await auth.currentUser?.getIdToken(tochkaRefreshKey > 0);
        if (!token) throw new Error('Нужно войти в аккаунт владельца');
        const monthKey = `${currentDate.getFullYear()}-${String(currentDate.getMonth() + 1).padStart(2, '0')}`;
        const response = await fetch(`/api/tochka/finance-summary?month=${monthKey}&period=${tochkaPeriod}&refresh=${tochkaRefreshKey}`, {
          headers: { Authorization: `Bearer ${token}` },
          cache: 'no-store',
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
  }, [canViewFinance, currentDate, tochkaPeriod, tochkaRefreshKey]);

  const handleAddExpense = async () => {
    if (!newExpense.amount || !newExpense.description) return;
    try {
      await addDoc(collection(db, 'expenses'), {
        category: newExpense.category,
        amount: Number(newExpense.amount),
        description: newExpense.description,
        date: new Date(`${newExpense.date}T12:00:00`),
        status: expenseEntryMode,
        paid: expenseEntryMode === 'paid',
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

  const openExpenseModal = (mode: 'planned' | 'paid') => {
    setExpenseEntryMode(mode);
    setNewExpense(current => ({
      ...current,
      date: mode === 'planned'
        ? new Date(Date.now() + 86_400_000).toISOString().split('T')[0]
        : new Date().toISOString().split('T')[0],
    }));
    setIsModalOpen(true);
  };

  const handleMarkExpensePaid = async (expense: Expense) => {
    try {
      await setDoc(doc(db, 'expenses', expense.id), {
        status: 'paid',
        paid: true,
        plannedDate: expense.date,
        date: new Date(),
        paidAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      }, { merge: true });
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, 'expenses');
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
      if (order.isBlogger) {
        const bloggerCost = Number(order.bloggerTotalCost)
          || (Array.isArray(order.itemCosts) ? order.itemCosts.reduce((sum: number, value: any) => sum + (Number(value) || 0), 0) : 0) + delivery;
        month.expense += bloggerCost;
        month.delivery += Number(order.bloggerDeliveryCost) || delivery;
        return;
      }
      if (status.includes('возврат') || status.includes('отмена')) {
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

    expenses.filter(expense => expense.status !== 'planned' && expense.paid !== false).forEach(expense => {
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

  const currentMonthKey = `${currentDate.getFullYear()}-${String(currentDate.getMonth() + 1).padStart(2, '0')}`;
  const selectedFinancialStats = useMemo(() => {
    const selectedMonth = financialStats.monthlyRows.find(month => (
      `${month.year}-${String(month.month + 1).padStart(2, '0')}` === currentMonthKey
    ));

    if (!selectedMonth) {
      return {
        received: 0,
        owed: 0,
        expenses: 0,
        returns: 0,
        planned: 0,
        sales: 0,
        orders: 0,
        balance: 0,
      };
    }

    return {
      received: selectedMonth.income,
      owed: selectedMonth.owed,
      expenses: selectedMonth.expense,
      returns: selectedMonth.returns,
      planned: selectedMonth.planned,
      sales: selectedMonth.sales,
      orders: selectedMonth.orders,
      balance: selectedMonth.net,
    };
  }, [financialStats.monthlyRows, currentMonthKey]);

  const tochkaOperationsForPeriod = tochkaSummary?.operations || [];
  const actualIncomeForPeriod = (tochkaPeriod === 'month' && Number.isFinite(Number(tochkaSummary?.paymentBreakdown?.actualIncome))
    ? Number(tochkaSummary?.paymentBreakdown?.actualIncome)
    : tochkaOperationsForPeriod
    .filter(operation => operation.direction === 'income' && !operation.isInternalTransfer)
    .reduce((sum, operation) => sum + (Number(operation.absAmount) || 0), 0));
  const actualExpensesForPeriod = Number.isFinite(Number(tochkaSummary?.actualExpenses))
    ? Number(tochkaSummary?.actualExpenses)
    : tochkaOperationsForPeriod
      .filter(operation => operation.direction === 'expense' && !operation.isInternalTransfer && !operation.isRefund)
      .reduce((sum, operation) => sum + (Number(operation.absAmount) || 0), 0);
  const actualReturnsForPeriod = (tochkaPeriod === 'month' && Number.isFinite(Number(tochkaSummary?.actualRefunds))
    ? Number(tochkaSummary?.actualRefunds)
    : tochkaOperationsForPeriod
      .filter(operation => operation.direction === 'expense' && !operation.isInternalTransfer && operation.isRefund)
      .reduce((sum, operation) => sum + (Number(operation.absAmount) || 0), 0));
  const actualNetForPeriod = actualIncomeForPeriod - actualReturnsForPeriod - actualExpensesForPeriod;

  const bankBreakdown = tochkaSummary?.paymentBreakdown;
  const selectedSalesAmount = Number.isFinite(Number(bankBreakdown?.salesAmount))
    ? Number(bankBreakdown?.salesAmount)
    : selectedFinancialStats.planned;
  const selectedOutstanding = Number.isFinite(Number(bankBreakdown?.remainingFromSelectedMonth))
    ? Number(bankBreakdown?.remainingFromSelectedMonth)
    : selectedFinancialStats.owed;
  const currentBankBalance = Number(tochkaSummary?.operatingBalance ?? tochkaSummary?.totalBalance ?? 0) || 0;
  const managementReport = useMemo(() => buildFinanceReport({
    orders,
    products,
    expenses,
    operations: tochkaSummary?.operations || [],
    selectedDate: currentDate,
    period: tochkaPeriod as FinancePeriod,
    bankBalance: Number(tochkaSummary?.totalBalance) || 0,
    expenseCategoryOverrides,
    reconciliationOverrides,
  }), [orders, products, expenses, tochkaSummary?.operations, tochkaSummary?.totalBalance, currentDate, tochkaPeriod, expenseCategoryOverrides, reconciliationOverrides]);

  const actualManualExpenses = useMemo(() => expenses.filter(expense => expense.status !== 'planned' && expense.paid !== false), [expenses]);
  const plannedExpenses = useMemo(() => expenses.filter(expense => expense.status === 'planned' || expense.paid === false), [expenses]);

  const saveReconciliation = async (operationId: string, orderId: string) => {
    const documentId = encodeURIComponent(operationId);
    if (!orderId) {
      await deleteDoc(doc(db, 'finance_reconciliations', documentId));
      return;
    }
    await setDoc(doc(db, 'finance_reconciliations', documentId), {
      operationId,
      orderId,
      updatedAt: serverTimestamp(),
      updatedBy: userEmail || '',
    }, { merge: true });
  };
  const reconciliationOrderOptions = useMemo(() => orders.slice().sort((a, b) => (
    normalizeDate(b.date || b.orderDate).getTime() - normalizeDate(a.date || a.orderDate).getTime()
  )), [orders]);

  const exportFinanceCsv = (kind: 'pnl' | 'dds' | 'balance' | 'reconciliation') => {
    const rows: Array<Array<string | number>> = kind === 'pnl'
      ? [
        ['Статья', 'Сумма'],
        ['Выручка', managementReport.pnl.revenue],
        ['Возвраты', -managementReport.pnl.returns],
        ['Чистая выручка', managementReport.pnl.netRevenue],
        ['Себестоимость', -managementReport.pnl.cogs],
        ['Валовая прибыль', managementReport.pnl.grossProfit],
        ['Операционные расходы', -managementReport.pnl.operatingExpenses],
        ['Чистая прибыль', managementReport.pnl.netProfit],
      ]
      : kind === 'dds'
        ? [['Показатель', 'Сумма'], ['Поступления', managementReport.cashFlow.income], ['Расходы', -managementReport.cashFlow.expenses], ['Возвраты', -managementReport.cashFlow.refunds], ['Чистый денежный поток', managementReport.cashFlow.net]]
        : kind === 'balance'
          ? [['Статья', 'Сумма'], ['Деньги', managementReport.balance.cash], ['Дебиторская задолженность', managementReport.balance.receivables], ['Запасы', managementReport.balance.inventory], ['Активы', managementReport.balance.assets], ['Кредиторская задолженность', managementReport.balance.payables], ['Авансы клиентов', managementReport.balance.customerAdvances], ['Капитал', managementReport.balance.equity]]
          : [['Дата', 'Сумма', 'Описание', 'Заказ', 'Статус'], ...managementReport.reconciliation.rows.map(row => [row.date.toLocaleDateString('ru-RU'), row.amount, row.description, row.orderNumber || '', row.status])];
    const csv = rows.map(row => row.map(value => `"${String(value).replace(/"/g, '""')}"`).join(';')).join('\n');
    const blob = new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `finance-${kind}-${currentMonthKey}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };
  const flowSteps = [
    {
      label: 'Продажи',
      value: selectedSalesAmount,
      caption: `${selectedFinancialStats.sales} заказов создано в этом месяце`,
      tone: 'text-[#1F2937]',
      bg: 'bg-[#F6F7F9]',
      icon: ReceiptText,
    },
    {
      label: 'Приход денег',
      value: actualIncomeForPeriod,
      caption: 'все фактические поступления по дате банка',
      tone: 'text-emerald-600',
      bg: 'bg-emerald-50',
      icon: TrendingUp,
    },
    {
      label: 'Расходы',
      value: actualExpensesForPeriod,
      caption: 'списания со счёта без возвратов и переводов',
      tone: 'text-red-500',
      bg: 'bg-red-50',
      icon: TrendingDown,
    },
    {
      label: 'Возвраты / отмены',
      value: actualReturnsForPeriod,
      caption: 'возвращённые деньги и отменённые заказы без выручки',
      tone: 'text-red-500',
      bg: 'bg-red-50',
      icon: RefreshCcw,
    },
  ];

  const comparisonRows = useMemo(() => (tochkaSummary?.monthlyComparison || []).map(row => {
    const [year, month] = row.monthKey.split('-').map(Number);
    return {
      ...row,
      label: `${monthNames[(month || 1) - 1].slice(0, 3)} ${String(year).slice(-2)}`,
    };
  }), [tochkaSummary?.monthlyComparison]);

  const categories = {
    rent: { label: 'Аренда', icon: Building, color: 'text-orange-500', bg: 'bg-orange-50' },
    payroll: { label: 'ФОТ (Зарплаты)', icon: UserCheck, color: 'text-blue-500', bg: 'bg-blue-50' },
    credit: { label: 'Кредиты', icon: CreditCard, color: 'text-red-500', bg: 'bg-red-50' },
    marketing: { label: 'Маркетинг', icon: TrendingUp, color: 'text-indigo-500', bg: 'bg-indigo-50' },
    production: { label: 'Производство', icon: Factory, color: 'text-emerald-600', bg: 'bg-emerald-50' },
    other: { label: 'Прочее', icon: Briefcase, color: 'text-slate-500', bg: 'bg-slate-50' }
  };

  const tochkaIncomingTotal = (tochkaSummary?.incomingSources || []).reduce((sum, source) => sum + (Number(source.amount) || 0), 0);
  const tochkaCardsExpenseTotal = (tochkaSummary?.cards || []).reduce((sum, card) => sum + (Number(card.expenses) || 0), 0);
  const tochkaPeriodOptions = [
    { key: 'month' as const, label: 'Месяц' },
    { key: 'quarter' as const, label: 'Квартал' },
    { key: 'halfYear' as const, label: 'Полгода' },
    { key: 'year' as const, label: 'Год' },
  ];
  const expenseOperations = useMemo(() => (
    (tochkaSummary?.operations || []).filter(operation => operation.direction === 'expense' && !operation.isInternalTransfer && !operation.isRefund)
  ), [tochkaSummary?.operations]);
  const getEffectiveExpenseCategory = (operation: NonNullable<TochkaFinanceSummary['operations']>[number]) => (
    expenseCategoryOverrides[operation.id] || operation.category || 'Другое'
  );
  const expenseCategoryOptions = useMemo(() => {
    const categoriesSet = new Set<string>();
    expenseOperations.forEach(operation => {
      categoriesSet.add(getEffectiveExpenseCategory(operation));
      if (operation.category) categoriesSet.add(operation.category);
    });
    customExpenseCategories.forEach(category => categoriesSet.add(category));
    return Array.from(categoriesSet)
      .filter(Boolean)
      .sort((a, b) => a.localeCompare(b, 'ru'));
  }, [expenseOperations, expenseCategoryOverrides, customExpenseCategories]);
  const expenseOperationsByCategory = useMemo(() => {
    const map = new Map<string, NonNullable<TochkaFinanceSummary['operations']>>();
    expenseOperations.forEach(operation => {
      const key = getEffectiveExpenseCategory(operation);
      const rows = map.get(key) || [];
      rows.push(operation);
      map.set(key, rows);
    });
    return map;
  }, [expenseOperations, expenseCategoryOverrides]);
  const expenseCategoriesForView = useMemo(() => {
    const rows = Array.from(expenseOperationsByCategory.entries()).map(([category, operations]) => ({
      category,
      amount: operations.reduce((sum, operation) => sum + (Number(operation.absAmount) || 0), 0),
      count: operations.length,
    }));
    customExpenseCategories.forEach(category => {
      if (!rows.some(row => row.category === category)) {
        rows.push({ category, amount: 0, count: 0 });
      }
    });
    return rows.sort((a, b) => (b.amount - a.amount) || a.category.localeCompare(b.category, 'ru'));
  }, [expenseOperationsByCategory, customExpenseCategories]);
  const handleAddExpenseCategory = () => {
    const name = newExpenseCategoryName.trim();
    if (!name) return;
    setCustomExpenseCategories(prev => (
      prev.some(category => category.toLowerCase() === name.toLowerCase()) ? prev : [...prev, name]
    ));
    setExpandedExpenseCategories(prev => ({ ...prev, [name]: true }));
    setNewExpenseCategoryName('');
  };
  const handleSetOperationCategory = (
    operation: NonNullable<TochkaFinanceSummary['operations']>[number],
    category: string
  ) => {
    const originalCategory = operation.category || 'Другое';
    setExpenseCategoryOverrides(prev => {
      const next = { ...prev };
      if (!category || category === originalCategory) {
        delete next[operation.id];
      } else {
        next[operation.id] = category;
      }
      return next;
    });
  };
  const incomeOperations = useMemo(() => (
    (tochkaSummary?.operations || []).filter(operation => operation.direction === 'income' && !operation.isInternalTransfer)
  ), [tochkaSummary?.operations]);
  const incomeOperationsTotal = incomeOperations.reduce((sum, operation) => sum + (Number(operation.absAmount) || 0), 0);
  const calendarYear = currentDate.getFullYear();
  const calendarMonth = currentDate.getMonth();
  const calendarDaysInMonth = new Date(calendarYear, calendarMonth + 1, 0).getDate();
  const calendarLeadingDays = (new Date(calendarYear, calendarMonth, 1).getDay() + 6) % 7;
  const calendarSlots = Array.from({ length: calendarLeadingDays + calendarDaysInMonth }, (_, index) => (
    index < calendarLeadingDays ? null : index - calendarLeadingDays + 1
  ));
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const plannedForCalendarMonth = plannedExpenses.filter(expense => expense.date.getMonth() === calendarMonth && expense.date.getFullYear() === calendarYear);
  const upcomingPlannedForMonth = [...plannedForCalendarMonth]
    .sort((a, b) => a.date.getTime() - b.date.getTime())
    .slice(0, 5);
  const actualForCalendarMonth = actualManualExpenses.filter(expense => expense.date.getMonth() === calendarMonth && expense.date.getFullYear() === calendarYear);
  const plannedMonthTotal = plannedForCalendarMonth.reduce((sum, expense) => sum + (Number(expense.amount) || 0), 0);
  const actualMonthTotal = actualForCalendarMonth.reduce((sum, expense) => sum + (Number(expense.amount) || 0), 0);
  const overduePlanned = plannedExpenses.filter(expense => expense.date.getTime() < startOfToday.getTime());
  const overduePlannedTotal = overduePlanned.reduce((sum, expense) => sum + (Number(expense.amount) || 0), 0);

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
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <button
              type="button"
              onClick={() => openExpenseModal('planned')}
              className="inline-flex h-11 items-center justify-center gap-2 rounded-[8px] border border-[#D97706] bg-amber-50 px-5 text-[13px] font-semibold text-amber-800 transition-colors hover:bg-amber-100"
            >
              <CalendarIcon size={18} />
              Запланировать платёж
            </button>
            <button
              type="button"
              onClick={() => openExpenseModal('paid')}
              className="inline-flex h-11 items-center justify-center gap-2 rounded-[8px] bg-[#1F2937] px-5 text-[13px] font-semibold text-white shadow-[0_10px_24px_rgba(31,41,55,0.14)] transition-colors hover:bg-[#111827]"
            >
              <Plus size={18} />
              Добавить расход
            </button>
          </div>
        </div>

        <div className="rounded-[12px] border border-[#E6E9EF] bg-white p-2 shadow-[0_8px_22px_rgba(31,41,55,0.03)]">
          <div className="flex max-w-full gap-1 overflow-x-auto">
            {[
              { id: 'overview', label: 'Главное', icon: Sparkles },
              { id: 'pnl', label: 'Прибыль', icon: TrendingUp },
              { id: 'dds', label: 'Движение денег', icon: PieChart },
              { id: 'reconciliation', label: 'Сверка оплат', icon: Link2 },
              { id: 'balance', label: 'Баланс', icon: Scale },
              { id: 'unit', label: 'По товарам', icon: PackageCheck },
              { id: 'bank', label: 'Банк и операции', icon: Landmark },
              { id: 'expenses', label: 'Ручные расходы', icon: Trash2 },
              { id: 'calendar', label: 'Календарь', icon: CalendarIcon },
            ].map(tab => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id as typeof activeTab)}
                className={cn(
                  "inline-flex h-10 shrink-0 items-center gap-2 rounded-[8px] px-4 text-[12px] font-bold transition-all",
                  activeTab === tab.id ? "bg-[#1F2937] text-white shadow-sm" : "text-[#6B7280] hover:bg-[#F6F7F9] hover:text-[#1F2937]"
                )}
              >
                <tab.icon size={15} />
                {tab.label}
              </button>
            ))}
          </div>
        </div>

        <div className="flex flex-col gap-3 rounded-[12px] border border-[#E6E9EF] bg-white p-3 shadow-[0_8px_22px_rgba(31,41,55,0.03)] lg:flex-row lg:items-center lg:justify-between">
          <div className="flex flex-wrap items-center gap-2">
            <span className="px-1 text-[11px] font-bold uppercase tracking-[0.14em] text-[#9CA3AF]">Период</span>
            <select
              value={currentMonthKey}
              onChange={(event) => {
                const [year, month] = event.target.value.split('-').map(Number);
                setCurrentDate(new Date(year, month - 1, 1));
                setTochkaPeriod('month');
              }}
              className="h-10 rounded-[8px] border border-[#E6E9EF] bg-white px-3 text-[13px] font-bold text-[#1F2937] outline-none transition-colors hover:bg-[#F6F7F9] focus:border-[#7D7DE6]"
            >
              {monthNames.map((month, index) => {
                const value = `${currentDate.getFullYear()}-${String(index + 1).padStart(2, '0')}`;
                return <option key={value} value={value}>{month} {currentDate.getFullYear()}</option>;
              })}
            </select>
            <div className="flex rounded-[8px] border border-[#E6E9EF] bg-[#F6F7F9] p-1">
              {tochkaPeriodOptions.map(option => (
                <button
                  key={option.key}
                  type="button"
                  onClick={() => setTochkaPeriod(option.key)}
                  className={cn(
                    "h-8 rounded-[6px] px-3 text-[11px] font-bold transition-colors",
                    tochkaPeriod === option.key ? "bg-white text-[#1F2937] shadow-sm" : "text-[#6B7280] hover:text-[#1F2937]"
                  )}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>
          <div className="flex items-center justify-between gap-3 lg:justify-end">
            <div className="text-right">
              <p className={cn('text-[12px] font-bold', tochkaError ? 'text-red-500' : 'text-emerald-600')}>
                {tochkaLoading ? 'Обновляем Точка Банк…' : tochkaError ? 'Банк требует внимания' : 'Точка Банк подключён'}
              </p>
              <p className="text-[10px] font-semibold text-[#9CA3AF]">Заказы из CRM · деньги по выписке</p>
            </div>
            <button
              type="button"
              onClick={() => setTochkaRefreshKey(key => key + 1)}
              disabled={tochkaLoading}
              aria-label="Обновить данные Точка Банка"
              className={cn('inline-flex h-10 w-10 items-center justify-center rounded-[8px] border border-[#E6E9EF] bg-white text-[#6B7280] hover:bg-[#F6F7F9]', tochkaLoading && 'cursor-wait opacity-60')}
            >
              <RefreshCcw size={16} className={tochkaLoading ? 'animate-spin' : ''} />
            </button>
          </div>
        </div>

        {activeTab === 'bank' && (
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className="space-y-5"
          >
        {/* Money Flow Overview */}
        <div className="overflow-hidden rounded-[10px] border border-[#E6E9EF] bg-white shadow-[0_8px_22px_rgba(31,41,55,0.03)]">
          <div className="flex flex-col gap-3 border-b border-[#E6E9EF] px-5 py-4 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.16em] text-[#6B7280]">
                <Wallet size={14} />
                Движение денег
              </div>
              <h3 className="mt-1 text-[20px] font-semibold leading-tight text-[#1F2937]">Продажи и фактическое движение денег за месяц</h3>
              <p className="mt-1 text-[12px] font-medium text-[#6B7280]">
                {monthNames[currentDate.getMonth()]} {currentDate.getFullYear()} · продажи по дате заказа, деньги — только по дате операции банка.
              </p>
            </div>
            <div className="grid grid-cols-2 gap-2 text-right sm:grid-cols-[160px_repeat(4,minmax(96px,1fr))]">
              <select
                value={currentMonthKey}
                onChange={(event) => {
                  const [year, month] = event.target.value.split('-').map(Number);
                  setCurrentDate(new Date(year, month - 1, 1));
                  setTochkaPeriod('month');
                }}
                className="col-span-2 h-full min-h-[54px] rounded-[8px] border border-[#E6E9EF] bg-white px-3 text-left text-[13px] font-bold text-[#1F2937] outline-none transition-colors hover:bg-[#F6F7F9] focus:border-[#7D7DE6] sm:col-span-1"
              >
                {monthNames.map((month, index) => {
                  const value = `${currentDate.getFullYear()}-${String(index + 1).padStart(2, '0')}`;
                  return (
                    <option key={value} value={value}>
                      {month} {currentDate.getFullYear()}
                    </option>
                  );
                })}
              </select>
              <div className="rounded-[8px] border border-[#E6E9EF] bg-[#F6F7F9] px-3 py-2">
                <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-[#9CA3AF]">Заказы</p>
                <p className="text-[15px] font-black text-[#1F2937]">{selectedFinancialStats.orders}</p>
              </div>
              <div className="rounded-[8px] border border-[#E6E9EF] bg-[#F6F7F9] px-3 py-2">
                <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-[#9CA3AF]">Продажи</p>
                <p className="text-[15px] font-black text-[#1F2937]">{selectedFinancialStats.sales}</p>
              </div>
              <div className="rounded-[8px] border border-emerald-100 bg-emerald-50 px-3 py-2">
                <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-emerald-500">Приход</p>
                <p className="text-[15px] font-black text-emerald-600">{formatCurrency(actualIncomeForPeriod)}</p>
              </div>
              <div className="rounded-[8px] border border-[#E6E9EF] bg-white px-3 py-2">
                <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-[#9CA3AF]">Баланс счёта</p>
                <p className={cn('text-[15px] font-black', currentBankBalance < 0 ? 'text-red-500' : 'text-[#1F2937]')}>{formatCurrency(currentBankBalance)}</p>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 divide-y divide-[#E6E9EF] sm:grid-cols-2 sm:divide-x lg:grid-cols-4 lg:divide-y-0">
            {flowSteps.map((step) => (
              <div key={step.label} className="p-4">
                <div className="mb-3 flex items-center justify-between gap-2">
                  <span className="text-[10px] font-bold uppercase tracking-[0.16em] text-[#6B7280]">{step.label}</span>
                  <div className={cn("rounded-[8px] p-2", step.bg)}>
                    <step.icon size={15} />
                  </div>
                </div>
                <p className={cn("text-[22px] font-black leading-tight", step.tone)}>{formatCurrency(step.value)}</p>
                <p className="mt-1 min-h-8 text-[11px] font-bold leading-4 text-[#9CA3AF]">{step.caption}</p>
              </div>
            ))}
          </div>

          <div className="grid grid-cols-1 gap-3 border-t border-[#E6E9EF] px-5 py-4 sm:grid-cols-3">
            <div className="rounded-[8px] border border-orange-100 bg-orange-50 px-4 py-3">
              <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-orange-500">К доплате сейчас</p>
              <p className="mt-1 text-[18px] font-black text-orange-600">{formatCurrency(selectedOutstanding)}</p>
              <p className="mt-1 text-[11px] font-semibold text-orange-500">только заказы выбранного месяца</p>
            </div>
            <div className="rounded-[8px] border border-[#E6E9EF] bg-[#F6F7F9] px-4 py-3">
              <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-[#6B7280]">Результат месяца</p>
              <p className={cn('mt-1 text-[18px] font-black', actualNetForPeriod < 0 ? 'text-red-500' : 'text-emerald-600')}>{formatCurrency(actualNetForPeriod)}</p>
              <p className="mt-1 text-[11px] font-semibold text-[#9CA3AF]">приход − расходы − возвраты</p>
            </div>
            <div className="rounded-[8px] border border-[#E6E9EF] bg-white px-4 py-3">
              <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-[#6B7280]">Текущий баланс Точки</p>
              <p className={cn('mt-1 text-[18px] font-black', currentBankBalance < 0 ? 'text-red-500' : 'text-[#1F2937]')}>{formatCurrency(currentBankBalance)}</p>
              <p className="mt-1 text-[11px] font-semibold text-[#9CA3AF]">не путать с результатом выбранного месяца</p>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-3 xl:grid-cols-[1.35fr_0.65fr]">
          <div className="rounded-[10px] border border-[#E6E9EF] bg-white p-5 shadow-[0_8px_22px_rgba(31,41,55,0.03)]">
            <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-[#6B7280]">Сравнение трёх месяцев</p>
                <h3 className="mt-1 text-[20px] font-semibold text-[#1F2937]">Продажи и фактический ДДС</h3>
              </div>
              <p className="text-[11px] font-semibold text-[#9CA3AF]">Заказы — по дате создания · деньги — по дате операции банка</p>
            </div>
            <div className="mt-5 h-[300px] w-full">
              {comparisonRows.length ? (
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={comparisonRows} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                    <CartesianGrid stroke="#EEF0F4" vertical={false} />
                    <XAxis dataKey="label" tick={{ fill: '#6B7280', fontSize: 11, fontWeight: 700 }} axisLine={false} tickLine={false} />
                    <YAxis tickFormatter={(value) => `${Math.round(Number(value) / 1000)}к`} tick={{ fill: '#9CA3AF', fontSize: 10 }} axisLine={false} tickLine={false} width={42} />
                    <Tooltip formatter={(value: any, name: any) => [formatCurrency(Number(value) || 0), name]} />
                    <Legend wrapperStyle={{ fontSize: 11, fontWeight: 700 }} />
                    <Bar dataKey="sales" name="Продажи" fill="#1F2937" radius={[5, 5, 0, 0]} />
                    <Bar dataKey="income" name="Поступило" fill="#10B981" radius={[5, 5, 0, 0]} />
                    <Bar dataKey="expenses" name="Расходы" fill="#F87171" radius={[5, 5, 0, 0]} />
                    <Bar dataKey="refunds" name="Возвраты" fill="#F59E0B" radius={[5, 5, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              ) : <div className="flex h-full items-center justify-center text-[13px] font-semibold text-[#9CA3AF]">Сравнение загрузится вместе с выпиской Точки</div>}
            </div>
          </div>

          <div className="rounded-[10px] border border-[#E6E9EF] bg-white p-5 shadow-[0_8px_22px_rgba(31,41,55,0.03)]">
            <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-[#6B7280]">Расшифровка поступлений</p>
            <h3 className="mt-1 text-[20px] font-semibold text-[#1F2937]">Что реально пришло</h3>
            <div className="mt-5 space-y-3">
              {[
                ['Оплаты заказов этого месяца', bankBreakdown?.currentMonthOrderReceipts || 0, 'text-emerald-600'],
                ['Доплаты за прошлые месяцы', bankBreakdown?.priorMonthDopayments || 0, 'text-indigo-600'],
                ['Поступления без найденного заказа CRM', bankBreakdown?.unmatchedIncome || 0, 'text-[#1F2937]'],
                ['Осталось получить по продажам месяца', selectedOutstanding, 'text-orange-500'],
              ].map(([label, value, tone]) => (
                <div key={String(label)} className="flex items-center justify-between gap-4 rounded-[8px] border border-[#E6E9EF] bg-[#F6F7F9] px-3 py-3">
                  <span className="text-[12px] font-semibold leading-4 text-[#6B7280]">{label}</span>
                  <span className={cn('shrink-0 text-[14px] font-black', String(tone))}>{formatCurrency(Number(value) || 0)}</span>
                </div>
              ))}
            </div>
            <p className="mt-4 text-[11px] font-medium leading-4 text-[#9CA3AF]">Доплата считается оплатой, пришедшей в выбранном месяце по заказу, созданному раньше. Неопознанные операции оставлены отдельно, чтобы итог банка всегда сходился.</p>
          </div>
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
                onClick={() => setTochkaRefreshKey(key => key + 1)}
                disabled={tochkaLoading}
                className={cn(
                  "inline-flex h-9 items-center justify-center gap-2 rounded-[8px] border border-[#E6E9EF] bg-white px-3 text-[11px] font-semibold uppercase tracking-[0.12em] text-[#6B7280] hover:bg-[#F6F7F9]",
                  tochkaLoading && "cursor-wait opacity-60"
                )}
              >
                <RefreshCcw size={14} className={tochkaLoading ? 'animate-spin' : ''} />
                Обновить
              </button>
            </div>

            <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-3">
              <div className="rounded-[8px] border border-[#E6E9EF] bg-[#F6F7F9] p-4">
                <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-[#6B7280]">Операционные деньги</p>
                <p className="mt-2 text-[24px] font-black leading-tight text-[#1F2937]">{formatCurrency(tochkaSummary?.operatingBalance ?? tochkaSummary?.totalBalance ?? 0)}</p>
              </div>
              <div className="rounded-[8px] border border-indigo-100 bg-indigo-50/70 p-4">
                <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-indigo-500">Деньги в фондах</p>
                <p className="mt-2 text-[24px] font-black leading-tight text-indigo-600">{formatCurrency(tochkaSummary?.reservedBalance || 0)}</p>
              </div>
              <div className="rounded-[8px] border border-emerald-100 bg-emerald-50/70 p-4">
                <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-emerald-600">Всего на счетах</p>
                <p className="mt-2 text-[24px] font-black leading-tight text-emerald-600">{formatCurrency(tochkaSummary?.totalBalance || 0)}</p>
              </div>
            </div>

            <div className="mt-4 overflow-hidden rounded-[8px] border border-[#E6E9EF]">
              <div className="grid grid-cols-[1.1fr_0.7fr_0.8fr] bg-[#F6F7F9] px-4 py-3 text-[10px] font-bold uppercase tracking-[0.14em] text-[#9CA3AF]">
                <span>Счёт / название в Точке</span>
                <span>Статус</span>
                <span className="text-right">Баланс</span>
              </div>
              {(tochkaSummary?.accounts || []).map(account => (
                <div key={account.accountId} className="grid grid-cols-[1.1fr_0.7fr_0.8fr] border-t border-[#E6E9EF] px-4 py-3 text-[13px] font-bold text-[#1F2937]">
                  <span><span className="block">{account.label || 'Счёт'}</span><span className="text-[11px] text-[#9CA3AF]">{account.maskedAccountId}</span></span>
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

        <div className="flex flex-wrap items-center justify-between gap-3 rounded-[10px] border border-[#E6E9EF] bg-white p-3 shadow-[0_8px_22px_rgba(31,41,55,0.03)]">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-[#9CA3AF]">Период выписки</p>
            <p className="mt-1 text-[13px] font-semibold text-[#1F2937]">Сначала выбери месяц, затем при необходимости расширь период</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <select
              value={currentMonthKey}
              onChange={(event) => {
                const [year, month] = event.target.value.split('-').map(Number);
                setCurrentDate(new Date(year, month - 1, 1));
                setTochkaPeriod('month');
              }}
              className="h-11 rounded-[8px] border border-[#E6E9EF] bg-white px-3 text-[13px] font-bold text-[#1F2937] outline-none transition-colors hover:bg-[#F6F7F9] focus:border-[#7D7DE6]"
            >
              {monthNames.map((month, index) => {
                const value = `${currentDate.getFullYear()}-${String(index + 1).padStart(2, '0')}`;
                return (
                  <option key={value} value={value}>
                    {month} {currentDate.getFullYear()}
                  </option>
                );
              })}
            </select>
            <div className="flex rounded-[8px] border border-[#E6E9EF] bg-[#F6F7F9] p-1">
              {tochkaPeriodOptions.map(option => (
                <button
                  key={option.key}
                  type="button"
                  onClick={() => setTochkaPeriod(option.key)}
                  className={cn(
                    "h-9 rounded-[7px] px-3 text-[12px] font-bold transition-colors",
                    tochkaPeriod === option.key
                      ? "bg-[#1F2937] text-white shadow-[0_6px_16px_rgba(31,41,55,0.12)]"
                      : "text-[#6B7280] hover:bg-white"
                  )}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-3 xl:grid-cols-[0.95fr_1.05fr]">
          <div className="rounded-[10px] border border-[#E6E9EF] bg-white p-5 shadow-[0_8px_22px_rgba(31,41,55,0.03)]">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="text-[13px] font-semibold uppercase tracking-[0.16em] text-[#1F2937]">Расход</h3>
                <p className="mt-1 text-[12px] font-medium text-[#6B7280]">Раскрывай категорию, чтобы увидеть каждую операцию и дату</p>
              </div>
              <span className="text-[18px] font-black text-red-500">{formatCurrency(tochkaSummary?.actualExpenses || 0)}</span>
            </div>
            <div className="mt-4 flex flex-col gap-2 sm:flex-row">
              <input
                value={newExpenseCategoryName}
                onChange={(event) => setNewExpenseCategoryName(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') handleAddExpenseCategory();
                }}
                placeholder="Новая статья расхода, например: Аптека"
                className="h-10 flex-1 rounded-[8px] border border-[#E6E9EF] bg-[#F6F7F9] px-3 text-[12px] font-semibold text-[#1F2937] outline-none transition-colors placeholder:text-[#9CA3AF] focus:border-[#7D7DE6] focus:bg-white"
              />
              <button
                type="button"
                onClick={handleAddExpenseCategory}
                className="inline-flex h-10 items-center justify-center gap-2 rounded-[8px] bg-[#1F2937] px-4 text-[12px] font-bold text-white transition-colors hover:bg-[#111827]"
              >
                <Plus size={15} />
                Добавить статью
              </button>
            </div>
            <div className="mt-4 space-y-2">
              {expenseCategoriesForView.map(category => (
                <div key={category.category} className="overflow-hidden rounded-[8px] border border-[#E6E9EF] bg-[#F6F7F9]">
                  <button
                    type="button"
                    onClick={() => setExpandedExpenseCategories(prev => ({ ...prev, [category.category]: !prev[category.category] }))}
                    className="flex w-full items-center justify-between gap-3 p-3 text-left"
                    aria-expanded={!!expandedExpenseCategories[category.category]}
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <ChevronRight
                          size={15}
                          className={cn(
                            "shrink-0 text-[#6B7280] transition-transform",
                            expandedExpenseCategories[category.category] && "rotate-90"
                          )}
                        />
                        <p className="truncate text-[13px] font-bold text-[#1F2937]">{category.category}</p>
                      </div>
                      <p className="mt-1 pl-6 text-[11px] font-semibold text-[#9CA3AF]">{category.count} операций</p>
                    </div>
                    <p className="shrink-0 text-[13px] font-black text-red-500">{formatCurrency(category.amount)}</p>
                  </button>

                  <AnimatePresence initial={false}>
                    {expandedExpenseCategories[category.category] && (
                      <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: 'auto', opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0.18 }}
                        className="border-t border-[#E6E9EF] bg-white"
                      >
                        <div className="divide-y divide-[#E6E9EF]">
                          {(expenseOperationsByCategory.get(category.category) || []).map(operation => (
                            <div key={operation.id} className="px-3 py-3">
                              <div className="grid grid-cols-[76px_1fr_auto] items-start gap-3">
                                <div className="text-[11px] font-bold text-[#9CA3AF]">
                                  {new Date(operation.date).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' })}
                                </div>
                                <div className="min-w-0">
                                  <p className="truncate text-[12px] font-bold text-[#1F2937]" title={operation.description}>
                                    {operation.description || operation.counterparty || 'Операция'}
                                  </p>
                                  <p className="mt-1 truncate text-[11px] font-semibold text-[#6B7280]">
                                    {operation.cardMask ? `карта *${operation.cardMask}` : operation.maskedAccountId}
                                    {operation.counterparty ? ` · ${operation.counterparty}` : ''}
                                  </p>
                                </div>
                                <p className="text-right text-[12px] font-black text-red-500">-{formatCurrency(operation.absAmount)}</p>
                              </div>
                              <div className="mt-3 grid grid-cols-[76px_1fr_auto] items-center gap-3">
                                <span className="text-[10px] font-bold uppercase tracking-[0.14em] text-[#9CA3AF]">Статья</span>
                                <select
                                  value={getEffectiveExpenseCategory(operation)}
                                  onChange={(event) => handleSetOperationCategory(operation, event.target.value)}
                                  className="h-9 rounded-[8px] border border-[#E6E9EF] bg-[#F6F7F9] px-3 text-[12px] font-semibold text-[#1F2937] outline-none transition-colors focus:border-[#7D7DE6] focus:bg-white"
                                >
                                  {expenseCategoryOptions.map(option => (
                                    <option key={option} value={option}>{option}</option>
                                  ))}
                                </select>
                                {expenseCategoryOverrides[operation.id] ? (
                                  <button
                                    type="button"
                                    onClick={() => handleSetOperationCategory(operation, operation.category || 'Другое')}
                                    className="h-9 rounded-[8px] border border-[#E6E9EF] bg-white px-3 text-[11px] font-bold text-[#6B7280] transition-colors hover:bg-[#F6F7F9]"
                                  >
                                    Сбросить
                                  </button>
                                ) : (
                                  <span className="hidden sm:block" />
                                )}
                              </div>
                            </div>
                          ))}
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              ))}
              {!expenseCategoriesForView.length && (
                <div className="rounded-[8px] border border-dashed border-[#E6E9EF] p-4 text-[12px] font-semibold leading-5 text-[#6B7280]">
                  Расходных операций за выбранный период пока нет в ответе API.
                </div>
              )}
            </div>
          </div>

          <div className="overflow-hidden rounded-[10px] border border-[#E6E9EF] bg-white shadow-[0_8px_22px_rgba(31,41,55,0.03)]">
            <div className="flex items-center justify-between gap-4 border-b border-[#E6E9EF] px-5 py-4">
              <div>
                <h3 className="text-[13px] font-semibold uppercase tracking-[0.16em] text-[#1F2937]">Приход</h3>
                <p className="mt-1 text-[12px] font-medium text-[#6B7280]">Детальный отчет поступлений: дата, источник, описание и сумма</p>
              </div>
              <div className="text-right">
                <p className="text-[18px] font-black leading-tight text-emerald-600">{formatCurrency(incomeOperationsTotal)}</p>
                <p className="mt-1 text-[11px] font-bold uppercase tracking-[0.14em] text-[#9CA3AF]">{incomeOperations.length} операций</p>
              </div>
            </div>
            <div className="overflow-auto">
              <table className="w-full min-w-[860px] table-fixed">
                <colgroup>
                  <col className="w-[116px]" />
                  <col className="w-[190px]" />
                  <col />
                  <col className="w-[150px]" />
                </colgroup>
                <thead className="sticky top-0 bg-[#F6F7F9]">
                  <tr>
                    <th className="py-3 pl-5 pr-2 text-left text-[10px] font-semibold uppercase tracking-[0.14em] text-[#9CA3AF]">Дата</th>
                    <th className="px-2 py-3 text-left text-[10px] font-semibold uppercase tracking-[0.14em] text-[#9CA3AF]">Счет / карта</th>
                    <th className="px-2 py-3 text-left text-[10px] font-semibold uppercase tracking-[0.14em] text-[#9CA3AF]">Описание</th>
                    <th className="py-3 pl-2 pr-5 text-right text-[10px] font-semibold uppercase tracking-[0.14em] text-[#9CA3AF]">Сумма</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#E6E9EF]">
                  {incomeOperations.map(operation => (
                    <tr key={operation.id} className="hover:bg-[#F6F7F9]">
                      <td className="py-3 pl-5 pr-2 text-[12px] font-bold text-[#6B7280]">
                        {new Date(operation.date).toLocaleDateString('ru-RU')}
                      </td>
                      <td className="px-2 py-3 text-[12px] font-bold text-[#1F2937]">
                        {operation.cardMask ? `*${operation.cardMask}` : operation.maskedAccountId}
                      </td>
                      <td className="truncate px-2 py-3 text-[12px] font-semibold text-[#1F2937]" title={operation.description}>
                        {operation.description}
                      </td>
                      <td className="py-3 pl-2 pr-5 text-right text-[12px] font-black text-emerald-600">
                        +{formatCurrency(operation.absAmount)}
                      </td>
                    </tr>
                  ))}
                  {!incomeOperations.length && (
                    <tr>
                      <td colSpan={4} className="px-4 py-8 text-center text-[13px] font-semibold text-[#6B7280]">
                        Приходных операций за выбранный период пока нет. {tochkaSummary?.operationFetches?.[0]?.errors?.[0]?.message || ''}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
          </motion.div>
        )}

        {/* Content */}
        <AnimatePresence mode="wait">
          {activeTab === 'overview' && (
            <motion.div
              layout
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              className="space-y-4"
            >
              <div className="overflow-hidden rounded-[14px] border border-[#E6E9EF] bg-white shadow-[0_12px_32px_rgba(31,41,55,0.05)]">
                <div className="border-b border-[#E6E9EF] px-5 py-5 sm:px-6">
                  <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-[#7D7DE6]">Главная цепочка денег</p>
                  <div className="mt-1 flex flex-col gap-2 lg:flex-row lg:items-end lg:justify-between">
                    <div>
                      <h2 className="text-[24px] font-semibold tracking-tight text-[#1F2937]">От заказа до денег на счёте</h2>
                      <p className="mt-1 text-[12px] font-medium text-[#6B7280]">Слева направо: что продали, что получили, что потратили и что осталось.</p>
                    </div>
                    <p className="text-[11px] font-semibold text-[#9CA3AF]">CRM отвечает за продажи · Точка Банк — за фактические деньги</p>
                  </div>
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-6">
                  {[
                    { number: '01', label: 'Продажи', value: managementReport.pnl.revenue, detail: `${selectedFinancialStats.sales} заказов за период`, source: 'CRM', tone: 'text-[#1F2937]', badge: 'bg-[#EEF0F4] text-[#1F2937]', icon: ReceiptText },
                    { number: '02', label: 'Получено', value: managementReport.cashFlow.income, detail: 'реальные зачисления', source: 'Точка Банк', tone: 'text-emerald-600', badge: 'bg-emerald-50 text-emerald-700', icon: Landmark },
                    { number: '03', label: 'К доплате', value: selectedOutstanding, detail: 'только по заказам выбранного месяца', source: 'CRM', tone: 'text-amber-600', badge: 'bg-amber-50 text-amber-700', icon: Link2 },
                    { number: '04', label: 'Списано', value: managementReport.cashFlow.expenses + managementReport.cashFlow.refunds, detail: 'расходы и возвраты по выписке', source: 'Точка Банк', tone: 'text-red-500', badge: 'bg-red-50 text-red-600', icon: CreditCard },
                    { number: '05', label: 'Прибыль месяца', value: managementReport.pnl.netProfit, detail: 'продажи − возвраты − себестоимость − расходы', source: 'P&L', tone: managementReport.pnl.netProfit >= 0 ? 'text-emerald-600' : 'text-red-500', badge: managementReport.pnl.netProfit >= 0 ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-600', icon: TrendingUp },
                    { number: '06', label: 'На счетах', value: managementReport.balance.cash, detail: 'остаток на сегодня', source: 'Точка Банк', tone: managementReport.balance.cash >= 0 ? 'text-indigo-600' : 'text-red-500', badge: 'bg-indigo-50 text-indigo-700', icon: Wallet },
                  ].map((step, index) => (
                    <div key={step.label} className="relative border-b border-[#E6E9EF] p-5 last:border-b-0 lg:border-b-0 lg:border-r lg:last:border-r-0">
                      <div className="flex items-center justify-between gap-3">
                        <span className={cn('inline-flex h-7 min-w-7 items-center justify-center rounded-full px-2 text-[10px] font-black', step.badge)}>{step.number}</span>
                        <step.icon size={17} className={step.tone} aria-hidden="true" />
                      </div>
                      <p className="mt-5 text-[11px] font-black uppercase tracking-[0.12em] text-[#6B7280]">{step.label}</p>
                      <p className={cn('mt-2 whitespace-nowrap text-[22px] font-black tracking-tight', step.tone)}>{formatCurrency(step.value)}</p>
                      <p className="mt-2 text-[11px] font-semibold leading-4 text-[#6B7280]">{step.detail}</p>
                      <span className="mt-3 inline-flex rounded-full bg-[#F6F7F9] px-2 py-1 text-[9px] font-bold uppercase tracking-[0.1em] text-[#9CA3AF]">{step.source}</span>
                      {index < 5 && (
                        <span className="absolute -right-[13px] top-1/2 z-10 hidden h-7 w-7 -translate-y-1/2 items-center justify-center rounded-full border border-[#E6E9EF] bg-white text-[#9CA3AF] lg:flex">
                          <ChevronRight size={14} />
                        </span>
                      )}
                    </div>
                  ))}
                </div>

                <div className="grid grid-cols-1 border-t border-[#E6E9EF] bg-[#FAFAFB] sm:grid-cols-3 sm:divide-x sm:divide-[#E6E9EF]">
                  <div className="border-b border-[#E6E9EF] px-5 py-4 sm:border-b-0">
                    <p className="text-[10px] font-bold uppercase tracking-[0.13em] text-[#9CA3AF]">Деньги за период</p>
                    <p className={cn('mt-1 text-[18px] font-black', managementReport.cashFlow.net >= 0 ? 'text-emerald-600' : 'text-red-500')}>{formatCurrency(managementReport.cashFlow.net)}</p>
                    <p className="mt-1 text-[10px] font-semibold text-[#6B7280]">поступления минус списания</p>
                  </div>
                  <div className="border-b border-[#E6E9EF] px-5 py-4 sm:border-b-0">
                    <p className="text-[10px] font-bold uppercase tracking-[0.13em] text-[#9CA3AF]">Рентабельность</p>
                    <p className={cn('mt-1 text-[18px] font-black', managementReport.pnl.netProfit >= 0 ? 'text-emerald-600' : 'text-red-500')}>{managementReport.pnl.netRevenue > 0 ? Math.round(managementReport.pnl.netProfit / managementReport.pnl.netRevenue * 100) : 0}%</p>
                    <p className="mt-1 text-[10px] font-semibold text-[#6B7280]">доля прибыли в выручке</p>
                  </div>
                  <button type="button" onClick={() => setActiveTab('reconciliation')} className="px-5 py-4 text-left transition-colors hover:bg-white">
                    <p className="text-[10px] font-bold uppercase tracking-[0.13em] text-[#9CA3AF]">Сверено с банком</p>
                    <p className={cn('mt-1 text-[18px] font-black', managementReport.reconciliation.rate >= 0.9 ? 'text-emerald-600' : 'text-amber-600')}>{Math.round(managementReport.reconciliation.rate * 100)}%</p>
                    <p className="mt-1 inline-flex items-center gap-1 text-[10px] font-bold text-[#6B7280]">Открыть несверенные <ChevronRight size={12} /></p>
                  </button>
                </div>
              </div>

              <div className="overflow-hidden rounded-[12px] border border-[#E6E9EF] bg-white shadow-[0_8px_22px_rgba(31,41,55,0.03)]">
                <div className="flex flex-col gap-3 border-b border-[#E6E9EF] px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-amber-600">Календарь на главной</p>
                    <h3 className="mt-1 text-[18px] font-semibold text-[#1F2937]">Ближайшие платежи месяца</h3>
                    <p className="mt-1 text-[11px] font-semibold text-[#6B7280]">План: {formatCurrency(plannedMonthTotal)} · просрочено: {formatCurrency(overduePlannedTotal)}</p>
                  </div>
                  <div className="flex gap-2">
                    <button type="button" onClick={() => openExpenseModal('planned')} className="inline-flex h-10 items-center justify-center gap-2 rounded-[8px] bg-amber-600 px-4 text-[11px] font-bold text-white hover:bg-amber-700"><Plus size={15} />Запланировать</button>
                    <button type="button" onClick={() => setActiveTab('calendar')} className="inline-flex h-10 items-center justify-center gap-2 rounded-[8px] border border-[#E6E9EF] px-4 text-[11px] font-bold text-[#1F2937] hover:bg-[#F6F7F9]">Весь календарь <ChevronRight size={14} /></button>
                  </div>
                </div>
                <div className="grid grid-cols-1 divide-y divide-[#E6E9EF] sm:grid-cols-5 sm:divide-x sm:divide-y-0">
                  {upcomingPlannedForMonth.map(expense => {
                    const isOverdue = expense.date.getTime() < startOfToday.getTime();
                    return (
                      <div key={expense.id} className={cn('min-h-[112px] p-4', isOverdue && 'bg-red-50/60')}>
                        <p className={cn('text-[10px] font-black uppercase tracking-[0.12em]', isOverdue ? 'text-red-600' : 'text-amber-600')}>{expense.date.toLocaleDateString('ru-RU', { day: '2-digit', month: 'short' })}</p>
                        <p className="mt-2 truncate text-[12px] font-bold text-[#1F2937]" title={expense.description}>{expense.description}</p>
                        <p className={cn('mt-2 text-[15px] font-black', isOverdue ? 'text-red-600' : 'text-[#1F2937]')}>{formatCurrency(expense.amount)}</p>
                      </div>
                    );
                  })}
                  {!upcomingPlannedForMonth.length && (
                    <div className="p-5 text-[12px] font-semibold text-[#6B7280] sm:col-span-5">На выбранный месяц платежей пока нет. Нажмите «Запланировать».</div>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-1 gap-3 xl:grid-cols-[1.1fr_0.9fr]">
                <div className="rounded-[10px] border border-[#E6E9EF] bg-white p-5 shadow-[0_8px_22px_rgba(31,41,55,0.03)]">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-[#6B7280]">CFO Agent</p>
                      <h3 className="mt-1 text-[20px] font-semibold text-[#1F2937]">Контрольные сигналы периода</h3>
                    </div>
                    <Sparkles size={20} className="text-indigo-500" />
                  </div>
                  <div className="mt-4 space-y-2">
                    {managementReport.cfo.warnings.map((warning, index) => (
                      <div key={`${warning.title}-${index}`} className={cn(
                        'flex items-start gap-3 rounded-[8px] border p-4',
                        warning.level === 'critical' ? 'border-red-100 bg-red-50' : warning.level === 'warning' ? 'border-amber-100 bg-amber-50' : 'border-emerald-100 bg-emerald-50'
                      )}>
                        {warning.level === 'info'
                          ? <CheckCircle2 size={18} className="mt-0.5 shrink-0 text-emerald-600" />
                          : <AlertTriangle size={18} className={cn('mt-0.5 shrink-0', warning.level === 'critical' ? 'text-red-500' : 'text-amber-600')} />}
                        <div>
                          <p className="text-[13px] font-bold text-[#1F2937]">{warning.title}</p>
                          <p className="mt-1 text-[12px] font-medium leading-5 text-[#6B7280]">{warning.message}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="rounded-[10px] border border-[#E6E9EF] bg-white p-5 shadow-[0_8px_22px_rgba(31,41,55,0.03)]">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-[#6B7280]">Reconciliation</p>
                      <h3 className="mt-1 text-[20px] font-semibold text-[#1F2937]">Заказы ↔ Точка Банк</h3>
                    </div>
                    <span className={cn('text-[24px] font-black', managementReport.reconciliation.rate >= 0.9 ? 'text-emerald-600' : 'text-red-500')}>
                      {Math.round(managementReport.reconciliation.rate * 100)}%
                    </span>
                  </div>
                  <div className="mt-5 h-3 overflow-hidden rounded-full bg-[#E6E9EF]" role="progressbar" aria-label="Доля сверенных поступлений" aria-valuenow={Math.round(managementReport.reconciliation.rate * 100)} aria-valuemin={0} aria-valuemax={100}>
                    <div className={cn('h-full rounded-full', managementReport.reconciliation.rate >= 0.9 ? 'bg-emerald-500' : 'bg-red-500')} style={{ width: `${Math.min(100, managementReport.reconciliation.rate * 100)}%` }} />
                  </div>
                  <div className="mt-5 grid grid-cols-2 gap-3">
                    <div className="rounded-[8px] bg-emerald-50 p-3">
                      <p className="text-[10px] font-bold uppercase text-emerald-700">Сверено</p>
                      <p className="mt-2 text-[17px] font-black text-emerald-700">{formatCurrency(managementReport.reconciliation.reconciledAmount)}</p>
                    </div>
                    <div className="rounded-[8px] bg-red-50 p-3">
                      <p className="text-[10px] font-bold uppercase text-red-600">Без заказа</p>
                      <p className="mt-2 text-[17px] font-black text-red-600">{formatCurrency(managementReport.reconciliation.unmatchedAmount)}</p>
                    </div>
                  </div>
                </div>
              </div>
            </motion.div>
          )}

          {activeTab === 'pnl' && (
            <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="overflow-hidden rounded-[10px] border border-[#E6E9EF] bg-white shadow-[0_8px_22px_rgba(31,41,55,0.03)]">
              <div className="flex items-center justify-between border-b border-[#E6E9EF] px-5 py-4">
                <div>
                  <h3 className="text-[13px] font-semibold uppercase tracking-[0.16em] text-[#1F2937]">Отчёт о прибылях и убытках</h3>
                  <p className="mt-1 text-[12px] text-[#6B7280]">Метод начисления: выручка по дате заказа, себестоимость из карточек товаров.</p>
                </div>
                <button type="button" onClick={() => exportFinanceCsv('pnl')} className="inline-flex h-10 items-center gap-2 rounded-[8px] border border-[#E6E9EF] px-3 text-[12px] font-bold text-[#1F2937] hover:bg-[#F6F7F9]"><FileSpreadsheet size={16} />CSV</button>
              </div>
              <div className="divide-y divide-[#E6E9EF]">
                {[
                  ['Выручка', managementReport.pnl.revenue, 'text-[#1F2937]'],
                  ['Возвраты и корректировки', -managementReport.pnl.returns, 'text-red-500'],
                  ['Чистая выручка', managementReport.pnl.netRevenue, 'text-[#1F2937]'],
                  ['Себестоимость реализованных товаров', -managementReport.pnl.cogs, 'text-red-500'],
                  ['Валовая прибыль', managementReport.pnl.grossProfit, 'text-emerald-600'],
                  ['Операционные расходы', -managementReport.pnl.operatingExpenses, 'text-red-500'],
                  ['Чистая прибыль', managementReport.pnl.netProfit, managementReport.pnl.netProfit >= 0 ? 'text-emerald-600' : 'text-red-500'],
                ].map(([label, value, tone], index) => (
                  <div key={String(label)} className={cn('flex items-center justify-between px-5 py-4', index === 2 || index === 4 || index === 6 ? 'bg-[#F6F7F9]' : '')}>
                    <span className={cn('text-[13px] text-[#1F2937]', index === 2 || index === 4 || index === 6 ? 'font-black' : 'font-semibold')}>{label}</span>
                    <span className={cn('text-[14px] font-black', String(tone))}>{formatCurrency(Number(value))}</span>
                  </div>
                ))}
              </div>
            </motion.div>
          )}

          {activeTab === 'balance' && (
            <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="space-y-3">
              <div className="rounded-[12px] border border-indigo-200 bg-indigo-50/60 p-5">
                <div className="flex items-start gap-3">
                  <div className="mt-0.5 rounded-[8px] bg-white p-2 text-indigo-600 shadow-sm"><Scale size={18} /></div>
                  <div>
                    <p className="text-[10px] font-black uppercase tracking-[0.16em] text-indigo-600">Как читать этот отчёт</p>
                    <h3 className="mt-1 text-[19px] font-semibold text-[#1F2937]">Баланс — это снимок того, что есть у бизнеса и кому принадлежат эти деньги</h3>
                    <p className="mt-2 max-w-4xl text-[12px] font-medium leading-5 text-[#6B7280]">Слева показано, что сейчас есть у бизнеса. Справа — что из этого мы должны поставщикам или клиентам, а что остаётся бизнесу. Это расчёт CRM по имеющимся данным, а не официальный бухгалтерский баланс.</p>
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
                {[
                  {
                    title: 'Что есть у бизнеса',
                    accountingTitle: 'Активы',
                    total: managementReport.balance.assets,
                    formula: 'деньги + долги клиентов + остатки товаров',
                    rows: [
                      { label: 'Деньги на счетах', value: managementReport.balance.cash, description: 'Фактические текущие остатки всех счетов Точка Банка, включая отложенные средства.', source: 'Источник: Точка Банк' },
                      { label: 'Клиенты должны нам', accounting: 'Дебиторская задолженность', value: managementReport.balance.receivables, description: 'Неоплаченная часть заказов выбранного периода.', source: 'Формула: стоимость активных заказов − подтверждённые оплаты' },
                      { label: 'Товары на складе', accounting: 'Запасы по себестоимости', value: managementReport.balance.inventory, description: 'Сколько нам стоили товары, которые сейчас числятся в остатках. Это не цена их будущей продажи.', source: 'Формула: остаток товара × себестоимость из карточки' },
                    ],
                    tone: 'text-emerald-600',
                  },
                  {
                    title: 'Что мы должны и что остаётся',
                    accountingTitle: 'Обязательства и расчётный капитал',
                    total: managementReport.balance.liabilities + managementReport.balance.equity,
                    formula: 'долги бизнеса + авансы клиентов + расчётный остаток',
                    rows: [
                      { label: 'Мы должны оплатить', accounting: 'Кредиторская задолженность', value: managementReport.balance.payables, description: 'Запланированные, но ещё не отмеченные оплаченными расходы выбранного периода.', source: 'Источник: платёжный календарь' },
                      { label: 'Получили аванс от клиентов', accounting: 'Авансы клиентов', value: managementReport.balance.customerAdvances, description: 'Клиент уже заплатил, но заказ ещё новый или находится в производстве. До выполнения заказа эти деньги считаются нашим обязательством.', source: 'Источник: подтверждённые оплаты заказов' },
                      { label: 'Остаётся бизнесу по расчёту', accounting: 'Расчётный капитал', value: managementReport.balance.equity, description: 'Технический остаток, который уравнивает две стороны отчёта. Это не прибыль и не сумма, которую можно вывести.', source: 'Формула: активы − наши долги − авансы клиентов' },
                    ],
                    tone: 'text-indigo-600',
                  },
                ].map(column => (
                  <div key={column.title} className="overflow-hidden rounded-[10px] border border-[#E6E9EF] bg-white shadow-[0_8px_22px_rgba(31,41,55,0.03)]">
                    <div className="border-b border-[#E6E9EF] px-5 py-4">
                      <div className="flex items-start justify-between gap-4">
                        <div><h3 className="text-[13px] font-bold uppercase tracking-[0.12em] text-[#1F2937]">{column.title}</h3><p className="mt-1 text-[10px] font-semibold text-[#9CA3AF]">Бухгалтерское название: {column.accountingTitle}</p></div>
                        <span className={cn('whitespace-nowrap text-[18px] font-black', column.tone)}>{formatCurrency(column.total)}</span>
                      </div>
                      <p className="mt-3 rounded-[7px] bg-[#F6F7F9] px-3 py-2 text-[11px] font-semibold text-[#6B7280]">Итого = {column.formula}</p>
                    </div>
                    <div className="divide-y divide-[#E6E9EF]">{column.rows.map(row => (
                      <div key={row.label} className="px-5 py-4">
                        <div className="flex items-start justify-between gap-4"><div><p className="text-[13px] font-bold text-[#1F2937]">{row.label}</p>{row.accounting && <p className="mt-0.5 text-[10px] font-semibold text-[#9CA3AF]">В отчётности: {row.accounting}</p>}</div><span className="whitespace-nowrap text-[14px] font-black text-[#1F2937]">{formatCurrency(Number(row.value))}</span></div>
                        <p className="mt-2 text-[11px] font-medium leading-4 text-[#6B7280]">{row.description}</p>
                        <p className="mt-1 text-[10px] font-bold text-indigo-600">{row.source}</p>
                      </div>
                    ))}</div>
                  </div>
                ))}
              </div>
              <div className="flex flex-col gap-2 rounded-[10px] border border-amber-200 bg-amber-50 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                <p className="text-[11px] font-semibold leading-4 text-amber-900"><strong>Важно:</strong> если оплаты банка ещё не связаны с заказами, строка «Клиенты должны нам» может быть завышена. Сначала проверьте вкладку «Сверка оплат».</p>
                <button type="button" onClick={() => exportFinanceCsv('balance')} className="inline-flex h-10 shrink-0 items-center justify-center gap-2 rounded-[8px] border border-amber-300 bg-white px-3 text-[12px] font-bold text-[#1F2937] hover:bg-amber-100"><FileSpreadsheet size={16} />Экспорт баланса</button>
              </div>
            </motion.div>
          )}

          {activeTab === 'unit' && (
            <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="overflow-hidden rounded-[10px] border border-[#E6E9EF] bg-white shadow-[0_8px_22px_rgba(31,41,55,0.03)]">
              <div className="border-b border-[#E6E9EF] px-5 py-4"><h3 className="text-[13px] font-semibold uppercase tracking-[0.16em] text-[#1F2937]">Юнит-экономика фактических продаж</h3><p className="mt-1 text-[12px] text-[#6B7280]">Цена и маржа считаются по заказам, себестоимость — из каталога товаров.</p></div>
              <div className="overflow-x-auto"><table className="w-full min-w-[820px]"><thead><tr className="bg-[#F6F7F9]">{['Товар', 'Единиц', 'Ср. цена', 'Себестоимость / ед.', 'Вклад', 'Маржа'].map((label, index) => <th key={label} className={cn('px-5 py-3 text-[10px] font-bold uppercase tracking-[0.12em] text-[#9CA3AF]', index ? 'text-right' : 'text-left')}>{label}</th>)}</tr></thead><tbody className="divide-y divide-[#E6E9EF]">{managementReport.unitEconomics.map(row => <tr key={row.id}><td className="px-5 py-4 text-[13px] font-bold text-[#1F2937]">{row.name}</td><td className="px-5 py-4 text-right text-[13px] font-semibold">{row.units}</td><td className="px-5 py-4 text-right text-[13px] font-semibold">{formatCurrency(row.averagePrice)}</td><td className="px-5 py-4 text-right text-[13px] font-semibold">{formatCurrency(row.unitCost)}</td><td className={cn('px-5 py-4 text-right text-[13px] font-black', row.contribution >= 0 ? 'text-emerald-600' : 'text-red-500')}>{formatCurrency(row.contribution)}</td><td className="px-5 py-4 text-right text-[13px] font-black">{Math.round(row.margin * 100)}%</td></tr>)}{!managementReport.unitEconomics.length && <tr><td colSpan={6} className="px-5 py-10 text-center text-[13px] font-semibold text-[#6B7280]">В выбранном периоде нет продаж с товарами.</td></tr>}</tbody></table></div>
            </motion.div>
          )}

          {activeTab === 'reconciliation' && (
            <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="overflow-hidden rounded-[10px] border border-[#E6E9EF] bg-white shadow-[0_8px_22px_rgba(31,41,55,0.03)]">
              <div className="flex items-center justify-between border-b border-[#E6E9EF] px-5 py-4"><div><h3 className="text-[13px] font-semibold uppercase tracking-[0.16em] text-[#1F2937]">Сверка банковских поступлений</h3><p className="mt-1 text-[12px] text-[#6B7280]">Точная связь — по номеру заказа; предложение — по уникальной сумме и дате ±7 дней.</p></div><button type="button" onClick={() => exportFinanceCsv('reconciliation')} className="inline-flex h-10 items-center gap-2 rounded-[8px] border border-[#E6E9EF] px-3 text-[12px] font-bold hover:bg-[#F6F7F9]"><FileSpreadsheet size={16} />CSV</button></div>
              <div className="overflow-x-auto"><table className="w-full min-w-[1120px]"><thead><tr className="bg-[#F6F7F9]">{['Дата', 'Операция банка', 'Сумма', 'Заказ', 'Клиент', 'Статус / ручная связь'].map(label => <th key={label} className="px-5 py-3 text-left text-[10px] font-bold uppercase tracking-[0.12em] text-[#9CA3AF]">{label}</th>)}</tr></thead><tbody className="divide-y divide-[#E6E9EF]">{managementReport.reconciliation.rows.map(row => <tr key={row.operationId}><td className="px-5 py-4 text-[12px] font-semibold text-[#6B7280]">{row.date.toLocaleDateString('ru-RU')}</td><td className="max-w-[320px] truncate px-5 py-4 text-[12px] font-semibold text-[#1F2937]" title={row.description}>{row.description}</td><td className="px-5 py-4 text-[12px] font-black text-emerald-600">{formatCurrency(row.amount)}</td><td className="px-5 py-4 text-[12px] font-bold">{row.orderNumber ? `#${row.orderNumber}` : '—'}</td><td className="px-5 py-4 text-[12px] font-semibold text-[#6B7280]">{row.clientName || '—'}</td><td className="px-5 py-3"><div className="flex min-w-[260px] items-center gap-2"><span className={cn('inline-flex shrink-0 rounded-full px-2.5 py-1 text-[10px] font-bold uppercase', row.status === 'matched' ? 'bg-emerald-50 text-emerald-700' : row.status === 'suggested' ? 'bg-amber-50 text-amber-700' : 'bg-red-50 text-red-600')}>{row.status === 'matched' ? (row.method === 'manual' ? 'Вручную' : 'Сверено') : row.status === 'suggested' ? 'Проверить' : 'Не найдено'}</span><select aria-label={`Связать операцию ${row.operationId} с заказом`} value={reconciliationOverrides[row.operationId] || ''} onChange={(event) => void saveReconciliation(row.operationId, event.target.value).catch(error => handleFirestoreError(error, OperationType.WRITE, 'finance_reconciliations'))} className="h-9 min-w-0 flex-1 rounded-[8px] border border-[#E6E9EF] bg-white px-2 text-[11px] font-semibold text-[#1F2937] outline-none focus:border-[#7D7DE6]"><option value="">Автоматически</option>{reconciliationOrderOptions.map(order => <option key={order.id} value={order.id}>#{order.orderNumber || order.id} · {order.clientName || 'без клиента'} · {formatCurrency(getOrderRevenue(order))}</option>)}</select></div></td></tr>)}{!managementReport.reconciliation.rows.length && <tr><td colSpan={6} className="px-5 py-10 text-center text-[13px] font-semibold text-[#6B7280]">Поступлений для сверки пока нет.</td></tr>}</tbody></table></div>
            </motion.div>
          )}

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
                  <div>
                    <h3 className="text-[13px] font-semibold uppercase tracking-[0.16em] text-[#1F2937]">Отчёт о движении денежных средств</h3>
                    <p className="mt-1 text-[12px] text-[#6B7280]">Кассовый метод: только фактические операции Точка Банка выбранного периода.</p>
                  </div>
                  <button type="button" onClick={() => exportFinanceCsv('dds')} className="inline-flex h-10 items-center gap-2 rounded-[8px] border border-[#E6E9EF] px-3 text-[12px] font-bold text-[#1F2937] hover:bg-[#F6F7F9]"><Download size={16} />CSV</button>
                </div>
                <div className="grid grid-cols-1 divide-y divide-[#E6E9EF] sm:grid-cols-4 sm:divide-x sm:divide-y-0">
                  {[
                    ['Поступления', managementReport.cashFlow.income, 'text-emerald-600'],
                    ['Операционные списания', -managementReport.cashFlow.expenses, 'text-red-500'],
                    ['Возвраты клиентам', -managementReport.cashFlow.refunds, 'text-red-500'],
                    ['Чистый денежный поток', managementReport.cashFlow.net, managementReport.cashFlow.net >= 0 ? 'text-emerald-600' : 'text-red-500'],
                  ].map(([label, value, tone]) => <div key={String(label)} className="p-5"><p className="text-[10px] font-bold uppercase tracking-[0.12em] text-[#9CA3AF]">{label}</p><p className={cn('mt-2 text-[20px] font-black', String(tone))}>{formatCurrency(Number(value))}</p></div>)}
                </div>
              </div>
              <div className="overflow-hidden rounded-[10px] border border-[#E6E9EF] bg-white shadow-[0_8px_22px_rgba(31,41,55,0.03)]">
                <div className="flex items-center justify-between border-b border-[#E6E9EF] px-5 py-4">
                  <div><h3 className="text-[13px] font-semibold uppercase tracking-[0.16em] text-[#1F2937]">История заказов и оплат CRM</h3><p className="mt-1 text-[12px] text-[#6B7280]">Контрольный регистр по месяцам; банковский ДДС показан выше.</p></div>
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
                {actualManualExpenses.length > 0 ? (
                  actualManualExpenses.map((expense) => {
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
                      const total = actualManualExpenses.filter(e => e.category === key).reduce((a, b) => a + b.amount, 0);
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
              className="space-y-4"
            >
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <div className="rounded-[10px] border border-amber-200 bg-amber-50 p-4">
                  <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-amber-700">Запланировано на месяц</p>
                  <p className="mt-2 text-[22px] font-black text-amber-700">{formatCurrency(plannedMonthTotal)}</p>
                  <p className="mt-1 text-[11px] font-semibold text-amber-800/70">{plannedForCalendarMonth.length} будущих платежей</p>
                </div>
                <div className="rounded-[10px] border border-[#E6E9EF] bg-white p-4">
                  <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-[#6B7280]">Фактические ручные расходы</p>
                  <p className="mt-2 text-[22px] font-black text-red-500">{formatCurrency(actualMonthTotal)}</p>
                  <p className="mt-1 text-[11px] font-semibold text-[#6B7280]">без автоматических списаний банка</p>
                </div>
                <div className={cn('rounded-[10px] border p-4', overduePlanned.length ? 'border-red-200 bg-red-50' : 'border-emerald-200 bg-emerald-50')}>
                  <p className={cn('text-[10px] font-bold uppercase tracking-[0.14em]', overduePlanned.length ? 'text-red-600' : 'text-emerald-700')}>Просрочено</p>
                  <p className={cn('mt-2 text-[22px] font-black', overduePlanned.length ? 'text-red-600' : 'text-emerald-700')}>{formatCurrency(overduePlannedTotal)}</p>
                  <p className={cn('mt-1 text-[11px] font-semibold', overduePlanned.length ? 'text-red-700/70' : 'text-emerald-800/70')}>{overduePlanned.length ? `${overduePlanned.length} платежей требуют внимания` : 'просроченных платежей нет'}</p>
                </div>
              </div>

              <div className="overflow-hidden rounded-[12px] border border-[#E6E9EF] bg-white shadow-[0_8px_22px_rgba(31,41,55,0.03)]">
                <div className="flex flex-col gap-4 border-b border-[#E6E9EF] p-5 lg:flex-row lg:items-center lg:justify-between">
                  <div>
                    <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-[#7D7DE6]">Платёжный календарь</p>
                    <div className="mt-2 flex items-center gap-2">
                      <button type="button" aria-label="Предыдущий месяц" onClick={() => setCurrentDate(new Date(calendarYear, calendarMonth - 1, 1))} className="inline-flex h-10 w-10 items-center justify-center rounded-[8px] border border-[#E6E9EF] text-[#6B7280] hover:bg-[#F6F7F9]"><ChevronLeft size={18} /></button>
                      <h3 className="min-w-[170px] text-center text-[18px] font-semibold capitalize text-[#1F2937]">{currentDate.toLocaleString('ru-RU', { month: 'long', year: 'numeric' })}</h3>
                      <button type="button" aria-label="Следующий месяц" onClick={() => setCurrentDate(new Date(calendarYear, calendarMonth + 1, 1))} className="inline-flex h-10 w-10 items-center justify-center rounded-[8px] border border-[#E6E9EF] text-[#6B7280] hover:bg-[#F6F7F9]"><ChevronRight size={18} /></button>
                    </div>
                  </div>
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                    <div className="flex flex-wrap gap-x-4 gap-y-2 text-[11px] font-bold text-[#6B7280]">
                      <span className="inline-flex items-center gap-2"><i className="h-2.5 w-2.5 rounded-full bg-amber-500" />План</span>
                      <span className="inline-flex items-center gap-2"><i className="h-2.5 w-2.5 rounded-full bg-red-500" />Расход</span>
                      <span className="inline-flex items-center gap-2"><i className="h-2.5 w-2.5 rounded-full bg-emerald-500" />Приход из банка</span>
                    </div>
                    <button type="button" onClick={() => openExpenseModal('planned')} className="inline-flex h-11 items-center justify-center gap-2 rounded-[8px] bg-amber-600 px-4 text-[12px] font-bold text-white transition-colors hover:bg-amber-700"><Plus size={16} />Запланировать платёж</button>
                  </div>
                </div>

                <div className="overflow-x-auto p-4">
                  <div className="min-w-[920px]">
                    <div className="grid grid-cols-7 border-b border-[#E6E9EF]">
                      {['Понедельник', 'Вторник', 'Среда', 'Четверг', 'Пятница', 'Суббота', 'Воскресенье'].map(dayName => (
                        <div key={dayName} className="px-2 py-3 text-center text-[10px] font-bold uppercase tracking-[0.1em] text-[#9CA3AF]">{dayName}</div>
                      ))}
                    </div>
                    <div className="grid grid-cols-7 border-l border-[#E6E9EF]">
                      {calendarSlots.map((day, index) => {
                        if (!day) return <div key={`empty-${index}`} className="min-h-[150px] border-b border-r border-[#E6E9EF] bg-[#FAFAFB]" />;
                        const dayPlanned = plannedForCalendarMonth.filter(expense => expense.date.getDate() === day);
                        const dayActual = actualForCalendarMonth.filter(expense => expense.date.getDate() === day);
                        const dayIncome = incomeOperations
                          .filter(operation => {
                            const date = normalizeDate(operation.date);
                            return date.getDate() === day && date.getMonth() === calendarMonth && date.getFullYear() === calendarYear;
                          })
                          .reduce((sum, operation) => sum + (Number(operation.absAmount) || 0), 0);
                        const cellDate = new Date(calendarYear, calendarMonth, day);
                        const isToday = cellDate.toDateString() === startOfToday.toDateString();

                        return (
                          <div key={day} className={cn('min-h-[150px] space-y-2 border-b border-r border-[#E6E9EF] bg-white p-2.5', isToday && 'bg-indigo-50/40')}>
                            <div className="flex items-center justify-between">
                              <span className={cn('inline-flex h-7 w-7 items-center justify-center rounded-full text-[11px] font-black', isToday ? 'bg-indigo-600 text-white' : 'text-[#6B7280]')}>{day}</span>
                              {dayPlanned.length > 0 && <span className="text-[9px] font-bold text-amber-700">{dayPlanned.length} в плане</span>}
                            </div>
                            <div className="space-y-1.5">
                              {dayIncome > 0 && <div className="rounded-[6px] border border-emerald-200 bg-emerald-50 px-2 py-1.5 text-[10px] font-bold text-emerald-700"><span className="block text-[9px] uppercase">Приход банка</span>+{formatCurrency(dayIncome)}</div>}
                              {dayPlanned.map(expense => {
                                const isOverdue = expense.date.getTime() < startOfToday.getTime();
                                return (
                                  <div key={expense.id} className={cn('rounded-[6px] border px-2 py-1.5', isOverdue ? 'border-red-200 bg-red-50' : 'border-amber-200 bg-amber-50')}>
                                    <p className={cn('truncate text-[9px] font-bold uppercase', isOverdue ? 'text-red-600' : 'text-amber-700')}>{isOverdue ? 'Просрочен' : 'Запланирован'}</p>
                                    <p className="mt-0.5 truncate text-[10px] font-bold text-[#1F2937]" title={expense.description}>{expense.description}</p>
                                    <div className="mt-1 flex items-center justify-between gap-1">
                                      <span className={cn('text-[10px] font-black', isOverdue ? 'text-red-600' : 'text-amber-700')}>{formatCurrency(expense.amount)}</span>
                                      <button type="button" onClick={() => handleMarkExpensePaid(expense)} className="h-6 rounded-[5px] bg-white px-1.5 text-[9px] font-bold text-[#1F2937] shadow-sm hover:bg-[#F6F7F9]">Оплачен</button>
                                    </div>
                                  </div>
                                );
                              })}
                              {dayActual.map(expense => <div key={expense.id} className="rounded-[6px] border border-red-200 bg-red-50 px-2 py-1.5 text-[10px] font-bold text-red-600"><span className="block truncate" title={expense.description}>{expense.description}</span>-{formatCurrency(expense.amount)}</div>)}
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
              className="relative z-10 max-h-[calc(100vh-32px)] w-full max-w-md overflow-y-auto rounded-[2rem] bg-white shadow-2xl"
              onClick={(e) => e.stopPropagation()}
              role="dialog"
              aria-modal="true"
              aria-labelledby="expense-modal-title"
            >
              <div className="p-8 space-y-6">
                <div className="flex justify-between items-center">
                  <div>
                    <p className={cn('text-[10px] font-bold uppercase tracking-[0.14em]', expenseEntryMode === 'planned' ? 'text-amber-600' : 'text-red-500')}>{expenseEntryMode === 'planned' ? 'Будущий платёж' : 'Фактическое списание'}</p>
                    <h2 id="expense-modal-title" className="mt-1 text-xl font-bold tracking-tight">{expenseEntryMode === 'planned' ? 'Запланировать платёж' : 'Добавить расход'}</h2>
                  </div>
                  <button type="button" aria-label="Закрыть форму" onClick={() => setIsModalOpen(false)} className="inline-flex h-11 w-11 items-center justify-center rounded-full text-slate-400 transition-colors hover:bg-slate-100">
                    <X size={20} />
                  </button>
                </div>

                <div className={cn('rounded-xl border px-4 py-3 text-[12px] font-semibold leading-5', expenseEntryMode === 'planned' ? 'border-amber-200 bg-amber-50 text-amber-800' : 'border-slate-200 bg-slate-50 text-slate-600')}>
                  {expenseEntryMode === 'planned'
                    ? 'Сумма появится в платёжном календаре, но не попадёт в фактические расходы, пока вы не отметите её оплаченной.'
                    : 'Используйте эту форму, только если расход уже произошёл и деньги действительно списаны.'}
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
                      <label className="text-[10px] font-bold uppercase tracking-widest text-slate-400 ml-1">{expenseEntryMode === 'planned' ? 'Дата платежа' : 'Дата списания'}</label>
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
                    type="button"
                    onClick={handleAddExpense}
                    className={cn('w-full rounded-2xl py-4 text-[11px] font-bold uppercase tracking-widest text-white shadow-xl transition-colors', expenseEntryMode === 'planned' ? 'bg-amber-600 hover:bg-amber-700' : 'bg-slate-900 hover:bg-slate-800')}
                  >
                    {expenseEntryMode === 'planned' ? 'Добавить в календарь' : 'Зафиксировать расход'}
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

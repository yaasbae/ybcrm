import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  CalendarClock,
  CalendarDays,
  Check,
  CheckCircle2,
  ClipboardList,
  CreditCard,
  Factory,
  Loader2,
  PackageCheck,
  Pencil,
  Plus,
  ReceiptText,
  Search,
  Scissors,
  Shirt,
  Trash2,
  X,
} from 'lucide-react';
import { motion } from 'motion/react';
import {
  addDoc,
  arrayUnion,
  collection,
  deleteDoc,
  doc,
  getDocs,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch,
} from 'firebase/firestore';
import { auth, db } from '../firebase';
import { cn } from '../lib/utils';
import { emitPushEvent } from '../lib/pushNotifications';
import {
  getNextProductionStatus,
  getProductionPaymentDate,
  getProductionStage,
  isProductionQueueStatus,
  type ProductionStage,
} from '../lib/production';

type ProductionEntry = {
  id: string;
  productName: string;
  date: string;
  quantity: number;
  cuttingCost: number | null;
  sewingCost: number | null;
  createdAt?: unknown;
  updatedAt?: unknown;
};

type EditDraft = {
  productName: string;
  date: string;
  quantity: string;
  cuttingCost: string;
  sewingCost: string;
};

type ProductionPageProps = {
  selectedMonth: string;
  setSelectedMonth: (month: string) => void;
  onOpenOrders?: () => void;
  isOwner?: boolean;
};

type ProductionOrder = {
  id: string;
  orderId: string;
  orderNumber: string;
  clientName: string;
  clientPhone: string;
  status: string;
  item: string;
  items: string[];
  itemColors: string[];
  itemSizes: string[];
  date: string;
  deadlineDate: string;
};

type ProductionExpense = {
  id: string;
  productionMonth: string;
  productionHalf: 1 | 2;
  amount: number;
  paymentDate: string;
  status?: string;
  paid?: boolean;
};

const today = () => {
  const date = new Date();
  const offset = date.getTimezoneOffset();
  return new Date(date.getTime() - offset * 60_000).toISOString().slice(0, 10);
};

const formatMoney = (value: number) =>
  new Intl.NumberFormat('ru-RU', {
    style: 'currency',
    currency: 'RUB',
    maximumFractionDigits: 0,
  }).format(value);

const formatDate = (value: string) => {
  if (!value) return '—';
  const [year, month, day] = value.split('-');
  return `${day}.${month}.${year}`;
};

const formatOrderDate = (value: string) => {
  if (!value) return '—';
  if (/^\d{4}-\d{2}-\d{2}/.test(value)) return formatDate(value.slice(0, 10));
  return value;
};

const getEntryTotal = (entry: Pick<ProductionEntry, 'quantity' | 'cuttingCost' | 'sewingCost'>) =>
  entry.quantity * ((entry.cuttingCost || 0) + (entry.sewingCost || 0));

const monthNamesGenitive = [
  'января', 'февраля', 'марта', 'апреля', 'мая', 'июня',
  'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря',
];

const monthNamesTitle = [
  'Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь',
  'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь',
];

const getMonthDetails = (monthKey: string) => {
  const [year, month] = monthKey.split('-').map(Number);
  const safeYear = year || new Date().getFullYear();
  const safeMonth = month || new Date().getMonth() + 1;
  const lastDay = new Date(safeYear, safeMonth, 0).getDate();
  return {
    year: safeYear,
    month: safeMonth,
    lastDay,
    genitiveName: monthNamesGenitive[safeMonth - 1],
    titleName: monthNamesTitle[safeMonth - 1],
  };
};

const parseOptionalNumber = (value: string) => {
  const normalized = value.trim().replace(',', '.');
  if (!normalized) return null;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
};

const normalizeProductName = (value: string) => value.trim().replace(/\s+/g, ' ');

const matchesProductSearch = (product: string, searchValue: string) => {
  const tokens = normalizeProductName(searchValue).toLocaleLowerCase('ru-RU').split(' ').filter(Boolean);
  const normalizedProduct = product.toLocaleLowerCase('ru-RU');
  return tokens.every((token) => normalizedProduct.includes(token));
};

export const ProductionPage: React.FC<ProductionPageProps> = ({
  selectedMonth,
  setSelectedMonth,
  onOpenOrders,
  isOwner = false,
}) => {
  const [activeTab, setActiveTab] = useState<'journal' | 'payments' | 'orders'>('journal');
  const [productNames, setProductNames] = useState<string[]>([]);
  const [entries, setEntries] = useState<ProductionEntry[]>([]);
  const [orders, setOrders] = useState<ProductionOrder[]>([]);
  const [productionExpenses, setProductionExpenses] = useState<ProductionExpense[]>([]);
  const [ordersLoading, setOrdersLoading] = useState(true);
  const [ordersError, setOrdersError] = useState('');
  const [ordersSearch, setOrdersSearch] = useState('');
  const [statusSavingId, setStatusSavingId] = useState('');
  const [paymentSavingId, setPaymentSavingId] = useState('');
  const [productName, setProductName] = useState('');
  const [productPickerOpen, setProductPickerOpen] = useState(false);
  const [addingProduct, setAddingProduct] = useState(false);
  const [date, setDate] = useState(today);
  const [quantity, setQuantity] = useState('');
  const [cuttingCost, setCuttingCost] = useState('');
  const [sewingCost, setSewingCost] = useState('');
  const [search, setSearch] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<EditDraft | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const productPickerRef = useRef<HTMLDivElement>(null);
  const expenseSyncHashRef = useRef('');

  useEffect(() => {
    const unsubscribe = onSnapshot(
      collection(db, 'orders_new'),
      (snapshot) => {
        const nextOrders = snapshot.docs
          .map((orderDoc) => {
            const data = orderDoc.data();
            const items = Array.isArray(data.items)
              ? data.items.map((item: unknown) => String(item || '').trim()).filter(Boolean)
              : String(data.item || '').split(/\s*,\s*|\n/).map((item) => item.trim()).filter(Boolean);
            return {
              id: orderDoc.id,
              orderId: String(data.orderId || orderDoc.id),
              orderNumber: String(data.orderNumber || data.orderId || orderDoc.id),
              clientName: String(data.clientName || ''),
              clientPhone: String(data.clientPhone || ''),
              status: String(data.status || 'Новый'),
              item: String(data.item || items.join(', ')),
              items,
              itemColors: Array.isArray(data.itemColors) ? data.itemColors.map(String) : [],
              itemSizes: Array.isArray(data.itemSizes) ? data.itemSizes.map(String) : [],
              date: String(data.orderDate || data.date || ''),
              deadlineDate: String(data.deadlineDate || data.shipmentDate || ''),
            } satisfies ProductionOrder;
          })
          .filter((order) => isProductionQueueStatus(order.status))
          .sort((a, b) => b.date.localeCompare(a.date));
        setOrders(nextOrders);
        setOrdersLoading(false);
        setOrdersError('');
      },
      (snapshotError) => {
        console.error(snapshotError);
        setOrdersLoading(false);
        setOrdersError('Не удалось загрузить заказы для производства.');
      },
    );
    return unsubscribe;
  }, []);

  useEffect(() => {
    const unsubscribe = onSnapshot(
      doc(db, 'settings', 'handbook'),
      (snapshot) => {
        const names = snapshot.exists() && Array.isArray(snapshot.data().productNames)
          ? snapshot.data().productNames.filter((item: unknown): item is string => typeof item === 'string' && Boolean(item.trim()))
          : [];
        setProductNames(Array.from(new Set(names.map((item: string) => item.trim()))));
      },
      (snapshotError) => {
        console.error(snapshotError);
        setError('Не удалось загрузить названия изделий из справочника.');
      },
    );
    return unsubscribe;
  }, []);

  useEffect(() => {
    const closePicker = (event: MouseEvent) => {
      if (!productPickerRef.current?.contains(event.target as Node)) setProductPickerOpen(false);
    };
    document.addEventListener('mousedown', closePicker);
    return () => document.removeEventListener('mousedown', closePicker);
  }, []);

  useEffect(() => {
    const unsubscribe = onSnapshot(
      collection(db, 'production_entries'),
      (snapshot) => {
        const nextEntries = snapshot.docs.map((entryDoc) => {
          const data = entryDoc.data();
          return {
            id: entryDoc.id,
            productName: String(data.productName || ''),
            date: String(data.date || ''),
            quantity: Number(data.quantity || 0),
            cuttingCost: typeof data.cuttingCost === 'number' ? data.cuttingCost : null,
            sewingCost: typeof data.sewingCost === 'number'
              ? data.sewingCost
              : typeof data.cost === 'number' ? data.cost : null,
            createdAt: data.createdAt,
            updatedAt: data.updatedAt,
          } satisfies ProductionEntry;
        });
        nextEntries.sort((a, b) => b.date.localeCompare(a.date));
        setEntries(nextEntries);
        setLoading(false);
        setError('');
      },
      (snapshotError) => {
        console.error(snapshotError);
        setLoading(false);
        setError('Не удалось загрузить журнал производства. Проверьте доступ к CRM.');
      },
    );
    return unsubscribe;
  }, []);

  useEffect(() => {
    const unsubscribe = onSnapshot(
      query(collection(db, 'expenses'), where('source', '==', 'production')),
      (snapshot) => {
        setProductionExpenses(snapshot.docs.map((expenseDoc) => {
          const data = expenseDoc.data();
          return {
            id: expenseDoc.id,
            productionMonth: String(data.productionMonth || ''),
            productionHalf: Number(data.productionHalf) === 2 ? 2 : 1,
            amount: Number(data.amount || 0),
            paymentDate: String(data.paymentDate || ''),
            status: data.status ? String(data.status) : undefined,
            paid: typeof data.paid === 'boolean' ? data.paid : undefined,
          } satisfies ProductionExpense;
        }));
      },
      (snapshotError) => {
        console.error(snapshotError);
        setError('Не удалось загрузить фактические оплаты производства.');
      },
    );
    return unsubscribe;
  }, []);

  useEffect(() => {
    if (!notice) return;
    const timeoutId = window.setTimeout(() => setNotice(''), 2600);
    return () => window.clearTimeout(timeoutId);
  }, [notice]);

  useEffect(() => {
    if (loading) return;
    const syncHash = JSON.stringify(entries.map((entry) => [
      entry.id,
      entry.date,
      entry.quantity,
      entry.cuttingCost,
      entry.sewingCost,
    ]));
    if (expenseSyncHashRef.current === syncHash) return;
    expenseSyncHashRef.current = syncHash;

    const syncProductionExpenses = async () => {
      const periodTotals = new Map<string, { amount: number; quantity: number; monthKey: string; half: 1 | 2 }>();
      entries.forEach((entry) => {
        const monthKey = entry.date.slice(0, 7);
        const day = Number(entry.date.slice(8, 10));
        if (!monthKey || !day) return;
        const half = day <= 15 ? 1 : 2;
        const documentId = `production-${monthKey}-h${half}`;
        const current = periodTotals.get(documentId) || { amount: 0, quantity: 0, monthKey, half };
        current.amount += getEntryTotal(entry);
        current.quantity += entry.quantity;
        periodTotals.set(documentId, current);
      });

      const existingSnapshot = await getDocs(query(collection(db, 'expenses'), where('source', '==', 'production')));
      const batch = writeBatch(db);
      const desiredIds = new Set<string>();
      const existingIds = new Set(existingSnapshot.docs.map((expenseDoc) => expenseDoc.id));

      periodTotals.forEach((period, documentId) => {
        if (period.amount <= 0) return;
        desiredIds.add(documentId);
        const details = getMonthDetails(period.monthKey);
        const periodStartDay = period.half === 1 ? 1 : 16;
        const periodEndDay = period.half === 1 ? 15 : details.lastDay;
        const productionDate = `${period.monthKey}-${String(periodStartDay).padStart(2, '0')}`;
        const paymentDate = getProductionPaymentDate(productionDate);
        batch.set(doc(db, 'expenses', documentId), {
          category: 'production',
          amount: period.amount,
          description: `Производство: ${periodStartDay}–${periodEndDay} ${details.genitiveName} ${details.year}`,
          date: new Date(`${paymentDate}T12:00:00`),
          paymentDate,
          productionMonth: period.monthKey,
          productionHalf: period.half,
          quantity: period.quantity,
          source: 'production',
          ...(!existingIds.has(documentId) ? { status: 'planned', paid: false } : {}),
          updatedAt: serverTimestamp(),
        }, { merge: true });
      });

      existingSnapshot.docs.forEach((expenseDoc) => {
        if (!desiredIds.has(expenseDoc.id)) batch.delete(expenseDoc.ref);
      });
      await batch.commit();
    };

    syncProductionExpenses().catch((syncError) => {
      console.error('Production expenses sync failed', syncError);
      expenseSyncHashRef.current = '';
      setError('Производство сохранено, но не удалось обновить расходы в финансах.');
    });
  }, [entries, loading]);

  const monthEntries = useMemo(() => (
    entries.filter((entry) => !selectedMonth || entry.date.startsWith(selectedMonth))
  ), [entries, selectedMonth]);

  const filteredEntries = useMemo(() => {
    const normalizedSearch = search.trim().toLocaleLowerCase('ru-RU');
    return monthEntries.filter((entry) => (
      !normalizedSearch || entry.productName.toLocaleLowerCase('ru-RU').includes(normalizedSearch)
    ));
  }, [monthEntries, search]);

  const monthlySummary = useMemo(() => {
    const months = new Map<string, { quantity: number; cost: number }>();
    entries.forEach((entry) => {
      const monthKey = entry.date.slice(0, 7);
      if (!monthKey) return;
      const current = months.get(monthKey) || { quantity: 0, cost: 0 };
      current.quantity += entry.quantity;
      current.cost += getEntryTotal(entry);
      months.set(monthKey, current);
    });
    return Array.from(months.entries())
      .sort(([left], [right]) => right.localeCompare(left))
      .map(([monthKey, values]) => ({ monthKey, ...values, details: getMonthDetails(monthKey) }));
  }, [entries]);

  const paidPeriods = useMemo(() => {
    const paidExpenseKeys = new Set(productionExpenses
      .filter((expense) => expense.status === 'paid' || expense.paid === true)
      .map((expense) => `${expense.productionMonth}-${expense.productionHalf}`));
    const periods = new Map<string, { monthKey: string; half: 1 | 2; quantity: number; cost: number; paymentDate: string }>();
    entries.forEach((entry) => {
      const monthKey = entry.date.slice(0, 7);
      const day = Number(entry.date.slice(8, 10));
      if (!monthKey || !day) return;
      const half: 1 | 2 = day <= 15 ? 1 : 2;
      const key = `${monthKey}-${half}`;
      const current = periods.get(key) || {
        monthKey,
        half,
        quantity: 0,
        cost: 0,
        paymentDate: getProductionPaymentDate(`${monthKey}-${half === 1 ? '01' : '16'}`),
      };
      current.quantity += entry.quantity;
      current.cost += getEntryTotal(entry);
      periods.set(key, current);
    });
    const currentDate = today();
    return Array.from(periods.values())
      .filter((period) => period.cost > 0 && paidExpenseKeys.has(`${period.monthKey}-${period.half}`))
      .sort((a, b) => b.paymentDate.localeCompare(a.paymentDate));
  }, [entries, productionExpenses]);

  const paymentMonths = useMemo(() => {
    const startMonth = '2026-08';
    const currentMonth = today().slice(0, 7);
    const periodEntries = new Map<string, { quantity: number; amount: number }>();
    entries.forEach((entry) => {
      const monthKey = entry.date.slice(0, 7);
      if (monthKey < startMonth || monthKey > currentMonth) return;
      const half = Number(entry.date.slice(8, 10)) <= 15 ? 1 : 2;
      const key = `${monthKey}-${half}`;
      const current = periodEntries.get(key) || { quantity: 0, amount: 0 };
      current.quantity += entry.quantity;
      current.amount += getEntryTotal(entry);
      periodEntries.set(key, current);
    });
    const expenseByPeriod = new Map(productionExpenses.map((expense) => [
      `${expense.productionMonth}-${expense.productionHalf}`,
      expense,
    ]));
    const monthKeys: string[] = [];
    let [year, month] = startMonth.split('-').map(Number);
    const [endYear, endMonth] = currentMonth.split('-').map(Number);
    while (year < endYear || (year === endYear && month <= endMonth)) {
      monthKeys.push(`${year}-${String(month).padStart(2, '0')}`);
      month += 1;
      if (month > 12) { month = 1; year += 1; }
    }
    return monthKeys.reverse().map((monthKey) => {
      const details = getMonthDetails(monthKey);
      const halves = ([1, 2] as const).map((half) => {
        const values = periodEntries.get(`${monthKey}-${half}`) || { quantity: 0, amount: 0 };
        const expense = expenseByPeriod.get(`${monthKey}-${half}`);
        const paymentDate = expense?.paymentDate || getProductionPaymentDate(`${monthKey}-${half === 1 ? '01' : '16'}`);
        const paid = expense?.status === 'paid' || expense?.paid === true;
        const amount = values.amount || Number(expense?.amount || 0);
        return { half, quantity: values.quantity, amount, paymentDate, paid, due: !paid && amount > 0 && paymentDate <= today() };
      });
      return {
        monthKey,
        details,
        halves,
        amount: halves.reduce((sum, half) => sum + half.amount, 0),
        paid: halves.filter((half) => half.paid).reduce((sum, half) => sum + half.amount, 0),
        debt: halves.filter((half) => !half.paid).reduce((sum, half) => sum + half.amount, 0),
      };
    });
  }, [entries, productionExpenses]);

  const filteredOrders = useMemo(() => {
    const normalizedSearch = ordersSearch.trim().toLocaleLowerCase('ru-RU');
    if (!normalizedSearch) return orders;
    return orders.filter((order) => [
      order.orderNumber,
      order.clientName,
      order.clientPhone,
      order.item,
      ...order.items,
    ].some((value) => value.toLocaleLowerCase('ru-RU').includes(normalizedSearch)));
  }, [orders, ordersSearch]);

  const productionColumns = useMemo(() => {
    const groups: Record<ProductionStage, ProductionOrder[]> = { new: [], fabric: [], cutting: [], sewing: [], ready: [] };
    filteredOrders.forEach((order) => {
      const stage = getProductionStage(order.status);
      if (stage) groups[stage].push(order);
    });
    Object.values(groups).forEach((group) => group.sort((a, b) => {
      const left = a.deadlineDate || '9999-12-31';
      const right = b.deadlineDate || '9999-12-31';
      return left.localeCompare(right);
    }));
    return groups;
  }, [filteredOrders]);

  const completeProductionStage = async (order: ProductionOrder, stage: Exclude<ProductionStage, 'ready'>) => {
    const nextStatus = getNextProductionStatus(stage);
    setStatusSavingId(order.id);
    setOrdersError('');
    try {
      const now = new Date().toISOString();
      const token = await auth.currentUser?.getIdToken();
      if (!token) throw new Error('Войдите в CRM заново.');
      const response = await fetch('/api/production/stage', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderId: order.id, currentStatus: order.status, transitionId: now }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || 'Этап не изменён.');
      void emitPushEvent('production_changed', `production-stage:${order.orderId}:${nextStatus}:${now}`, {
        action: `Этап завершён: ${nextStatus}`,
        productName: order.items.join(', ') || order.item,
        quantity: Math.max(1, order.items.length),
      });
      const telegramWarning = payload.telegram?.warning ? ` ${payload.telegram.warning}` : '';
      setNotice(`Заказ #${order.orderNumber.replace(/^#+/, '')} переведён в «${payload.status || nextStatus}».${telegramWarning}`);
    } catch (saveError) {
      console.error(saveError);
      setOrdersError(saveError instanceof Error ? saveError.message : 'Статус заказа не изменился. Повторите попытку.');
    } finally {
      setStatusSavingId('');
    }
  };

  const markProductionPaymentPaid = async (monthKey: string, half: 1 | 2, amount: number) => {
    if (!isOwner || amount <= 0) return;
    const periodId = `${monthKey}-${half}`;
    const details = getMonthDetails(monthKey);
    const startDay = half === 1 ? 1 : 16;
    const endDay = half === 1 ? 15 : details.lastDay;
    if (!window.confirm(`Подтвердить оплату за ${startDay}–${endDay} ${details.genitiveName} на сумму ${formatMoney(amount)}?`)) return;

    setPaymentSavingId(periodId);
    setError('');
    try {
      const token = await auth.currentUser?.getIdToken();
      if (!token) throw new Error('Войдите в аккаунт собственника заново.');
      const response = await fetch('/api/production/payments/mark-paid', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ month: monthKey, half }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || 'Оплата не отмечена.');
      setNotice(payload.alreadyPaid ? 'Этот период уже был отмечен оплаченным' : 'Оплата за пошив отмечена');
    } catch (saveError) {
      console.error(saveError);
      setError(saveError instanceof Error ? saveError.message : 'Оплата не отмечена. Повторите попытку.');
    } finally {
      setPaymentSavingId('');
    }
  };

  const matchingProducts = useMemo(() => {
    const normalizedSearch = normalizeProductName(productName);
    const matches = normalizedSearch
      ? productNames.filter((name) => matchesProductSearch(name, normalizedSearch))
      : productNames;
    return matches.slice(0, 12);
  }, [productName, productNames]);

  const exactProductExists = useMemo(() => {
    const normalizedSearch = normalizeProductName(productName).toLocaleLowerCase('ru-RU');
    return productNames.some((name) => name.toLocaleLowerCase('ru-RU') === normalizedSearch);
  }, [productName, productNames]);

  const addProductToHandbook = async (rawName: string) => {
    const newName = normalizeProductName(rawName);
    if (!newName) return;
    setAddingProduct(true);
    setError('');
    try {
      await setDoc(
        doc(db, 'settings', 'handbook'),
        { productNames: arrayUnion(newName) },
        { merge: true },
      );
      setProductName(newName);
      setProductPickerOpen(false);
      setNotice(`Изделие «${newName}» добавлено в справочник`);
    } catch (saveError) {
      console.error(saveError);
      setError('Не удалось добавить изделие в справочник.');
      throw saveError;
    } finally {
      setAddingProduct(false);
    }
  };

  const resetForm = () => {
    setProductName('');
    setDate(today());
    setQuantity('');
    setCuttingCost('');
    setSewingCost('');
  };

  const addEntry = async (event: React.FormEvent) => {
    event.preventDefault();
    const normalizedProductName = normalizeProductName(productName);
    const parsedQuantity = Number(quantity);
    const parsedCuttingCost = parseOptionalNumber(cuttingCost);
    const parsedSewingCost = parseOptionalNumber(sewingCost);
    if (!normalizedProductName || !date || !Number.isInteger(parsedQuantity) || parsedQuantity <= 0) {
      setError('Выберите изделие, дату и укажите количество больше нуля.');
      return;
    }
    if (
      (cuttingCost.trim() && (parsedCuttingCost === null || parsedCuttingCost < 0))
      || (sewingCost.trim() && (parsedSewingCost === null || parsedSewingCost < 0))
    ) {
      setError('Стоимость кроя и пошива должна быть положительным числом или оставаться пустой.');
      return;
    }

    setSaving(true);
    setError('');
    try {
      if (!productNames.some((name) => name.toLocaleLowerCase('ru-RU') === normalizedProductName.toLocaleLowerCase('ru-RU'))) {
        await setDoc(
          doc(db, 'settings', 'handbook'),
          { productNames: arrayUnion(normalizedProductName) },
          { merge: true },
        );
      }
      await addDoc(collection(db, 'production_entries'), {
        productName: normalizedProductName,
        date,
        quantity: parsedQuantity,
        cuttingCost: parsedCuttingCost,
        sewingCost: parsedSewingCost,
        cost: parsedSewingCost,
        paymentDate: getProductionPaymentDate(date),
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      resetForm();
      setSelectedMonth(date.slice(0, 7));
      setNotice('Запись добавлена');
    } catch (saveError) {
      console.error(saveError);
      setError('Запись не сохранилась. Попробуйте ещё раз.');
    } finally {
      setSaving(false);
    }
  };

  const beginEdit = (entry: ProductionEntry) => {
    setEditingId(entry.id);
    setEditDraft({
      productName: entry.productName,
      date: entry.date,
      quantity: String(entry.quantity),
      cuttingCost: entry.cuttingCost === null ? '' : String(entry.cuttingCost),
      sewingCost: entry.sewingCost === null ? '' : String(entry.sewingCost),
    });
    setError('');
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditDraft(null);
  };

  const saveEdit = async (entryId: string) => {
    if (!editDraft) return;
    const parsedQuantity = Number(editDraft.quantity);
    const parsedCuttingCost = parseOptionalNumber(editDraft.cuttingCost);
    const parsedSewingCost = parseOptionalNumber(editDraft.sewingCost);
    if (!editDraft.productName || !editDraft.date || !Number.isInteger(parsedQuantity) || parsedQuantity <= 0) {
      setError('Проверьте изделие, дату и количество в редактируемой строке.');
      return;
    }
    if (
      (editDraft.cuttingCost.trim() && (parsedCuttingCost === null || parsedCuttingCost < 0))
      || (editDraft.sewingCost.trim() && (parsedSewingCost === null || parsedSewingCost < 0))
    ) {
      setError('Стоимость кроя и пошива должна быть положительным числом или оставаться пустой.');
      return;
    }

    setSaving(true);
    setError('');
    try {
      await updateDoc(doc(db, 'production_entries', entryId), {
        productName: editDraft.productName,
        date: editDraft.date,
        quantity: parsedQuantity,
        cuttingCost: parsedCuttingCost,
        sewingCost: parsedSewingCost,
        cost: parsedSewingCost,
        paymentDate: getProductionPaymentDate(editDraft.date),
        updatedAt: serverTimestamp(),
      });
      cancelEdit();
      setNotice('Изменения сохранены');
    } catch (saveError) {
      console.error(saveError);
      setError('Изменения не сохранились. Попробуйте ещё раз.');
    } finally {
      setSaving(false);
    }
  };

  const removeEntry = async (entry: ProductionEntry) => {
    if (!window.confirm(`Удалить запись «${entry.productName}» от ${formatDate(entry.date)}?`)) return;
    try {
      await deleteDoc(doc(db, 'production_entries', entry.id));
      setNotice('Запись удалена');
    } catch (removeError) {
      console.error(removeError);
      setError('Не удалось удалить запись.');
    }
  };

  const inputClass = 'h-11 w-full rounded-xl border border-[#E2E5EA] bg-white px-3 text-[12px] font-medium text-[#1F2937] outline-none transition-all placeholder:text-[#A0A7B2] focus:border-[#7D7DE6] focus:ring-4 focus:ring-[#7D7DE6]/10';
  const compactInputClass = 'h-9 w-full min-w-0 rounded-lg border border-[#E2E5EA] bg-white px-2.5 text-[11px] font-medium text-[#1F2937] outline-none focus:border-[#7D7DE6] focus:ring-2 focus:ring-[#7D7DE6]/10';

  return (
    <div className="mx-auto max-w-[1480px] px-4 pb-12 pt-4 sm:px-6 xl:px-8">
      <motion.section
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        className="overflow-hidden rounded-2xl border border-[#E6E9EF] bg-white shadow-[0_12px_36px_rgba(31,41,55,0.05)]"
      >
        <div className="border-b border-[#EEF0F3] px-5 py-5 sm:px-6">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-3.5">
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-[#1F2937] text-white shadow-sm">
                <Factory size={20} />
              </div>
              <div>
                <h2 className="text-lg font-semibold tracking-[-0.02em] text-[#1F2937]">Производство</h2>
                <p className="mt-0.5 text-[11px] font-medium text-[#8B95A5]">Учёт пошива изделий у подрядчика</p>
              </div>
            </div>
            {activeTab === 'journal' && (
              <label className="flex h-11 items-center gap-2 rounded-xl border border-[#E6E9EF] bg-[#F7F8FA] px-3 text-[11px] font-medium text-[#6B7280]">
                <CalendarDays size={14} />
                <span className="hidden sm:inline">Период</span>
                <input
                  type="month"
                  value={selectedMonth}
                  onChange={(event) => setSelectedMonth(event.target.value)}
                  className="cursor-pointer bg-transparent font-semibold text-[#1F2937] outline-none"
                  aria-label="Месяц производства"
                />
              </label>
            )}
          </div>
          <div className="mt-5 flex gap-1 overflow-x-auto rounded-xl bg-[#F3F4F7] p-1" role="tablist" aria-label="Разделы производства">
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === 'journal'}
              onClick={() => setActiveTab('journal')}
              className={cn(
                'flex min-h-10 shrink-0 items-center gap-2 rounded-lg px-4 text-[11px] font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#7D7DE6]',
                activeTab === 'journal' ? 'bg-white text-[#1F2937] shadow-sm' : 'text-[#6B7280] hover:text-[#1F2937]',
              )}
            >
              <Factory size={15} /> Выпуски и оплаты
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === 'payments'}
              onClick={() => setActiveTab('payments')}
              className={cn(
                'flex min-h-10 shrink-0 items-center gap-2 rounded-lg px-4 text-[11px] font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#7D7DE6]',
                activeTab === 'payments' ? 'bg-white text-[#1F2937] shadow-sm' : 'text-[#6B7280] hover:text-[#1F2937]',
              )}
            >
              <CreditCard size={15} /> Оплата за пошив
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === 'orders'}
              onClick={() => setActiveTab('orders')}
              className={cn(
                'flex min-h-10 shrink-0 items-center gap-2 rounded-lg px-4 text-[11px] font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#7D7DE6]',
                activeTab === 'orders' ? 'bg-white text-[#1F2937] shadow-sm' : 'text-[#6B7280] hover:text-[#1F2937]',
              )}
            >
              <ClipboardList size={15} /> План производства
              <span className="rounded-full bg-[#EEEEFF] px-2 py-0.5 text-[9px] font-bold text-[#6262C7]">{orders.length}</span>
            </button>
          </div>
        </div>

        {activeTab === 'journal' ? (
          <>
        <div className="grid gap-4 bg-[#F8F9FB] p-5 sm:p-6 xl:grid-cols-[minmax(0,1.08fr)_minmax(0,0.92fr)]">
          <section className="overflow-hidden rounded-2xl border border-[#E6E9EF] bg-white" aria-labelledby="monthly-production-summary">
            <div className="flex items-center justify-between gap-3 border-b border-[#EEF0F3] px-4 py-4 sm:px-5">
              <div>
                <h3 id="monthly-production-summary" className="flex items-center gap-2 text-sm font-semibold text-[#1F2937]"><PackageCheck size={16} className="text-[#7D7DE6]" /> Сводка по месяцам</h3>
                <p className="mt-1 text-[10px] text-[#8B95A5]">Нажмите на месяц, чтобы открыть его журнал</p>
              </div>
              <span className="text-[10px] font-semibold text-[#8B95A5]">{monthlySummary.length} мес.</span>
            </div>
            {monthlySummary.length ? (
              <div className="max-h-72 divide-y divide-[#EEF0F3] overflow-y-auto">
                {monthlySummary.map((month) => (
                  <button
                    key={month.monthKey}
                    type="button"
                    onClick={() => setSelectedMonth(month.monthKey)}
                    className={cn(
                      'grid min-h-16 w-full grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-[#F8F9FB] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#7D7DE6] sm:px-5',
                      selectedMonth === month.monthKey && 'bg-[#F7F7FF]',
                    )}
                  >
                    <span>
                      <span className="block text-[12px] font-semibold text-[#1F2937]">{month.details.titleName} {month.details.year}</span>
                      <span className="mt-0.5 block text-[9px] font-medium text-[#8B95A5]">{month.quantity.toLocaleString('ru-RU')} шт.</span>
                    </span>
                    <span className="text-right text-[12px] font-semibold tabular-nums text-[#1F2937]">{formatMoney(month.cost)}</span>
                    <span className={cn('h-2 w-2 rounded-full', selectedMonth === month.monthKey ? 'bg-[#7D7DE6]' : 'bg-[#D7DBE2]')} aria-hidden="true" />
                  </button>
                ))}
              </div>
            ) : (
              <div className="flex min-h-40 items-center justify-center px-6 text-center text-[11px] text-[#8B95A5]">Сводка появится после первого выпуска.</div>
            )}
          </section>

          <section className="overflow-hidden rounded-2xl border border-[#DDEFE5] bg-white" aria-labelledby="paid-production-periods">
            <div className="flex items-start justify-between gap-3 border-b border-[#E6F3EC] bg-[#FAFFFC] px-4 py-4 sm:px-5">
              <div>
                <h3 id="paid-production-periods" className="flex items-center gap-2 text-sm font-semibold text-[#1F2937]"><ReceiptText size={16} className="text-[#2EBA7F]" /> Уже оплачено</h3>
                <p className="mt-1 text-[10px] leading-4 text-[#6F887D]">Только периоды с подтверждённой фактической оплатой</p>
              </div>
              <span className="rounded-full bg-[#E7F8EF] px-2.5 py-1 text-[9px] font-bold text-[#23825D]">{paidPeriods.length}</span>
            </div>
            {paidPeriods.length ? (
              <div className="max-h-72 divide-y divide-[#EAF3EE] overflow-y-auto">
                {paidPeriods.map((period) => {
                  const details = getMonthDetails(period.monthKey);
                  const startDay = period.half === 1 ? 1 : 16;
                  const endDay = period.half === 1 ? 15 : details.lastDay;
                  return (
                    <div key={`${period.monthKey}-${period.half}`} className="grid min-h-16 grid-cols-[minmax(0,1fr)_auto] items-center gap-3 px-4 py-3 sm:px-5">
                      <div>
                        <p className="text-[12px] font-semibold text-[#1F2937]">{startDay}–{endDay} {details.genitiveName} {details.year}</p>
                        <p className="mt-0.5 flex items-center gap-1.5 text-[9px] font-medium text-[#23825D]"><Check size={11} /> Оплачено после {formatDate(period.paymentDate)}</p>
                      </div>
                      <div className="text-right">
                        <p className="text-[12px] font-semibold tabular-nums text-[#1F2937]">{formatMoney(period.cost)}</p>
                        <p className="mt-0.5 text-[9px] text-[#8B95A5]">{period.quantity.toLocaleString('ru-RU')} шт.</p>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="flex min-h-40 items-center justify-center px-6 text-center text-[11px] text-[#8B95A5]">Пока нет периодов с прошедшей датой оплаты.</div>
            )}
          </section>
        </div>

        <div className="grid gap-6 p-5 sm:p-6 lg:grid-cols-[340px_minmax(0,1fr)]">
          <aside>
            <form onSubmit={addEntry} className="rounded-2xl border border-[#E6E9EF] bg-[#F8F9FB] p-4 sm:p-5 lg:sticky lg:top-20">
              <div className="mb-5">
                <p className="text-sm font-semibold text-[#1F2937]">Добавить выпуск</p>
                <p className="mt-1 text-[10px] leading-4 text-[#8B95A5]">Крой и пошив указываются за одну штуку. Цены можно заполнить позднее.</p>
              </div>
              <div className="space-y-4">
                <div className="block" ref={productPickerRef}>
                  <span className="mb-1.5 block text-[10px] font-semibold uppercase tracking-[0.1em] text-[#6B7280]">Изделие</span>
                  <div className="relative">
                    <Search size={15} className="pointer-events-none absolute left-3 top-1/2 z-10 -translate-y-1/2 text-[#9CA3AF]" />
                    <input
                      type="text"
                      value={productName}
                      onFocus={() => setProductPickerOpen(true)}
                      onChange={(event) => {
                        setProductName(event.target.value);
                        setProductPickerOpen(true);
                      }}
                      onKeyDown={(event) => {
                        if (event.key === 'Escape') setProductPickerOpen(false);
                        if (event.key === 'Enter' && productPickerOpen && productName.trim()) {
                          event.preventDefault();
                          const exactMatch = productNames.find((name) => name.toLocaleLowerCase('ru-RU') === normalizeProductName(productName).toLocaleLowerCase('ru-RU'));
                          if (exactMatch) {
                            setProductName(exactMatch);
                            setProductPickerOpen(false);
                          } else if (matchingProducts.length > 0) {
                            setProductName(matchingProducts[0]);
                            setProductPickerOpen(false);
                          } else {
                            addProductToHandbook(productName).catch(() => undefined);
                          }
                        }
                      }}
                      placeholder="Начните вводить название"
                      className={cn(inputClass, 'pl-9')}
                      role="combobox"
                      aria-expanded={productPickerOpen}
                      aria-controls="production-product-options"
                      aria-autocomplete="list"
                      required
                    />
                    {productPickerOpen && (
                      <div
                        id="production-product-options"
                        role="listbox"
                        className="absolute z-30 mt-1.5 max-h-64 w-full overflow-y-auto rounded-xl border border-[#E2E5EA] bg-white p-1.5 shadow-[0_16px_40px_rgba(31,41,55,0.14)]"
                      >
                        {matchingProducts.map((name) => (
                          <button
                            key={name}
                            type="button"
                            role="option"
                            aria-selected={name === productName}
                            onClick={() => {
                              setProductName(name);
                              setProductPickerOpen(false);
                            }}
                            className="flex min-h-10 w-full items-center justify-between gap-3 rounded-lg px-3 py-2 text-left text-[11px] font-medium text-[#1F2937] transition-colors hover:bg-[#F4F4FA] focus-visible:bg-[#F4F4FA] focus-visible:outline-none"
                          >
                            <span>{name}</span>
                            {name === productName && <Check size={14} className="shrink-0 text-[#7D7DE6]" />}
                          </button>
                        ))}
                        {productName.trim() && !exactProductExists && (
                          <button
                            type="button"
                            onClick={() => addProductToHandbook(productName).catch(() => undefined)}
                            disabled={addingProduct}
                            className="mt-1 flex min-h-11 w-full items-center gap-2 rounded-lg border border-dashed border-[#B8B8E8] bg-[#F7F7FF] px-3 py-2 text-left text-[11px] font-semibold text-[#6262C7] transition-colors hover:bg-[#EEEEFF] disabled:opacity-50"
                          >
                            {addingProduct ? <Loader2 size={14} className="shrink-0 animate-spin" /> : <Plus size={14} className="shrink-0" />}
                            <span className="min-w-0">Добавить «<span className="break-words">{normalizeProductName(productName)}</span>»</span>
                          </button>
                        )}
                        {!matchingProducts.length && !productName.trim() && (
                          <p className="px-3 py-3 text-[10px] text-[#8B95A5]">Начните вводить название изделия.</p>
                        )}
                      </div>
                    )}
                  </div>
                  {!productNames.length && <span className="mt-1.5 block text-[10px] text-[#D97706]">В справочнике пока нет изделий.</span>}
                  <span className="mt-1.5 block text-[9px] text-[#9CA3AF]">Ищите по названию или добавьте новое изделие.</span>
                </div>
                <label className="block">
                  <span className="mb-1.5 block text-[10px] font-semibold uppercase tracking-[0.1em] text-[#6B7280]">Дата выпуска</span>
                  <input type="date" value={date} onChange={(event) => setDate(event.target.value)} className={inputClass} required />
                </label>
                <label className="block">
                  <span className="mb-1.5 block text-[10px] font-semibold uppercase tracking-[0.1em] text-[#6B7280]">Количество, шт.</span>
                  <input type="number" min="1" step="1" value={quantity} onChange={(event) => setQuantity(event.target.value)} placeholder="Например, 120" className={inputClass} required />
                </label>
                <div className="grid grid-cols-2 gap-2.5">
                  <label className="block min-w-0">
                    <span className="mb-1.5 block text-[10px] font-semibold uppercase tracking-[0.08em] text-[#6B7280]">Крой за 1 шт.</span>
                    <div className="relative">
                      <input type="number" min="0" step="0.01" value={cuttingCost} onChange={(event) => setCuttingCost(event.target.value)} placeholder="0" className={cn(inputClass, 'pr-8')} />
                      <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[12px] font-medium text-[#9CA3AF]">₽</span>
                    </div>
                  </label>
                  <label className="block min-w-0">
                    <span className="mb-1.5 block text-[10px] font-semibold uppercase tracking-[0.08em] text-[#6B7280]">Пошив за 1 шт.</span>
                    <div className="relative">
                      <input type="number" min="0" step="0.01" value={sewingCost} onChange={(event) => setSewingCost(event.target.value)} placeholder="0" className={cn(inputClass, 'pr-8')} />
                      <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[12px] font-medium text-[#9CA3AF]">₽</span>
                    </div>
                  </label>
                </div>
                {(quantity || cuttingCost || sewingCost) && (
                  <div className="rounded-xl border border-[#E6E9EF] bg-white px-3.5 py-3">
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-[9px] font-semibold uppercase tracking-[0.1em] text-[#8B95A5]">Итого за выпуск</span>
                      <span className="text-[13px] font-semibold tabular-nums text-[#1F2937]">
                        {formatMoney((Number(quantity) || 0) * ((parseOptionalNumber(cuttingCost) || 0) + (parseOptionalNumber(sewingCost) || 0)))}
                      </span>
                    </div>
                    {date && (
                      <div className="mt-2 flex items-center justify-between gap-3 border-t border-[#EEF0F3] pt-2">
                        <span className="flex items-center gap-1.5 text-[9px] font-medium text-[#8B95A5]"><CalendarClock size={12} /> Дата оплаты</span>
                        <span className="text-[10px] font-semibold text-[#6262C7]">{formatDate(getProductionPaymentDate(date))}</span>
                      </div>
                    )}
                  </div>
                )}
                <button
                  type="submit"
                  disabled={saving || !productName || !date || !quantity}
                  className="flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-[#1F2937] px-4 text-[11px] font-semibold uppercase tracking-[0.08em] text-white transition-colors hover:bg-[#303B4A] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#1F2937]/15 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {saving ? <Loader2 size={15} className="animate-spin" /> : <Plus size={15} />}
                  {saving ? 'Сохраняем' : 'Добавить запись'}
                </button>
              </div>
            </form>
          </aside>

          <div className="min-w-0">
            <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h3 className="text-sm font-semibold text-[#1F2937]">Журнал производства</h3>
                <p className="mt-0.5 text-[10px] text-[#8B95A5]">{filteredEntries.length} записей за выбранный месяц</p>
              </div>
              <label className="relative block sm:w-64">
                <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[#9CA3AF]" />
                <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Найти изделие" className={cn(inputClass, 'h-10 pl-9')} />
              </label>
            </div>

            {error && (
              <div role="alert" className="mb-4 flex items-start gap-2 rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-[11px] font-medium text-red-600">
                <AlertCircle size={15} className="mt-0.5 shrink-0" /> {error}
              </div>
            )}
            {notice && (
              <div className="mb-4 flex items-center gap-2 rounded-xl border border-emerald-100 bg-emerald-50 px-4 py-3 text-[11px] font-medium text-emerald-700">
                <Check size={15} /> {notice}
              </div>
            )}

            <div className="overflow-hidden rounded-2xl border border-[#E6E9EF]">
              {loading ? (
                <div className="flex min-h-64 items-center justify-center gap-2 text-[11px] font-medium text-[#8B95A5]">
                  <Loader2 size={16} className="animate-spin" /> Загружаем журнал
                </div>
              ) : !filteredEntries.length ? (
                <div className="flex min-h-64 flex-col items-center justify-center px-6 text-center">
                  <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-[#F2F3F7] text-[#8B95A5]">
                    <Factory size={21} />
                  </div>
                  <p className="text-sm font-semibold text-[#1F2937]">За этот месяц записей нет</p>
                  <p className="mt-1 max-w-xs text-[10px] leading-4 text-[#8B95A5]">Добавьте первый выпуск через форму слева.</p>
                </div>
              ) : (
                <>
                  <div className="hidden overflow-x-auto md:block">
                    <table className="w-full min-w-[1040px] table-fixed text-left">
                      <thead className="bg-[#F8F9FB] text-[9px] font-semibold uppercase tracking-[0.12em] text-[#8B95A5]">
                        <tr>
                          <th className="w-[21%] px-3 py-3">Изделие</th>
                          <th className="w-[11%] px-3 py-3">Выпуск</th>
                          <th className="w-[10%] px-3 py-3">Количество</th>
                          <th className="w-[11%] px-3 py-3">Крой / шт.</th>
                          <th className="w-[11%] px-3 py-3">Пошив / шт.</th>
                          <th className="w-[14%] px-3 py-3">Крой + пошив</th>
                          <th className="w-[12%] px-3 py-3">Оплата</th>
                          <th className="w-[10%] px-3 py-3 text-right">Действия</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[#EEF0F3]">
                        {filteredEntries.map((entry) => {
                          const isEditing = editingId === entry.id && editDraft;
                          return (
                            <tr key={entry.id} className="group bg-white hover:bg-[#FBFBFC]">
                              <td className="px-3 py-3">
                                {isEditing ? (
                                  <select value={editDraft.productName} onChange={(event) => setEditDraft({ ...editDraft, productName: event.target.value })} className={compactInputClass}>
                                    {productNames.map((name) => <option key={name} value={name}>{name}</option>)}
                                  </select>
                                ) : <span className="block truncate text-[12px] font-semibold text-[#1F2937]">{entry.productName}</span>}
                              </td>
                              <td className="px-3 py-3">
                                {isEditing ? <input type="date" value={editDraft.date} onChange={(event) => setEditDraft({ ...editDraft, date: event.target.value })} className={compactInputClass} /> : <span className="text-[11px] font-medium text-[#6B7280]">{formatDate(entry.date)}</span>}
                              </td>
                              <td className="px-3 py-3">
                                {isEditing ? <input type="number" min="1" step="1" value={editDraft.quantity} onChange={(event) => setEditDraft({ ...editDraft, quantity: event.target.value })} className={compactInputClass} /> : <span className="text-[12px] font-semibold tabular-nums text-[#1F2937]">{entry.quantity.toLocaleString('ru-RU')} шт.</span>}
                              </td>
                              <td className="px-3 py-3">
                                {isEditing ? <input type="number" min="0" step="0.01" placeholder="—" value={editDraft.cuttingCost} onChange={(event) => setEditDraft({ ...editDraft, cuttingCost: event.target.value })} className={compactInputClass} /> : entry.cuttingCost === null ? <span className="text-[10px] font-medium text-amber-700">Не указано</span> : <span className="text-[11px] font-semibold tabular-nums text-[#1F2937]">{formatMoney(entry.cuttingCost)}</span>}
                              </td>
                              <td className="px-3 py-3">
                                {isEditing ? <input type="number" min="0" step="0.01" placeholder="—" value={editDraft.sewingCost} onChange={(event) => setEditDraft({ ...editDraft, sewingCost: event.target.value })} className={compactInputClass} /> : entry.sewingCost === null ? <span className="text-[10px] font-medium text-amber-700">Не указано</span> : <span className="text-[11px] font-semibold tabular-nums text-[#1F2937]">{formatMoney(entry.sewingCost)}</span>}
                              </td>
                              <td className="px-3 py-3">
                                <span className="text-[12px] font-semibold tabular-nums text-[#1F2937]">{formatMoney(getEntryTotal(entry))}</span>
                                {(entry.cuttingCost === null || entry.sewingCost === null) && <span className="mt-0.5 block text-[8px] font-medium uppercase tracking-[0.06em] text-amber-700">Частичная сумма</span>}
                              </td>
                              <td className="px-3 py-3">
                                <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-[11px] font-semibold text-[#6262C7]"><CalendarClock size={13} /> {formatDate(getProductionPaymentDate(entry.date))}</span>
                              </td>
                              <td className="px-3 py-3">
                                <div className="flex justify-end gap-1">
                                  {isEditing ? (
                                    <>
                                      <button onClick={() => saveEdit(entry.id)} disabled={saving} className="flex h-8 w-8 items-center justify-center rounded-lg text-emerald-600 hover:bg-emerald-50 disabled:opacity-40" title="Сохранить"><Check size={15} /></button>
                                      <button onClick={cancelEdit} className="flex h-8 w-8 items-center justify-center rounded-lg text-[#8B95A5] hover:bg-[#F0F1F4]" title="Отменить"><X size={15} /></button>
                                    </>
                                  ) : (
                                    <>
                                      <button onClick={() => beginEdit(entry)} className="flex h-8 w-8 items-center justify-center rounded-lg text-[#7D7DE6] hover:bg-[#F1F0FF]" title="Редактировать"><Pencil size={14} /></button>
                                      <button onClick={() => removeEntry(entry)} className="flex h-8 w-8 items-center justify-center rounded-lg text-[#A0A7B2] hover:bg-red-50 hover:text-red-500" title="Удалить"><Trash2 size={14} /></button>
                                    </>
                                  )}
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>

                  <div className="divide-y divide-[#EEF0F3] md:hidden">
                    {filteredEntries.map((entry) => {
                      const isEditing = editingId === entry.id && editDraft;
                      return (
                        <div key={entry.id} className="p-4">
                          {isEditing ? (
                            <div className="space-y-3">
                              <select value={editDraft.productName} onChange={(event) => setEditDraft({ ...editDraft, productName: event.target.value })} className={compactInputClass}>{productNames.map((name) => <option key={name} value={name}>{name}</option>)}</select>
                              <div className="grid grid-cols-2 gap-2">
                                <input type="date" value={editDraft.date} onChange={(event) => setEditDraft({ ...editDraft, date: event.target.value })} className={compactInputClass} />
                                <input type="number" min="1" step="1" value={editDraft.quantity} onChange={(event) => setEditDraft({ ...editDraft, quantity: event.target.value })} className={compactInputClass} />
                              </div>
                              <div className="grid grid-cols-2 gap-2">
                                <label className="min-w-0">
                                  <span className="mb-1 block text-[9px] font-semibold uppercase tracking-[0.08em] text-[#8B95A5]">Крой / шт.</span>
                                  <input type="number" min="0" step="0.01" placeholder="Не указано" value={editDraft.cuttingCost} onChange={(event) => setEditDraft({ ...editDraft, cuttingCost: event.target.value })} className={compactInputClass} />
                                </label>
                                <label className="min-w-0">
                                  <span className="mb-1 block text-[9px] font-semibold uppercase tracking-[0.08em] text-[#8B95A5]">Пошив / шт.</span>
                                  <input type="number" min="0" step="0.01" placeholder="Не указано" value={editDraft.sewingCost} onChange={(event) => setEditDraft({ ...editDraft, sewingCost: event.target.value })} className={compactInputClass} />
                                </label>
                              </div>
                              <div className="flex gap-2">
                                <button onClick={() => saveEdit(entry.id)} disabled={saving} className="flex h-9 flex-1 items-center justify-center gap-1.5 rounded-lg bg-[#1F2937] text-[10px] font-semibold uppercase tracking-[0.06em] text-white"><Check size={14} /> Сохранить</button>
                                <button onClick={cancelEdit} className="flex h-9 items-center justify-center rounded-lg border border-[#E6E9EF] px-3 text-[#6B7280]"><X size={14} /></button>
                              </div>
                            </div>
                          ) : (
                            <>
                              <div className="flex items-start justify-between gap-3">
                                <div className="min-w-0">
                                  <p className="truncate text-[12px] font-semibold text-[#1F2937]">{entry.productName}</p>
                                  <p className="mt-1 text-[10px] font-medium text-[#8B95A5]">{formatDate(entry.date)}</p>
                                </div>
                                <div className="flex shrink-0 gap-1">
                                  <button onClick={() => beginEdit(entry)} className="flex h-8 w-8 items-center justify-center rounded-lg text-[#7D7DE6] hover:bg-[#F1F0FF]" aria-label="Редактировать"><Pencil size={14} /></button>
                                  <button onClick={() => removeEntry(entry)} className="flex h-8 w-8 items-center justify-center rounded-lg text-[#A0A7B2] hover:bg-red-50 hover:text-red-500" aria-label="Удалить"><Trash2 size={14} /></button>
                                </div>
                              </div>
                              <div className="mt-3 grid grid-cols-2 gap-x-3 gap-y-3 rounded-xl bg-[#F8F9FB] p-3">
                                <div><p className="text-[8px] font-semibold uppercase tracking-[0.1em] text-[#9CA3AF]">Количество</p><p className="mt-1 text-[12px] font-semibold text-[#1F2937]">{entry.quantity.toLocaleString('ru-RU')} шт.</p></div>
                                <div><p className="text-[8px] font-semibold uppercase tracking-[0.1em] text-[#9CA3AF]">Крой / шт.</p><p className={cn('mt-1 text-[12px] font-semibold', entry.cuttingCost === null ? 'text-amber-700' : 'text-[#1F2937]')}>{entry.cuttingCost === null ? 'Не указан' : formatMoney(entry.cuttingCost)}</p></div>
                                <div><p className="text-[8px] font-semibold uppercase tracking-[0.1em] text-[#9CA3AF]">Пошив / шт.</p><p className={cn('mt-1 text-[12px] font-semibold', entry.sewingCost === null ? 'text-amber-700' : 'text-[#1F2937]')}>{entry.sewingCost === null ? 'Не указан' : formatMoney(entry.sewingCost)}</p></div>
                                <div><p className="text-[8px] font-semibold uppercase tracking-[0.1em] text-[#9CA3AF]">Крой + пошив</p><p className="mt-1 text-[12px] font-semibold text-[#1F2937]">{formatMoney(getEntryTotal(entry))}</p></div>
                                <div className="col-span-2 border-t border-[#E6E9EF] pt-2.5"><p className="flex items-center gap-1.5 text-[8px] font-semibold uppercase tracking-[0.1em] text-[#9CA3AF]"><CalendarClock size={11} /> Дата оплаты</p><p className="mt-1 text-[12px] font-semibold text-[#6262C7]">{formatDate(getProductionPaymentDate(entry.date))}</p></div>
                              </div>
                            </>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
          </>
        ) : activeTab === 'payments' ? (
          <div className="bg-[#F8F9FB] p-5 sm:p-6">
            <div className="mb-5 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <h3 className="text-base font-semibold text-[#1F2937]">Оплата за пошив</h3>
                <p className="mt-1 max-w-2xl text-[11px] leading-5 text-[#6B7280]">Начисления с августа 2026 года. Первая половина месяца оплачивается в конце месяца, вторая — 15 числа следующего месяца.</p>
              </div>
              <div className="flex gap-4 rounded-xl bg-white px-4 py-3 text-right">
                <div><p className="text-[9px] font-medium text-[#8B95A5]">Начислено</p><p className="mt-1 text-[13px] font-semibold tabular-nums text-[#1F2937]">{formatMoney(paymentMonths.reduce((sum, month) => sum + month.amount, 0))}</p></div>
                <div><p className="text-[9px] font-medium text-[#8B95A5]">Осталось</p><p className="mt-1 text-[13px] font-semibold tabular-nums text-amber-700">{formatMoney(paymentMonths.reduce((sum, month) => sum + month.debt, 0))}</p></div>
              </div>
            </div>

            <div className="space-y-3">
              {paymentMonths.map((month) => (
                <section key={month.monthKey} className="overflow-hidden rounded-2xl border border-[#E3E6EC] bg-white">
                  <div className="grid gap-3 bg-[#F3F4F7] px-4 py-4 sm:grid-cols-[minmax(180px,1fr)_repeat(3,minmax(110px,auto))] sm:items-center sm:px-5">
                    <div>
                      <h4 className="text-[14px] font-semibold text-[#1F2937]">{month.details.titleName} {month.details.year}</h4>
                      <p className="mt-0.5 text-[10px] text-[#8B95A5]">{month.halves.reduce((sum, half) => sum + half.quantity, 0).toLocaleString('ru-RU')} изделий</p>
                    </div>
                    <div><p className="text-[9px] text-[#8B95A5]">Всего</p><p className="mt-1 text-[12px] font-semibold tabular-nums text-[#1F2937]">{formatMoney(month.amount)}</p></div>
                    <div><p className="text-[9px] text-[#8B95A5]">Оплачено</p><p className="mt-1 text-[12px] font-semibold tabular-nums text-emerald-700">{formatMoney(month.paid)}</p></div>
                    <div><p className="text-[9px] text-[#8B95A5]">Не оплачено</p><p className="mt-1 text-[12px] font-semibold tabular-nums text-amber-700">{formatMoney(month.debt)}</p></div>
                  </div>
                  <div className="grid md:grid-cols-2">
                    {month.halves.map((half, index) => {
                      const startDay = half.half === 1 ? 1 : 16;
                      const endDay = half.half === 1 ? 15 : month.details.lastDay;
                      return (
                        <div key={half.half} className={cn('p-4 sm:p-5', index === 1 && 'border-t border-[#EEF0F3] md:border-l md:border-t-0')}>
                          <div className="flex items-start justify-between gap-3">
                            <div>
                              <p className="text-[12px] font-semibold text-[#1F2937]">{startDay}–{endDay} {month.details.genitiveName}</p>
                              <p className="mt-1 text-[10px] text-[#8B95A5]">{half.quantity.toLocaleString('ru-RU')} изделий</p>
                            </div>
                            <span className={cn(
                              'inline-flex min-h-7 items-center gap-1.5 rounded-lg px-2.5 text-[9px] font-semibold',
                              half.paid ? 'bg-emerald-50 text-emerald-700' : half.due ? 'bg-red-50 text-red-700' : 'bg-amber-50 text-amber-700',
                            )}>
                              {half.paid ? <CheckCircle2 size={12} /> : <CalendarClock size={12} />}
                              {half.paid ? 'Оплачено' : half.due ? 'Просрочено' : 'К оплате'}
                            </span>
                          </div>
                          <div className="mt-4 flex items-end justify-between gap-4">
                            <div><p className="text-[9px] text-[#8B95A5]">Дата оплаты</p><p className="mt-1 text-[11px] font-semibold text-[#374151]">{formatDate(half.paymentDate)}</p></div>
                            <p className="text-[16px] font-semibold tabular-nums text-[#1F2937]">{formatMoney(half.amount)}</p>
                          </div>
                          {isOwner && !half.paid && half.amount > 0 && (
                            <button
                              type="button"
                              disabled={paymentSavingId === `${month.monthKey}-${half.half}`}
                              onClick={() => void markProductionPaymentPaid(month.monthKey, half.half, half.amount)}
                              className="mt-4 inline-flex min-h-10 w-full items-center justify-center gap-2 rounded-xl bg-[#1F2937] px-4 text-[11px] font-semibold text-white transition-colors hover:bg-[#111827] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#7D7DE6] focus-visible:ring-offset-2 disabled:cursor-wait disabled:opacity-60 sm:w-auto"
                            >
                              {paymentSavingId === `${month.monthKey}-${half.half}` ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />}
                              {paymentSavingId === `${month.monthKey}-${half.half}` ? 'Сохраняем…' : 'Я оплатил'}
                            </button>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </section>
              ))}
            </div>
          </div>
        ) : (
          <div className="bg-[#F8F9FB] p-5 sm:p-6">
            <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h3 className="text-base font-semibold text-[#1F2937]">План производства</h3>
                <p className="mt-1 text-[11px] leading-5 text-[#6B7280]">Оплаченный заказ сначала попадает в «Новый заказ». После решения менеджера он переходит к заказу ткани, крою и пошиву.</p>
              </div>
              <div className="flex flex-col gap-2 sm:flex-row">
                <label className="relative block sm:w-72">
                  <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[#9CA3AF]" />
                  <input value={ordersSearch} onChange={(event) => setOrdersSearch(event.target.value)} placeholder="Найти заказ или изделие" className={cn(inputClass, 'h-11 pl-9')} />
                </label>
                {onOpenOrders && <button type="button" onClick={onOpenOrders} className="min-h-11 rounded-xl border border-[#DADDE4] bg-white px-4 text-[11px] font-semibold text-[#1F2937] hover:bg-[#F8F9FB]">Открыть заказы</button>}
              </div>
            </div>

            {ordersError && <div role="alert" className="mb-4 flex items-start gap-2 rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-[11px] font-medium text-red-600"><AlertCircle size={15} className="mt-0.5 shrink-0" /> {ordersError}</div>}
            {notice && <div role="status" className="mb-4 flex items-center gap-2 rounded-xl border border-emerald-100 bg-emerald-50 px-4 py-3 text-[11px] font-medium text-emerald-700"><Check size={15} /> {notice}</div>}

            {ordersLoading ? (
              <div className="flex min-h-64 items-center justify-center gap-2 rounded-2xl bg-white text-[11px] text-[#8B95A5]"><Loader2 size={16} className="animate-spin" /> Загружаем заказы</div>
            ) : (
              <div className="grid gap-4 lg:grid-cols-2 2xl:grid-cols-5">
                {([
                  { key: 'new' as const, title: 'Новый заказ', hint: 'Оплачен · требуется решение', icon: ClipboardList, tone: 'bg-violet-50 text-violet-800' },
                  { key: 'fabric' as const, title: 'Заказать ткань', hint: 'Снабжение', icon: Shirt, tone: 'bg-amber-50 text-amber-800' },
                  { key: 'cutting' as const, title: 'Накроить', hint: 'Закройщик', icon: Scissors, tone: 'bg-blue-50 text-blue-800' },
                  { key: 'sewing' as const, title: 'Пошив', hint: 'Швейный цех', icon: Factory, tone: 'bg-emerald-50 text-emerald-800' },
                  { key: 'ready' as const, title: 'Готов', hint: 'Отшито · можно упаковывать', icon: PackageCheck, tone: 'bg-teal-50 text-teal-800' },
                ]).map((column) => {
                  const ColumnIcon = column.icon;
                  return (
                    <section key={column.key} className="min-w-0 rounded-2xl bg-[#ECEEF2] p-2.5" aria-label={column.title}>
                      <div className="flex items-center justify-between gap-3 px-2 py-2">
                        <div className="flex items-center gap-2"><span className={cn('flex h-8 w-8 items-center justify-center rounded-lg', column.tone)}><ColumnIcon size={15} /></span><div><h4 className="text-[12px] font-semibold text-[#1F2937]">{column.title}</h4><p className="text-[9px] text-[#8B95A5]">{column.hint}</p></div></div>
                        <span className="rounded-lg bg-white px-2 py-1 text-[10px] font-semibold tabular-nums text-[#6B7280]">{productionColumns[column.key].length}</span>
                      </div>
                      <div className="space-y-2">
                        {productionColumns[column.key].length ? productionColumns[column.key].map((order) => {
                          const overdue = Boolean(order.deadlineDate && order.deadlineDate.slice(0, 10) < today());
                          const itemDetails = [order.items.join(', ') || order.item, order.itemColors.filter(Boolean).join(', '), order.itemSizes.filter(Boolean).join(', ')].filter(Boolean);
                          return (
                            <article key={order.id} className="rounded-xl bg-white p-4">
                              <div className="flex items-start justify-between gap-3"><p className="text-[11px] font-semibold text-[#6B7280]">#{order.orderNumber.replace(/^#+/, '')}</p><span className={cn('text-[9px] font-semibold', overdue ? 'text-red-600' : 'text-[#6B7280]')}>{order.deadlineDate ? `до ${formatOrderDate(order.deadlineDate)}` : 'срок не указан'}</span></div>
                              <p className="mt-3 line-clamp-2 text-[13px] font-semibold leading-5 text-[#1F2937]">{itemDetails[0] || 'Изделие не указано'}</p>
                              {itemDetails.length > 1 && <p className="mt-1 line-clamp-2 text-[10px] leading-4 text-[#8B95A5]">{itemDetails.slice(1).join(' · ')}</p>}
                              {column.key !== 'ready' && <button
                                type="button"
                                onClick={() => void completeProductionStage(order, column.key)}
                                disabled={statusSavingId === order.id}
                                className="mt-4 flex min-h-10 w-full items-center justify-center gap-2 rounded-lg border border-[#DDE1E8] bg-[#F8F9FB] px-3 text-[10px] font-semibold text-[#374151] hover:bg-[#F0F2F5] disabled:opacity-50"
                              >
                                {statusSavingId === order.id ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />}
                                {column.key === 'new' ? 'Передать в заказ ткани' : column.key === 'fabric' ? 'Ткань заказана' : column.key === 'cutting' ? 'Крой готов' : 'Пошив готов'}
                              </button>
                              }
                            </article>
                          );
                        }) : <div className="flex min-h-32 items-center justify-center rounded-xl border border-dashed border-[#D5D9E0] px-4 text-center text-[10px] text-[#8B95A5]">На этом этапе заказов нет</div>}
                      </div>
                    </section>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </motion.section>
    </div>
  );
};

import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  CalendarClock,
  CalendarDays,
  Check,
  CircleDollarSign,
  Factory,
  Loader2,
  PackageCheck,
  Pencil,
  Plus,
  Search,
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
  onSnapshot,
  serverTimestamp,
  setDoc,
  updateDoc,
} from 'firebase/firestore';
import { db } from '../firebase';
import { cn } from '../lib/utils';

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

const getPaymentDate = (productionDate: string) => {
  const [year, month, day] = productionDate.split('-').map(Number);
  if (!year || !month || !day) return '';
  if (day <= 15) {
    const lastDay = new Date(year, month, 0).getDate();
    return `${year}-${String(month).padStart(2, '0')}-${String(Math.min(30, lastDay)).padStart(2, '0')}`;
  }
  const nextMonth = new Date(year, month, 15);
  return `${nextMonth.getFullYear()}-${String(nextMonth.getMonth() + 1).padStart(2, '0')}-15`;
};

const getEntryTotal = (entry: Pick<ProductionEntry, 'quantity' | 'cuttingCost' | 'sewingCost'>) =>
  entry.quantity * ((entry.cuttingCost || 0) + (entry.sewingCost || 0));

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
}) => {
  const [productNames, setProductNames] = useState<string[]>([]);
  const [entries, setEntries] = useState<ProductionEntry[]>([]);
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
    if (!notice) return;
    const timeoutId = window.setTimeout(() => setNotice(''), 2600);
    return () => window.clearTimeout(timeoutId);
  }, [notice]);

  const filteredEntries = useMemo(() => {
    const normalizedSearch = search.trim().toLocaleLowerCase('ru-RU');
    return entries.filter((entry) => {
      const inMonth = !selectedMonth || entry.date.startsWith(selectedMonth);
      const matchesSearch = !normalizedSearch || entry.productName.toLocaleLowerCase('ru-RU').includes(normalizedSearch);
      return inMonth && matchesSearch;
    });
  }, [entries, search, selectedMonth]);

  const summary = useMemo(() => {
    const totalQuantity = filteredEntries.reduce((sum, entry) => sum + entry.quantity, 0);
    const fullyPricedEntries = filteredEntries.filter((entry) => entry.cuttingCost !== null && entry.sewingCost !== null);
    return {
      totalQuantity,
      totalCost: filteredEntries.reduce((sum, entry) => sum + getEntryTotal(entry), 0),
      missingCost: filteredEntries.length - fullyPricedEntries.length,
    };
  }, [filteredEntries]);

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
        paymentDate: getPaymentDate(date),
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
        paymentDate: getPaymentDate(editDraft.date),
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
            <label className="flex h-10 items-center gap-2 rounded-xl border border-[#E6E9EF] bg-[#F7F8FA] px-3 text-[11px] font-medium text-[#6B7280]">
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
          </div>
        </div>

        <div className="grid gap-px bg-[#E6E9EF] sm:grid-cols-3">
          <div className="bg-white px-5 py-4 sm:px-6">
            <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-[#8B95A5]">
              <PackageCheck size={14} className="text-[#7D7DE6]" /> Общее количество
            </div>
            <p className="mt-2 text-2xl font-semibold tracking-[-0.04em] text-[#1F2937]">
              {summary.totalQuantity.toLocaleString('ru-RU')} <span className="text-sm font-medium text-[#9CA3AF]">шт.</span>
            </p>
          </div>
          <div className="bg-white px-5 py-4 sm:px-6">
            <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-[#8B95A5]">
              <CircleDollarSign size={14} className="text-[#2EBA7F]" /> Общая стоимость
            </div>
            <p className="mt-2 text-2xl font-semibold tracking-[-0.04em] text-[#1F2937]">{formatMoney(summary.totalCost)}</p>
          </div>
          <div className="bg-white px-5 py-4 sm:px-6">
            <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-[#8B95A5]">
              <AlertCircle size={14} className={summary.missingCost ? 'text-[#F5A623]' : 'text-[#2EBA7F]'} /> Без стоимости
            </div>
            <p className="mt-2 text-2xl font-semibold tracking-[-0.04em] text-[#1F2937]">
              {summary.missingCost} <span className="text-sm font-medium text-[#9CA3AF]">зап.</span>
            </p>
          </div>
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
                        <span className="text-[10px] font-semibold text-[#6262C7]">{formatDate(getPaymentDate(date))}</span>
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
                                <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-[11px] font-semibold text-[#6262C7]"><CalendarClock size={13} /> {formatDate(getPaymentDate(entry.date))}</span>
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
                                <div className="col-span-2 border-t border-[#E6E9EF] pt-2.5"><p className="flex items-center gap-1.5 text-[8px] font-semibold uppercase tracking-[0.1em] text-[#9CA3AF]"><CalendarClock size={11} /> Дата оплаты</p><p className="mt-1 text-[12px] font-semibold text-[#6262C7]">{formatDate(getPaymentDate(entry.date))}</p></div>
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
      </motion.section>
    </div>
  );
};

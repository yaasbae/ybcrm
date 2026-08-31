import React, { useEffect, useMemo, useState } from 'react';
import {
  ArrowLeft,
  Briefcase,
  Calculator,
  CalendarDays,
  CheckCircle2,
  Download,
  Plus,
  ReceiptText,
  Trash2,
  UserRound,
  Wallet,
} from 'lucide-react';
import Papa from 'papaparse';
import { collection, onSnapshot, query } from 'firebase/firestore';
import { auth, db } from '../firebase';
import { cn, formatCurrency } from '../lib/utils';
import { buildShiftCalendar } from '../lib/shiftCalendar';

interface PayrollPageProps {
  onBack: () => void;
}

type PayType = 'salary' | 'hourly' | 'shift' | 'piece' | 'mixed';

interface PayrollPerson {
  id: string;
  name: string;
  department: string;
  role: string;
  payType: PayType;
  baseSalary: number;
  normDays: number;
  workedDays: number;
  hourlyRate: number;
  normHours: number;
  workedHours: number;
  shiftRate: number;
  shifts: number;
  pieceAmount: number;
  percentRate: number;
  percentBase: number;
  linkedManager: string;
  bonus: number;
  paid: number;
  note: string;
}

interface PayrollOrder {
  id: string;
  manager: string;
  date: Date | null;
  revenue: number;
  status: string;
}

interface PayrollManagerContact {
  id: string;
  managerName?: string;
  managerId?: string;
  managerEmail?: string;
  clientPhone?: string;
  clientName?: string;
  date?: string;
  status?: string;
}

interface PayrollManagerShift {
  id: string;
  managerName?: string;
  managerId?: string;
  managerEmail?: string;
  dateKey?: string;
  startedAt?: string;
  targetContacts?: number;
  basePay?: number;
  status?: string;
}

const STORAGE_KEY = 'ybcrm.payroll.people.v1';
const MANAGER_LINKS = ['Менеджер 1', 'Менеджер 2'];
const SHIFT_TARGET_CONTACTS = 100;
const SHIFT_BASE_PAY = 1000;

const payTypeLabels: Record<PayType, string> = {
  salary: 'Оклад',
  hourly: 'Почасовая',
  shift: 'Выход / смена',
  piece: 'Сдельная',
  mixed: 'Смешанная',
};

const defaultPeople: PayrollPerson[] = [
  {
    id: 'manager-1-example',
    name: 'Менеджер 1',
    department: 'Отдел продаж',
    role: 'Менеджер по продажам',
    payType: 'mixed',
    baseSalary: 0,
    normDays: 22,
    workedDays: 0,
    hourlyRate: 0,
    normHours: 176,
    workedHours: 0,
    shiftRate: 1000,
    shifts: 0,
    pieceAmount: 0,
    percentRate: 5,
    percentBase: 0,
    linkedManager: 'Менеджер 1',
    bonus: 0,
    paid: 0,
    note: 'Продажи подтягиваются из заказов, где выбран Менеджер 1.',
  },
  {
    id: 'manager-2-example',
    name: 'Менеджер 2',
    department: 'Отдел продаж',
    role: 'Менеджер по продажам',
    payType: 'mixed',
    baseSalary: 0,
    normDays: 22,
    workedDays: 0,
    hourlyRate: 0,
    normHours: 176,
    workedHours: 0,
    shiftRate: 1000,
    shifts: 12,
    pieceAmount: 0,
    percentRate: 5,
    percentBase: 0,
    linkedManager: 'Менеджер 2',
    bonus: 0,
    paid: 0,
    note: 'Продажи подтягиваются из заказов, где выбран Менеджер 2.',
  },
  {
    id: 'cutter-example',
    name: 'Закройщик',
    department: 'Производство',
    role: 'Закройщик',
    payType: 'hourly',
    baseSalary: 0,
    normDays: 22,
    workedDays: 0,
    hourlyRate: 500,
    normHours: 176,
    workedHours: 160,
    shiftRate: 0,
    shifts: 0,
    pieceAmount: 0,
    percentRate: 0,
    percentBase: 0,
    linkedManager: '',
    bonus: 0,
    paid: 0,
    note: 'Пример: норма 176 часов, ставка 500 рублей в час.',
  },
];

const createPerson = (): PayrollPerson => ({
  id: `person-${Date.now()}`,
  name: '',
  department: 'Производство',
  role: '',
  payType: 'mixed',
  baseSalary: 0,
  normDays: 22,
  workedDays: 0,
  hourlyRate: 0,
  normHours: 176,
  workedHours: 0,
  shiftRate: 0,
  shifts: 0,
  pieceAmount: 0,
  percentRate: 0,
  percentBase: 0,
  linkedManager: '',
  bonus: 0,
  paid: 0,
  note: '',
});

const numberValue = (value: unknown) => {
  const parsed = Number(String(value ?? '').replace(/\s/g, '').replace(',', '.'));
  return Number.isFinite(parsed) ? parsed : 0;
};

const currentMonthKey = () => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
};

const toMonthKey = (date: Date | null) => {
  if (!date) return '';
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
};

const parseOrderDate = (value: unknown): Date | null => {
  if (!value) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value === 'object' && value && 'toDate' in value && typeof (value as { toDate?: () => Date }).toDate === 'function') {
    const date = (value as { toDate: () => Date }).toDate();
    return Number.isNaN(date.getTime()) ? null : date;
  }
  const date = new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date;
};

const isPayrollSaleOrder = (order: PayrollOrder) => {
  const status = order.status.toLowerCase();
  return order.revenue > 0 && !status.includes('возврат') && !status.includes('отмена') && !status.includes('обмен');
};

const normalizePeople = (people: PayrollPerson[]) => {
  const normalized = people.map(person => {
    const matchingManager = MANAGER_LINKS.find(manager => manager === person.name);
    return { ...person, linkedManager: person.linkedManager || matchingManager || '' };
  });
  const hasManager1 = normalized.some(person => person.linkedManager === 'Менеджер 1' || person.name === 'Менеджер 1');
  const hasManager2 = normalized.some(person => person.linkedManager === 'Менеджер 2' || person.name === 'Менеджер 2');
  return [
    ...(!hasManager1 ? [defaultPeople[0]] : []),
    ...(!hasManager2 ? [defaultPeople[1]] : []),
    ...normalized,
  ];
};

const calculateAccrued = (person: PayrollPerson) => {
  const salaryPart = person.baseSalary > 0
    ? person.baseSalary * (person.normDays > 0 ? person.workedDays / person.normDays : 1)
    : 0;
  const hourlyPart = person.hourlyRate * person.workedHours;
  const shiftPart = person.shiftRate * person.shifts;
  const piecePart = person.pieceAmount;
  const percentPart = person.percentBase * (person.percentRate / 100);
  return Math.max(salaryPart + hourlyPart + shiftPart + piecePart + percentPart + person.bonus, 0);
};

const describeFormula = (person: PayrollPerson) => {
  const parts: string[] = [];
  if (person.baseSalary > 0) {
    parts.push(`оклад ${formatCurrency(person.baseSalary)} x ${person.workedDays || 0}/${person.normDays || 1}`);
  }
  if (person.hourlyRate > 0 || person.workedHours > 0) {
    parts.push(`${formatCurrency(person.hourlyRate)} x ${person.workedHours || 0} ч`);
  }
  if (person.shiftRate > 0 || person.shifts > 0) {
    parts.push(`${formatCurrency(person.shiftRate)} x ${person.shifts || 0} смен`);
  }
  if (person.pieceAmount > 0) {
    parts.push(`сдельно ${formatCurrency(person.pieceAmount)}`);
  }
  if (person.percentRate > 0 || person.percentBase > 0) {
    parts.push(`${person.percentRate || 0}% от ${person.linkedManager ? `продаж ${person.linkedManager} ` : ''}${formatCurrency(person.percentBase)}`);
  }
  if (person.bonus > 0) {
    parts.push(`премия ${formatCurrency(person.bonus)}`);
  }
  return parts.length ? parts.join(' + ') : 'Заполни ставку, часы, смены, сдельную сумму или процент.';
};

export const PayrollPage: React.FC<PayrollPageProps> = ({ onBack }) => {
  const [people, setPeople] = useState<PayrollPerson[]>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      return saved ? normalizePeople(JSON.parse(saved)) : defaultPeople;
    } catch {
      return defaultPeople;
    }
  });
  const [activeId, setActiveId] = useState(people[0]?.id || '');
  const [monthKey, setMonthKey] = useState(currentMonthKey());
  const [orders, setOrders] = useState<PayrollOrder[]>([]);
  const [managerContacts, setManagerContacts] = useState<PayrollManagerContact[]>([]);
  const [managerShifts, setManagerShifts] = useState<PayrollManagerShift[]>([]);
  const [shiftStartEvents, setShiftStartEvents] = useState<PayrollManagerShift[]>([]);
  const [managerAliases, setManagerAliases] = useState<Record<string, string>>({});
  const [ordersLoading, setOrdersLoading] = useState(true);

  useEffect(() => {
    const ordersQuery = query(collection(db, 'orders_new'));
    const unsubscribe = onSnapshot(
      ordersQuery,
      snapshot => {
        const nextOrders = snapshot.docs.map(docSnap => {
          const data = docSnap.data() as Record<string, unknown>;
          return {
            id: docSnap.id,
            manager: String(data.manager || '').trim(),
            date: parseOrderDate(data.date),
            revenue: numberValue(data.revenue ?? data.totalPrice ?? data.amount ?? 0),
            status: String(data.status || ''),
          };
        });
        setOrders(nextOrders);
        setOrdersLoading(false);
      },
      () => setOrdersLoading(false)
    );
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    const unsubscribe = onSnapshot(
      query(collection(db, 'manager_contacts')),
      snapshot => setManagerContacts(snapshot.docs.map(docSnap => ({ id: docSnap.id, ...docSnap.data() } as PayrollManagerContact))),
      () => setManagerContacts([])
    );
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    let active = true;
    const loadStartEvents = async () => {
      try {
        await auth.authStateReady();
        const token = await auth.currentUser?.getIdToken();
        if (!token) return;
        const response = await fetch(`/api/manager-shifts/start-events?month=${encodeURIComponent(monthKey)}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error || 'Не удалось загрузить подтверждения смен');
        if (!active) return;
        setShiftStartEvents(Array.isArray(payload.events) ? payload.events : []);
        setManagerAliases(payload.aliases && typeof payload.aliases === 'object' ? payload.aliases : {});
      } catch (error) {
        console.warn('Не удалось загрузить подтверждения начала смен:', error);
        if (active) {
          setShiftStartEvents([]);
          setManagerAliases({});
        }
      }
    };
    loadStartEvents();
    return () => { active = false; };
  }, [monthKey]);

  useEffect(() => {
    const unsubscribe = onSnapshot(
      query(collection(db, 'manager_shifts')),
      snapshot => setManagerShifts(snapshot.docs.map(docSnap => ({ id: docSnap.id, ...docSnap.data() } as PayrollManagerShift))),
      () => setManagerShifts([])
    );
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(people));
  }, [people]);

  const activePerson = people.find(person => person.id === activeId) || people[0];

  const managerStats = useMemo(() => {
    return MANAGER_LINKS.reduce<Record<string, { orders: number; revenue: number }>>((acc, manager) => {
      const managerOrders = orders.filter(order => (
        order.manager === manager &&
        toMonthKey(order.date) === monthKey &&
        isPayrollSaleOrder(order)
      ));
      acc[manager] = {
        orders: managerOrders.length,
        revenue: managerOrders.reduce((sum, order) => sum + order.revenue, 0),
      };
      return acc;
    }, {});
  }, [orders, monthKey]);

  const shiftCalendar = useMemo(() => {
    return buildShiftCalendar(
      monthKey,
      managerContacts,
      [...managerShifts, ...shiftStartEvents],
      MANAGER_LINKS,
      SHIFT_TARGET_CONTACTS,
      SHIFT_BASE_PAY,
      managerAliases,
    );
  }, [managerAliases, managerContacts, managerShifts, monthKey, shiftStartEvents]);

  const managerShiftStats = useMemo(() => MANAGER_LINKS.reduce<Record<string, { creditedShifts: number; contacts: number; accrued: number }>>((acc, manager) => {
    const summary = shiftCalendar.managers.find(row => row.manager === manager);
    const managerDays = shiftCalendar.days.flatMap(day => day.shifts).filter(shift => shift.manager === manager);
    acc[manager] = {
      creditedShifts: summary?.creditedShifts || 0,
      contacts: summary?.contacts || 0,
      accrued: managerDays.reduce((sum, shift) => sum + (shift.credited ? shift.basePay : 0), 0),
    };
    return acc;
  }, {}), [shiftCalendar]);

  const applyManagerLink = (person: PayrollPerson): PayrollPerson => {
    if (!person.linkedManager) return person;
    const shiftStat = managerShiftStats[person.linkedManager];
    return {
      ...person,
      percentBase: managerStats[person.linkedManager]?.revenue || 0,
      shifts: shiftStat?.creditedShifts ?? person.shifts,
      shiftRate: shiftStat ? SHIFT_BASE_PAY : person.shiftRate,
    };
  };

  const rows = useMemo(() => {
    return people.map(person => {
      const effectivePerson = applyManagerLink(person);
      const accrued = calculateAccrued(effectivePerson);
      return {
        ...effectivePerson,
        accrued,
        debt: Math.max(accrued - effectivePerson.paid, 0),
      };
    });
  }, [people, managerStats, managerShiftStats]);

  const totals = useMemo(() => {
    return rows.reduce(
      (acc, row) => ({
        accrued: acc.accrued + row.accrued,
        paid: acc.paid + row.paid,
        debt: acc.debt + row.debt,
        people: acc.people + 1,
      }),
      { accrued: 0, paid: 0, debt: 0, people: 0 }
    );
  }, [rows]);

  const updatePerson = (id: string, patch: Partial<PayrollPerson>) => {
    setPeople(prev => prev.map(person => person.id === id ? { ...person, ...patch } : person));
  };

  const addPerson = () => {
    const person = createPerson();
    setPeople(prev => [person, ...prev]);
    setActiveId(person.id);
  };

  const removePerson = (id: string) => {
    setPeople(prev => {
      const next = prev.filter(person => person.id !== id);
      if (activeId === id) setActiveId(next[0]?.id || '');
      return next;
    });
  };

  const exportPayroll = () => {
    const headers = ['ФИО', 'Отдел', 'Должность', 'Тип', 'Формула', 'Начислено', 'Выплачено', 'Долг'];
    const data = rows.map(row => [
      row.name,
      row.department,
      row.role,
      payTypeLabels[row.payType],
      describeFormula(row),
      row.accrued,
      row.paid,
      row.debt,
    ]);
    const blob = new Blob(['\uFEFF' + Papa.unparse([headers, ...data])], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = 'fot_payroll.csv';
    link.click();
    URL.revokeObjectURL(link.href);
  };

  const activeEffectivePerson = activePerson ? applyManagerLink(activePerson) : undefined;
  const activeAccrued = activeEffectivePerson ? calculateAccrued(activeEffectivePerson) : 0;
  const activeDebt = activeEffectivePerson ? Math.max(activeAccrued - activeEffectivePerson.paid, 0) : 0;

  return (
    <div className="min-h-screen bg-[#F6F7F9] text-[#1F2937]">
      <div className="mx-auto w-full max-w-[1540px] px-4 py-8 sm:px-6 xl:px-8">
        <div className="mb-8 flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
          <div className="flex items-start gap-4">
            <button onClick={onBack} className="mt-1 rounded-[8px] p-2 text-[#6B7280] transition hover:bg-white hover:text-[#1F2937]">
              <ArrowLeft size={20} />
            </button>
            <div>
              <p className="text-[11px] font-bold uppercase tracking-[0.22em] text-[#9CA3AF]">ФОТ</p>
              <h1 className="mt-2 text-[34px] font-medium leading-10 tracking-tight text-[#1F2937]">Расчет зарплаты</h1>
              <p className="mt-1 text-[14px] text-[#6B7280]">Добавляй людей, ставки, смены, проценты и выплаты. Таблица больше не нужна как источник расчета.</p>
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <label className="inline-flex h-10 items-center gap-2 rounded-[8px] border border-[#E6E9EF] bg-white px-3 text-[12px] font-medium uppercase tracking-[0.12em] text-[#6B7280]">
              Месяц
              <input
                type="month"
                value={monthKey}
                onChange={event => setMonthKey(event.target.value || currentMonthKey())}
                className="bg-transparent text-[13px] font-semibold normal-case tracking-normal text-[#1F2937] outline-none"
              />
            </label>
            <button
              onClick={exportPayroll}
              className="inline-flex h-10 items-center gap-2 rounded-[8px] border border-[#E6E9EF] bg-white px-4 text-[12px] font-medium uppercase tracking-[0.12em] text-[#6B7280] transition hover:text-[#1F2937]"
            >
              <Download size={16} />
              Экспорт
            </button>
            <button
              onClick={addPerson}
              className="inline-flex h-10 items-center gap-2 rounded-[8px] bg-[#7D7DE6] px-5 text-[12px] font-medium uppercase tracking-[0.12em] text-white shadow-sm transition hover:bg-[#6f6fd8]"
            >
              <Plus size={17} />
              Добавить сотрудника
            </button>
          </div>
        </div>

        <div className="mb-6 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {[
            { label: 'Сотрудников', value: String(totals.people), caption: 'в расчете', icon: UserRound, tone: 'slate' },
            { label: 'Начислено', value: formatCurrency(totals.accrued), caption: 'зарплата к начислению', icon: Wallet, tone: 'green' },
            { label: 'Выплачено', value: formatCurrency(totals.paid), caption: 'уже выдано', icon: CheckCircle2, tone: 'blue' },
            { label: 'Долг', value: formatCurrency(totals.debt), caption: 'осталось выплатить', icon: ReceiptText, tone: 'orange' },
          ].map(card => {
            const Icon = card.icon;
            return (
              <div key={card.label} className="rounded-[10px] border border-[#E6E9EF] bg-white p-5 shadow-[0_12px_32px_rgba(31,41,55,0.04)]">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-[11px] font-medium uppercase tracking-[0.16em] text-[#6B7280]">{card.label}</p>
                  <span className={cn(
                    'rounded-[8px] p-2',
                    card.tone === 'green' && 'bg-emerald-50 text-emerald-600',
                    card.tone === 'blue' && 'bg-blue-50 text-blue-600',
                    card.tone === 'orange' && 'bg-orange-50 text-orange-500',
                    card.tone === 'slate' && 'bg-slate-100 text-slate-700'
                  )}>
                    <Icon size={16} />
                  </span>
                </div>
                <p className="mt-5 text-[26px] font-semibold leading-8 text-[#1F2937]">{card.value}</p>
                <p className="mt-2 text-[11px] font-medium uppercase tracking-[0.16em] text-[#9CA3AF]">{card.caption}</p>
              </div>
            );
          })}
        </div>

        <div className="mb-6 grid gap-4 md:grid-cols-2">
          {MANAGER_LINKS.map(manager => {
            const stat = managerStats[manager] || { orders: 0, revenue: 0 };
            const shiftStat = managerShiftStats[manager] || { creditedShifts: 0, contacts: 0, accrued: 0 };
            return (
              <div key={manager} className="rounded-[10px] border border-[#E6E9EF] bg-white p-5 shadow-[0_12px_32px_rgba(31,41,55,0.04)]">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="text-[11px] font-medium uppercase tracking-[0.16em] text-[#9CA3AF]">Продажи и смены</p>
                    <h3 className="mt-2 text-[20px] font-semibold text-[#1F2937]">{manager}</h3>
                  </div>
                  <p className="text-right text-[24px] font-semibold text-emerald-600">{formatCurrency(stat.revenue)}</p>
                </div>
                <div className="mt-4 grid gap-2 border-t border-[#F1F3F6] pt-3 text-[12px] font-medium text-[#6B7280] sm:grid-cols-3">
                  <span>{ordersLoading ? 'Загружаю заказы...' : `${stat.orders} заказов`}</span>
                  <span>{shiftStat.contacts} касаний базы</span>
                  <span className="text-emerald-600">{shiftStat.creditedShifts} смен · {formatCurrency(shiftStat.accrued)}</span>
                </div>
              </div>
            );
          })}
        </div>

        <section className="mb-6 rounded-[10px] border border-[#E6E9EF] bg-white p-5 shadow-[0_12px_32px_rgba(31,41,55,0.04)]">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <div className="inline-flex items-center gap-2 rounded-full border border-violet-100 bg-violet-50 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-violet-700">
                <CalendarDays size={14} />
                Календарь смен
              </div>
              <h2 className="mt-3 text-[22px] font-semibold tracking-[-0.03em] text-[#1F2937]">Кто выходил и кому засчиталась смена</h2>
              <p className="mt-1 max-w-3xl text-[12px] font-medium leading-5 text-[#6B7280]">
                Смена засчитывается, когда менеджер начал день и поднял минимум {SHIFT_TARGET_CONTACTS} клиентов. Если касания были, но смену не начали, менеджер всё равно виден — без начисления оплаты.
              </p>
            </div>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:min-w-[520px]">
              <CalendarStat label="Смен начато" value={String(shiftCalendar.totalShifts)} tone="slate" />
              <CalendarStat label="Зачтено" value={String(shiftCalendar.creditedShifts)} tone="green" />
              <CalendarStat label="Касаний" value={String(shiftCalendar.totalContacts)} tone="violet" />
              <CalendarStat label="ФОТ смен" value={formatCurrency(shiftCalendar.accrued)} tone="orange" />
            </div>
          </div>

          <div className="mt-4 flex flex-wrap gap-2" aria-label="Сводка по менеджерам">
            {shiftCalendar.managers.map(manager => (
              <div key={manager.manager} className="min-w-[190px] flex-1 rounded-[10px] border border-[#E6E9EF] bg-[#FBFCFD] px-3 py-2.5 sm:max-w-[280px]">
                <div className="flex items-center justify-between gap-3">
                  <span className="truncate text-[12px] font-semibold text-[#1F2937]">{manager.manager}</span>
                  <span className="shrink-0 text-[11px] font-semibold text-emerald-600">{manager.creditedShifts}/{manager.shifts} зачтено</span>
                </div>
                <p className="mt-1 text-[10px] font-medium text-[#6B7280]">
                  {manager.contacts} касаний{manager.missingStarts > 0 ? ` · без старта: ${manager.missingStarts}` : ''}
                </p>
              </div>
            ))}
          </div>

          <div className="mt-5 overflow-x-auto pb-1">
            <div className="min-w-[820px]">
              <div className="grid grid-cols-7 gap-2 px-1 text-[10px] font-bold uppercase tracking-[0.16em] text-[#9CA3AF]">
                {['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'].map(day => <span key={day}>{day}</span>)}
              </div>
              <div className="mt-2 grid grid-cols-7 gap-2">
                {shiftCalendar.days.map(day => (
                  <div
                    key={day.key}
                    className={cn(
                      'min-h-[112px] rounded-[12px] border p-2.5',
                      day.isCurrentMonth ? 'border-[#E6E9EF] bg-[#FBFCFD]' : 'border-transparent bg-transparent',
                      day.shifts.length > 0 && 'border-violet-100 bg-violet-50/40 shadow-[0_8px_22px_rgba(125,125,230,0.08)]'
                    )}
                  >
                    {day.dayNumber && (
                      <>
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-[12px] font-semibold text-[#1F2937]">{day.dayNumber}</span>
                          {day.shifts.length > 0 && <div className="flex flex-wrap justify-end gap-1">
                            {day.accrued > 0 && <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-700">{formatCurrency(day.accrued)}</span>}
                            {day.missingStarts > 0 && <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-semibold text-amber-700">без старта: {day.missingStarts}</span>}
                            {day.accrued === 0 && day.missingStarts === 0 && <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-semibold text-amber-700">не зачтено</span>}
                          </div>}
                        </div>
                        <div className="mt-2 space-y-1.5">
                          {day.shifts.slice(0, 3).map(shift => (
                            <div
                              key={shift.id}
                              className={cn(
                                'rounded-[9px] border bg-white px-2 py-1.5',
                                shift.credited ? 'border-emerald-100' : 'border-amber-100'
                              )}
                              title={shift.missingStart ? `${shift.manager}: ${shift.contacts} касаний, смена не начата` : `${shift.manager}: ${shift.contacts}/${shift.target} клиентов`}
                            >
                              <div className="flex items-center justify-between gap-2">
                                <span className="truncate text-[11px] font-semibold text-[#1F2937]">{shift.manager}</span>
                                <span className={cn('text-[10px] font-semibold', shift.credited ? 'text-emerald-600' : 'text-amber-600')}>
                                  {shift.missingStart ? 'смена не начата' : `${shift.contacts}/${shift.target}`}
                                </span>
                              </div>
                            </div>
                          ))}
                          {day.shifts.length > 3 && (
                            <p className="text-[10px] font-semibold text-[#9CA3AF]">+ ещё {day.shifts.length - 3}</p>
                          )}
                        </div>
                      </>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>

        <div className="grid gap-5 xl:grid-cols-[420px_minmax(0,1fr)]">
          <div className="rounded-[10px] border border-[#E6E9EF] bg-white shadow-[0_12px_32px_rgba(31,41,55,0.04)]">
            <div className="border-b border-[#E6E9EF] p-5">
              <h2 className="text-[14px] font-medium uppercase tracking-[0.18em]">Сотрудники</h2>
              <p className="mt-1 text-[12px] text-[#9CA3AF]">Выбери строку, чтобы настроить расчет.</p>
            </div>
            <div className="max-h-[680px] overflow-y-auto">
              {rows.map(row => (
                <button
                  key={row.id}
                  onClick={() => setActiveId(row.id)}
                  className={cn(
                    'w-full border-b border-[#F1F3F6] px-5 py-4 text-left transition hover:bg-[#F6F7F9]',
                    row.id === activeId && 'bg-[#F6F7F9]'
                  )}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-[15px] font-semibold text-[#1F2937]">{row.name || 'Новый сотрудник'}</p>
                      <p className="mt-1 truncate text-[12px] font-medium text-[#6B7280]">{row.role || 'должность'} • {payTypeLabels[row.payType]}</p>
                    </div>
                    <p className="shrink-0 text-[14px] font-semibold text-emerald-600">{formatCurrency(row.accrued)}</p>
                  </div>
                  <p className="mt-3 line-clamp-2 text-[11px] leading-4 text-[#9CA3AF]">{describeFormula(row)}</p>
                </button>
              ))}
            </div>
          </div>

          {activePerson && (
            <div className="space-y-5">
              <div className="rounded-[10px] border border-[#E6E9EF] bg-white p-5 shadow-[0_12px_32px_rgba(31,41,55,0.04)]">
                <div className="mb-5 flex items-start justify-between gap-4">
                  <div>
                    <h2 className="text-[14px] font-medium uppercase tracking-[0.18em]">Карточка расчета</h2>
                    <p className="mt-1 text-[12px] text-[#9CA3AF]">Заполняй только нужные поля. Итог считается автоматически.</p>
                  </div>
                  <button
                    onClick={() => removePerson(activePerson.id)}
                    className="rounded-[8px] bg-red-50 p-2 text-red-500 transition hover:bg-red-100"
                  >
                    <Trash2 size={16} />
                  </button>
                </div>

                <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
                  <Field label="ФИО" value={activePerson.name} onChange={value => updatePerson(activePerson.id, { name: value })} />
                  <Field label="Отдел" value={activePerson.department} onChange={value => updatePerson(activePerson.id, { department: value })} />
                  <Field label="Должность" value={activePerson.role} onChange={value => updatePerson(activePerson.id, { role: value })} />
                  <label className="space-y-2">
                    <span className="text-[11px] font-medium uppercase tracking-[0.16em] text-[#9CA3AF]">Тип оплаты</span>
                    <select
                      value={activePerson.payType}
                      onChange={event => updatePerson(activePerson.id, { payType: event.target.value as PayType })}
                      className="h-12 w-full rounded-[8px] border border-[#E6E9EF] bg-white px-3 text-[14px] font-medium text-[#1F2937] outline-none transition focus:border-[#7D7DE6]"
                    >
                      {Object.entries(payTypeLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                    </select>
                  </label>
                  <label className="space-y-2">
                    <span className="text-[11px] font-medium uppercase tracking-[0.16em] text-[#9CA3AF]">Связь с заказами</span>
                    <select
                      value={activePerson.linkedManager || ''}
                      onChange={event => updatePerson(activePerson.id, { linkedManager: event.target.value })}
                      className="h-12 w-full rounded-[8px] border border-[#E6E9EF] bg-white px-3 text-[14px] font-medium text-[#1F2937] outline-none transition focus:border-[#7D7DE6]"
                    >
                      <option value="">Не привязан</option>
                      {MANAGER_LINKS.map(manager => <option key={manager} value={manager}>{manager}</option>)}
                    </select>
                  </label>
                </div>

                <div className="mt-5 grid gap-5 xl:grid-cols-2">
                  <Section title="Окладник" caption="Формула: оклад / норма дней x отработанные дни">
                    <NumberField label="Оклад" value={activePerson.baseSalary} onChange={value => updatePerson(activePerson.id, { baseSalary: value })} />
                    <NumberField label="Норма дней" value={activePerson.normDays} onChange={value => updatePerson(activePerson.id, { normDays: value })} />
                    <NumberField label="Отработал дней" value={activePerson.workedDays} onChange={value => updatePerson(activePerson.id, { workedDays: value })} />
                  </Section>

                  <Section title="Почасовая" caption="Формула: ставка в час x часы">
                    <NumberField label="Ставка в час" value={activePerson.hourlyRate} onChange={value => updatePerson(activePerson.id, { hourlyRate: value })} />
                    <NumberField label="Норма часов" value={activePerson.normHours} onChange={value => updatePerson(activePerson.id, { normHours: value })} />
                    <NumberField label="Отработал часов" value={activePerson.workedHours} onChange={value => updatePerson(activePerson.id, { workedHours: value })} />
                  </Section>

                  <Section title="Выход / смена" caption="Формула: ставка за смену x кол-во смен">
                    <NumberField label="Ставка за смену" value={activePerson.shiftRate} onChange={value => updatePerson(activePerson.id, { shiftRate: value })} />
                    <NumberField label="Смен" value={activePerson.shifts} onChange={value => updatePerson(activePerson.id, { shifts: value })} />
                  </Section>

                  <Section title="Сдельная и процент" caption="Формула: сдельная сумма + процент от базы + премия">
                    <NumberField label="Сдельная сумма" value={activePerson.pieceAmount} onChange={value => updatePerson(activePerson.id, { pieceAmount: value })} />
                    <NumberField label="% ставка" value={activePerson.percentRate} onChange={value => updatePerson(activePerson.id, { percentRate: value })} />
                    <NumberField
                      label={activePerson.linkedManager ? `База: ${activePerson.linkedManager}` : 'База процента'}
                      value={activeEffectivePerson?.percentBase || activePerson.percentBase}
                      onChange={value => updatePerson(activePerson.id, { percentBase: value })}
                      disabled={Boolean(activePerson.linkedManager)}
                    />
                    <NumberField label="Премия" value={activePerson.bonus} onChange={value => updatePerson(activePerson.id, { bonus: value })} />
                  </Section>
                </div>

                <div className="mt-5 grid gap-4 md:grid-cols-[1fr_240px]">
                  <label className="space-y-2">
                    <span className="text-[11px] font-medium uppercase tracking-[0.16em] text-[#9CA3AF]">Комментарий</span>
                    <textarea
                      value={activePerson.note}
                      onChange={event => updatePerson(activePerson.id, { note: event.target.value })}
                      placeholder="Например: аванс выдан 15 числа, остальное 30 числа"
                      className="min-h-[84px] w-full resize-none rounded-[8px] border border-[#E6E9EF] bg-white px-3 py-3 text-[14px] outline-none transition focus:border-[#7D7DE6]"
                    />
                  </label>
                  <NumberField label="Выплачено" value={activePerson.paid} onChange={value => updatePerson(activePerson.id, { paid: value })} />
                </div>
              </div>

              <div className="rounded-[10px] border border-[#E6E9EF] bg-white p-5 shadow-[0_12px_32px_rgba(31,41,55,0.04)]">
                <div className="flex items-center gap-2 text-[14px] font-medium uppercase tracking-[0.18em] text-[#1F2937]">
                  <Calculator size={17} className="text-[#7D7DE6]" />
                  Формула и итог
                </div>
                <div className="mt-4 rounded-[8px] border border-[#E6E9EF] bg-[#F6F7F9] p-4 text-[13px] font-medium leading-6 text-[#6B7280]">
                  {activeEffectivePerson ? describeFormula(activeEffectivePerson) : describeFormula(activePerson)}
                </div>
                <div className="mt-4 grid gap-3 md:grid-cols-3">
                  <ResultCard label="Начислено" value={activeAccrued} tone="green" />
                  <ResultCard label="Выплачено" value={activePerson.paid} tone="slate" />
                  <ResultCard label="Долг" value={activeDebt} tone="orange" />
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

const Field: React.FC<{ label: string; value: string; onChange: (value: string) => void }> = ({ label, value, onChange }) => (
  <label className="space-y-2">
    <span className="text-[11px] font-medium uppercase tracking-[0.16em] text-[#9CA3AF]">{label}</span>
    <input
      value={value}
      onChange={event => onChange(event.target.value)}
      className="h-12 w-full rounded-[8px] border border-[#E6E9EF] bg-white px-3 text-[14px] font-medium text-[#1F2937] outline-none transition focus:border-[#7D7DE6]"
    />
  </label>
);

const NumberField: React.FC<{ label: string; value: number; onChange: (value: number) => void; disabled?: boolean }> = ({ label, value, onChange, disabled }) => (
  <label className="space-y-2">
    <span className="text-[11px] font-medium uppercase tracking-[0.16em] text-[#9CA3AF]">{label}</span>
    <input
      type="number"
      value={value || ''}
      onChange={event => onChange(numberValue(event.target.value))}
      disabled={disabled}
      placeholder="0"
      className={cn(
        'h-12 w-full rounded-[8px] border border-[#E6E9EF] bg-white px-3 text-[14px] font-semibold text-[#1F2937] outline-none transition focus:border-[#7D7DE6]',
        disabled && 'bg-[#F6F7F9] text-emerald-600'
      )}
    />
  </label>
);

const Section: React.FC<{ title: string; caption: string; children: React.ReactNode }> = ({ title, caption, children }) => (
  <div className="rounded-[10px] border border-[#E6E9EF] bg-[#FBFCFD] p-4">
    <h3 className="text-[13px] font-semibold text-[#1F2937]">{title}</h3>
    <p className="mt-1 text-[11px] font-medium text-[#9CA3AF]">{caption}</p>
    <div className="mt-4 grid gap-3 sm:grid-cols-2">{children}</div>
  </div>
);

const ResultCard: React.FC<{ label: string; value: number; tone: 'green' | 'orange' | 'slate' }> = ({ label, value, tone }) => (
  <div className={cn(
    'rounded-[8px] border p-4',
    tone === 'green' && 'border-emerald-100 bg-emerald-50/60',
    tone === 'orange' && 'border-orange-100 bg-orange-50/60',
    tone === 'slate' && 'border-[#E6E9EF] bg-white'
  )}>
    <p className="text-[11px] font-medium uppercase tracking-[0.16em] text-[#9CA3AF]">{label}</p>
    <p className={cn(
      'mt-2 text-[22px] font-semibold',
      tone === 'green' && 'text-emerald-600',
      tone === 'orange' && 'text-orange-500',
      tone === 'slate' && 'text-[#1F2937]'
    )}>
      {formatCurrency(value)}
    </p>
  </div>
);

const CalendarStat: React.FC<{ label: string; value: string; tone: 'slate' | 'green' | 'violet' | 'orange' }> = ({ label, value, tone }) => (
  <div className={cn(
    'rounded-[10px] border px-3 py-2.5',
    tone === 'slate' && 'border-[#E6E9EF] bg-[#F8FAFC]',
    tone === 'green' && 'border-emerald-100 bg-emerald-50/70',
    tone === 'violet' && 'border-violet-100 bg-violet-50/70',
    tone === 'orange' && 'border-orange-100 bg-orange-50/70'
  )}>
    <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-[#9CA3AF]">{label}</p>
    <p className={cn(
      'mt-1 truncate text-[16px] font-semibold tracking-[-0.02em]',
      tone === 'green' && 'text-emerald-600',
      tone === 'violet' && 'text-violet-700',
      tone === 'orange' && 'text-orange-500',
      tone === 'slate' && 'text-[#1F2937]'
    )}>
      {value}
    </p>
  </div>
);

export default PayrollPage;

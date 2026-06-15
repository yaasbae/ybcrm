import React, { useEffect, useMemo, useState } from 'react';
import {
  ArrowLeft,
  Briefcase,
  Calculator,
  CheckCircle2,
  Download,
  Plus,
  ReceiptText,
  Trash2,
  UserRound,
  Wallet,
} from 'lucide-react';
import Papa from 'papaparse';
import { cn, formatCurrency } from '../lib/utils';

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
  bonus: number;
  paid: number;
  note: string;
}

const STORAGE_KEY = 'ybcrm.payroll.people.v1';

const payTypeLabels: Record<PayType, string> = {
  salary: 'Оклад',
  hourly: 'Почасовая',
  shift: 'Выход / смена',
  piece: 'Сдельная',
  mixed: 'Смешанная',
};

const defaultPeople: PayrollPerson[] = [
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
    percentBase: 600000,
    bonus: 0,
    paid: 0,
    note: 'Пример: смена 1000 рублей + 5% от продаж.',
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
  bonus: 0,
  paid: 0,
  note: '',
});

const numberValue = (value: unknown) => {
  const parsed = Number(String(value ?? '').replace(/\s/g, '').replace(',', '.'));
  return Number.isFinite(parsed) ? parsed : 0;
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
    parts.push(`${person.percentRate || 0}% от ${formatCurrency(person.percentBase)}`);
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
      return saved ? JSON.parse(saved) : defaultPeople;
    } catch {
      return defaultPeople;
    }
  });
  const [activeId, setActiveId] = useState(people[0]?.id || '');

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(people));
  }, [people]);

  const activePerson = people.find(person => person.id === activeId) || people[0];

  const rows = useMemo(() => {
    return people.map(person => {
      const accrued = calculateAccrued(person);
      return {
        ...person,
        accrued,
        debt: Math.max(accrued - person.paid, 0),
      };
    });
  }, [people]);

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

  const activeAccrued = activePerson ? calculateAccrued(activePerson) : 0;
  const activeDebt = activePerson ? Math.max(activeAccrued - activePerson.paid, 0) : 0;

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

                <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
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
                    <NumberField label="База процента" value={activePerson.percentBase} onChange={value => updatePerson(activePerson.id, { percentBase: value })} />
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
                  {describeFormula(activePerson)}
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

const NumberField: React.FC<{ label: string; value: number; onChange: (value: number) => void }> = ({ label, value, onChange }) => (
  <label className="space-y-2">
    <span className="text-[11px] font-medium uppercase tracking-[0.16em] text-[#9CA3AF]">{label}</span>
    <input
      type="number"
      value={value || ''}
      onChange={event => onChange(numberValue(event.target.value))}
      placeholder="0"
      className="h-12 w-full rounded-[8px] border border-[#E6E9EF] bg-white px-3 text-[14px] font-semibold text-[#1F2937] outline-none transition focus:border-[#7D7DE6]"
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

export default PayrollPage;

import React, { useEffect, useMemo, useState } from 'react';
import Papa from 'papaparse';
import {
  ArrowLeft,
  Briefcase,
  CalendarDays,
  CheckCircle2,
  Clock,
  Download,
  RefreshCcw,
  ReceiptText,
  Search,
  Users,
  Wallet,
} from 'lucide-react';
import { cn, formatCurrency } from '../lib/utils';

interface PayrollPageProps {
  onBack: () => void;
}

interface PayrollEmployee {
  id: string;
  department: string;
  payType: string;
  name: string;
  phone: string;
  role: string;
  salary: number;
  hourlyRate: number;
  shiftRate: number;
  workedFirst: number;
  workedSecond: number;
  earnedFirst: number;
  earnedSecond: number;
  paid: number;
  debt: number;
}

interface PayrollSummaryRow {
  manager: string;
  kind: string;
  sales: number;
  amount: number;
  salary: number;
}

const PAYROLL_SHEET_ID = '182Rshoz5PhHYVgz-FzqFEiO24bcIXqLHIble9wEsgHM';
const PAYROLL_GID = '1163158895';

const sectionNames = [
  'Административный персонал',
  'Отдел продаж',
  'Производство г.Казань',
  'Производство г. Казань',
  'Производство г. Вятские Поляны',
];

const monthNameMap: Record<string, string> = {
  '01': 'Январь',
  '02': 'Февраль',
  '03': 'Март',
  '04': 'Апрель',
  '05': 'Май',
  '06': 'Июнь',
  '07': 'Июль',
  '08': 'Август',
  '09': 'Сентябрь',
  '10': 'Октябрь',
  '11': 'Ноябрь',
  '12': 'Декабрь',
};

const parseMoney = (value: any): number => {
  if (value === null || value === undefined) return 0;
  const normalized = String(value)
    .replace(/\u00A0/g, '')
    .replace(/\s/g, '')
    .replace(',', '.')
    .replace(/[^\d.-]/g, '');
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
};

const isPeriodRow = (row: string[]) => /^\d{2}\.\d{2}$/.test(String(row[0] || '').trim());

const getPeriodTitle = (start: string, end: string) => {
  const [, month] = start.split('.');
  const year = String(end || '').split('.').pop() || '2026';
  return `${monthNameMap[month] || 'Месяц'} ${year}`;
};

const normalizeRows = (rows: any[][]) => rows.map(row => Array.from({ length: 18 }, (_, index) => String(row[index] ?? '').trim()));

const parsePayroll = (csv: string) => {
  const parsed = Papa.parse<string[]>(csv, { skipEmptyLines: false });
  const rows = normalizeRows(parsed.data as any[][]);
  const startIndex = rows.findIndex(row => isPeriodRow(row));
  const sourceRows = startIndex >= 0 ? rows.slice(startIndex) : rows;
  const nextPeriodIndex = sourceRows.findIndex((row, index) => index > 0 && isPeriodRow(row));
  const block = nextPeriodIndex > 0 ? sourceRows.slice(0, nextPeriodIndex) : sourceRows;

  const periodStart = block[0]?.[0] || '';
  const periodEnd = block[0]?.[1] || '';
  const title = getPeriodTitle(periodStart, periodEnd);

  let department = 'Без отдела';
  const employees: PayrollEmployee[] = [];

  block.forEach((row, index) => {
    const possibleSection = row[4];
    if (possibleSection && sectionNames.some(section => possibleSection.toLowerCase() === section.toLowerCase())) {
      department = possibleSection;
      return;
    }

    const name = row[5];
    if (!name || name.toLowerCase() === 'фио' || name.toLowerCase().includes('итого')) return;
    if (!row[4] && !row[7] && !row[8] && !row[10] && !row[11]) return;

    const earnedFirst = parseMoney(row[10]);
    const earnedSecond = parseMoney(row[11]);
    const paid = [12, 13, 14, 15].reduce((sum, cellIndex) => sum + parseMoney(row[cellIndex]), 0);
    const explicitDebt = [16, 17].map(cellIndex => parseMoney(row[cellIndex])).find(value => value > 0) || 0;
    const earned = earnedFirst + earnedSecond;

    employees.push({
      id: `${index}-${name}`,
      department,
      payType: row[4] || 'не указан',
      name,
      phone: row[6],
      role: row[7] || 'не указана',
      salary: parseMoney(row[0]),
      hourlyRate: parseMoney(row[1]),
      shiftRate: parseMoney(row[2]),
      workedFirst: parseMoney(row[8]),
      workedSecond: parseMoney(row[9]),
      earnedFirst,
      earnedSecond,
      paid,
      debt: explicitDebt || Math.max(earned - paid, 0),
    });
  });

  const summaryStart = block.findIndex(row => row.some(cell => cell.toLowerCase().includes('короткая сводка')));
  const summaryRows: PayrollSummaryRow[] = summaryStart >= 0
    ? block.slice(summaryStart + 2).map(row => ({
      manager: row[1],
      kind: row[2],
      sales: parseMoney(row[3]),
      amount: parseMoney(row[4]),
      salary: parseMoney(row[5]),
    })).filter(row => row.manager || row.kind)
    : [];

  const workingDaysRow = block.find(row => row[1]?.toLowerCase() === 'дней рабочих');
  const normHoursRow = block.find(row => row[1]?.toLowerCase() === 'часов норма');
  const payrollFundRow = block.find(row => row[5]?.toLowerCase().includes('итого по организации'));

  return {
    title,
    periodStart,
    periodEnd,
    workingDays: parseMoney(workingDaysRow?.[0]),
    normHours: parseMoney(normHoursRow?.[0]),
    payrollFund: parseMoney(payrollFundRow?.[0]),
    employees,
    summaryRows,
  };
};

export const PayrollPage: React.FC<PayrollPageProps> = ({ onBack }) => {
  const [csv, setCsv] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [departmentFilter, setDepartmentFilter] = useState('Все отделы');

  const loadPayroll = async () => {
    setLoading(true);
    setError(null);
    try {
      const url = `/api/sheet/export?sheetId=${encodeURIComponent(PAYROLL_SHEET_ID)}&gid=${PAYROLL_GID}`;
      const response = await fetch(url);
      if (!response.ok) throw new Error('Не удалось загрузить таблицу ФОТ');
      setCsv(await response.text());
    } catch (err: any) {
      setError(err?.message || 'Не удалось загрузить ФОТ');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadPayroll();
  }, []);

  const payroll = useMemo(() => parsePayroll(csv), [csv]);

  const totals = useMemo(() => {
    const earned = payroll.employees.reduce((sum, employee) => sum + employee.earnedFirst + employee.earnedSecond, 0);
    const paid = payroll.employees.reduce((sum, employee) => sum + employee.paid, 0);
    const debt = payroll.employees.reduce((sum, employee) => sum + employee.debt, 0);
    const worked = payroll.employees.reduce((sum, employee) => sum + employee.workedFirst + employee.workedSecond, 0);
    return {
      people: payroll.employees.length,
      earned,
      paid,
      debt,
      worked,
      remaining: Math.max(earned - paid, 0),
    };
  }, [payroll.employees]);

  const departments = useMemo(() => ['Все отделы', ...Array.from(new Set(payroll.employees.map(employee => employee.department)))], [payroll.employees]);

  const filteredEmployees = useMemo(() => {
    const search = query.trim().toLowerCase();
    return payroll.employees.filter(employee => {
      const matchDepartment = departmentFilter === 'Все отделы' || employee.department === departmentFilter;
      const matchSearch = !search || [employee.name, employee.phone, employee.role, employee.department].some(value => value.toLowerCase().includes(search));
      return matchDepartment && matchSearch;
    });
  }, [departmentFilter, payroll.employees, query]);

  const departmentStats = useMemo(() => {
    return departments.filter(name => name !== 'Все отделы').map(name => {
      const list = payroll.employees.filter(employee => employee.department === name);
      return {
        name,
        people: list.length,
        earned: list.reduce((sum, employee) => sum + employee.earnedFirst + employee.earnedSecond, 0),
        paid: list.reduce((sum, employee) => sum + employee.paid, 0),
        debt: list.reduce((sum, employee) => sum + employee.debt, 0),
      };
    });
  }, [departments, payroll.employees]);

  const exportCsv = () => {
    const headers = ['Отдел', 'ФИО', 'Телефон', 'Должность', 'Тип оплаты', 'Начислено', 'Выплачено', 'Долг'];
    const rows = filteredEmployees.map(employee => [
      employee.department,
      employee.name,
      employee.phone,
      employee.role,
      employee.payType,
      employee.earnedFirst + employee.earnedSecond,
      employee.paid,
      employee.debt,
    ]);
    const blob = new Blob(['\uFEFF' + Papa.unparse([headers, ...rows])], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `payroll_${payroll.title.replace(/\s/g, '_')}.csv`;
    link.click();
    URL.revokeObjectURL(link.href);
  };

  const statCards = [
    { label: 'Фонд организации', value: payroll.payrollFund || totals.earned, caption: 'плановый ФОТ', icon: Briefcase, tone: 'slate' },
    { label: 'Начислено', value: totals.earned, caption: `${totals.people} сотрудников`, icon: Wallet, tone: 'emerald' },
    { label: 'Выплачено', value: totals.paid, caption: '15 и 30 числа', icon: CheckCircle2, tone: 'blue' },
    { label: 'Долг', value: totals.debt || totals.remaining, caption: 'к выплате', icon: ReceiptText, tone: 'orange' },
  ];

  return (
    <div className="min-h-screen bg-slate-50/50 text-slate-900 font-sans">
      <div className="mx-auto w-full max-w-[1440px] px-4 py-8 space-y-8 sm:px-6 lg:px-8">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-start gap-4">
            <button onClick={onBack} className="mt-1 rounded-full p-2 text-slate-700 transition-colors hover:bg-slate-100">
              <ArrowLeft size={20} strokeWidth={1.8} />
            </button>
            <div>
              <h1 className="text-2xl font-bold tracking-tight text-slate-900">ФОТ</h1>
              <p className="text-sm text-slate-500">Зарплаты, выплаты, долги и сводка по сотрудникам</p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <div className="inline-flex h-12 items-center gap-2 rounded-xl border border-slate-100 bg-white px-4 text-sm font-bold text-slate-700 shadow-sm">
              <CalendarDays size={16} className="text-slate-400" />
              {payroll.title}
            </div>
            <button
              onClick={loadPayroll}
              disabled={loading}
              className="inline-flex h-12 items-center gap-2 rounded-xl border border-slate-100 bg-white px-4 text-xs font-bold uppercase tracking-widest text-slate-500 shadow-sm transition-all hover:bg-slate-50 hover:text-slate-900 disabled:opacity-50"
            >
              <RefreshCcw size={16} className={cn(loading && 'animate-spin')} />
              Обновить
            </button>
            <button
              onClick={exportCsv}
              disabled={!filteredEmployees.length}
              className="inline-flex h-12 items-center gap-2 rounded-xl bg-slate-900 px-5 text-sm font-bold text-white shadow-lg transition-all hover:bg-slate-800 disabled:opacity-50"
            >
              <Download size={18} />
              Экспорт
            </button>
          </div>
        </div>

        {error && (
          <div className="rounded-2xl border border-orange-100 bg-orange-50 px-5 py-4 text-sm font-semibold text-orange-700">
            {error}. Проверь доступ к таблице или backend `/api/sheet/export`.
          </div>
        )}

        <div className="grid grid-cols-1 gap-6 md:grid-cols-2 xl:grid-cols-4">
          {statCards.map(card => {
            const Icon = card.icon;
            const toneClass = card.tone === 'emerald'
              ? 'text-emerald-500 bg-emerald-50'
              : card.tone === 'blue'
                ? 'text-blue-500 bg-blue-50'
                : card.tone === 'orange'
                  ? 'text-orange-500 bg-orange-50'
                  : 'text-slate-900 bg-slate-100';
            return (
              <div key={card.label} className="space-y-3 rounded-2xl border border-slate-100 bg-white p-6 shadow-sm">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-bold uppercase tracking-widest text-slate-400">{card.label}</span>
                  <div className={cn('rounded-lg p-2', toneClass)}>
                    <Icon size={16} />
                  </div>
                </div>
                <p className="text-2xl font-black text-slate-900">{formatCurrency(card.value)}</p>
                <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">{card.caption}</p>
              </div>
            );
          })}
        </div>

        <div className="grid grid-cols-1 gap-6 xl:grid-cols-[1fr_360px]">
          <div className="overflow-hidden rounded-3xl border border-slate-100 bg-white shadow-sm">
            <div className="flex flex-col gap-4 border-b border-slate-50 p-6 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <h3 className="text-sm font-bold uppercase tracking-widest text-slate-900">Сотрудники ФОТ</h3>
                <p className="mt-1 text-xs font-bold text-slate-400">
                  {payroll.periodStart} - {payroll.periodEnd} • {payroll.workingDays || 0} рабочих дней • {payroll.normHours || 0} часов норма
                </p>
              </div>
              <div className="flex flex-col gap-3 sm:flex-row">
                <div className="relative">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-300" />
                  <input
                    value={query}
                    onChange={event => setQuery(event.target.value)}
                    placeholder="Поиск..."
                    className="h-11 w-full rounded-xl border border-slate-100 bg-slate-50/40 pl-10 pr-4 text-sm font-semibold text-slate-700 outline-none transition focus:border-slate-300 sm:w-64"
                  />
                </div>
                <select
                  value={departmentFilter}
                  onChange={event => setDepartmentFilter(event.target.value)}
                  className="h-11 rounded-xl border border-slate-100 bg-white px-4 text-sm font-bold text-slate-700 outline-none transition focus:border-slate-300"
                >
                  {departments.map(department => <option key={department}>{department}</option>)}
                </select>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full min-w-[980px] table-fixed text-left">
                <thead className="bg-slate-50/50">
                  <tr>
                    {['Отдел', 'Сотрудник', 'Должность', 'Отработано', 'Начислено', 'Выплачено', 'Долг'].map((head, index) => (
                      <th key={head} className={cn('px-5 py-4 text-[10px] font-bold uppercase tracking-widest text-slate-400', index > 3 && 'text-right')}>
                        {head}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filteredEmployees.map(employee => {
                    const earned = employee.earnedFirst + employee.earnedSecond;
                    return (
                      <tr key={employee.id} className="border-t border-slate-50 transition hover:bg-slate-50/50">
                        <td className="px-5 py-5 text-xs font-bold text-slate-400">{employee.department}</td>
                        <td className="px-5 py-5">
                          <div className="text-sm font-bold text-slate-900">{employee.name}</div>
                          <div className="mt-1 text-xs font-semibold text-slate-400">{employee.phone || 'телефон не указан'}</div>
                        </td>
                        <td className="px-5 py-5">
                          <div className="text-sm font-semibold text-slate-700">{employee.role}</div>
                          <div className="mt-1 text-xs font-bold uppercase tracking-wider text-slate-400">{employee.payType}</div>
                        </td>
                        <td className="px-5 py-5 text-sm font-bold text-slate-700">
                          {employee.workedFirst + employee.workedSecond || 0}
                          <span className="ml-1 text-xs text-slate-400">ч/дн.</span>
                        </td>
                        <td className="px-5 py-5 text-right text-sm font-black text-slate-900">{formatCurrency(earned)}</td>
                        <td className="px-5 py-5 text-right text-sm font-black text-emerald-600">{formatCurrency(employee.paid)}</td>
                        <td className="px-5 py-5 text-right text-sm font-black text-orange-500">{formatCurrency(employee.debt)}</td>
                      </tr>
                    );
                  })}
                  {!filteredEmployees.length && (
                    <tr>
                      <td colSpan={7} className="px-5 py-12 text-center text-sm font-semibold text-slate-400">
                        {loading ? 'Загружаю ФОТ...' : 'Сотрудники не найдены'}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          <div className="space-y-6">
            <div className="rounded-3xl border border-slate-100 bg-white p-6 shadow-sm">
              <h3 className="text-sm font-bold uppercase tracking-widest text-slate-900">Отделы</h3>
              <div className="mt-5 space-y-4">
                {departmentStats.map(department => (
                  <button
                    key={department.name}
                    onClick={() => setDepartmentFilter(department.name)}
                    className={cn(
                      'w-full rounded-2xl border p-4 text-left transition',
                      departmentFilter === department.name ? 'border-slate-900 bg-slate-50' : 'border-slate-100 hover:bg-slate-50'
                    )}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <p className="text-sm font-black text-slate-900">{department.name}</p>
                        <p className="mt-1 text-xs font-bold text-slate-400">{department.people} сотрудников</p>
                      </div>
                      <Users size={16} className="text-slate-400" />
                    </div>
                    <div className="mt-3 grid grid-cols-2 gap-3 text-xs font-bold">
                      <span className="text-emerald-600">{formatCurrency(department.earned)}</span>
                      <span className="text-right text-orange-500">{formatCurrency(department.debt)}</span>
                    </div>
                  </button>
                ))}
              </div>
            </div>

            <div className="rounded-3xl border border-slate-100 bg-white p-6 shadow-sm">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-bold uppercase tracking-widest text-slate-900">Сводка продаж</h3>
                <Clock size={16} className="text-slate-400" />
              </div>
              <div className="mt-5 space-y-3">
                {payroll.summaryRows.slice(0, 8).map((row, index) => (
                  <div key={`${row.manager}-${row.kind}-${index}`} className="rounded-2xl border border-slate-100 p-4">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <p className="text-sm font-black text-slate-900">{row.manager || row.kind || 'Строка'}</p>
                        <p className="mt-1 text-xs font-bold text-slate-400">{row.kind || 'тип не указан'} • {row.sales || 0} продаж</p>
                      </div>
                      <p className="text-sm font-black text-emerald-600">{formatCurrency(row.salary || row.amount)}</p>
                    </div>
                  </div>
                ))}
                {!payroll.summaryRows.length && <p className="text-sm font-semibold text-slate-400">Сводка в таблице не найдена</p>}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default PayrollPage;

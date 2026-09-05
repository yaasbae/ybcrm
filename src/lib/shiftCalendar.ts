export type ShiftCalendarContact = {
  id: string;
  managerName?: string;
  managerId?: string;
  managerEmail?: string;
  clientPhone?: string;
  clientName?: string;
  date?: unknown;
  status?: string;
};

export type ShiftCalendarRecord = {
  id: string;
  managerName?: string;
  managerId?: string;
  managerEmail?: string;
  dateKey?: string;
  startedAt?: string;
  targetContacts?: number;
  basePay?: number;
  status?: string;
};

export type ShiftCalendarActivity = ShiftCalendarRecord & {
  manager: string;
  contacts: number;
  target: number;
  basePay: number;
  started: boolean;
  missingStart: boolean;
  credited: boolean;
};

const FIXED_MANAGER_EMAILS: Record<string, string> = {
  'yb1@ybcrm.ru': 'Менеджер 1',
  'yb2@ybcrm.ru': 'Менеджер 2',
};

const dayKey = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
const monthOf = (date: Date) => dayKey(date).slice(0, 7);

function parseContactDate(value: unknown): Date | null {
  if (!value) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value === 'string') {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  if (typeof value === 'object' && typeof (value as { toDate?: () => Date }).toDate === 'function') {
    const parsed = (value as { toDate: () => Date }).toDate();
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  if (typeof value === 'object' && typeof (value as { seconds?: number }).seconds === 'number') {
    return new Date((value as { seconds: number }).seconds * 1000);
  }
  return null;
}

export function buildShiftCalendar(
  monthKey: string,
  contacts: ShiftCalendarContact[],
  shifts: ShiftCalendarRecord[],
  knownManagers: string[] = ['Менеджер 1', 'Менеджер 2'],
  defaultTarget = 100,
  defaultBasePay = 1000,
  identityAliases: Record<string, string> = {},
) {
  const [yearRaw, monthRaw] = monthKey.split('-').map(Number);
  const year = Number.isFinite(yearRaw) ? yearRaw : new Date().getFullYear();
  const monthIndex = Number.isFinite(monthRaw) ? monthRaw - 1 : new Date().getMonth();
  const monthStart = new Date(year, monthIndex, 1);
  const daysInMonth = new Date(year, monthIndex + 1, 0).getDate();
  const leadingDays = (monthStart.getDay() + 6) % 7;
  const totalCells = Math.ceil((leadingDays + daysInMonth) / 7) * 7;

  const aliases = {
    ...FIXED_MANAGER_EMAILS,
    ...Object.fromEntries(Object.entries(identityAliases).map(([key, value]) => [String(key).trim().toLowerCase(), String(value).trim()])),
  };
  const canonicalManager = (row: { managerName?: string; managerEmail?: string; managerId?: string }) => {
    // Authenticated email is the strongest identity signal. Older records may
    // contain a stale managerName after a shared browser session was reused.
    const candidates = [row.managerEmail, row.managerId, row.managerName].map(value => String(value || '').trim()).filter(Boolean);
    for (const candidate of candidates) {
      const mapped = aliases[candidate.toLowerCase()];
      if (mapped) return mapped;
    }
    return String(row.managerName || row.managerEmail || row.managerId || '').trim();
  };

  const contactsByManagerDay = contacts.reduce<Record<string, Set<string>>>((acc, entry) => {
    const date = parseContactDate(entry.date);
    const manager = canonicalManager(entry);
    if (!date || !manager || monthOf(date) !== monthKey || String(entry.status || '').trim() === 'в работе') return acc;
    const key = `${manager}__${dayKey(date)}`;
    if (!acc[key]) acc[key] = new Set();
    acc[key].add(String(entry.clientPhone || entry.clientName || entry.id || '').trim());
    return acc;
  }, {});

  const shiftsByDay = shifts.reduce<Record<string, ShiftCalendarRecord[]>>((acc, shift) => {
    const dateKey = String(shift.dateKey || '').trim();
    if (!dateKey.startsWith(monthKey)) return acc;
    if (!acc[dateKey]) acc[dateKey] = [];
    acc[dateKey].push(shift);
    return acc;
  }, {});

  const managerNames = Array.from(new Set([
    ...knownManagers,
    ...shifts.map(canonicalManager),
    ...contacts.map(canonicalManager),
  ].filter(Boolean)));

  const days = Array.from({ length: totalCells }, (_, index) => {
    const dayNumber = index - leadingDays + 1;
    const isCurrentMonth = dayNumber >= 1 && dayNumber <= daysInMonth;
    const dateKey = isCurrentMonth ? dayKey(new Date(year, monthIndex, dayNumber)) : '';
    const dayShifts = dateKey ? shiftsByDay[dateKey] || [] : [];
    const activities: ShiftCalendarActivity[] = [];
    for (const shift of dayShifts) {
      const manager = canonicalManager(shift) || 'Менеджер';
      if (activities.some(activity => activity.manager === manager)) continue;
      const target = Number(shift.targetContacts) || defaultTarget;
      const managerContacts = contactsByManagerDay[`${manager}__${dateKey}`]?.size || 0;
      const basePay = Number(shift.basePay) || defaultBasePay;
      const started = Boolean(shift.startedAt);
      activities.push({ ...shift, manager, contacts: managerContacts, target, basePay, started, missingStart: !started, credited: started && managerContacts >= target });
    }

    if (dateKey) {
      for (const manager of managerNames) {
        const managerContacts = contactsByManagerDay[`${manager}__${dateKey}`]?.size || 0;
        const alreadyVisible = activities.some(activity => activity.manager === manager);
        if (!managerContacts || alreadyVisible) continue;
        activities.push({
          id: `activity-${dateKey}-${manager}`,
          managerName: manager,
          manager,
          dateKey,
          contacts: managerContacts,
          target: defaultTarget,
          basePay: defaultBasePay,
          started: false,
          missingStart: true,
          credited: false,
          status: 'missing_start',
        });
      }
    }

    return {
      key: isCurrentMonth ? dateKey : `empty-${index}`,
      dayNumber: isCurrentMonth ? dayNumber : null,
      isCurrentMonth,
      shifts: activities,
      contacts: activities.reduce((sum, activity) => sum + activity.contacts, 0),
      accrued: activities.reduce((sum, activity) => sum + (activity.credited ? activity.basePay : 0), 0),
      missingStarts: activities.filter(activity => activity.missingStart).length,
    };
  });

  const activities = days.flatMap(day => day.shifts);
  const managers = managerNames.map(manager => {
    const rows = activities.filter(activity => activity.manager === manager);
    return {
      manager,
      shifts: rows.filter(activity => activity.started).length,
      creditedShifts: rows.filter(activity => activity.credited).length,
      missingStarts: rows.filter(activity => activity.missingStart).length,
      contacts: rows.reduce((sum, activity) => sum + activity.contacts, 0),
    };
  });

  return {
    days,
    managers,
    creditedShifts: activities.filter(activity => activity.credited).length,
    totalShifts: activities.filter(activity => activity.started).length,
    totalContacts: activities.reduce((sum, activity) => sum + activity.contacts, 0),
    accrued: activities.reduce((sum, activity) => sum + (activity.credited ? activity.basePay : 0), 0),
  };
}

import assert from 'node:assert/strict';
import test from 'node:test';
import { buildShiftCalendar } from '../src/lib/shiftCalendar';

test('always lists both managers even when only manager 1 started shifts', () => {
  const calendar = buildShiftCalendar('2026-08', [], [{ id: 'shift-1', managerName: 'Менеджер 1', dateKey: '2026-08-14', startedAt: '2026-08-14T08:00:00' }]);
  assert.deepEqual(calendar.managers.map(row => row.manager), ['Менеджер 1', 'Менеджер 2']);
  assert.equal(calendar.managers[0].shifts, 1);
  assert.equal(calendar.managers[1].shifts, 0);
});

test('shows manager activity without inventing or crediting a shift', () => {
  const contacts = Array.from({ length: 3 }, (_, index) => ({
    id: `contact-${index}`,
    managerName: 'Менеджер 2',
    clientPhone: `+7000000000${index}`,
    date: '2026-08-15T10:00:00',
    status: 'написали',
  }));
  const calendar = buildShiftCalendar('2026-08', contacts, []);
  const day = calendar.days.find(row => row.key === '2026-08-15');
  assert.equal(day?.shifts[0].manager, 'Менеджер 2');
  assert.equal(day?.shifts[0].missingStart, true);
  assert.equal(day?.shifts[0].credited, false);
  assert.equal(calendar.totalShifts, 0);
  assert.equal(calendar.accrued, 0);
  assert.equal(calendar.managers.find(row => row.manager === 'Менеджер 2')?.contacts, 3);
});

test('credits a started shift only after the contact target is met', () => {
  const contacts = Array.from({ length: 2 }, (_, index) => ({ id: String(index), managerName: 'Менеджер 2', clientPhone: String(index), date: '2026-08-16T10:00:00', status: 'написали' }));
  const shifts = [{ id: 'shift-2', managerName: 'Менеджер 2', dateKey: '2026-08-16', startedAt: '2026-08-16T08:00:00', targetContacts: 2, basePay: 1000 }];
  const calendar = buildShiftCalendar('2026-08', contacts, shifts);
  assert.equal(calendar.totalShifts, 1);
  assert.equal(calendar.creditedShifts, 1);
  assert.equal(calendar.accrued, 1000);
});

test('joins an email contact to manager 2 using the authenticated profile alias', () => {
  const contacts = [{ id: 'contact-email', managerName: 'yb1@ybcrm.ru', managerEmail: 'yb1@ybcrm.ru', date: '2026-08-20T10:00:00', status: 'написали' }];
  const notificationShift = [{ id: 'push-event', managerName: 'Менеджер 2', managerEmail: 'yb1@ybcrm.ru', dateKey: '2026-08-20', startedAt: '2026-08-20T08:00:00' }];
  const calendar = buildShiftCalendar('2026-08', contacts, notificationShift, ['Менеджер 1', 'Менеджер 2'], 100, 1000, { 'yb1@ybcrm.ru': 'Менеджер 2' });
  const day = calendar.days.find(row => row.key === '2026-08-20');
  assert.equal(day?.shifts.length, 1);
  assert.equal(day?.shifts[0].manager, 'Менеджер 2');
  assert.equal(day?.shifts[0].started, true);
  assert.equal(day?.shifts[0].contacts, 1);
  assert.equal(day?.shifts[0].missingStart, false);
});

test('uses the authenticated manager email when a saved display name is stale', () => {
  const contacts = [{
    id: 'manager-2-contact',
    managerName: 'Менеджер 1',
    managerEmail: 'yb2@ybcrm.ru',
    date: '2026-09-05T10:00:00',
    status: 'написали',
  }];
  const shifts = [{
    id: 'manager-2-shift',
    managerName: 'Менеджер 1',
    managerEmail: 'yb2@ybcrm.ru',
    dateKey: '2026-09-05',
    startedAt: '2026-09-05T08:00:00',
  }];
  const calendar = buildShiftCalendar('2026-09', contacts, shifts);
  const day = calendar.days.find(row => row.key === '2026-09-05');
  assert.equal(day?.shifts[0].manager, 'Менеджер 2');
  assert.equal(day?.shifts[0].contacts, 1);
  assert.equal(calendar.managers.find(row => row.manager === 'Менеджер 2')?.contacts, 1);
  assert.equal(calendar.managers.find(row => row.manager === 'Менеджер 1')?.contacts, 0);
});

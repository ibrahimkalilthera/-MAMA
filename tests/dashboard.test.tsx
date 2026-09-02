/**
 * happy-dom unit tests for the useDashboard domain hook.
 *
 * Pure derivation (no state, no side effects): the KPI stats (incl. the
 * scholarship-discounted outstanding, the honest month-over-month delta and
 * the academic-year scoping), the due/note notifications, the late-students
 * filter, the 12-month chart buckets, the paid/outstanding pie, the missed
 * payroll months and the payroll-window status.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { translations } from '../src/i18n/translations';
import type { TranslationDict } from '../src/i18n/translations';
import type { Student, Staff, Expense, SalaryPayment, VendorExpense } from '../src/app/types';
import { useDashboard } from '../src/app/useDashboard';
import { installDomGlobals, renderHook } from './harness';

const t = translations.fr as TranslationDict;

installDomGlobals();

/** Real current date — the hook reads `new Date()` for month/year filters. */
const now = new Date();
const month = now.getMonth();
const year = now.getFullYear();
const prevMonth = (month + 11) % 12;
const prevMonthYear = month === 0 ? year - 1 : year;
const pad = (n: number): string => String(n).padStart(2, '0');
/** YYYY-MM-DD for a payment falling in a given month/year. */
const dateIn = (y: number, m: number, d = 15): string => `${y}-${pad(m + 1)}-${pad(d)}`;

type Api = ReturnType<typeof useDashboard>;

/** Renders the pure-derivation hook, reads its API, unmounts immediately. */
function compute(args: Parameters<typeof useDashboard>[0]): Api {
  const { api, unmount } = renderHook(useDashboard, args);
  const result = api.current;
  unmount();
  if (!result) throw new Error('hook did not render');
  return result;
}

function student(overrides: Partial<Student>): Student {
  return {
    id: 's1',
    parentId: 'p1',
    name: 'Omar Coulibaly',
    parentName: 'M. Coulibaly',
    parentEmail: '',
    parentPhone: '',
    totalDue: 100000,
    amountPaid: 0,
    scholarshipDiscount: 0,
    dueDate: dateIn(year, month, 30),
    payments: [],
    notes: '',
    academicYear: '2026-2027',
    ...overrides,
  };
}

const salaryPayment = (overrides: Partial<SalaryPayment> = {}): SalaryPayment => ({
  id: 'sp1', staffId: 'st1', amount: 75000, date: dateIn(year, month, 25), academicYear: '2026-2027',
  ...overrides,
});

const staff: Staff[] = [{ id: 'st1', name: 'Awa Traoré', position: 'Enseignante', salary: 75000, email: '', phone: '', bankDetails: '', emergencyContact: '' }];

const baseArgs = (partial?: Partial<Parameters<typeof useDashboard>[0]>): Parameters<typeof useDashboard>[0] => ({
  t,
  today: '2026-09-02',
  currentMonth: 8, // septembre — used by the arrears KPI only
  selectedYear: '2026-2027',
  students: [],
  staff: [],
  expenses: [],
  vendorExpenses: [],
  salaryPayments: [],
  ...partial,
});

describe('useDashboard', () => {
  it('computes the discounted outstanding and fees per selected year', () => {
    const api = compute(baseArgs({
      students: [
        student({ id: 'a', totalDue: 100000, scholarshipDiscount: 50, amountPaid: 10000 }),
        // Different academic year → excluded by the filter
        student({ id: 'b', academicYear: '2025-2026', totalDue: 999999 }),
      ],
    }));
    // (100000 × 0.5) − 10000 = 40000 ; fees = amounts actually paid
    assert.equal(api.stats.totalOutstanding, 40000);
    assert.equal(api.stats.totalFees, 10000);
    assert.equal(api.stats.enrolledStudentsCount, 1);
  });

  it('isolates collected-this-month from previous months AND previous years', () => {
    const api = compute(baseArgs({
      students: [
        student({ amountPaid: 0, payments: [
          { date: dateIn(year, month, 5), amount: 30000 },             // this month
          { date: dateIn(prevMonthYear, prevMonth, 5), amount: 20000 }, // last month
          { date: `${year - 1}-${pad(month + 1)}-10`, amount: 999999 }, // same month, last year → must NOT leak
        ] }),
      ],
    }));
    // collectedThisMonth / prevMonthCollected sum the *payments* of the month;
    // totalCollected sums the student's amountPaid ledger field (0 here).
    assert.equal(api.stats.collectedMonth, 30000);
    assert.equal(api.stats.prevMonthCollected, 20000);
    assert.equal(api.stats.totalCollected, 0);
  });

  it('includes scholarship-adjusted late students only when truly overdue', () => {
    const api = compute(baseArgs({
      today: '2026-09-02',
      selectedYear: null,
      students: [
        student({ id: 'late', totalDue: 100000, scholarshipDiscount: 25, amountPaid: 0, dueDate: '2026-08-30' }),
        student({ id: 'paid', totalDue: 100000, amountPaid: 100000, dueDate: '2026-08-01' }),
        student({ id: 'future', totalDue: 100000, dueDate: '2026-09-20' }),
      ],
    }));
    assert.deepEqual(api.lateStudents.map(s => s.id), ['late']);
    assert.equal(api.stats.lateParentsCount, 1);
  });

  it('raises a due reminder for balances due within 2 days', () => {
    const api = compute(baseArgs({
      students: [student({ id: 'soon', amountPaid: 0, dueDate: '2026-09-03' })],
    }));
    assert.deepEqual(api.notifications.map(n => n.type), ['due']);
    assert.equal(api.notifications[0].message, `Omar Coulibaly: ${t.dueReminder}`);
    assert.equal(api.notifications[0].studentId, 'soon');
  });

  it('raises a note reminder when a late parent has an old note (>3 days)', () => {
    const api = compute(baseArgs({
      students: [student({ id: 'note', amountPaid: 0, dueDate: '2026-08-20', lastNoteDate: '2026-08-25' })],
    }));
    assert.deepEqual(api.notifications.map(n => n.type), ['note']);
    assert.equal(api.notifications[0].message, `Omar Coulibaly: ${t.noteReminder}`);
  });

  it('keeps a fresh note (<3 days) from raising the reminder', () => {
    const api = compute(baseArgs({
      students: [student({ id: 'fresh', amountPaid: 0, dueDate: '2026-08-20', lastNoteDate: '2026-09-01' })],
    }));
    assert.equal(api.notifications.length, 0);
  });

  it('buckets income and expenses into the 12 monthly chart slots', () => {
    const api = compute(baseArgs({
      students: [student({ payments: [{ date: dateIn(year, month, 3), amount: 5000 }] })],
      expenses: [{ id: 'e1', category: 'fournitures', description: 'Craie', amount: 1200, date: dateIn(year, month, 6), academicYear: '2026-2027' }],
      salaryPayments: [salaryPayment({ amount: 8000 })],
    }));
    assert.equal(api.chartData.length, 12);
    assert.equal(api.chartData[month].income, 5000);
    assert.equal(api.chartData[month].expenses, 1200 + 8000);
    const others = api.chartData.filter((_, i) => i !== month);
    assert.ok(others.every(x => x.income === 0 && x.expenses === 0));
  });

  it('builds the paid/outstanding pie with the selected-year scope', () => {
    const api = compute(baseArgs({
      students: [
        student({ id: 'a', totalDue: 100000, amountPaid: 40000 }),
        student({ id: 'b', academicYear: '2025-2026', totalDue: 999999 }),
      ],
    }));
    assert.deepEqual(api.pieData, [
      { name: t.paid, value: 40000 },
      { name: t.outstanding, value: 60000 },
    ]);
  });

  it('reports every month without salary payments as missed, only when staff exist', () => {
    const emptyStaff = compute(baseArgs({ staff: [], salaryPayments: [] }));
    assert.deepEqual(emptyStaff.missedMonths, []);

    // One payment lands this month → this month is not missed anymore
    const api = compute(baseArgs({ staff, salaryPayments: [salaryPayment()] }));
    const expected = [];
    for (let m = 0; m <= month; m++) if (m !== month) expected.push(m);
    assert.deepEqual(api.missedMonths, expected);
  });

  it('flags missed payroll months as bell notifications', () => {
    const emptyStaff = compute(baseArgs({ staff: [], salaryPayments: [] }));
    assert.deepEqual(emptyStaff.notifications.filter(n => n.type === 'payroll'), [], 'no payroll alerts without staff');

    const api = compute(baseArgs({ staff, salaryPayments: [] }));
    const payrollAlerts = api.notifications.filter(n => n.type === 'payroll');
    assert.deepEqual(
      payrollAlerts.map(n => n.id),
      api.missedMonths.map(m => `payroll-${now.getFullYear()}-${m}`),
      'one payroll alert per missed month, id anchored on year+month',
    );
    assert.equal(payrollAlerts[0]?.studentId, undefined, 'team alert has no student');
    assert.ok(
      payrollAlerts[0]?.message.includes(t.noPayrollWarning.split('{month}')[0] || '') &&
        !payrollAlerts[0]?.message.includes('{month}'),
      'the alert carries the localized no-payroll message with a real month',
    );
  });

  it('deactivates the payroll window when there is no staff', () => {
    const api = compute(baseArgs({ staff: [] }));
    assert.equal(api.payrollWindowStatus.isOpen, false);
    assert.equal(api.payrollWindowStatus.isOverdue, false);
    assert.equal(api.payrollWindowStatus.totalPaidCurrentMonth, 0);
  });

  it('reflects the real payroll window: open before the 11th when unpaid, overdue after', () => {
    const day = now.getDate();
    const api = compute(baseArgs({ staff, salaryPayments: [] }));
    const w = api.payrollWindowStatus;
    assert.equal(w.isOpen, day >= 1 && day <= 10);
    assert.equal(w.isOverdue, day >= 11 && w.totalPaidCurrentMonth === 0);
    assert.equal(w.totalPaidCurrentMonth, 0);
  });

  it('sums the selected-month expenses incl. vendor (paid/partial) and salaries', () => {
    const vendor: VendorExpense = {
      id: 'v1', vendorName: 'Fournitures Bamako', category: 'stationery', amount: 20000, dueDate: dateIn(year, month, 8),
      paymentStatus: 'partial', amountPaid: 5000, academicYear: '2026-2027',
    };
    const api = compute(baseArgs({
      staff,
      expenses: [{ id: 'e1', category: 'eau', description: '', amount: 3000, date: dateIn(year, month, 9), academicYear: '2026-2027' }],
      vendorExpenses: [vendor],
      salaryPayments: [salaryPayment()],
    }));
    // totalExpenses = cash expenses + salaries + vendor partial 5000
    assert.equal(api.stats.totalExpenses, 3000 + 75000 + 5000);
    assert.equal(api.stats.expensesThisMonth, 3000 + 75000 + 5000);
  });
});
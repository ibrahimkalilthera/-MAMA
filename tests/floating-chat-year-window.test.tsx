/**
 * Regression: the chat-AI "this month" aggregations must window by year AND
 * month (mirroring useDashboard / RecordSalaryModal). A payment dated the same
 * month of a PREVIOUS year must never count toward "this month", and the
 * June-expenses query must scope to the most recent June, not all Junes.
 *
 * Drives the REAL useFloatingChat hook through renderHook — no mocks — and
 * asserts on the actual reply text after the response delay.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { act } from 'react';
import { translations } from '../src/i18n/translations';
import type { TranslationDict } from '../src/i18n/translations';
import { useFloatingChat } from '../src/app/useFloatingChat';
import type { DashboardStats } from '../src/app/mainViewsProps';
import type { Expense, SalaryPayment, Staff, Student, VendorExpense } from '../src/lib/useSupabaseData';
import { installDomGlobals, renderHook } from './harness';

const t = translations.en as TranslationDict;

const now = new Date();
const currentMonth = now.getMonth();
const currentYear = now.getFullYear();
const pad = (n: number): string => String(n).padStart(2, '0');
const thisMonthDay = (dayOfMonth: number): string =>
  `${currentYear}-${pad(currentMonth + 1)}-${pad(dayOfMonth)}`;
const sameMonthLastYear = `${currentYear - 1}-${pad(currentMonth + 1)}-15`;
// "June expenses" means the most recent June (June of the year just passed
// before the September intake), mirroring the hook's juneYear derivation.
const juneYear = currentMonth >= 5 ? currentYear : currentYear - 1;
const juneDate = (year: number, dayOfMonth: number): string =>
  `${year}-06-${pad(dayOfMonth)}`;

const stats: DashboardStats = {
  totalOutstanding: 0,
  collectedMonth: 0,
  prevMonthCollected: 0,
  lateParentsCount: 0,
  totalFees: 0,
  totalCollected: 0,
  totalExpenses: 0,
  totalArrears: 0,
  expensesThisMonth: 0,
  enrolledStudentsCount: 0,
};

const staffMember = (id: string): Staff => ({
  id,
  name: `Staff ${id}`,
  position: 'Teacher',
  salary: 100000,
  email: '',
  phone: '',
  bankDetails: '',
  emergencyContact: '',
});

const pupil = (payments: { date: string; amount: number }[]): Student => ({
  id: 'student-1',
  name: 'S. Pupil',
  parentName: 'P. Parent',
  parentEmail: '',
  parentPhone: '',
  totalDue: 50000,
  amountPaid: 0,
  dueDate: thisMonthDay(28),
  payments,
  notes: '',
});

const generalExpense = (description: string, date: string): Expense => ({
  id: `exp-${description}`,
  category: 'stationery',
  description,
  amount: 10000,
  date,
});

const vendorExpense = (description: string, dueDate: string): VendorExpense => ({
  id: `ven-${description}`,
  vendorName: `Vendor ${description}`,
  category: 'electricity',
  amount: 20000,
  dueDate,
  paymentStatus: 'paid',
  amountPaid: 20000,
  description,
});

installDomGlobals();

const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

type ChatApi = ReturnType<typeof useFloatingChat>;

describe('chat AI year+month windows', () => {
  it('payroll query counts only same-year payments as paid this month', async () => {
    const ref = { current: null as ChatApi | null };
    const salaryPayments: SalaryPayment[] = [
      // Paid in full LAST year, same month — must NOT settle this month.
      { id: 'sp-last-year', staffId: 'staff-a', amount: 100000, date: sameMonthLastYear },
      // Paid in full THIS month — must settle this month.
      { id: 'sp-this-month', staffId: 'staff-b', amount: 100000, date: thisMonthDay(5) },
    ];
    const { unmount } = renderHook(useFloatingChat, {
      lang: 'en',
      t,
      stats,
      students: [],
      staff: [staffMember('staff-a'), staffMember('staff-b')],
      salaryPayments,
      expenses: [],
      vendorExpenses: [],
      formatCurrency: (v: number) => `${v} XOF`,
      formatDate: (d: string) => d,
    }, ref);
    try {
      act(() => {
        ref.current?.handleAiQuery('salary');
      });
      await act(async () => {
        await delay(700);
      });
      const reply = ref.current?.aiMessages.at(-1)?.text ?? '';
      // Exactly staff-a is unpaid: last year's payment must not count.
      assert.match(reply, /with 1 unpaid salaries/);
    } finally {
      unmount();
    }
  });

  it('tuition query ignores a same-month payment from last year', async () => {
    const ref = { current: null as ChatApi | null };
    const { unmount } = renderHook(useFloatingChat, {
      lang: 'en',
      t,
      stats,
      students: [
        pupil([
          { date: sameMonthLastYear, amount: 20000 },
          { date: thisMonthDay(10), amount: 30000 },
        ]),
      ],
      staff: [],
      salaryPayments: [],
      expenses: [],
      vendorExpenses: [],
      formatCurrency: (v: number) => `${v} XOF`,
      formatDate: (d: string) => d,
    }, ref);
    try {
      act(() => {
        ref.current?.handleFloatingAiQuery('tuition collected this month');
      });
      await act(async () => {
        await delay(700);
      });
      const reply = ref.current?.floatingChatMessages.at(-1)?.text ?? '';
      // Only the 30000 XOF paid THIS month/year counts — not the 20000 from
      // the same month last year.
      assert.ok(reply.includes('**30000 XOF**'), `reply: ${reply}`);
      assert.ok(!reply.includes('20000'), `stale-year payment leaked in: ${reply}`);
    } finally {
      unmount();
    }
  });

  it('June expenses query scopes to the most recent June', async () => {
    const ref = { current: null as ChatApi | null };
    const { unmount } = renderHook(useFloatingChat, {
      lang: 'en',
      t,
      stats,
      students: [],
      staff: [],
      salaryPayments: [],
      expenses: [
        generalExpense('CURRENT_JUNE', juneDate(juneYear, 10)),
        generalExpense('STALE_JUNE', juneDate(juneYear - 1, 10)),
      ],
      vendorExpenses: [
        vendorExpense('CURRENT_VENDOR', juneDate(juneYear, 12)),
        vendorExpense('STALE_VENDOR', juneDate(juneYear - 1, 12)),
      ],
      formatCurrency: (v: number) => `${v} XOF`,
      formatDate: (d: string) => d,
    }, ref);
    try {
      act(() => {
        ref.current?.handleFloatingAiQuery('expenses for june');
      });
      await act(async () => {
        await delay(700);
      });
      const reply = ref.current?.floatingChatMessages.at(-1)?.text ?? '';
      assert.ok(reply.includes('CURRENT_JUNE'), `current June missing: ${reply}`);
      assert.ok(reply.includes('CURRENT_VENDOR'), `current June vendor missing: ${reply}`);
      assert.ok(!reply.includes('STALE_JUNE'), `stale June leaked in: ${reply}`);
      assert.ok(!reply.includes('STALE_VENDOR'), `stale June vendor leaked in: ${reply}`);
    } finally {
      unmount();
    }
  });
});
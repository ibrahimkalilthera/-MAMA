/**
 * happy-dom unit tests for the usePayments domain hook.
 *
 * The hook is rendered for real (spy mutators, happy-dom globals):
 *   1. a locked academic year blocks the payment with an alert and no
 *      mutator call (no receipt, no form reset);
 *   2. missing student or amount → silent early return (no addPayment);
 *   3. success — addPayment receives the parsed numeric amount, the payment
 *      date, the student's own academic year (falling back to selectedYear)
 *      and a REC-###### receipt number; the receipt PDF is generated with the
 *      student's amountPaid INCREMENTED by the payment (up-to-date balance),
 *      the same payment object and the cashier's name; the form resets;
 *   4. a receipt-PDF failure is caught (logged) and must NOT block the flow
 *      — the form still resets after a successful addPayment;
 *   5. an unknown student id still records the payment but generates no
 *      receipt (no target student to print it for);
 *   6. getEventsForDay groups the day's due students (details = remaining
 *      balance), surfaces staff salaries only on the 25th, and lists the
 *      day's expenses (name = description || category).
 *
 * The receipt PDF generator is mocked at the module level (node:test
 * --experimental-test-module-mocks) — jsPDF cannot run in happy-dom, and the
 * hook imports it statically so the mock must be registered before the hook
 * is imported.
 */
import { describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';
import { act } from 'react';
import { translations } from '../src/i18n/translations';
import type { TranslationDict } from '../src/i18n/translations';
import type { Student, User, Payment } from '../src/app/types';
import { installDomGlobals, stubAlert, renderHook } from './harness';

// ── module mock: receipt PDF (registered BEFORE importing the hook) ─────────
interface ReceiptCall {
  student: Student;
  payment: Payment;
  lang?: 'en' | 'fr';
  cashierName?: string;
}
const pdfCalls: ReceiptCall[] = [];
let pdfShouldThrow = false;

mock.module('../src/lib/pdfReceipt', {
  namedExports: {
    generatePaymentReceiptPdf: async (opts: ReceiptCall): Promise<void> => {
      pdfCalls.push(opts);
      if (pdfShouldThrow) throw new Error('jsPDF unavailable in test');
    },
  },
});

const { usePayments } = await import('../src/app/usePayments');

const t = translations.fr as TranslationDict;

const win = installDomGlobals();

// ── fixtures ─────────────────────────────────────────────────────────────────

const cashier: User = { username: 'ibrahim', name: 'Ibrahim Thera', role: 'admin' };

function student(overrides: Partial<Student> & { id: string; name: string; totalDue: number; amountPaid: number }): Student {
  return {
    parentName: 'Mamadou Diallo',
    parentEmail: 'parent@example.com',
    parentPhone: '+223 70 00 00 00',
    dueDate: '2026-12-31',
    payments: [],
    notes: '',
    ...overrides,
  };
}

const ali = (): Student => student({ id: 's1', name: 'Ali Diallo', totalDue: 150000, amountPaid: 50000, academicYear: '2026-2027' });

interface Spies {
  alerts: string[];
  addPaymentCalls: Array<{ studentId: string; payment: Omit<Payment, 'receiptNumber'> & { receiptNumber?: string } }>;
  addPaymentResults: boolean[];
  updateCalls: Array<{ id: string; updates: Partial<Student> }>;
  updateResults: boolean[];
}

interface DepsOverrides {
  students?: Student[];
  selectedYear?: string;
  lockedYears?: string[];
  staff?: Array<{ id: string; name: string; salary: number }>;
  expenses?: Array<{ id: string; category: string; description: string; amount: number; date: string }>;
  todos?: Array<{ id: string; text: string; completed: boolean; date?: string }>;
  addPaymentResults?: boolean[];
}

function baseDeps(overrides: DepsOverrides = {}): {
  args: Parameters<typeof usePayments>[0];
  spies: Spies;
} {
  const spies: Spies = { alerts: [], addPaymentCalls: [], addPaymentResults: overrides.addPaymentResults ?? [true], updateCalls: [], updateResults: [true] };
  const args = {
    t,
    lang: 'fr' as const,
    selectedYear: overrides.selectedYear ?? '2026-2027',
    lockedYears: overrides.lockedYears ?? [],
    students: overrides.students ?? [ali()],
    staff: (overrides.staff ?? []) as never[],
    expenses: (overrides.expenses ?? []) as never[],
    todos: (overrides.todos ?? []) as never[],
    currentUser: cashier,
    addPayment: async (studentId: string, payment: Omit<Payment, 'receiptNumber'> & { receiptNumber?: string }) => {
      spies.addPaymentCalls.push({ studentId, payment });
      return spies.addPaymentResults[spies.addPaymentCalls.length - 1] ?? true;
    },
    updateStudent: async (id: string, updates: Partial<Student>) => {
      spies.updateCalls.push({ id, updates });
      return spies.updateResults[spies.updateCalls.length - 1] ?? true;
    },
  };
  return { args: args as Parameters<typeof usePayments>[0], spies };
}

/** Mounts the hook, lets the test drive the form state, then submits. */
async function setup(
  args: Parameters<typeof usePayments>[0],
  form: { studentId: string; amount: string; date?: string },
  alertTarget: string[] = [],
): Promise<{
  ref: { current: ReturnType<typeof usePayments> | null };
  root: { unmount: () => void };
  restoreAlert: () => void;
}> {
  const ref: { current: ReturnType<typeof usePayments> | null } = { current: null };
  const { unmount } = renderHook(usePayments, args, ref);
  const restoreAlert = stubAlert(alertTarget);
  await act(async () => {
    ref.current!.setShowPaymentForm(true);
    ref.current!.setPaymentStudentId(form.studentId);
    ref.current!.setPaymentAmount(form.amount);
    if (form.date) ref.current!.setPaymentDate(form.date);
  });
  return { ref, root: { unmount }, restoreAlert };
}

describe('usePayments.handlePaymentSubmit', () => {
  it('blocks a locked academic year with an alert and no payment/receipt', async () => {
    const { args, spies } = baseDeps({ lockedYears: ['2026-2027'] });
    const { ref, root, restoreAlert } = await setup(args, { studentId: 's1', amount: '25000' }, spies.alerts);
    try {
      await act(async () => { await ref.current!.handlePaymentSubmit({ preventDefault: () => {} } as never); });

      assert.equal(spies.alerts[0], t.thisAcademicYearIsLocked);
      assert.equal(spies.addPaymentCalls.length, 0, 'no payment recorded on a locked year');
      assert.equal(pdfCalls.length, 0, 'no receipt generated on a locked year');
      assert.equal(ref.current!.showPaymentForm, true, 'form left open');
      assert.equal(ref.current!.paymentAmount, '25000', 'amount untouched');
    } finally {
      act(() => root.unmount());
      restoreAlert();
    }
  });

  it('silently ignores a submit without student or amount', async () => {
    const { args, spies } = baseDeps({});
    // no student selected
    {
      const { ref, root, restoreAlert } = await setup(args, { studentId: '', amount: '25000' });
      try {
        await act(async () => { await ref.current!.handlePaymentSubmit({ preventDefault: () => {} } as never); });
        assert.equal(spies.addPaymentCalls.length, 0);
        assert.equal(spies.alerts.length, 0);
      } finally {
        act(() => root.unmount());
        restoreAlert();
      }
    }
    // no amount entered
    {
      const { ref, root, restoreAlert } = await setup(args, { studentId: 's1', amount: '' });
      try {
        await act(async () => { await ref.current!.handlePaymentSubmit({ preventDefault: () => {} } as never); });
        assert.equal(spies.addPaymentCalls.length, 0);
        assert.equal(spies.alerts.length, 0);
      } finally {
        act(() => root.unmount());
        restoreAlert();
      }
    }
  });

  it('records the payment, generates the receipt with the up-to-date balance, and resets the form', async () => {
    pdfCalls.length = 0; // the module-level mock accumulates across tests
    const { args, spies } = baseDeps({ students: [ali()] });
    const { ref, root, restoreAlert } = await setup(args, { studentId: 's1', amount: '25000', date: '2026-05-12' }, spies.alerts);
    try {
      await act(async () => { await ref.current!.handlePaymentSubmit({ preventDefault: () => {} } as never); });

      // addPayment: parsed numeric amount + the entered date + student's own academic year + receipt number
      assert.equal(spies.addPaymentCalls.length, 1);
      const call = spies.addPaymentCalls[0];
      assert.equal(call.studentId, 's1');
      assert.equal(call.payment.amount, 25000, 'the string amount is parsed to a number');
      assert.equal(call.payment.date, '2026-05-12');
      assert.equal(call.payment.academicYear, '2026-2027', "the student's own academic year wins");
      assert.match(call.payment.receiptNumber ?? '', /^REC-\d{6}$/, 'a REC-###### receipt number is generated');

      // receipt PDF: the student's amountPaid is incremented (balance up to date)
      assert.equal(pdfCalls.length, 1, 'exactly one receipt is generated');
      const receipt = pdfCalls[0];
      assert.equal(receipt.student.id, 's1');
      assert.equal(receipt.student.amountPaid, 75000, 'amountPaid = 50000 + 25000 in the receipt');
      assert.equal(receipt.payment.receiptNumber, call.payment.receiptNumber, 'same receipt number on the payment and receipt');
      assert.equal(receipt.cashierName, 'Ibrahim Thera', "the cashier's name comes from currentUser");
      assert.equal(receipt.lang, 'fr');

      // form reset
      assert.equal(ref.current!.paymentStudentId, '');
      assert.equal(ref.current!.paymentAmount, '');
      assert.equal(ref.current!.showPaymentForm, false);
      assert.equal(spies.alerts.length, 0);
    } finally {
      act(() => root.unmount());
      restoreAlert();
    }
  });

  it('falls back to selectedYear when the student has no academic year', async () => {
    const noYear = student({ id: 's2', name: 'Binta Fall', totalDue: 90000, amountPaid: 0 });
    const { args, spies } = baseDeps({ students: [noYear], selectedYear: '2027-2028' });
    const { ref, root, restoreAlert } = await setup(args, { studentId: 's2', amount: '10000' });
    try {
      await act(async () => { await ref.current!.handlePaymentSubmit({ preventDefault: () => {} } as never); });
      assert.equal(spies.addPaymentCalls[0]?.payment.academicYear, '2027-2028');
    } finally {
      act(() => root.unmount());
      restoreAlert();
    }
  });

  it('still resets the form when the receipt PDF fails (non-blocking)', async () => {
    pdfShouldThrow = true;
    pdfCalls.length = 0;
    try {
      const { args, spies } = baseDeps({});
      const { ref, root, restoreAlert } = await setup(args, { studentId: 's1', amount: '25000' }, spies.alerts);
      try {
        await act(async () => { await ref.current!.handlePaymentSubmit({ preventDefault: () => {} } as never); });

        assert.equal(spies.addPaymentCalls.length, 1, 'payment recorded before the PDF step');
        assert.equal(pdfCalls.length, 1, 'the receipt generation was attempted');
        assert.equal(ref.current!.showPaymentForm, false, 'form closed despite the PDF failure');
        assert.equal(ref.current!.paymentStudentId, '');
      } finally {
        act(() => root.unmount());
        restoreAlert();
      }
    } finally {
      pdfShouldThrow = false;
      pdfCalls.length = 0;
    }
  });

  it('records an unknown student id without generating a receipt', async () => {
    pdfCalls.length = 0;
    const { args, spies } = baseDeps({});
    const { ref, root, restoreAlert } = await setup(args, { studentId: 'ghost', amount: '5000' }, spies.alerts);
    try {
      await act(async () => { await ref.current!.handlePaymentSubmit({ preventDefault: () => {} } as never); });

      assert.equal(spies.addPaymentCalls.length, 1, 'the payment is still recorded');
      assert.equal(spies.addPaymentCalls[0]?.studentId, 'ghost');
      assert.equal(pdfCalls.length, 0, 'no receipt without a target student');
      assert.equal(ref.current!.showPaymentForm, false);
    } finally {
      act(() => root.unmount());
      restoreAlert();
    }
  });
});

describe('usePayments.getEventsForDay', () => {
  it('groups due students, salaries on the 25th and the day expenses', async () => {
    const { args } = baseDeps({
      students: [
        student({ id: 's1', name: 'Ali Diallo', totalDue: 150000, amountPaid: 50000, dueDate: '2026-05-12' }),
        student({ id: 's2', name: 'Binta Fall', totalDue: 80000, amountPaid: 80000, dueDate: '2026-05-12' }), // balance 0
        student({ id: 's3', name: 'Omar Sy', totalDue: 60000, amountPaid: 0, dueDate: '2026-06-01' }), // other day
      ],
      staff: [
        { id: 'st1', name: 'Aminata Touré', salary: 120000 },
        { id: 'st2', name: 'Moussa Keïta', salary: 95000 },
      ],
      expenses: [
        { id: 'e1', category: 'stationery', description: 'Cahiers et craies', amount: 15000, date: '2026-05-12' },
        { id: 'e2', category: 'electricity', description: '', amount: 45000, date: '2026-05-12' },
        { id: 'e3', category: 'water', description: 'Autre jour', amount: 9000, date: '2026-05-20' },
      ],
      todos: [
        { id: 'td1', text: 'Réunion parents', completed: false, date: '2026-05-12' },
        { id: 'td2', text: 'Commander les fournitures', completed: true, date: '2026-05-12' },
        { id: 'td3', text: 'Autre jour', completed: false, date: '2026-05-20' },
      ],
    });
    const { ref, root } = await setup(args, { studentId: '', amount: '' });
    try {
      // Midday UTC: same calendar day in any timezone (due dates use toISOString, salaries use getDate).
      const day = new Date('2026-05-12T12:00:00Z');
      const events = ref.current!.getEventsForDay(day);
      const byType = Object.fromEntries(events.map((e) => [e.type, e]));

      // due: only the students due that day, details = remaining balance
      assert.ok(byType.due, 'a due event exists');
      assert.equal(byType.due.count, 2);
      assert.deepEqual(
        byType.due.details.map((d) => d.name).sort(),
        ['Ali Diallo', 'Binta Fall'],
      );
      const aliDetail = byType.due.details.find((d) => d.name === 'Ali Diallo')!;
      assert.equal(aliDetail.amount, 100000, 'remaining balance = totalDue - amountPaid');
      const bintaDetail = byType.due.details.find((d) => d.name === 'Binta Fall')!;
      assert.equal(bintaDetail.amount, 0);

      // salary: NOT on the 12th
      assert.equal(byType.salary, undefined, 'no salary event outside the 25th');

      // expenses: description wins over category, other-day expense excluded
      assert.ok(byType.expense, 'an expense event exists');
      assert.equal(byType.expense.count, 2);
      assert.deepEqual(
        byType.expense.details.map((d) => d.name).sort(),
        ['Cahiers et craies', 'electricity'],
        'description || category per expense, same-day only',
      );

      // todos: dated tasks appear with the completion flag; count = open tasks
      assert.ok(byType.todo, 'a todo event exists');
      assert.equal(byType.todo.count, 1, 'only the open task counts');
      assert.deepEqual(
        byType.todo.details.map((d) => d.name).sort(),
        ['Commander les fournitures', 'Réunion parents'],
        'both dated tasks listed, completed one flagged',
      );
      const done = byType.todo.details.find((d) => d.name === 'Commander les fournitures')!;
      assert.equal(done.completed, true);
      const open = byType.todo.details.find((d) => d.name === 'Réunion parents')!;
      assert.equal(open.completed, false);

      // salaries on the 25th
      const payday = new Date('2026-05-25T12:00:00Z');
      const payEvents = ref.current!.getEventsForDay(payday);
      const salaryEvent = payEvents.find((e) => e.type === 'salary')!;
      assert.ok(salaryEvent, 'a salary event exists on the 25th');
      assert.equal(salaryEvent.count, 2, 'one entry per staff member');
      assert.deepEqual(
        salaryEvent.details.map((d) => d.name).sort(),
        ['Aminata Touré', 'Moussa Keïta'],
      );
      assert.deepEqual(salaryEvent.details.map((d) => d.amount ?? 0).sort((a, b) => a - b), [95000, 120000]);
    } finally {
      act(() => root.unmount());
    }
  });

  it('returns no events for an empty day', async () => {
    const { args } = baseDeps({});
    const { ref, root } = await setup(args, { studentId: '', amount: '' });
    try {
      const events = ref.current!.getEventsForDay(new Date('2030-01-07T12:00:00Z'));
      assert.deepEqual(events, []);
    } finally {
      act(() => root.unmount());
    }
  });
});

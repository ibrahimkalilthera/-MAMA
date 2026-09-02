/**
 * happy-dom unit tests for useYearOps.handleCloseCurrentYear.
 *
 * The year-closure flow is exercised against the REAL hook with injected spy
 * mutators/setters:
 *   1. non-admin/dev role → alert + early return (nothing mutated);
 *   2. already-locked year → alert + early return;
 *   3. success — positive balances are carried over grouped BY STUDENT NAME
 *      (two students sharing a name accumulate into ONE next-year student),
 *      zero-balance students are skipped, the next year is created via
 *      addStudent with the opening-balance note, the year is locked, the
 *      year list gains the next year and the audit modal opens;
 *   4. an existing next-year student gets its totalDue increased and a
 *      carry-over note appended (updateStudent);
 *   5. partial mutation failure → alert and the lock/audit/toast side
 *      effects are skipped.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { act } from 'react';
import { translations } from '../src/i18n/translations';
import type { TranslationDict } from '../src/i18n/translations';
import { useYearOps } from '../src/app/useYearOps';
import type { UseYearOpsDeps } from '../src/app/useYearOps';
import type { User, Student } from '../src/app/types';
import { installDomGlobals, renderHook } from './harness';

const t = translations.en as TranslationDict;

const win = installDomGlobals();

/** Renders the hook and returns a live API ref. */
function mount(args: UseYearOpsDeps): {
  root: { unmount: () => void };
  ref: { current: ReturnType<typeof useYearOps> | null };
} {
  const ref: { current: ReturnType<typeof useYearOps> | null } = { current: null };
  const { unmount } = renderHook(useYearOps, args, ref);
  return { ref, root: { unmount } };
}

// ── fixtures ─────────────────────────────────────────────────────────────────

const admin: User = {
  username: 'admin',
  name: 'Admin',
  role: 'admin',
};

const staffUser: User = {
  username: 'staff',
  name: 'Staff',
  role: 'staff',
};

function student(overrides: Partial<Student> & { id: string; name: string; totalDue: number; amountPaid: number }): Student {
  return {
    parentName: 'Parent',
    parentEmail: '',
    parentPhone: '',
    dueDate: '2026-12-31',
    payments: [],
    notes: '',
    ...overrides,
  };
}

/** A successful addStudent result (the hook only checks `!== null`). */
const okStudent: Student = student({ id: 'new', name: 'New', totalDue: 0, amountPaid: 0 });

interface Spies {
  alerts: string[];
  updateStudentCalls: Array<[string, Partial<Student>]>;
  addStudentCalls: Array<Omit<Student, 'id' | 'payments'>>;
  lockedYearsUpdaters: Array<(prev: string[]) => string[]>;
  academicYearsUpdaters: Array<(prev: string[]) => string[]>;
  auditYears: Array<string | null>;
  auditModalOpen: boolean[];
  toasts: number;
}

function baseDeps(overrides: {
  students?: Student[];
  currentUser?: User | null;
  selectedYear?: string;
  lockedYears?: string[];
  updateStudentResults?: boolean[];
  addStudentResults?: Array<Student | null>;
}): { args: UseYearOpsDeps; spies: Spies } {
  const spies: Spies = {
    alerts: [],
    updateStudentCalls: [],
    addStudentCalls: [],
    lockedYearsUpdaters: [],
    academicYearsUpdaters: [],
    auditYears: [],
    auditModalOpen: [],
    toasts: 0,
  };
  const args: UseYearOpsDeps = {
    t,
    currentUser: overrides.currentUser === undefined ? admin : overrides.currentUser,
    students: overrides.students ?? [],
    expenses: [],
    vendorExpenses: [],
    salaryPayments: [],
    updateStudent: async (id: string, updates: Partial<Student>) => {
      spies.updateStudentCalls.push([id, updates]);
      return (overrides.updateStudentResults ?? [true])[spies.updateStudentCalls.length - 1] ?? true;
    },
    addStudent: async (s: Omit<Student, 'id' | 'payments'>) => {
      spies.addStudentCalls.push(s);
      const result = (overrides.addStudentResults ?? [okStudent])[spies.addStudentCalls.length - 1];
      return result === undefined ? okStudent : result;
    },
    selectedYear: overrides.selectedYear ?? '2026-2027',
    lockedYears: overrides.lockedYears ?? [],
    setLockedYears: (updater) => { spies.lockedYearsUpdaters.push(updater as (prev: string[]) => string[]); },
    setAcademicYears: (updater) => { spies.academicYearsUpdaters.push(updater as (prev: string[]) => string[]); },
    setAuditYear: (year) => { spies.auditYears.push(year as string | null); },
    setShowAuditModal: (open) => { spies.auditModalOpen.push(open as boolean); },
    showToast: () => { spies.toasts += 1; },
  };
  return { args, spies };
}

/** Stub globalThis.alert (node has none) and restore after the test. */
function stubAlert(target: string[]): () => void {
  const original = globalThis.alert as unknown;
  globalThis.alert = ((msg: string) => { target.push(msg); }) as typeof alert;
  return () => {
    globalThis.alert = original as typeof alert;
  };
}

describe('useYearOps.handleCloseCurrentYear', () => {
  it('blocks non-admin/dev roles with an alert and no side effects', async () => {
    const { args, spies } = baseDeps({ currentUser: staffUser, students: [student({ id: 's1', name: 'Ali', totalDue: 1000, amountPaid: 0 })] });
    const restore = stubAlert(spies.alerts);
    const { ref, root } = mount(args);
    try {
      await act(async () => { await ref.current!.handleCloseCurrentYear(); });
      assert.equal(spies.alerts[0], t.onlyPromoterOwnerCanCloseAcademicYears);
      assert.equal(spies.addStudentCalls.length, 0);
      assert.equal(spies.updateStudentCalls.length, 0);
      assert.equal(spies.lockedYearsUpdaters.length, 0);
      assert.equal(spies.toasts, 0);
    } finally {
      act(() => root.unmount());
      restore();
    }
  });

  it('blocks an already-locked year with an alert and no side effects', async () => {
    const { args, spies } = baseDeps({ selectedYear: '2026-2027', lockedYears: ['2026-2027'], students: [student({ id: 's1', name: 'Ali', totalDue: 1000, amountPaid: 0 })] });
    const restore = stubAlert(spies.alerts);
    const { ref, root } = mount(args);
    try {
      await act(async () => { await ref.current!.handleCloseCurrentYear(); });
      assert.equal(spies.alerts[0], t.thisAcademicYearIsAlreadyLocked);
      assert.equal(spies.addStudentCalls.length, 0);
      assert.equal(spies.lockedYearsUpdaters.length, 0);
    } finally {
      act(() => root.unmount());
      restore();
    }
  });

  it('carries positive balances over grouped by student name and opens the next year', async () => {
    const { args, spies } = baseDeps({
      selectedYear: '2026-2027',
      students: [
        student({ id: 's1', name: 'Ali Diallo', totalDue: 10000, amountPaid: 5000, academicYear: '2026-2027', grade: '6A', dueDate: '2026-06-30', parentName: 'M. Diallo' }),
        // Same name → balances accumulate into a single next-year student (5000 + 3000)
        student({ id: 's2', name: 'Ali Diallo', totalDue: 8000, amountPaid: 5000, academicYear: '2026-2027', grade: '6A' }),
        // Zero balance → skipped
        student({ id: 's3', name: 'Binta Fall', totalDue: 4000, amountPaid: 4000, academicYear: '2026-2027' }),
        student({ id: 's4', name: 'Omar Sy', totalDue: 3000, amountPaid: 0, academicYear: '2026-2027', grade: '3B' }),
      ],
    });
    const { ref, root } = mount(args);
    try {
      await act(async () => { await ref.current!.handleCloseCurrentYear(); });

      // 2 next-year students: Ali Diallo (8000 grouped) and Omar Sy (3000)
      assert.equal(spies.addStudentCalls.length, 2);
      const ali = spies.addStudentCalls.find(s => s.name === 'Ali Diallo')!;
      const omar = spies.addStudentCalls.find(s => s.name === 'Omar Sy')!;
      assert.equal(ali.totalDue, 8000);
      assert.equal(ali.academicYear, '2027-2028');
      assert.equal(ali.scholarshipDiscount, 0);
      assert.equal(ali.amountPaid, 0);
      assert.match(ali.notes, /Opening Balance \(Debt carried over from 2026-2027\): 8000 CFA/);
      assert.equal(ali.grade, '6A');
      assert.equal(ali.dueDate, '2026-06-30');
      assert.equal(omar.totalDue, 3000);
      assert.equal(omar.academicYear, '2027-2028');
      assert.equal(omar.grade, '3B');
      assert.equal(spies.updateStudentCalls.length, 0);

      // Year locked + added to the year list + audit modal opened
      assert.equal(spies.lockedYearsUpdaters.length, 1);
      assert.deepEqual(spies.lockedYearsUpdaters[0](['2025-2026']), ['2025-2026', '2026-2027']);
      assert.equal(spies.academicYearsUpdaters.length, 1);
      assert.deepEqual(spies.academicYearsUpdaters[0](['2026-2027']), ['2026-2027', '2027-2028']);
      // Idempotent: next year already present → unchanged
      assert.deepEqual(spies.academicYearsUpdaters[0](['2026-2027', '2027-2028']), ['2026-2027', '2027-2028']);
      assert.deepEqual(spies.auditYears, ['2026-2027']);
      assert.deepEqual(spies.auditModalOpen, [true]);
      assert.equal(spies.toasts, 1);
      assert.equal(spies.alerts.length, 0);
    } finally {
      act(() => root.unmount());
    }
  });

  it('updates an existing next-year student with the carried balance and a note', async () => {
    const { args, spies } = baseDeps({
      selectedYear: '2026-2027',
      students: [
        student({ id: 's1', name: 'Ali Diallo', totalDue: 10000, amountPaid: 2000, academicYear: '2026-2027' }), // balance 8000
        student({ id: 'n1', name: 'Ali Diallo', totalDue: 5000, amountPaid: 0, academicYear: '2027-2028', notes: '' }),
      ],
    });
    const { ref, root } = mount(args);
    try {
      await act(async () => { await ref.current!.handleCloseCurrentYear(); });

      assert.equal(spies.addStudentCalls.length, 0);
      assert.equal(spies.updateStudentCalls.length, 1);
      const [id, updates] = spies.updateStudentCalls[0];
      assert.equal(id, 'n1');
      assert.equal(updates.totalDue, 13000);
      assert.equal(updates.notes, 'Carryover debt from 2026-2027: +8000 CFA');
    } finally {
      act(() => root.unmount());
    }
  });

  it('skips the lock/audit/toast side effects when a mutation fails', async () => {
    const { args, spies } = baseDeps({
      selectedYear: '2026-2027',
      addStudentResults: [null],
      students: [
        student({ id: 's1', name: 'Ali Diallo', totalDue: 10000, amountPaid: 2000, academicYear: '2026-2027' }),
      ],
    });
    const restore = stubAlert(spies.alerts);
    const { ref, root } = mount(args);
    try {
      await act(async () => { await ref.current!.handleCloseCurrentYear(); });

      assert.equal(spies.alerts[0], t.someCarryOverBalancesCouldNotBeSaved);
      assert.equal(spies.lockedYearsUpdaters.length, 0);
      assert.equal(spies.auditYears.length, 0);
      assert.equal(spies.auditModalOpen.length, 0);
      assert.equal(spies.toasts, 0);
    } finally {
      act(() => root.unmount());
      restore();
    }
  });
});

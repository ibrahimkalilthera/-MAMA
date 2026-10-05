/**
 * Determinism tests for useFloatingChat's monthly answers.
 *
 * The hook reads its monthly KPIs from an INJECTED clock (`now`), so "this
 * month" is decided by the pinned date rather than the wall clock. These tests
 * pin two different months and prove the "collected this month" answer follows
 * each one — a reply computed from the real date could not satisfy both.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { act } from 'react';
import { translations } from '../src/i18n/translations';
import type { TranslationDict } from '../src/i18n/translations';
import type { DashboardStats } from '../src/app/mainViewsProps';
import type { Student } from '../src/app/types';
import { useFloatingChat } from '../src/app/useFloatingChat';
import { installDomGlobals, renderHook } from './harness';

installDomGlobals();

const t = translations.en as TranslationDict;

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

const student: Student = {
  id: 's1',
  parentId: 'p1',
  name: 'Omar Coulibaly',
  parentName: 'M. Coulibaly',
  parentEmail: '',
  parentPhone: '',
  totalDue: 100000,
  amountPaid: 0,
  scholarshipDiscount: 0,
  dueDate: '2026-09-30',
  notes: '',
  academicYear: '2026-2027',
  payments: [
    { date: '2026-09-05', amount: 30000 },
    { date: '2026-10-05', amount: 12000 },
  ],
};

const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** Asks the "collected this month" question under a pinned clock, returns the reply. */
async function collectedThisMonth(clock: Date): Promise<string> {
  const { api, unmount } = renderHook(useFloatingChat, {
    lang: 'en',
    t,
    stats,
    students: [student],
    staff: [],
    salaryPayments: [],
    expenses: [],
    vendorExpenses: [],
    formatCurrency: (value: number) => `${value} XOF`,
    formatDate: (dateStr: string) => dateStr,
    now: () => clock,
  });
  try {
    await act(async () => {
      api.current?.handleFloatingAiQuery('How much tuition was collected this month?');
    });
    await delay(600); // the hook appends the assistant reply after 450 ms
    await act(async () => {});
    const messages = api.current?.floatingChatMessages ?? [];
    return messages[messages.length - 1]?.text ?? '';
  } finally {
    unmount();
  }
}

describe('useFloatingChat — the monthly answer follows the injected clock', () => {
  it('answers with September’s total under a September clock', async () => {
    assert.equal(
      await collectedThisMonth(new Date(2026, 8, 2)),
      'The total tuition fees collected this month is **30000 XOF**.',
    );
  });

  it('answers with October’s total under an October clock — the wall clock never leaks', async () => {
    assert.equal(
      await collectedThisMonth(new Date(2026, 9, 2)),
      'The total tuition fees collected this month is **12000 XOF**.',
    );
  });
});

/**
 * happy-dom unit tests for the useExpenses domain hook.
 *
 * The hook is rendered for real (spy mutators, happy-dom globals):
 *   1. handleExpenseSubmit — a locked year blocks with an alert; an invalid
 *      amount is silently ignored; success parses the amount, stamps the
 *      academic year, closes the modal and resets the form;
 *   2. handleVendorExpenseSubmit — creation is gated to finance admins
 *      (promoter / general manager get through, staff is alerted); the
 *      promoter alone may set the amount and vendor name; a
 *      general_manager keeps the existing amount/vendorName on EDIT of an
 *      existing record; paid/unpaid/partial drive amountPaid; social_cases
 *      fills the aid fields, other categories drop them;
 *   3. handleDeleteVendorExpense — locked year blocks, non-finance roles are
 *      alerted, finance roles delete and toast;
 *   4. handleEditVendorExpense — hydrates the form from the record and opens
 *      the modal;
 *   5. expenseCategoryList — localized labels, alphabetically sorted.
 *
 * State updates and handler calls live in SEPARATE act() blocks, so the
 * handler always reads a fresh render (React batches same-block updates).
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { act } from 'react';
import { translations } from '../src/i18n/translations';
import type { TranslationDict } from '../src/i18n/translations';
import type { User, VendorExpense, Expense } from '../src/app/types';
import { useExpenses } from '../src/app/useExpenses';
import { installDomGlobals, stubAlert, renderHook } from './harness';

const t = translations.fr as TranslationDict;

const win = installDomGlobals();

// ── fixtures ─────────────────────────────────────────────────────────────────

const promoter: User = { username: 'ibrahim', name: 'Ibrahim Thera', role: 'admin' };
const gmUser: User = { username: 'mamadou', name: 'Mamadou Lamine Thera', role: 'general_manager' };
const staffUser: User = { username: 'sekou', name: 'Sékou Traoré', role: 'staff' };

const vendor: VendorExpense = {
  id: 'v1',
  vendorName: 'Papeterie Ba',
  category: 'stationery',
  amount: 75000,
  dueDate: '2026-09-30',
  paymentStatus: 'unpaid',
  amountPaid: 0,
  description: 'Cahiers',
  academicYear: '2026-2027',
};

interface Spies {
  alerts: string[];
  addExpenseCalls: Array<Omit<Expense, 'id'>>;
  addVendorCalls: Array<Omit<VendorExpense, 'id'>>;
  updateVendorCalls: Array<{ id: string; updates: Partial<VendorExpense> }>;
  deleteVendorCalls: string[];
  deleteResults: boolean[];
  toasts: number;
}

interface DepsOverrides {
  selectedYear?: string;
  lockedYears?: string[];
  currentUser?: User | null;
  deleteResults?: boolean[];
}

function baseDeps(overrides: DepsOverrides = {}): {
  args: Parameters<typeof useExpenses>[0];
  spies: Spies;
} {
  const spies: Spies = {
    alerts: [],
    addExpenseCalls: [],
    addVendorCalls: [],
    updateVendorCalls: [],
    deleteVendorCalls: [],
    deleteResults: overrides.deleteResults ?? [true],
    toasts: 0,
  };
  const args = {
    t,
    lang: 'fr' as const,
    selectedYear: overrides.selectedYear ?? '2026-2027',
    lockedYears: overrides.lockedYears ?? [],
    currentUser: overrides.currentUser !== undefined ? overrides.currentUser : promoter,
    addExpense: async (exp: Omit<Expense, 'id'>) => {
      spies.addExpenseCalls.push(exp);
      return { ...exp, id: 'e-new' } as Expense;
    },
    addVendorExpense: async (ve: Omit<VendorExpense, 'id'>) => {
      spies.addVendorCalls.push(ve);
      return { ...ve, id: 'v-new' } as VendorExpense;
    },
    updateVendorExpense: async (id: string, updates: Partial<VendorExpense>) => {
      spies.updateVendorCalls.push({ id, updates });
      return true;
    },
    deleteVendorExpense: async (id: string) => {
      spies.deleteVendorCalls.push(id);
      return spies.deleteResults[spies.deleteVendorCalls.length - 1] ?? true;
    },
    showToast: () => { spies.toasts += 1; },
    // Validation/guard messages go through the toast system now (no native alert).
    toastError: (msg: string) => { spies.alerts.push(msg); },
  };
  return { args: args as Parameters<typeof useExpenses>[0], spies };
}

async function setup(args: Parameters<typeof useExpenses>[0], alertTarget: string[] = []): Promise<{
  ref: { current: ReturnType<typeof useExpenses> | null };
  root: { unmount: () => void };
  restoreAlert: () => void;
}> {
  const ref: { current: ReturnType<typeof useExpenses> | null } = { current: null };
  const { unmount } = renderHook(useExpenses, args, ref);
  const restoreAlert = stubAlert(alertTarget);
  return { ref, root: { unmount }, restoreAlert };
}

const submitEvent = { preventDefault: () => {} } as never;

describe('useExpenses.handleExpenseSubmit', () => {
  it('blocks a locked year with an alert and no write', async () => {
    const { args, spies } = baseDeps({ lockedYears: ['2026-2027'] });
    const { ref, root, restoreAlert } = await setup(args, spies.alerts);
    try {
      await act(async () => {
        ref.current!.setShowExpenseModal(true);
        ref.current!.setExpenseForm({ category: 'water', description: 'Facture', amount: '12000', date: '2026-05-01' });
      });
      await act(async () => { await ref.current!.handleExpenseSubmit(submitEvent); });
      assert.equal(spies.alerts[0], t.thisAcademicYearIsLocked);
      assert.equal(spies.addExpenseCalls.length, 0);
      assert.equal(ref.current!.showExpenseModal, true, 'modal left open');
    } finally {
      act(() => root.unmount());
      restoreAlert();
    }
  });

  it('silently ignores an invalid amount', async () => {
    const { args, spies } = baseDeps();
    const { ref, root, restoreAlert } = await setup(args, spies.alerts);
    try {
      for (const bad of ['', 'abc', '-5']) {
        await act(async () => {
          ref.current!.setExpenseForm({ category: 'water', description: 'x', amount: bad, date: '2026-05-01' });
        });
        await act(async () => { await ref.current!.handleExpenseSubmit(submitEvent); });
      }
      assert.equal(spies.addExpenseCalls.length, 0, 'no write for invalid amounts');
      assert.equal(spies.alerts.length, 0, 'silent on invalid amount');
    } finally {
      act(() => root.unmount());
      restoreAlert();
    }
  });

  it('creates the expense with a parsed amount and the academic year, then resets', async () => {
    const { args, spies } = baseDeps();
    const { ref, root, restoreAlert } = await setup(args, spies.alerts);
    try {
      await act(async () => {
        ref.current!.setExpenseForm({ category: 'internet', description: 'Fibre', amount: '25000', date: '2026-05-02' });
      });
      await act(async () => { await ref.current!.handleExpenseSubmit(submitEvent); });
      assert.deepEqual(spies.addExpenseCalls, [
        { category: 'internet', description: 'Fibre', amount: 25000, date: '2026-05-02', academicYear: '2026-2027' },
      ]);
      assert.equal(ref.current!.showExpenseModal, false);
      assert.equal(ref.current!.expenseForm.amount, '', 'form reset');
      assert.equal(spies.toasts, 1);
    } finally {
      act(() => root.unmount());
      restoreAlert();
    }
  });
});

describe('useExpenses.handleVendorExpenseSubmit', () => {
  it('gates creation to finance admins: staff is alerted, GM passes', async () => {
    // staff blocked
    {
      const { args, spies } = baseDeps({ currentUser: staffUser });
      const { ref, root, restoreAlert } = await setup(args, spies.alerts);
      try {
        await act(async () => {
          ref.current!.setVendorExpenseForm({ ...ref.current!.vendorExpenseForm, vendorName: 'X', amount: '1000' });
        });
        await act(async () => { await ref.current!.handleVendorExpenseSubmit(submitEvent); });
        assert.equal(spies.alerts[0], t.onlyThePromoterCanCreateAVendorExpense);
        assert.equal(spies.addVendorCalls.length, 0);
      } finally {
        act(() => root.unmount());
        restoreAlert();
      }
    }
    // general manager passes
    {
      const { args, spies } = baseDeps({ currentUser: gmUser });
      const { ref, root, restoreAlert } = await setup(args, spies.alerts);
      try {
        await act(async () => {
          ref.current!.setVendorExpenseForm({
            ...ref.current!.vendorExpenseForm,
            vendorName: 'Solar Mali',
            category: 'solar_energy',
            amount: '300000',
            paymentStatus: 'paid',
          });
        });
        await act(async () => { await ref.current!.handleVendorExpenseSubmit(submitEvent); });
        assert.equal(spies.alerts.length, 0);
        assert.equal(spies.addVendorCalls.length, 1);
        assert.equal(spies.addVendorCalls[0]?.amount, 300000);
      } finally {
        act(() => root.unmount());
        restoreAlert();
      }
    }
  });

  it('lets the promoter set amount and vendorName on create', async () => {
    const { args, spies } = baseDeps({});
    const { ref, root, restoreAlert } = await setup(args, spies.alerts);
    try {
      await act(async () => {
        ref.current!.setVendorExpenseForm({
          ...ref.current!.vendorExpenseForm,
          vendorName: '  Papeterie Ba  ',
          category: 'stationery',
          amount: '75000',
          paymentStatus: 'partial',
          amountPaid: '25000',
          description: 'Cahiers',
        });
      });
      await act(async () => { await ref.current!.handleVendorExpenseSubmit(submitEvent); });
      const call = spies.addVendorCalls[0]!;
      assert.equal(call.vendorName, 'Papeterie Ba', 'vendorName is trimmed');
      assert.equal(call.amount, 75000, 'amount parsed from the form');
      assert.equal(call.amountPaid, 25000, 'partial keeps the entered amountPaid');
      assert.equal(call.academicYear, '2026-2027');
      assert.equal(call.aidType, undefined, 'no aid fields outside social_cases');
    } finally {
      act(() => root.unmount());
      restoreAlert();
    }
  });

  it('amountPaid follows the payment status: paid = full, unpaid = 0', async () => {
    const { args, spies } = baseDeps({});
    const { ref, root, restoreAlert } = await setup(args, spies.alerts);
    try {
      await act(async () => {
        ref.current!.setVendorExpenseForm({ ...ref.current!.vendorExpenseForm, vendorName: 'A', amount: '50000', paymentStatus: 'paid', amountPaid: '999' });
      });
      await act(async () => { await ref.current!.handleVendorExpenseSubmit(submitEvent); });
      assert.equal(spies.addVendorCalls[0]?.amountPaid, 50000, 'paid forces the full amount');
      await act(async () => {
        ref.current!.setVendorExpenseForm({ ...ref.current!.vendorExpenseForm, vendorName: 'B', amount: '50000', paymentStatus: 'unpaid', amountPaid: '999' });
      });
      await act(async () => { await ref.current!.handleVendorExpenseSubmit(submitEvent); });
      assert.equal(spies.addVendorCalls[1]?.amountPaid, 0, 'unpaid forces 0');
    } finally {
      act(() => root.unmount());
      restoreAlert();
    }
  });

  it('fills the social-case aid fields only for social_cases', async () => {
    const { args, spies } = baseDeps({});
    const { ref, root, restoreAlert } = await setup(args, spies.alerts);
    try {
      await act(async () => {
        ref.current!.setVendorExpenseForm({
          ...ref.current!.vendorExpenseForm,
          vendorName: 'Aide',
          category: 'social_cases',
          amount: '30000',
          paymentStatus: 'unpaid',
          aidType: 'kits_fournitures',
          beneficiaryStudentName: 'Ali Diallo',
          beneficiaryStudentGrade: '6e',
        });
      });
      await act(async () => { await ref.current!.handleVendorExpenseSubmit(submitEvent); });
      assert.equal(spies.addVendorCalls[0]?.aidType, 'kits_fournitures');
      assert.equal(spies.addVendorCalls[0]?.beneficiaryStudentName, 'Ali Diallo');
      assert.equal(spies.addVendorCalls[0]?.beneficiaryStudentGrade, '6e');
    } finally {
      act(() => root.unmount());
      restoreAlert();
    }
  });

  it('keeps the existing amount and vendorName when a non-promoter finance admin edits a record', async () => {
    const { args, spies } = baseDeps({ currentUser: gmUser });
    const { ref, root, restoreAlert } = await setup(args, spies.alerts);
    try {
      await act(async () => { ref.current!.handleEditVendorExpense(vendor); });
      assert.equal(ref.current!.showVendorExpenseModal, true, 'edit modal opened');
      await act(async () => {
        ref.current!.setVendorExpenseForm({
          ...ref.current!.vendorExpenseForm,
          vendorName: 'Tentative de renommage',
          amount: '1',
          paymentStatus: 'paid',
        });
      });
      await act(async () => { await ref.current!.handleVendorExpenseSubmit(submitEvent); });
      assert.equal(spies.updateVendorCalls.length, 1);
      const upd = spies.updateVendorCalls[0]!;
      assert.equal(upd.id, 'v1');
      assert.equal(upd.updates.amount, 75000, 'the GM cannot change the amount of an existing record');
      assert.equal(upd.updates.vendorName, 'Papeterie Ba', 'the GM cannot rename the vendor');
      assert.equal(ref.current!.editingVendorExpense, null, 'editing flag cleared');
      assert.equal(ref.current!.showVendorExpenseModal, false);
    } finally {
      act(() => root.unmount());
      restoreAlert();
    }
  });
});

describe('useExpenses.handleDeleteVendorExpense', () => {
  it('blocks on a locked year, then on a non-finance role, then deletes + toasts', async () => {
    // locked year
    {
      const { args, spies } = baseDeps({ lockedYears: ['2026-2027'] });
      const { ref, root, restoreAlert } = await setup(args, spies.alerts);
      try {
        await act(async () => { await ref.current!.handleDeleteVendorExpense('v1'); });
        assert.equal(spies.alerts[0], t.thisAcademicYearIsLocked);
        assert.equal(spies.deleteVendorCalls.length, 0);
      } finally {
        act(() => root.unmount());
        restoreAlert();
      }
    }
    // non-finance role
    {
      const { args, spies } = baseDeps({ currentUser: staffUser });
      const { ref, root, restoreAlert } = await setup(args, spies.alerts);
      try {
        await act(async () => { await ref.current!.handleDeleteVendorExpense('v1'); });
        assert.equal(spies.alerts[0], t.onlyThePromoterCanDeleteExpenses);
        assert.equal(spies.deleteVendorCalls.length, 0);
      } finally {
        act(() => root.unmount());
        restoreAlert();
      }
    }
    // GM deletes and toasts
    {
      const { args, spies } = baseDeps({ currentUser: gmUser });
      const { ref, root, restoreAlert } = await setup(args, spies.alerts);
      try {
        await act(async () => { await ref.current!.handleDeleteVendorExpense('v1'); });
        assert.deepEqual(spies.deleteVendorCalls, ['v1']);
        assert.equal(spies.toasts, 1);
      } finally {
        act(() => root.unmount());
        restoreAlert();
      }
    }
  });
});

describe('useExpenses.utilities', () => {
  it('hydrates the form on edit and exposes the localized sorted categories', async () => {
    const { args } = baseDeps({});
    const { ref, root, restoreAlert } = await setup(args);
    try {
      await act(async () => { ref.current!.handleEditVendorExpense(vendor); });
      const f = ref.current!.vendorExpenseForm;
      assert.equal(f.vendorName, 'Papeterie Ba');
      assert.equal(f.amount, '75000');
      assert.equal(f.paymentStatus, 'unpaid');
      assert.equal(f.dueDate, '2026-09-30');

      const cats = ref.current!.expenseCategoryList;
      assert.ok(cats.length >= 18, 'the full category list is exposed');
      const labels = cats.map((c) => c.label);
      assert.deepEqual(labels, [...labels].sort((a, b) => a.localeCompare(b, 'fr', { sensitivity: 'base' })), 'sorted alphabetically');
      assert.ok(cats.every((c) => typeof c.label === 'string' && c.label.length > 0), 'labels are localized, not raw keys');

      // month navigation
      const before = ref.current!.calendarDate.getMonth();
      await act(async () => { ref.current!.changeMonth(1); });
      const after = ref.current!.calendarDate.getMonth();
      assert.equal(after, (before + 1) % 12, 'changeMonth advances the calendar month');
    } finally {
      act(() => root.unmount());
      restoreAlert();
    }
  });
});
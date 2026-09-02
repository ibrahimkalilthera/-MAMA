/**
 * happy-dom unit tests for the usePayroll domain hook.
 *
 * The hook is rendered for real (spy mutators, happy-dom globals):
 *   1. handleStaffSubmit — a locked academic year blocks with an alert and no
 *      mutator call; success parses the numeric salary, trims the string
 *      fields, resets the form and closes the modal;
 *   2. an invalid (NaN/negative) salary silently aborts;
 *   3. handleSalarySubmit — locked year blocked; success records the payment
 *      stamped with the selected academic year, resets the form and closes;
 *   4. openEditStaffModal refills the form from the record;
 *   5. handleExportMonthlyPayrollExcel — bordereau XLSX: one row per staff
 *      member with paid-this-month summed from the matching salaryPayments
 *      (same staff id + month + year), remaining balance floored at 0, the
 *      localized status (fully paid / partial / unpaid) and the academic
 *      year; the workbook is written under the expected file name.
 *
 * The `xlsx` module is mocked at the module level (node:test
 * --experimental-test-module-mocks) so no real file is written and the
 * sheet data can be asserted.
 */
import { describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';
import { act } from 'react';
import { translations } from '../src/i18n/translations';
import type { TranslationDict } from '../src/i18n/translations';
import type { Staff, SalaryPayment } from '../src/app/types';
import { installDomGlobals, stubAlert, renderHook } from './harness';

// ── module mock: xlsx (registered BEFORE importing the hook) ─────────────────
interface SheetRow {
  [key: string]: string | number;
}
const writeFileCalls: Array<{ fileName: string }> = [];
let lastSheetRows: SheetRow[] = [];
let lastSheetName = '';

mock.module('xlsx', {
  namedExports: {
    utils: {
      json_to_sheet: (rows: SheetRow[]) => {
        lastSheetRows = rows;
        return { '!ref': 'A1' };
      },
      book_new: () => ({ SheetNames: [], Sheets: {} }),
      book_append_sheet: (wb: { SheetNames: string[] }, _ws: unknown, name: string) => {
        lastSheetName = name;
        wb.SheetNames.push(name);
      },
    },
    writeFile: (_wb: unknown, fileName: string) => {
      writeFileCalls.push({ fileName });
    },
  },
});

// ── module mock: jspdf (for the per-employee salary receipt PDF) ─────────────
// The receipt handler dynamically imports jsPDF; the fake records every
// `save()` call (filename) and every `text()` payload so the PDF content can
// be asserted without a real PDF library.
const pdfSaveCalls: string[] = [];
const pdfTextCalls: string[] = [];
class FakeJsPDF {
  setFillColor() {}
  setDrawColor() {}
  setTextColor() {}
  setFont() {}
  setFontSize() {}
  rect() {}
  roundedRect() {}
  line() {}
  addPage() {}
  text(payload: string) {
    pdfTextCalls.push(payload);
  }
  save(fileName: string) {
    pdfSaveCalls.push(fileName);
  }
}

mock.module('jspdf', {
  namedExports: { jsPDF: FakeJsPDF },
});

const { usePayroll } = await import('../src/app/usePayroll');

const t = translations.fr as TranslationDict;

const win = installDomGlobals({ forwardAlert: true });

// ── fixtures ─────────────────────────────────────────────────────────────────

function staff(overrides: Partial<Staff> & { id: string; name: string; salary: number }): Staff {
  return {
    position: 'Enseignant',
    email: '',
    phone: '+223 70 00 00 00',
    bankDetails: '',
    emergencyContact: '',
    ...overrides,
  };
}

const fatou = (): Staff => staff({ id: 'st1', name: 'Fatou Traoré', salary: 120000 });
const moussa = (): Staff => staff({ id: 'st2', name: 'Moussa Camara', salary: 90000 });

const YEAR = '2026-2027';

interface Spies {
  alerts: string[];
  addStaffCalls: Array<Omit<Staff, 'id'>>;
  updateStaffCalls: Array<{ id: string; updates: Partial<Staff> }>;
  addSalaryCalls: Array<Omit<SalaryPayment, 'id'>>;
  toastCount: number;
}

interface DepsOverrides {
  staff?: Staff[];
  salaryPayments?: SalaryPayment[];
  selectedYear?: string;
  lockedYears?: string[];
}

function baseDeps(overrides: DepsOverrides = {}): {
  args: Parameters<typeof usePayroll>[0];
  spies: Spies;
} {
  const spies: Spies = { alerts: [], addStaffCalls: [], updateStaffCalls: [], addSalaryCalls: [], toastCount: 0 };
  const args = {
    t,
    lang: 'fr' as const,
    selectedYear: overrides.selectedYear ?? YEAR,
    lockedYears: overrides.lockedYears ?? [],
    staff: overrides.staff ?? [fatou(), moussa()],
    salaryPayments: overrides.salaryPayments ?? [],
    showToast: () => { spies.toastCount += 1; },
    addStaff: async (s: Omit<Staff, 'id'>) => {
      spies.addStaffCalls.push(s);
      return { ...s, id: `new-${spies.addStaffCalls.length}` };
    },
    updateStaff: async (id: string, updates: Partial<Staff>) => {
      spies.updateStaffCalls.push({ id, updates });
      return true;
    },
    addSalaryPayment: async (sp: Omit<SalaryPayment, 'id'>) => {
      spies.addSalaryCalls.push(sp);
      return { ...sp, id: `sp-${spies.addSalaryCalls.length}` };
    },
  };
  return { args: args as Parameters<typeof usePayroll>[0], spies };
}

async function mount(args: Parameters<typeof usePayroll>[0]): Promise<{
  ref: { current: ReturnType<typeof usePayroll> | null };
  root: { unmount: () => void };
}> {
  const ref: { current: ReturnType<typeof usePayroll> | null } = { current: null };
  const { unmount } = renderHook(usePayroll, args, ref);
  return { ref, root: { unmount } };
}

const submitEvent = { preventDefault: () => {} } as never;

describe('usePayroll.handleStaffSubmit', () => {
  it('blocks a locked academic year with an alert and no staff write', async () => {
    const { args, spies } = baseDeps({ lockedYears: [YEAR] });
    const restoreAlert = stubAlert(spies.alerts);
    const { ref, root } = await mount(args);
    try {
      await act(async () => {
        ref.current!.setShowStaffModal(true);
        ref.current!.setStaffForm({ name: 'New Guy', position: 'Gardien', salary: '50000', email: '', phone: '', bankDetails: '', emergencyContact: '' });
      });
      await act(async () => { await ref.current!.handleStaffSubmit(submitEvent); });

      assert.equal(spies.alerts[0], t.thisAcademicYearIsLocked);
      assert.equal(spies.addStaffCalls.length, 0, 'no staff created on a locked year');
      assert.equal(ref.current!.showStaffModal, true, 'modal left open');
      assert.equal(ref.current!.staffForm.name, 'New Guy', 'form untouched');
      assert.equal(spies.toastCount, 0);
    } finally {
      act(() => root.unmount());
      restoreAlert();
    }
  });

  it('silently ignores an invalid (NaN or negative) salary', async () => {
    for (const bad of ['abc', '-100']) {
      const { args, spies } = baseDeps({});
      const { ref, root } = await mount(args);
      try {
        await act(async () => {
          ref.current!.setStaffForm({ name: 'X', position: 'Y', salary: bad, email: '', phone: '', bankDetails: '', emergencyContact: '' });
        });
        await act(async () => { await ref.current!.handleStaffSubmit(submitEvent); });
        assert.equal(spies.addStaffCalls.length, 0, `no write for salary=${bad}`);
        assert.equal(spies.alerts.length, 0, 'silent early return');
      } finally {
        act(() => root.unmount());
      }
    }
  });

  it('creates staff with the parsed numeric salary, trimmed fields, resets and toasts', async () => {
    const { args, spies } = baseDeps({});
    const { ref, root } = await mount(args);
    try {
      await act(async () => {
        ref.current!.setStaffForm({ name: '  Awa Diop  ', position: 'Comptable', salary: '135000', email: ' awa@mamathera.org ', phone: ' 70 11 22 33 ', bankDetails: ' BOA ', emergencyContact: ' 76 55 44 33 ' });
      });
      await act(async () => { await ref.current!.handleStaffSubmit(submitEvent); });

      assert.equal(spies.addStaffCalls.length, 1);
      const created = spies.addStaffCalls[0];
      assert.equal(created.name, '  Awa Diop  ', 'name is passed through as typed');
      assert.equal(created.salary, 135000, 'salary parsed to a number');
      assert.equal(created.email, 'awa@mamathera.org', 'email trimmed');
      assert.equal(created.phone, '70 11 22 33', 'phone trimmed');
      assert.equal(created.bankDetails, 'BOA', 'bank details trimmed');
      assert.equal(created.emergencyContact, '76 55 44 33', 'emergency contact trimmed');
      assert.equal(ref.current!.showStaffModal, false, 'modal closed');
      assert.equal(ref.current!.staffForm.name, '', 'form reset');
      assert.equal(spies.toastCount, 1);
    } finally {
      act(() => root.unmount());
    }
  });

  it('edits an existing staff member through updateStaff when editing', async () => {
    const { args, spies } = baseDeps({});
    const { ref, root } = await mount(args);
    try {
      await act(async () => { ref.current!.openEditStaffModal(fatou()); });
      assert.equal(ref.current!.editingStaff?.id, 'st1');
      assert.equal(ref.current!.staffForm.salary, '120000', 'form refilled from the record');
      await act(async () => {
        ref.current!.setStaffForm({ ...ref.current!.staffForm, salary: '140000' });
      });
      await act(async () => { await ref.current!.handleStaffSubmit(submitEvent); });

      assert.equal(spies.updateStaffCalls.length, 1);
      assert.equal(spies.updateStaffCalls[0].id, 'st1');
      assert.equal(spies.updateStaffCalls[0].updates.salary, 140000);
      assert.equal(spies.addStaffCalls.length, 0, 'no new record created');
      assert.equal(ref.current!.editingStaff, null, 'editing state cleared');
    } finally {
      act(() => root.unmount());
    }
  });
});

describe('usePayroll.handleSalarySubmit', () => {
  it('blocks a locked academic year with an alert and no salary write', async () => {
    const { args, spies } = baseDeps({ lockedYears: [YEAR] });
    const restoreAlert = stubAlert(spies.alerts);
    const { ref, root } = await mount(args);
    try {
      await act(async () => {
        ref.current!.setShowSalaryModal(true);
        ref.current!.setSalaryForm({ staffId: 'st1', amount: '60000', date: '2026-09-25' });
      });
      await act(async () => { await ref.current!.handleSalarySubmit(submitEvent); });

      assert.equal(spies.alerts[0], t.thisAcademicYearIsLocked);
      assert.equal(spies.addSalaryCalls.length, 0, 'no salary payment on a locked year');
      assert.equal(ref.current!.showSalaryModal, true, 'modal left open');
    } finally {
      act(() => root.unmount());
      restoreAlert();
    }
  });

  it('silently ignores an invalid amount', async () => {
    const { args, spies } = baseDeps({});
    const { ref, root } = await mount(args);
    try {
      await act(async () => { ref.current!.setSalaryForm({ staffId: 'st1', amount: 'not-a-number', date: '2026-09-25' }); });
      await act(async () => { await ref.current!.handleSalarySubmit(submitEvent); });
      assert.equal(spies.addSalaryCalls.length, 0);
      assert.equal(spies.alerts.length, 0);
    } finally {
      act(() => root.unmount());
    }
  });

  it('records the salary payment stamped with the academic year, resets and closes', async () => {
    const { args, spies } = baseDeps({});
    const { ref, root } = await mount(args);
    try {
      await act(async () => {
        ref.current!.setSalaryForm({ staffId: 'st2', amount: '90000', date: '2026-09-25' });
      });
      await act(async () => { await ref.current!.handleSalarySubmit(submitEvent); });

      assert.equal(spies.addSalaryCalls.length, 1);
      const recorded = spies.addSalaryCalls[0];
      assert.equal(recorded.staffId, 'st2');
      assert.equal(recorded.amount, 90000);
      assert.equal(recorded.date, '2026-09-25');
      assert.equal(recorded.academicYear, YEAR, 'payment stamped with the selected year');
      assert.equal(ref.current!.showSalaryModal, false, 'modal closed');
      assert.equal(ref.current!.salaryForm.amount, '', 'form reset');
      assert.equal(spies.toastCount, 1);
    } finally {
      act(() => root.unmount());
    }
  });
});

describe('usePayroll.handleExportMonthlyPayrollExcel (bordereau XLSX)', () => {
  it('builds one row per staff member with paid/balance/status for the chosen month', async () => {
    const salaryPayments: SalaryPayment[] = [
      { id: 'p1', staffId: 'st1', amount: 120000, date: '2026-09-05' },
      { id: 'p2', staffId: 'st1', amount: 10000, date: '2026-09-20' },
      { id: 'p3', staffId: 'st2', amount: 30000, date: '2026-09-11' },
      { id: 'p4', staffId: 'st2', amount: 50000, date: '2026-08-30' }, // other month → excluded
      { id: 'p5', staffId: 'st2', amount: 60000, date: '2026-09-28' },
    ];
    const { args } = baseDeps({ salaryPayments });
    const { ref, root } = await mount(args);
    try {
      writeFileCalls.length = 0;
      lastSheetRows = [];
      await act(async () => { await ref.current!.handleExportMonthlyPayrollExcel(8, 2026); }); // Septembre

      assert.equal(writeFileCalls.length, 1, 'one workbook written');
      assert.match(writeFileCalls[0].fileName, /^MAMA_THERA_Bordereau_Paie_Septembre_2026\.xlsx$/);
      assert.equal(lastSheetName, 'Paie_Septembre');

      assert.equal(lastSheetRows.length, 2, 'one row per staff member');
      const [fatouRow, moussaRow] = lastSheetRows;

      // Fatou: 120000 + 10000 = 130000 paid of 120000 → balance 0, fully paid
      assert.equal(fatouRow[t.employeeName], 'Fatou Traoré');
      assert.equal(fatouRow[t.baseSalaryFcfa], 120000);
      assert.equal(fatouRow[t.paidThisMonthFcfa], 130000);
      assert.equal(fatouRow[t.remainingBalanceFcfa], 0, 'balance floored at 0');
      assert.equal(fatouRow[t.status], t.fullyPaid);
      assert.equal(fatouRow[t.lastPaymentDate], '2026-09-20', 'last matching payment date');

      // Moussa: 30000 + 60000 = 90000 paid of 90000 → fully paid (August's 50000 excluded)
      assert.equal(moussaRow[t.paidThisMonthFcfa], 90000);
      assert.equal(moussaRow[t.remainingBalanceFcfa], 0);
      assert.equal(moussaRow[t.status], t.fullyPaid);

      // Both stamped with the academic year
      assert.equal(fatouRow[t.academicYear2], YEAR);
      assert.equal(moussaRow[t.academicYear2], YEAR);
    } finally {
      act(() => root.unmount());
    }
  });

  it('exports a per-employee salary receipt PDF with the payment history', async () => {
    const salaryPayments: SalaryPayment[] = [
      { id: 'p1', staffId: 'st1', amount: 60000, date: '2026-09-05', academicYear: YEAR },
      { id: 'p2', staffId: 'st1', amount: 60000, date: '2026-09-20', academicYear: YEAR },
      { id: 'p3', staffId: 'st2', amount: 30000, date: '2026-09-11' }, // other employee → excluded
    ];
    const { args } = baseDeps({ salaryPayments });
    const { ref, root } = await mount(args);
    try {
      pdfSaveCalls.length = 0;
      pdfTextCalls.length = 0;
      await act(async () => { await ref.current!.handleExportStaffReceiptPdf(fatou()); });

      assert.equal(pdfSaveCalls.length, 1, 'one PDF saved');
      assert.match(pdfSaveCalls[0], /^Recu_Salaire_Fatou_Traor/, 'filename carries the employee name');
      assert.match(pdfSaveCalls[0], /\.pdf$/, 'filename ends with .pdf');
      assert.ok(pdfTextCalls.includes(t.consolidatedSalaryReceipt), 'the receipt title is drawn');
      assert.ok(pdfTextCalls.some(c => c.includes('Fatou Traoré')), 'the employee name is drawn');
      const frFormatted = (120000).toLocaleString('fr-FR') + ' FCFA';
      assert.ok(pdfTextCalls.some(c => c.includes(frFormatted)), 'the monthly salary is drawn');
      assert.ok(pdfTextCalls.some(c => c.includes(frFormatted)), 'the cumulative total is drawn');
      assert.ok(pdfTextCalls.includes('SAL-P1'), 'history row 1 drawn (receipt ref)');
      assert.ok(pdfTextCalls.includes('SAL-P2'), 'history row 2 drawn (receipt ref)');
      assert.ok(pdfTextCalls.includes('2026-09-05'), 'history row 1 date drawn');
      assert.ok(!pdfTextCalls.includes(t.noPaymentRecordsFound), 'history is not empty');
    } finally {
      act(() => root.unmount());
    }
  });

  it('marks staff with no payment as unpaid and partial payments as partial', async () => {
    const salaryPayments: SalaryPayment[] = [
      { id: 'p1', staffId: 'st2', amount: 40000, date: '2026-09-10' }, // half of 90000
    ];
    const { args } = baseDeps({ salaryPayments });
    const { ref, root } = await mount(args);
    try {
      writeFileCalls.length = 0;
      lastSheetRows = [];
      await act(async () => { await ref.current!.handleExportMonthlyPayrollExcel(8, 2026); });

      const [fatouRow, moussaRow] = lastSheetRows;
      assert.equal(fatouRow[t.paidThisMonthFcfa], 0);
      assert.equal(fatouRow[t.remainingBalanceFcfa], 120000);
      assert.equal(fatouRow[t.status], t.unpaid);
      assert.equal(fatouRow[t.lastPaymentDate], '—');
      assert.equal(moussaRow[t.paidThisMonthFcfa], 40000);
      assert.equal(moussaRow[t.remainingBalanceFcfa], 50000);
      assert.equal(moussaRow[t.status], t.partial2);
    } finally {
      act(() => root.unmount());
    }
  });
});

/**
 * happy-dom unit tests for the useExports domain hook.
 *
 * The `xlsx` module is mocked at the module level (node:test
 * --experimental-test-module-mocks) — the hook imports it dynamically inside
 * its handlers, so the fake captures every sheet/row/filename without ever
 * touching the real library:
 *   1. handleExport builds the late-payments sheet with the LOCALIZED
 *      headers and writes Late_Payments_Report.xlsx;
 *   2. handleExportAllData writes the four-sheet backup workbook
 *      (Students/Staff/Expenses/Salary Payments) with the computed
 *      scholarship-adjusted balance and toasts;
 *   3. handlePrint calls window.print.
 */
import { describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';
import { act } from 'react';
import { translations } from '../src/i18n/translations';
import type { TranslationDict } from '../src/i18n/translations';
import type { Student, Staff, Expense, SalaryPayment } from '../src/app/types';
import { installDomGlobals, renderHook } from './harness';

// ── module mock: xlsx (registered BEFORE importing the hook) ────────────────
interface SheetCapture { name: string; rows: Record<string, unknown>[]; }
const workbookCalls: { filename: string; sheets: SheetCapture[] }[] = [];

mock.module('xlsx', {
  namedExports: {
    utils: {
      json_to_sheet: (rows: Record<string, unknown>[]) => rows,
      book_new: () => ({ sheets: [] as SheetCapture[] }),
      book_append_sheet: (wb: { sheets: SheetCapture[] }, ws: Record<string, unknown>[], name: string) => {
        wb.sheets.push({ name, rows: ws });
      },
    },
    writeFile: (wb: { sheets: SheetCapture[] }, filename: string) => {
      workbookCalls.push({ filename, sheets: wb.sheets });
    },
  },
});

const { useExports } = await import('../src/app/useExports');

const t = translations.fr as TranslationDict;

const win = installDomGlobals();
let printCalls = 0;
(win as unknown as { print: () => void }).print = () => { printCalls++; };

const student = (overrides: Partial<Student>): Student => ({
  id: 's1', name: 'Ali Diallo', parentName: 'M. Diallo', parentEmail: 'p@x.com', parentPhone: '+223',
  totalDue: 150000, amountPaid: 50000, dueDate: '2026-08-30', payments: [], notes: '', academicYear: '2026-2027',
  ...overrides,
});

const staff: Staff[] = [{ id: 'st1', name: 'Awa', position: 'Enseignante', salary: 75000, email: '', phone: '', bankDetails: '', emergencyContact: '' }];
const expenses: Expense[] = [{ id: 'e1', category: 'eau', description: '', amount: 3000, date: '2026-09-01', academicYear: '2026-2027' }];
const salaryPayments: SalaryPayment[] = [{ id: 'sp1', staffId: 'st1', amount: 75000, date: '2026-09-25', academicYear: '2026-2027' }];

function render(lateStudents: Student[] = [], students: Student[] = []) {
  const showToasts: string[] = [];
  const { api, unmount } = renderHook(useExports, {
    t, lateStudents, students, staff, expenses, salaryPayments,
    showToast: () => { showToasts.push('toast'); },
  });
  return { api, unmount, showToasts };
}

describe('useExports', () => {
  it('exports the late-payments report with localized headers', async () => {
    const late = [student({ id: 'late1', name: 'Binta Fall', totalDue: 80000, amountPaid: 10000 })];
    const { api, unmount } = render(late);
    workbookCalls.length = 0;
    await api.current!.handleExport();

    assert.equal(workbookCalls.length, 1);
    const call = workbookCalls[0];
    assert.equal(call.filename, 'Late_Payments_Report.xlsx');
    assert.equal(call.sheets.length, 1);
    assert.equal(call.sheets[0].name, 'Late Payments');
    assert.deepEqual(call.sheets[0].rows, [{
      [t.studentName]: 'Binta Fall',
      [t.parentName]: 'M. Diallo',
      [t.parentEmail]: 'p@x.com',
      [t.parentPhone]: '+223',
      [t.totalDue]: 80000,
      [t.balance]: 70000,
      'Due Date': '2026-08-30',
    }]);
    act(() => unmount());
  });

  it('exports the full backup workbook with the discounted balance and toasts', async () => {
    const students = [
      student({ id: 'a', name: 'Ali Diallo', totalDue: 100000, scholarshipDiscount: 50, amountPaid: 10000 }),
      student({ id: 'b', name: 'Omar Sy', totalDue: 60000, amountPaid: 60000 }),
    ];
    const { api, unmount, showToasts } = render([], students);
    workbookCalls.length = 0;
    await api.current!.handleExportAllData();

    assert.equal(workbookCalls.length, 1);
    const call = workbookCalls[0];
    assert.equal(call.filename, 'School_Data_Backup.xlsx');
    assert.deepEqual(call.sheets.map((s) => s.name), ['Students', 'Staff', 'Expenses', 'Salary Payments']);

    const studentsSheet = call.sheets[0];
    assert.equal(studentsSheet.rows.length, 2);
    assert.equal(studentsSheet.rows[0]['Balance'], (100000 * 0.5) - 10000, 'scholarship-adjusted balance');
    assert.equal(studentsSheet.rows[1]['Balance'], 0);

    assert.equal(call.sheets[1].rows.length, 1);
    assert.equal(call.sheets[2].rows.length, 1);
    assert.equal(call.sheets[3].rows.length, 1);
    assert.deepEqual(showToasts, ['toast']);
    act(() => unmount());
  });

  it('prints through window.print', () => {
    const { api, unmount } = render();
    printCalls = 0;
    api.current!.handlePrint();
    assert.equal(printCalls, 1);
    act(() => unmount());
  });
});
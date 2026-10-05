// ─────────────────────────────────────────────────────────────────────────────
// tests/hook-clock-windows.test.tsx — usePayroll / useExpenses / useStudents
// suivent une horloge INJECTÉE (`now`) au lieu de l'horloge murale.
//
// Chacun de ces hooks calculait sa fenêtre mensuelle et ses défauts de date avec
// `new Date()`. Un test ne pouvait donc pas épandre « nous sommes en septembre
// 2031 » : le résultat suivait le calendrier de la machine. Le repère injecté est
// volontairement décalé de l'année réelle (2031) pour qu'une lecture d'horloge
// murale se voie immédiatement.
//
// On vérifie :
//   • usePayroll  — mois/année du brouillon de paie + jour par défaut du salaire ;
//   • useExpenses — mois affiché du calendrier + jours par défaut des formulaires ;
//   • useStudents — jours par défaut du formulaire élève (échéance / inscription).
// ─────────────────────────────────────────────────────────────────────────────
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { translations } from '../src/i18n/translations';
import type { TranslationDict } from '../src/i18n/translations';
import type { User, Staff, SalaryPayment, Expense, VendorExpense, Student } from '../src/app/types';
import { usePayroll } from '../src/app/usePayroll';
import { useExpenses } from '../src/app/useExpenses';
import { useStudents } from '../src/app/useStudents';
import { installDomGlobals, renderHook } from './harness';

const t = translations.fr as TranslationDict;

installDomGlobals();

// Le repère pinné : 2 septembre 2031. La fenêtre mensuelle doit être septembre
// 2031, et le jour par défaut 2031-09-02 — jamais l'année de la machine.
const PINNED = new Date(2031, 8, 2);
const clock = () => PINNED;

const promoter: User = { username: 'ibrahim', name: 'Ibrahim', role: 'admin' };

const noop = () => {};
const asyncNull = async () => null;
const asyncTrue = async () => true;

describe('horloge injectée — fenêtres mensuelles des hooks', () => {
  it('usePayroll : le brouillon et le formulaire suivent l’horloge injectée', () => {
    const staff: Staff[] = [
      { id: 's1', name: 'Alice', position: 'teacher', salary: 100000, email: '', phone: '', bankDetails: '', emergencyContact: '' },
    ];
    const ref: { current: ReturnType<typeof usePayroll> | null } = { current: null };
    const root = renderHook(
      usePayroll,
      {
        t,
        lang: 'fr',
        selectedYear: '2031-2032',
        lockedYears: [],
        staff,
        salaryPayments: [] as SalaryPayment[],
        showToast: noop,
        toastError: noop,
        addStaff: asyncNull as never,
        updateStaff: asyncTrue,
        addSalaryPayment: asyncNull as never,
        schoolLogo: null,
        now: clock,
      },
      ref,
    );
    try {
      const api = ref.current!;
      assert.equal(api.selectedDraftMonth, 8, 'mois du brouillon = septembre (injecté)');
      assert.equal(api.selectedDraftYear, 2031, 'année du brouillon = 2031 (injectée)');
      assert.equal(api.salaryForm.date, '2031-09-02', 'jour par défaut du salaire = celui de l’horloge injectée');
    } finally {
      root.unmount();
    }
  });

  it('useExpenses : le calendrier et les formulaires suivent l’horloge injectée', () => {
    const ref: { current: ReturnType<typeof useExpenses> | null } = { current: null };
    const root = renderHook(
      useExpenses,
      {
        t,
        lang: 'fr',
        selectedYear: '2031-2032',
        lockedYears: [],
        isPromoter: true,
        isGeneralManager: false,
        currentUser: promoter,
        addExpense: asyncNull as never as (e: Omit<Expense, 'id'>) => Promise<Expense | null>,
        deleteExpense: asyncTrue,
        addVendorExpense: asyncNull as never as (v: Omit<VendorExpense, 'id'>) => Promise<VendorExpense | null>,
        updateVendorExpense: asyncTrue,
        deleteVendorExpense: asyncTrue,
        showToast: noop,
        toastError: noop,
        now: clock,
      },
      ref,
    );
    try {
      const api = ref.current!;
      assert.equal(api.calendarDate.getFullYear(), 2031, 'année du calendrier = injectée');
      assert.equal(api.calendarDate.getMonth(), 8, 'mois du calendrier = septembre (injecté)');
      assert.equal(api.calendarDate.getDate(), 2, 'jour du calendrier = injecté');
      assert.equal(api.expenseForm.date, '2031-09-02', 'jour par défaut de la dépense');
      assert.equal(api.vendorExpenseForm.dueDate, '2031-09-02', 'échéance par défaut de la charge fournisseur');
    } finally {
      root.unmount();
    }
  });

  it('useStudents : les défauts du formulaire élève suivent l’horloge injectée', () => {
    const ref: { current: ReturnType<typeof useStudents> | null } = { current: null };
    const root = renderHook(
      useStudents,
      {
        t,
        lang: 'fr',
        today: '2031-09-02',
        selectedYear: '2031-2032',
        lockedYears: [],
        isPromoter: true,
        isGeneralManager: false,
        students: [] as Student[],
        addStudent: asyncNull as never,
        updateStudent: asyncTrue,
        showToast: noop,
        toastError: noop,
        now: clock,
      },
      ref,
    );
    try {
      const api = ref.current!;
      assert.equal(api.studentForm.dueDate, '2031-09-02', 'échéance par défaut = jour de l’horloge injectée');
      assert.equal(api.studentForm.enrollmentDate, '2031-09-02', 'inscription par défaut = jour de l’horloge injectée');
    } finally {
      root.unmount();
    }
  });
});

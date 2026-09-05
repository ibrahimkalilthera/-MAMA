/**
 * Expenses/vendors domain hook — extracted verbatim from App.tsx.
 *
 * Owns the expense & vendor-expense management: the modal open flags
 * (`showExpenseModal`, `showVendorExpenseModal`, `vendorExpensesTab`), the
 * list filters (`generalExpenseCategoryFilter`, `generalExpenseSearch`,
 * `vendorSearch`, `vendorCategoryFilter`, `vendorStatusFilter`), the calendar
 * state (`calendarDate`, `showCalendarModal` + the month/day helpers), the
 * forms (`expenseForm`, `vendorExpenseForm` typed against the existing
 * `VendorExpenseForm`, `editingVendorExpense`), the late-payment ticket
 * (`ticketStudent`), the localized `expenseCategoryList` memo and the four
 * handlers (`handleExpenseSubmit`, `handleVendorExpenseSubmit`,
 * `handleEditVendorExpense`, `handleDeleteVendorExpense`) — lock checks,
 * promoter role gates, social-case aid fields, toast feedback.
 *
 * Call-site note: the hook takes `currentUser` (for the delete role check)
 * and `showToast` as deps, so App.tsx calls it after those are declared.
 */
import { useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import type { User, Student, VendorExpense, Expense } from './types';
import type { VendorExpenseForm, ExpenseForm } from './mainViewsProps';
import type { TranslationDict } from '../i18n/translations';
import { canManageUsers, canWriteFinance } from '../lib/permissions';
import { getCalendarDays } from '../lib/classes';
import { getMonthName as getMonthNameImpl, getDayName as getDayNameImpl } from '../lib/formatters';

export interface UseExpensesDeps {
  t: TranslationDict;
  lang: 'en' | 'fr';
  selectedYear: string;
  lockedYears: string[];
  /** Who is acting — finance powers are derived from the role. */
  currentUser: User | null;
  addExpense: (exp: Omit<Expense, 'id'>) => Promise<Expense | null>;
  addVendorExpense: (ve: Omit<VendorExpense, 'id'>) => Promise<VendorExpense | null>;
  updateVendorExpense: (id: string, updates: Partial<VendorExpense>) => Promise<boolean>;
  deleteVendorExpense: (id: string) => Promise<boolean>;
  showToast: () => void;
  /** Toast an error/validation message (replaces the native alert()). */
  toastError: (message: string) => void;
}

const emptyExpenseForm = (): ExpenseForm => ({
  category: 'Other',
  description: '',
  amount: '',
  date: new Date().toISOString().split('T')[0],
});

const emptyVendorExpenseForm = (): VendorExpenseForm => ({
  vendorName: '',
  category: 'stationery',
  amount: '',
  dueDate: new Date().toISOString().split('T')[0],
  paymentStatus: 'unpaid',
  amountPaid: '',
  description: '',
  aidType: '',
  beneficiaryStudentName: '',
  beneficiaryStudentGrade: '',
});

export function useExpenses(deps: UseExpensesDeps) {  const { t, lang, selectedYear, lockedYears, currentUser, addExpense, addVendorExpense, updateVendorExpense, deleteVendorExpense, showToast, toastError
  } = deps;
  // Finance-admin writes (vendor create/delete) belong to the finance-manager
  // roles; only the account-owner pair (admin/dev — the "promoter" fields)
  // may overwrite vendor name/amount on existing records.
  const role = currentUser?.role ?? null;
  const isPromoter = canManageUsers(role);

  const [showExpenseModal, setShowExpenseModal] = useState(false);
  const [showVendorExpenseModal, setShowVendorExpenseModal] = useState(false);
  const [vendorExpensesTab, setVendorExpensesTab] = useState<'general' | 'vendors'>('general');
  const [generalExpenseCategoryFilter, setGeneralExpenseCategoryFilter] = useState<string>('all');
  const [generalExpenseSearch, setGeneralExpenseSearch] = useState<string>('');
  const [vendorSearch, setVendorSearch] = useState('');
  const [vendorCategoryFilter, setVendorCategoryFilter] = useState<string>('all');
  const [vendorStatusFilter, setVendorStatusFilter] = useState<string>('all');

  const [calendarDate, setCalendarDate] = useState(new Date());
  const [showCalendarModal, setShowCalendarModal] = useState(false);
  const [expenseForm, setExpenseForm] = useState<ExpenseForm>(emptyExpenseForm);
  const [vendorExpenseForm, setVendorExpenseForm] = useState<VendorExpenseForm>(emptyVendorExpenseForm);

  const [editingVendorExpense, setEditingVendorExpense] = useState<VendorExpense | null>(null);

  const [ticketStudent, setTicketStudent] = useState<Student | null>(null);

  const expenseCategoryList = useMemo(() => {
    const keys = [
      'insurance',
      'social_cases',
      'exam_bac',
      'exam_def',
      'electricity',
      'water',
      'social_events',
      'internet',
      'stationery',
      'security_maintenance',
      'machine_management',
      'taxes',
      'furniture',
      'solar_energy',
      'reforestation',
      'catering',
      'works_renovation',
      'training'
    ];
    return keys
      .map(key => ({ key, label: (t as Record<string, string>)[key] || key }))
      .sort((a, b) => a.label.localeCompare(b.label, lang === 'en' ? 'en' : 'fr', { sensitivity: 'base' }));
  }, [t, lang]);

  const handleExpenseSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (lockedYears.includes(selectedYear)) {
      toastError(t.thisAcademicYearIsLocked);
      return;
    }
    const amount = parseFloat(expenseForm.amount);
    if (isNaN(amount) || amount < 0) return;

    const saved = await addExpense({ ...expenseForm, amount, academicYear: selectedYear });
    if (!saved) return;
    setShowExpenseModal(false);
    setExpenseForm(emptyExpenseForm());
    showToast();
  };

  const handleVendorExpenseSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!editingVendorExpense && !canWriteFinance(role)) {
      toastError(t.onlyThePromoterCanCreateAVendorExpense);
      return;
    }
    if (lockedYears.includes(selectedYear)) {
      toastError(t.thisAcademicYearIsLocked);
      return;
    }
    const parsedAmount = parseFloat(vendorExpenseForm.amount);
    const amountPaid = parseFloat(vendorExpenseForm.amountPaid) || 0;
    const amount = isPromoter ? parsedAmount : (editingVendorExpense?.amount ?? parsedAmount);
    if (isNaN(amount) || amount < 0) return;

    const vendorData = {
      vendorName: isPromoter ? vendorExpenseForm.vendorName.trim() : (editingVendorExpense?.vendorName || vendorExpenseForm.vendorName.trim()),
      category: vendorExpenseForm.category,
      amount,
      dueDate: vendorExpenseForm.dueDate,
      paymentStatus: vendorExpenseForm.paymentStatus as VendorExpense['paymentStatus'],
      amountPaid: vendorExpenseForm.paymentStatus === 'paid' ? amount : (vendorExpenseForm.paymentStatus === 'unpaid' ? 0 : amountPaid),
      description: vendorExpenseForm.description.trim(),
      academicYear: selectedYear,
      aidType: vendorExpenseForm.category === 'social_cases' ? (vendorExpenseForm.aidType as VendorExpense['aidType']) : undefined,
      beneficiaryStudentName: vendorExpenseForm.category === 'social_cases' ? vendorExpenseForm.beneficiaryStudentName : undefined,
      beneficiaryStudentGrade: vendorExpenseForm.category === 'social_cases' ? vendorExpenseForm.beneficiaryStudentGrade : undefined,
    };

    const saved = editingVendorExpense
      ? await updateVendorExpense(editingVendorExpense.id, vendorData)
      : await addVendorExpense(vendorData);
    if (!saved) return;

    if (editingVendorExpense) {
      setEditingVendorExpense(null);
    }

    setShowVendorExpenseModal(false);
    setVendorExpenseForm(emptyVendorExpenseForm());
    showToast();
  };

  const handleEditVendorExpense = (v: VendorExpense) => {
    setEditingVendorExpense(v);
    setVendorExpenseForm({
      vendorName: v.vendorName,
      category: v.category,
      amount: String(v.amount),
      dueDate: v.dueDate,
      paymentStatus: v.paymentStatus,
      amountPaid: String(v.amountPaid),
      description: v.description || '',
      aidType: v.aidType || '',
      beneficiaryStudentName: v.beneficiaryStudentName || '',
      beneficiaryStudentGrade: v.beneficiaryStudentGrade || ''
    });
    setShowVendorExpenseModal(true);
  };

  const handleDeleteVendorExpense = async (id: string) => {
    if (lockedYears.includes(selectedYear)) {
      toastError(t.thisAcademicYearIsLocked);
      return;
    }
    if (!canWriteFinance(role)) {
      toastError(t.onlyThePromoterCanDeleteExpenses);
      return;
    }
    if (await deleteVendorExpense(id)) showToast();
  };

  const getDaysInMonth = (date: Date) => getCalendarDays(date);

  const changeMonth = (offset: number) => {
    const newDate = new Date(calendarDate);
    newDate.setMonth(newDate.getMonth() + offset);
    setCalendarDate(newDate);
  };

  const getMonthName = (monthIndex: number) => getMonthNameImpl(monthIndex, t);

  const getDayName = (dayIndex: number) => getDayNameImpl(dayIndex, t);

  return {
    showExpenseModal, setShowExpenseModal,
    showVendorExpenseModal, setShowVendorExpenseModal,
    vendorExpensesTab, setVendorExpensesTab,
    generalExpenseCategoryFilter, setGeneralExpenseCategoryFilter,
    generalExpenseSearch, setGeneralExpenseSearch,
    vendorSearch, setVendorSearch,
    vendorCategoryFilter, setVendorCategoryFilter,
    vendorStatusFilter, setVendorStatusFilter,
    calendarDate, setCalendarDate,
    showCalendarModal, setShowCalendarModal,
    expenseForm, setExpenseForm,
    vendorExpenseForm, setVendorExpenseForm,
    editingVendorExpense, setEditingVendorExpense,
    ticketStudent, setTicketStudent,
    expenseCategoryList,
    handleExpenseSubmit,
    handleVendorExpenseSubmit,
    handleEditVendorExpense,
    handleDeleteVendorExpense,
    getDaysInMonth,
    changeMonth,
    getMonthName,
    getDayName,
  };
}

/**
 * Year-operations hook — extracted verbatim from App.tsx.
 *
 * Owns `handleCloseCurrentYear` (the year-closure flow: role + lock checks,
 * carry-over of positive balances into the next year — grouped by student
 * name, then the lock/year-list/audit-modal updates) and `getYearStats` (the
 * revenue/expenses/balance derivation for a given year, fed to the archives
 * view). Pure logic with all deps injected, following the same convention as
 * the other domain hooks.
 */
import type { Dispatch, SetStateAction } from 'react';
import type { User, Student, Expense, VendorExpense, SalaryPayment } from './types';
import type { TranslationDict } from '../i18n/translations';

export interface UseYearOpsDeps {
  t: TranslationDict;
  currentUser: User | null;
  students: Student[];
  expenses: Expense[];
  vendorExpenses: VendorExpense[];
  salaryPayments: SalaryPayment[];
  updateStudent: (id: string, updates: Partial<Student>) => Promise<boolean>;
  addStudent: (s: Omit<Student, 'id' | 'payments'>) => Promise<Student | null>;
  selectedYear: string;
  lockedYears: string[];
  setLockedYears: Dispatch<SetStateAction<string[]>>;
  setAcademicYears: Dispatch<SetStateAction<string[]>>;
  setAuditYear: Dispatch<SetStateAction<string | null>>;
  setShowAuditModal: Dispatch<SetStateAction<boolean>>;
  showToast: () => void;
  /** Toast an error/validation message (replaces the native alert()). */
  toastError: (message: string) => void;
}

export function useYearOps(deps: UseYearOpsDeps) {
  const { t, currentUser, students, expenses, vendorExpenses, salaryPayments, updateStudent, addStudent, selectedYear, lockedYears, setLockedYears, setAcademicYears, setAuditYear, setShowAuditModal, showToast, toastError } = deps;

  const getYearStats = (year: string) => {
    const filteredStudents = students.filter(s => s.academicYear === year || (!s.academicYear && year === '2024-2025'));
    const filteredExpenses = expenses.filter(e => e.academicYear === year || (!e.academicYear && year === '2024-2025'));
    const filteredVendorExpenses = vendorExpenses.filter(v => v.academicYear === year || (!v.academicYear && year === '2024-2025'));
    const filteredSalaryPayments = salaryPayments.filter(s => s.academicYear === year || (!s.academicYear && year === '2024-2025'));

    const totalRevenue = filteredStudents.reduce((acc, s) => acc + s.amountPaid, 0);

    const totalVendorExpensesPaid = filteredVendorExpenses.reduce((acc, v) => {
      if (v.paymentStatus === 'paid') {
        return acc + v.amount;
      } else if (v.paymentStatus === 'partial') {
        return acc + (v.amountPaid || 0);
      }
      return acc;
    }, 0);

    const totalExpenses = filteredExpenses.reduce((acc, e) => acc + e.amount, 0) + 
                          filteredSalaryPayments.reduce((acc, s) => acc + s.amount, 0) +
                          totalVendorExpensesPaid;

    const balance = totalRevenue - totalExpenses;

    return {
      revenue: totalRevenue,
      expenses: totalExpenses,
      balance
    };
  };

  const handleCloseCurrentYear = async () => {
    if (currentUser?.role !== 'admin' && currentUser?.role !== 'dev') {
      toastError(t.onlyPromoterOwnerCanCloseAcademicYears);
      return;
    }
    if (lockedYears.includes(selectedYear)) {
      toastError(t.thisAcademicYearIsAlreadyLocked);
      return;
    }

    const parts = selectedYear.split('-');
    let nextYear = '';
    if (parts.length === 2) {
      const y1 = parseInt(parts[0], 10);
      const y2 = parseInt(parts[1], 10);
      if (!isNaN(y1) && !isNaN(y2)) {
        nextYear = `${y1 + 1}-${y2 + 1}`;
      }
    }
    if (!nextYear) {
      nextYear = '2025-2026';
    }

    const currentYearStudents = students.filter(s => s.academicYear === selectedYear || (!s.academicYear && selectedYear === '2024-2025'));
    const ops: Promise<boolean>[] = [];

    // Group carry-over balances by next-year student name so that multiple
    // current-year students sharing a name accumulate into a single next-year
    // student (matching the previous local-state behaviour).
    const carryOverByName = new Map<string, number>();
    const firstByName = new Map<string, Student>();
    currentYearStudents.forEach(student => {
      const discount = student.scholarshipDiscount || 0;
      const discountedTotal = student.totalDue * (1 - discount / 100);
      const balance = discountedTotal - student.amountPaid;

      if (balance <= 0) return;

      carryOverByName.set(student.name, (carryOverByName.get(student.name) || 0) + balance);
      if (!firstByName.has(student.name)) {
        firstByName.set(student.name, student);
      }
    });

    carryOverByName.forEach((balance, name) => {
      const existing = students.find(s => s.name === name && s.academicYear === nextYear);
      if (existing) {
        const note = existing.notes
          ? `${existing.notes}\nCarryover debt from ${selectedYear}: +${balance} CFA`
          : `Carryover debt from ${selectedYear}: +${balance} CFA`;
        ops.push(updateStudent(existing.id, { totalDue: existing.totalDue + balance, notes: note }));
      } else {
        const student = firstByName.get(name)!;
        ops.push(addStudent({
          name: student.name,
          parentName: student.parentName,
          parentEmail: student.parentEmail,
          parentPhone: student.parentPhone,
          totalDue: balance,
          scholarshipDiscount: 0,
          dueDate: student.dueDate,
          amountPaid: 0,
          notes: `Opening Balance (Debt carried over from ${selectedYear}): ${balance} CFA`,
          academicYear: nextYear,
          grade: student.grade || '',
          status: 'Active',
        }).then(r => r !== null));
      }
    });

    const results = await Promise.all(ops);
    if (results.some(ok => !ok)) {
      toastError(t.someCarryOverBalancesCouldNotBeSaved);
      return;
    }

    setLockedYears(prev => [...prev, selectedYear]);

    setAcademicYears(prev => {
      if (!prev.includes(nextYear)) {
        return [...prev, nextYear];
      }
      return prev;
    });

    setAuditYear(selectedYear);
    setShowAuditModal(true);
    showToast();
  };

  return {
    handleCloseCurrentYear,
    getYearStats,
  };
}

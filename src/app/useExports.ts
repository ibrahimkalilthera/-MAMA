/**
 * Exports domain hook — extracted verbatim from App.tsx.
 *
 * Owns the three local export/print handlers: `handleExport` (late-payments
 * XLSX report), `handleExportAllData` (full school-data backup workbook) and
 * `handlePrint` (window.print for the current view). The other export entry
 * points (parent-ledger PDF, monthly payroll bordereau, payment receipt PDF)
 * come from their own domain hooks/libs and stay passthroughs in App.tsx.
 *
 * Call-site note: the hook takes `showToast` (defined in App) as a dep, so
 * App.tsx calls it right after that definition.
 */
import type { Student, Staff, Expense, SalaryPayment } from './types';
import type { TranslationDict } from '../i18n/translations';

export interface UseExportsDeps {
  t: TranslationDict;
  lateStudents: Student[];
  students: Student[];
  staff: Staff[];
  expenses: Expense[];
  salaryPayments: SalaryPayment[];
  showToast: () => void;
}

export function useExports(deps: UseExportsDeps) {
  const { t, lateStudents, students, staff, expenses, salaryPayments, showToast } = deps;

  const handleExport = async () => {
    const XLSX = await import('xlsx');
    const data = lateStudents.map(s => ({
      [t.studentName]: s.name,
      [t.parentName]: s.parentName,
      [t.parentEmail]: s.parentEmail,
      [t.parentPhone]: s.parentPhone,
      [t.totalDue]: s.totalDue,
      [t.balance]: s.totalDue - s.amountPaid,
      'Due Date': s.dueDate
    }));

    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Late Payments");
    XLSX.writeFile(wb, "Late_Payments_Report.xlsx");
  };

  const handleExportAllData = async () => {
    const XLSX = await import('xlsx');
    const wb = XLSX.utils.book_new();
    
    // Students
    const studentData = students.map(s => ({
      ID: s.id,
      Name: s.name,
      Parent: s.parentName,
      Email: s.parentEmail,
      Phone: s.parentPhone,
      'Total Due': s.totalDue,
      'Scholarship %': s.scholarshipDiscount || 0,
      'Amount Paid': s.amountPaid,
      'Balance': (s.totalDue * (1 - (s.scholarshipDiscount || 0) / 100)) - s.amountPaid,
      'Due Date': s.dueDate,
      'Academic Year': s.academicYear || 'N/A'
    }));
    const wsStudents = XLSX.utils.json_to_sheet(studentData);
    XLSX.utils.book_append_sheet(wb, wsStudents, "Students");

    // Staff
    const staffData = staff.map(s => ({
      ID: s.id,
      Name: s.name,
      Position: s.position,
      Salary: s.salary,
      Email: s.email,
      Phone: s.phone,
      'Academic Year': s.academicYear || 'N/A'
    }));
    const wsStaff = XLSX.utils.json_to_sheet(staffData);
    XLSX.utils.book_append_sheet(wb, wsStaff, "Staff");

    // Expenses
    const expenseData = expenses.map(e => ({
      ID: e.id,
      Category: e.category,
      Description: e.description,
      Amount: e.amount,
      Date: e.date,
      'Academic Year': e.academicYear || 'N/A'
    }));
    const wsExpenses = XLSX.utils.json_to_sheet(expenseData);
    XLSX.utils.book_append_sheet(wb, wsExpenses, "Expenses");

    // Salary Payments
    const salaryData = salaryPayments.map(p => ({
      ID: p.id,
      'Staff ID': p.staffId,
      Amount: p.amount,
      Date: p.date,
      'Academic Year': p.academicYear || 'N/A'
    }));
    const wsSalary = XLSX.utils.json_to_sheet(salaryData);
    XLSX.utils.book_append_sheet(wb, wsSalary, "Salary Payments");

    XLSX.writeFile(wb, "School_Data_Backup.xlsx");
    showToast();
  };

  const handlePrint = () => {
    window.print();
  };

  return {
    handleExport,
    handleExportAllData,
    handlePrint,
  };
}

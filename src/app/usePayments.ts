/**
 * Payments/students domain hook — extracted verbatim from App.tsx.
 *
 * Owns the payment-entry domain: the payment form state (open flag,
 * student/amount/date), the day-payment-history modal state
 * (`selectedCalendarDay`), the submit handler with the auto-generated PDF
 * receipt (`generatePaymentReceiptPdf`) and the calendar event derivation
 * (`getEventsForDay`) that feeds the day modal. App.tsx only consumes the
 * returned API — the props contracts passed down to MainViews/AppModals are
 * unchanged (guards verify the wiring).
 *
 * Call-site note: the hook takes students/staff/expenses/selectedYear/
 * currentUser and the `addPayment` mutator as arguments, so App.tsx must
 * call it after those are declared.
 */
import { useState } from 'react';
import type { FormEvent } from 'react';
import { generatePaymentReceiptPdf } from '../lib/pdfReceipt';
import type { Student, Staff, Expense, Payment, User } from '../app/types';
import type { TranslationDict } from '../i18n/translations';
import type { CalendarEvent } from './mainViewsProps';

interface UsePaymentsDeps {
  t: TranslationDict;
  lang: 'en' | 'fr';
  selectedYear: string;
  lockedYears: string[];
  students: Student[];
  staff: Staff[];
  expenses: Expense[];
  currentUser: User | null;
  addPayment: (studentId: string, payment: Omit<Payment, 'receiptNumber'> & { receiptNumber?: string }) => Promise<boolean>;
}

export function usePayments(deps: UsePaymentsDeps) {
  const { t, lang, selectedYear, lockedYears, students, staff, expenses, currentUser, addPayment } = deps;

  const [showPaymentForm, setShowPaymentForm] = useState(false);
  const [selectedCalendarDay, setSelectedCalendarDay] = useState<Date | null>(null);
  const [paymentStudentId, setPaymentStudentId] = useState('');
  const [paymentAmount, setPaymentAmount] = useState('');
  const [paymentDate, setPaymentDate] = useState(new Date().toISOString().split('T')[0]);

  const handlePaymentSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (lockedYears.includes(selectedYear)) {
      alert(t.thisAcademicYearIsLocked);
      return;
    }
    if (!paymentStudentId || !paymentAmount) return;

    const amount = parseFloat(paymentAmount);
    const targetStudent = students.find(s => s.id === paymentStudentId);
    const receiptNo = `REC-${Date.now().toString().slice(-6)}`;

    const newPayment = {
      date: paymentDate,
      amount,
      academicYear: targetStudent?.academicYear || selectedYear,
      receiptNumber: receiptNo,
    };

    await addPayment(paymentStudentId, newPayment);

    // Auto-generate printable PDF receipt
    if (targetStudent) {
      try {
        await generatePaymentReceiptPdf({
          student: {
            ...targetStudent,
            amountPaid: targetStudent.amountPaid + amount,
          },
          payment: newPayment,
          lang,
          cashierName: currentUser?.name || 'Administration',
        });
      } catch (pdfErr) {
        console.error('PDF receipt generation error:', pdfErr);
      }
    }

    setPaymentStudentId('');
    setPaymentAmount('');
    setShowPaymentForm(false);
  };

  const getEventsForDay = (date: Date): CalendarEvent[] => {
    const dateStr = date.toISOString().split('T')[0];
    const dayEvents: CalendarEvent[] = [];

    // Student Due Dates
    const dueStudents = students.filter(s => s.dueDate === dateStr);
    if (dueStudents.length > 0) {
      dayEvents.push({
        type: 'due',
        count: dueStudents.length,
        label: `${dueStudents.length} ${t.navStudents} ${t.totalOutstanding}`,
        details: dueStudents.map(s => ({ name: s.name, amount: s.totalDue - s.amountPaid }))
      });
    }

    // Salary Dates (Assuming 25th of each month if not specified, or use a fixed date for demo)
    // For this app, let's say staff are paid on the 25th
    if (date.getDate() === 25) {
      dayEvents.push({
        type: 'salary',
        count: staff.length,
        label: `${staff.length} ${t.navPayroll}`,
        details: staff.map(s => ({ name: s.name, amount: s.salary }))
      });
    }

    // Expenses
    const dayExpenses = expenses.filter(e => e.date === dateStr);
    if (dayExpenses.length > 0) {
      dayEvents.push({
        type: 'expense',
        count: dayExpenses.length,
        label: `${dayExpenses.length} ${t.navExpenses}`,
        details: dayExpenses.map(e => ({ name: e.description || e.category, amount: e.amount }))
      });
    }

    return dayEvents;
  };

  return {
    showPaymentForm, setShowPaymentForm,
    selectedCalendarDay, setSelectedCalendarDay,
    paymentStudentId, setPaymentStudentId,
    paymentAmount, setPaymentAmount,
    paymentDate, setPaymentDate,
    handlePaymentSubmit,
    getEventsForDay,
  };
}
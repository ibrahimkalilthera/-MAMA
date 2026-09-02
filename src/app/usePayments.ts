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
import type { Student, StudentNoteEntry, Staff, Expense, Payment, User } from '../app/types';
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
  /** Calendar ⇄ Notes bridge: persist a dated note on the student record. */
  updateStudent: (id: string, updates: Partial<Student>) => Promise<boolean>;
}

export function usePayments(deps: UsePaymentsDeps) {
  const { t, lang, selectedYear, lockedYears, students, staff, expenses, currentUser, addPayment, updateStudent } = deps;

  const [showPaymentForm, setShowPaymentForm] = useState(false);
  const [selectedCalendarDay, setSelectedCalendarDay] = useState<Date | null>(null);
  const [paymentStudentId, setPaymentStudentId] = useState('');
  const [paymentAmount, setPaymentAmount] = useState('');
  const [paymentDate, setPaymentDate] = useState(new Date().toISOString().split('T')[0]);

  // ── Notes ⇄ Calendar bridge ─────────────────────────────────────────────
  // Dated note entry from the calendar day modal (side 2 of the bridge:
  // pick a date → add a note that lands on that date). The note is stored
  // on the student record as `noteEntries` (see Student type).
  const [noteStudentId, setNoteStudentId] = useState('');
  const [noteText, setNoteText] = useState('');
  const [savingNoteOnDate, setSavingNoteOnDate] = useState(false);

  const getNotesForDay = (date: Date): { id: string; studentName: string; text: string }[] => {
    const dateStr = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
    return students.flatMap(s =>
      (s.noteEntries || [])
        .filter(n => n.date === dateStr)
        .map(n => ({ id: `${s.id}:${n.date}:${n.text.slice(0, 24)}`, studentName: s.name, text: n.text }))
    );
  };

  const saveNoteOnDate = async (date: Date): Promise<boolean> => {
    const text = noteText.trim();
    if (!noteStudentId || !text) return false;
    setSavingNoteOnDate(true);
    const student = students.find(s => s.id === noteStudentId);
    if (!student) {
      setSavingNoteOnDate(false);
      return false;
    }
    // Local-date key (not toISOString) so the entry matches the day the
    // user clicked in their own timezone.
    const dateStr = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
    const entry: StudentNoteEntry = { date: dateStr, text };
    const ok = await updateStudent(student.id, {
      noteEntries: [...(student.noteEntries || []), entry],
    });
    setSavingNoteOnDate(false);
    if (!ok) return false;
    setNoteText('');
    setNoteStudentId('');
    return true;
  };

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

    // Notes saved on this exact date (Notes ⇄ Calendar bridge)
    const dateKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
    const dayNotes = students.flatMap(s => (s.noteEntries || []).filter(n => n.date === dateKey));
    if (dayNotes.length > 0) {
      dayEvents.push({
        type: 'note',
        count: dayNotes.length,
        label: `${dayNotes.length} ${t.notes}`,
        details: [],
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
    noteStudentId, setNoteStudentId,
    noteText, setNoteText,
    savingNoteOnDate,
    saveNoteOnDate,
    getNotesForDay,
  };
}
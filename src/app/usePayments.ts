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
import { useCallback, useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { generatePaymentReceiptPdf } from '../lib/pdfReceipt';
import { fetchCalendarDayNotes, saveCalendarDayNote, deleteCalendarDayNote } from '../lib/calendarNotes';
import type { Student, Staff, Expense, Payment, User, Todo } from '../app/types';
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
  todos: Todo[];
  currentUser: User | null;
  addPayment: (studentId: string, payment: Omit<Payment, 'receiptNumber'> & { receiptNumber?: string }) => Promise<boolean>;
  /** Calendar ⇄ Notes bridge: persist a dated note on the student record. */
  /** Toast an error/validation message (replaces the native alert()). */
  toastError: (message: string) => void;
}

export function usePayments(deps: UsePaymentsDeps) {
  const { t, lang, selectedYear, lockedYears, students, staff, expenses, todos, currentUser, addPayment, toastError } = deps;

  const [showPaymentForm, setShowPaymentForm] = useState(false);
  const [selectedCalendarDay, setSelectedCalendarDay] = useState<Date | null>(null);
  const [paymentStudentId, setPaymentStudentId] = useState('');
  const [paymentAmount, setPaymentAmount] = useState('');
  const [paymentDate, setPaymentDate] = useState(new Date().toISOString().split('T')[0]);

  // ── Notes ⇄ Calendar bridge ─────────────────────────────────────────────
  // Dated note entry from the calendar day modal (side 2 of the bridge:
  // pick a date → add a note that lands on that date). Day notes are TEAM
  // artefacts: they live in the `calendar_notes` table so every account sees
  // them (like todos); localStorage only serves as a fast-start cache of the
  // last fetched list while the DB read is in flight (or degraded). Notes
  // attached to a student from the student sheet still live on the
  // student's `noteEntries` and are merged in for display.
  const DAY_NOTES_KEY = 'calendar-day-notes';
  interface DayNote { id: string; date: string; text: string; }

  const readDayNotes = (): DayNote[] => {
    try {
      const raw = localStorage.getItem(DAY_NOTES_KEY);
      if (!raw) return [];
      const parsed: unknown = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed as DayNote[] : [];
    } catch {
      return [];
    }
  };

  const writeDayNotesCache = useCallback((notes: DayNote[]): void => {
    try {
      localStorage.setItem(DAY_NOTES_KEY, JSON.stringify(notes));
    } catch {
      /* storage unavailable — the DB remains the source of truth */
    }
  }, []);

  const [dayNotes, setDayNotes] = useState<DayNote[]>(readDayNotes);

  // Pull the team's notes once when a session is live (refreshed after each
  // write). Auth-gated like the data hook: no anon read on the login screen,
  // and a fresh sign-in (currentUser flips null → user) triggers the fetch.
  useEffect(() => {
    if (!currentUser) return;
    let cancelled = false;
    void fetchCalendarDayNotes().then(notes => {
      if (cancelled || !notes) return;
      setDayNotes(notes);
      writeDayNotesCache(notes);
    });
    return () => { cancelled = true; };
  }, [currentUser, writeDayNotesCache]);

  const [noteText, setNoteText] = useState('');
  const [savingNoteOnDate, setSavingNoteOnDate] = useState(false);

  const getNotesForDay = (date: Date): { id: string; studentName?: string; text: string }[] => {
    const dateStr = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
    const standalone = dayNotes
      .filter(n => n.date === dateStr)
      .map(n => ({ id: n.id, text: n.text }));
    const studentNotes = students.flatMap(s =>
      (s.noteEntries || [])
        .filter(n => n.date === dateStr)
        .map(n => ({ id: `${s.id}:${n.date}:${n.text.slice(0, 24)}`, studentName: s.name, text: n.text }))
    );
    return [...standalone, ...studentNotes];
  };

  const saveNoteOnDate = async (date: Date): Promise<boolean> => {
    const text = noteText.trim();
    if (!text) return false;
    setSavingNoteOnDate(true);
    // Local-date key (not toISOString) so the entry matches the day the
    // user clicked in their own timezone.
    const dateStr = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
    // Team-wide write: the note goes to the calendar_notes table; on success
    // the returned row (real UUID) replaces the optimistic state + cache.
    const saved = await saveCalendarDayNote(dateStr, text);
    if (!saved) {
      setSavingNoteOnDate(false);
      return false;
    }
    setDayNotes(prev => {
      const next = [...prev, { id: saved.id, date: saved.date, text: saved.text }];
      writeDayNotesCache(next);
      return next;
    });
    setSavingNoteOnDate(false);
    setNoteText('');
    return true;
  };

  const handlePaymentSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (lockedYears.includes(selectedYear)) {
      toastError(t.thisAcademicYearIsLocked);
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

    // Notes saved on this exact date (Notes ⇄ Calendar bridge) — both the
    // standalone local day-notes and the student-attached dated entries.
    const dateKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
    const dayNotes = [
      ...readDayNotes().filter(n => n.date === dateKey),
      ...students.flatMap(s => (s.noteEntries || []).filter(n => n.date === dateKey)),
    ];
    if (dayNotes.length > 0) {
      dayEvents.push({
        type: 'note',
        count: dayNotes.length,
        label: `${dayNotes.length} ${t.notes}`,
        details: [],
      });
    }

    // To-Do tasks dated on this exact day (Tasks ⇄ Calendar bridge)
    const dayTodos = todos.filter(td => td.date === dateKey);
    if (dayTodos.length > 0) {
      dayEvents.push({
        type: 'todo',
        count: dayTodos.filter(td => !td.completed).length,
        label: `${dayTodos.length} ${t.tasks}`,
        details: dayTodos.map(td => ({ name: td.text, completed: td.completed })),
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
    noteText, setNoteText,
    savingNoteOnDate,
    saveNoteOnDate,
    getNotesForDay,
  };
}
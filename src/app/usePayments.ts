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
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { generatePaymentReceiptPdf } from '../lib/pdfReceipt';
import { PAYROLL_WINDOW_LAST_DAY } from '../lib/payrollWindow';
import { fetchCalendarDayNotes, saveCalendarDayNote, deleteCalendarDayNote } from '../lib/calendarNotes';
import { useGestureId } from '../lib/gestureId';
import { academicYearMonths, effectivePaymentMonths, toggledPaymentMonths } from '../lib/paymentMonths';
import { academicYearOf } from '../lib/dateWindows';
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
  /** Toast an error/validation message (replaces the native alert()). */
  toastError: (message: string) => void;
  /** Calendar ⇄ Notes bridge: persist a dated note on the student record. */
}

export function usePayments(deps: UsePaymentsDeps) {
  const { t, lang, selectedYear, lockedYears, students, staff, expenses, todos, currentUser, addPayment, toastError } = deps;

  const [showPaymentForm, setShowPaymentForm] = useState(false);
  const [selectedCalendarDay, setSelectedCalendarDay] = useState<Date | null>(null);
  const [paymentStudentId, setPaymentStudentId] = useState('');
  const [paymentAmount, setPaymentAmount] = useState('');
  const [paymentDate, setPaymentDate] = useState(new Date().toISOString().split('T')[0]);

  // ── Les MOIS que le paiement couvre ──────────────────────────────────────
  // La date dit quand l'argent est entré ; elle ne dit pas ce qu'il règle.
  // Voir src/lib/paymentMonths.ts : forme stockée `YYYY-MM`, tri, et le texte
  // que la ligne « Mois » du reçu en tire.
  const [paymentMonths, setPaymentMonths] = useState<string[]>([]);
  // « Touché » : tant que le caissier n'a rien coché lui-même, le mois proposé
  // SUIT la date saisie. Sans ce drapeau, changer la date d'octobre à novembre
  // laisserait « Octobre » coché sur un reçu daté de novembre — exactement la
  // confusion que ces mois existent pour lever.
  const [paymentMonthsTouched, setPaymentMonthsTouched] = useState(false);

  // Les mois PROPOSÉS sont ceux de l'année scolaire où TOMBE LA DATE : le mois
  // de la date y est donc toujours, le choix par défaut existe toujours, et
  // aucun encaissement normal n'est bloqué. Les mois à venir sont dans la liste
  // (une famille peut payer d'avance) — ils ne le sont que là.

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

  // L'id du GESTE de la note en cours : un double envoi écrit la note UNE fois.
  // Libéré après succès.
  const { gestureId: noteGestureId, resetGestureId: resetNoteGesture } = useGestureId();

  const saveNoteOnDate = async (date: Date): Promise<boolean> => {
    const text = noteText.trim();
    if (!text) return false;
    setSavingNoteOnDate(true);
    // Local-date key (not toISOString) so the entry matches the day the
    // user clicked in their own timezone.
    const dateStr = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
    // Team-wide write: the note goes to the calendar_notes table; on success
    // the returned row (real UUID) replaces the optimistic state + cache.
    const saved = await saveCalendarDayNote(dateStr, text, noteGestureId());
    if (!saved) {
      setSavingNoteOnDate(false);
      return false;
    }
    resetNoteGesture();
    setDayNotes(prev => {
      const next = [...prev, { id: saved.id, date: saved.date, text: saved.text }];
      writeDayNotesCache(next);
      return next;
    });
    setSavingNoteOnDate(false);
    setNoteText('');
    return true;
  };

  const paymentMonthOptions = useMemo(
    () => academicYearMonths(academicYearOf(paymentDate)),
    [paymentDate],
  );

  // Le mois de la date, lu DANS LA CHAÎNE : `2026-10-04` → `2026-10`. Aucune
  // conversion de fuseau ne peut donc décaler le mois d'un reçu.
  const paymentDateMonth = paymentDate.slice(0, 7);

  // Le choix RÉEL — la règle vit dans le module pur : tant que rien n'a été
  // coché, le mois proposé suit la DATE ; dès qu'un clic a eu lieu, c'est le
  // choix du caissier qui compte.
  const shownPaymentMonths = effectivePaymentMonths(
    paymentMonths, paymentMonthsTouched, paymentDateMonth, paymentMonthOptions,
  );

  // Cocher/décocher un mois. La liste repart TOUJOURS triée dans l'ordre du
  // calendrier scolaire : un reçu n'a pas à dépendre de l'ordre des clics.
  const togglePaymentMonth = (month: string) => {
    setPaymentMonths(prev => toggledPaymentMonths(
      prev, paymentMonthsTouched, paymentDateMonth, paymentMonthOptions, month,
    ));
    setPaymentMonthsTouched(true);
  };

  // L'id du GESTE de la saisie de paiement : un double envoi retombe sur la
  // même clé primaire (un seul reçu en base). Libéré après un succès.
  const { gestureId: paymentGestureId, resetGestureId: resetPaymentGesture } = useGestureId();
  // Un seul envoi à la fois : sans cette garde, un double clic lancerait DEUX
  // handlers concurrents, et donc deux reçus PDF pour un seul paiement.
  const paymentSubmittingRef = useRef(false);

  const handlePaymentSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (paymentSubmittingRef.current) return;
    if (lockedYears.includes(selectedYear)) {
      toastError(t.thisAcademicYearIsLocked);
      return;
    }
    if (!paymentStudentId || !paymentAmount) return;
    // Au moins un mois — mais SEULEMENT quand la liste est proposée (elle ne
    // l'est que si l'année scolaire de la date se lit). Sur une année illisible,
    // exiger un mois rendrait le guichet infranchissable.
    if (paymentMonthOptions.length > 0 && shownPaymentMonths.length === 0) {
      toastError(t.paidMonthsRequired);
      return;
    }

    const amount = parseFloat(paymentAmount);
    const targetStudent = students.find(s => s.id === paymentStudentId);
    const receiptNo = `REC-${Date.now().toString().slice(-6)}`;

    const newPayment = {
      date: paymentDate,
      amount,
      academicYear: targetStudent?.academicYear || selectedYear,
      receiptNumber: receiptNo,
      // L'id du GESTE : le même si l'envoi est répété → un seul reçu.
      id: paymentGestureId(),
      // Les mois couverts — ils partent EN BASE avec le paiement (reçus réimprimés)
      // et sur le reçu du moment.
      months: shownPaymentMonths.length > 0 ? shownPaymentMonths : undefined,
    };

    paymentSubmittingRef.current = true;
    try {
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

      resetPaymentGesture();
      setPaymentStudentId('');
      setPaymentAmount('');
      // Le paiement est enregistré : les mois repartent du mois de la date, comme
      // le formulaire rouvert les proposera.
      setPaymentMonths([]);
      setPaymentMonthsTouched(false);
      setShowPaymentForm(false);
    } finally {
      paymentSubmittingRef.current = false;
    }
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

    // Salary deadline — derived from the payroll window (open 1st–10th, late
    // from the 11th, see src/lib/payrollWindow.ts): the calendar marks the
    // window's last day instead of a hardcoded payday that could contradict
    // the late rule.
    if (date.getDate() === PAYROLL_WINDOW_LAST_DAY) {
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
    paymentMonths: shownPaymentMonths,
    paymentMonthOptions,
    togglePaymentMonth,
    handlePaymentSubmit,
    getEventsForDay,
    noteText, setNoteText,
    savingNoteOnDate,
    saveNoteOnDate,
    getNotesForDay,
  };
}
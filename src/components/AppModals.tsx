import { useRef, useState } from 'react';
import type { Dispatch, SetStateAction, FormEvent, KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Bell, Briefcase, Calendar, CheckCircle2, CheckSquare, Copy, CreditCard, DollarSign, ExternalLink, FileText, Globe, Heart, Layers, MessageSquare, Phone, Plus, Printer, Receipt, Search, ShieldCheck, Sparkles, StickyNote, Trash2, TrendingUp, Users, X } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { Student, Staff, Parent, Todo, Expense, SalaryPayment, VendorExpense } from '../lib/useSupabaseData';
import type { CalendarEvent, CurrentTheme, ManagedClass, ParentForm, SalaryForm, StaffForm, VendorExpenseForm } from '../app/mainViewsProps';
import type { TranslationDict } from '../i18n/translations';
import type { ReceiptDataOptions } from '../lib/pdfReceipt';
import { ConfirmDialog } from './ConfirmDialog';
import { ProductivityPanel } from './ProductivityPanel';
import { StudentFormModal } from './StudentFormModal';
import type { StudentForm } from './StudentFormModal';
import { AddClassModal } from './AddClassModal';
import type { ClassForm } from './AddClassModal';
import { EditClassModal } from './EditClassModal';
import { useEscapeToClose } from '../lib/useEscapeToClose';
import { useOverlayTraps } from '../lib/focusStack';

// ─── Productivité panel sizing (resizable on desktop) ───────────────────────
// The panel used to be a hard-coded w-80 (320px). It is now user-resizable:
// drag the left-edge handle (desktop) or focus it and use arrow keys; the
// choice persists per browser. The 88vw CSS max-width remains the final guard
// on any viewport. Module-local on purpose: exporting consts from a component
// file would trip the react-refresh lint gate.
const PANEL_WIDTH_KEY = 'mama-thera:productivity-panel-width';
const PANEL_WIDTH_MIN = 280;
const PANEL_WIDTH_MAX = 720;
const PANEL_WIDTH_DEFAULT = 320;
const PANEL_WIDTH_STEP = 40;

const clampPanelWidth = (w: number): number =>
  Math.min(PANEL_WIDTH_MAX, Math.max(PANEL_WIDTH_MIN, w));

const loadPanelWidth = (): number => {
  try {
    if (typeof localStorage === 'undefined') return PANEL_WIDTH_DEFAULT;
    const raw = localStorage.getItem(PANEL_WIDTH_KEY);
    const parsed = raw ? Number.parseInt(raw, 10) : Number.NaN;
    return Number.isFinite(parsed) ? clampPanelWidth(parsed) : PANEL_WIDTH_DEFAULT;
  } catch {
    return PANEL_WIDTH_DEFAULT;
  }
};

const savePanelWidth = (w: number): void => {
  try {
    localStorage.setItem(PANEL_WIDTH_KEY, String(Math.round(w)));
  } catch {
    /* storage unavailable (private mode, test runner) — width stays session-only */
  }
};

/** General expense add/edit form state (matches App.tsx). */
export interface ExpenseForm {
  category: string;
  description: string;
  amount: string;
  date: string;
}

export interface AppModalsProps {
  Bell: LucideIcon;
  Briefcase: LucideIcon;
  Calendar: LucideIcon;
  CheckCircle2: LucideIcon;
  CheckSquare: LucideIcon;
  Copy: LucideIcon;
  CreditCard: LucideIcon;
  DollarSign: LucideIcon;
  FileText: LucideIcon;
  Globe: LucideIcon;
  Heart: LucideIcon;
  Layers: LucideIcon;
  MessageSquare: LucideIcon;
  Phone: LucideIcon;
  Plus: LucideIcon;
  Printer: LucideIcon;
  Receipt: LucideIcon;
  ShieldCheck: LucideIcon;
  Sparkles: LucideIcon;
  StickyNote: LucideIcon;
  Trash2: LucideIcon;
  TrendingUp: LucideIcon;
  Users: LucideIcon;
  X: LucideIcon;
  academicYears: string[];
  activeLinkingParent: Parent | null;
  aiInput: string;
  aiMessages: { sender: 'user' | 'assistant'; text: string }[];
  auditYear: string | null;
  availableClasses: ManagedClass[];
  copiedToast: boolean;
  copyToClipboard: (text: string) => void;
  currentMonth: number;
  currentTheme: CurrentTheme;
  currentUser: { name?: string; role?: string; username?: string } | null;
  deleteStudent: (id: string) => Promise<boolean>;
  deleteTodo: (id: string) => Promise<boolean>;
  editClassForm: ClassForm;
  editingParent: Parent | null;
  editingStaff: Staff | null;
  editingStudent: Student | null;
  editingVendorExpense: VendorExpense | null;
  expenseCategoryList: { key: string; label: string }[];
  expenseForm: ExpenseForm;
  formatCurrency: (amount: number) => string;
  formatDate: (dateStr: string) => string;
  generateInstallmentMemo: (staffId: string, amount: number) => void;
  generatePaymentReceiptPdf: (opts: ReceiptDataOptions) => Promise<void>;
  getDayName: (dayIndex: number) => string;
  getEventsForDay: (date: Date) => CalendarEvent[];
  /** Notes ⇄ Calendar bridge: dated notes for a day + the entry form state. */
  getNotesForDay: (date: Date) => { id: string; studentName?: string; text: string }[];
  noteText: string;
  savingNoteOnDate: boolean;
  saveNoteOnDate: (date: Date) => Promise<boolean>;
  setNoteText: Dispatch<SetStateAction<string>>;
  getGradeDisplay: (grade: string | undefined, currentLang?: 'en' | 'fr') => string;
  getParentOutstandingBalance: (parent: Parent) => number;
  getYearStats: (year: string) => { revenue: number; expenses: number; balance: number };
  handleAddTodo: (e: FormEvent) => Promise<void>;
  handleAiQuery: (queryText: string) => void;
  handleCopyNotifyMessage: () => void;
  handleCreateClassSubmit: (e?: FormEvent) => Promise<void>;
  handleEditClassSubmit: (e: FormEvent) => Promise<void>;
  handleExpenseSubmit: (e: FormEvent) => Promise<void>;
  handleLinkStudentSubmit: (e: FormEvent) => Promise<void>;
  handleNotifyTemplateChange: (newType: 'polite' | 'urgent' | 'detailed') => void;
  handleParentSubmit: (e: FormEvent) => Promise<void>;
  handlePaymentSubmit: (e: FormEvent) => Promise<void>;
  handleSalarySubmit: (e: FormEvent) => Promise<void>;
  handleSaveNote: (studentId: string, note: string, noteDate?: string) => Promise<void>;
  handleSendSMS: () => void;
  handleSendWhatsApp: () => void;
  handleStaffSubmit: (e: FormEvent) => Promise<void>;
  handleStudentSubmit: (e: FormEvent) => Promise<void>;
  handleVendorExpenseSubmit: (e: FormEvent) => Promise<void>;
  isPromoter: boolean;
  /** Gestionnaire Principal — finance admin without user/settings/audit access. */
  isGeneralManager: boolean;
  lang: 'en' | 'fr';
  newClassForm: ClassForm;
  notifyCustomText: string;
  notifyParent: Parent | null;
  notifySelectedPhone: string;
  notifyTemplateType: 'polite' | 'urgent' | 'detailed';
  openEditModal: (student: Student) => void;
  parentForm: ParentForm;
  paymentAmount: string;
  paymentDate: string;
  paymentStudentId: string;
  printStudentFile: Student | null;
  productivitySidebarTab: 'tasks' | 'ai';
  salaryForm: SalaryForm;
  salaryPayments: SalaryPayment[];
  schoolLogo: string | null;
  selectedCalendarDay: Date | null;
  selectedStudent: Student | null;
  setAiInput: Dispatch<SetStateAction<string>>;
  setEditClassForm: Dispatch<SetStateAction<ClassForm>>;
  setEditingVendorExpense: Dispatch<SetStateAction<VendorExpense | null>>;
  setExpenseForm: Dispatch<SetStateAction<ExpenseForm>>;
  setNewClassForm: Dispatch<SetStateAction<ClassForm>>;
  setNotifyCustomText: Dispatch<SetStateAction<string>>;
  setNotifySelectedPhone: Dispatch<SetStateAction<string>>;
  setParentForm: Dispatch<SetStateAction<ParentForm>>;
  setPaymentAmount: Dispatch<SetStateAction<string>>;
  setPaymentDate: Dispatch<SetStateAction<string>>;
  setPaymentStudentId: Dispatch<SetStateAction<string>>;
  setPrintStudentFile: Dispatch<SetStateAction<Student | null>>;
  setProductivitySidebarTab: Dispatch<SetStateAction<'tasks' | 'ai'>>;
  setSalaryForm: Dispatch<SetStateAction<SalaryForm>>;
  setSelectedStudent: Dispatch<SetStateAction<Student | null>>;
  setShowAddClassModal: Dispatch<SetStateAction<boolean>>;
  setShowAuditModal: Dispatch<SetStateAction<boolean>>;
  setShowCalendarModal: Dispatch<SetStateAction<boolean>>;
  setShowEditClassModal: Dispatch<SetStateAction<boolean>>;
  setShowExpenseModal: Dispatch<SetStateAction<boolean>>;
  setShowLinkStudentModal: Dispatch<SetStateAction<boolean>>;
  setShowNotifyModal: Dispatch<SetStateAction<boolean>>;
  setShowParentModal: Dispatch<SetStateAction<boolean>>;
  setShowPaymentForm: Dispatch<SetStateAction<boolean>>;
  setShowSalaryModal: Dispatch<SetStateAction<boolean>>;
  setShowStaffModal: Dispatch<SetStateAction<boolean>>;
  setShowStudentModal: Dispatch<SetStateAction<boolean>>;
  setShowTodoSidebar: Dispatch<SetStateAction<boolean>>;
  setShowVendorExpenseModal: Dispatch<SetStateAction<boolean>>;
  setStaffForm: Dispatch<SetStateAction<StaffForm>>;
  setStudentDetailTab: Dispatch<SetStateAction<'general' | 'parent' | 'medical'>>;
  setStudentForm: Dispatch<SetStateAction<StudentForm>>;
  setStudentToLinkId: Dispatch<SetStateAction<string>>;
  setTicketStudent: Dispatch<SetStateAction<Student | null>>;
  setTodoInput: Dispatch<SetStateAction<string>>;
  setVendorExpenseForm: Dispatch<SetStateAction<VendorExpenseForm>>;
  showAddClassModal: boolean;
  showAuditModal: boolean;
  showCalendarModal: boolean;
  showEditClassModal: boolean;
  showExpenseModal: boolean;
  showLinkStudentModal: boolean;
  showNotifyModal: boolean;
  showParentModal: boolean;
  showPaymentForm: boolean;
  showSalaryModal: boolean;
  showStaffModal: boolean;
  showStudentModal: boolean;
  showSuccessToast: boolean;
  showTodoSidebar: boolean;
  showVendorExpenseModal: boolean;
  staff: Staff[];
  staffForm: StaffForm;
  studentDetailTab: 'general' | 'parent' | 'medical';
  studentForm: StudentForm;
  studentToLinkId: string;
  students: Student[];
  t: TranslationDict;
  ticketStudent: Student | null;
  todoInput: string;
  todoDate: string;
  setTodoDate: Dispatch<SetStateAction<string>>;
  todos: Todo[];
  toggleLanguage: (lang: 'en' | 'fr') => void;
  toggleTodo: (id: string) => Promise<void>;
  handleUpdateTodoDate: (id: string, date: string) => Promise<boolean>;
  vendorExpenseForm: VendorExpenseForm;
  welcomeMessage: string | null;
}

export function AppModals(props: AppModalsProps) {
  const [parentStudentSearch, setParentStudentSearch] = useState('');
  const [parentClassFilter, setParentClassFilter] = useState('all');
  const [confirmDeleteStudent, setConfirmDeleteStudent] = useState<Student | null>(null);
  // Notes ⇄ Calendar bridge: optional date picked next to the sticky note.
  const [noteDateInput, setNoteDateInput] = useState('');
  const { Bell, Briefcase, Calendar, CheckCircle2, CheckSquare, Copy, CreditCard, DollarSign, FileText, Globe, Heart, Layers, MessageSquare, Phone, Plus, Printer, Receipt, ShieldCheck, Sparkles, StickyNote, Trash2, TrendingUp, Users, X, academicYears, activeLinkingParent, aiInput, aiMessages, auditYear, availableClasses, copiedToast, copyToClipboard, currentMonth, currentTheme, currentUser, deleteStudent, deleteTodo, editClassForm, editingParent, editingStaff, editingStudent, editingVendorExpense, expenseCategoryList, expenseForm, formatCurrency, formatDate, generateInstallmentMemo, generatePaymentReceiptPdf, getDayName, getEventsForDay, getNotesForDay, getGradeDisplay, getParentOutstandingBalance, getYearStats, handleAddTodo, handleAiQuery, handleCopyNotifyMessage, handleCreateClassSubmit, handleEditClassSubmit, handleExpenseSubmit, handleLinkStudentSubmit, handleNotifyTemplateChange, handleParentSubmit, handlePaymentSubmit, handleSalarySubmit, handleSaveNote, handleSendSMS, handleSendWhatsApp, handleStaffSubmit, handleStudentSubmit, handleVendorExpenseSubmit, isPromoter, isGeneralManager, lang, newClassForm, noteText, savingNoteOnDate, saveNoteOnDate, setNoteText, notifyCustomText, notifyParent, notifySelectedPhone, notifyTemplateType, openEditModal, parentForm, paymentAmount, paymentDate, paymentStudentId, printStudentFile, productivitySidebarTab, salaryForm, salaryPayments, schoolLogo, selectedCalendarDay, selectedStudent, setAiInput, setEditClassForm, setEditingVendorExpense, setExpenseForm, setNewClassForm, setNotifyCustomText, setNotifySelectedPhone, setParentForm, setPaymentAmount, setPaymentDate, setPaymentStudentId, setPrintStudentFile, setProductivitySidebarTab, setSalaryForm, setSelectedStudent, setShowAddClassModal, setShowAuditModal, setShowCalendarModal, setShowEditClassModal, setShowExpenseModal, setShowLinkStudentModal, setShowNotifyModal, setShowParentModal, setShowPaymentForm, setShowSalaryModal, setShowStaffModal, setShowStudentModal, setShowTodoSidebar, setShowVendorExpenseModal, setStaffForm, setStudentDetailTab, setStudentForm, setStudentToLinkId, setTicketStudent, setTodoInput, setVendorExpenseForm, showAddClassModal, showAuditModal, showCalendarModal, showEditClassModal, showExpenseModal, showLinkStudentModal, showNotifyModal, showParentModal, showPaymentForm, showSalaryModal, showStaffModal, showStudentModal, showSuccessToast, showTodoSidebar, showVendorExpenseModal, staff, staffForm, studentDetailTab, studentForm, studentToLinkId, students, t, ticketStudent, todoDate, setTodoDate, todoInput, todos, toggleLanguage, toggleTodo, handleUpdateTodoDate, vendorExpenseForm, welcomeMessage } = props;

  // Productivité panel width — resizable on desktop (drag handle or arrow
  // keys), persisted per browser. Local UI state only: it never touches the
  // MainViewsProps contract.
  const [panelWidth, setPanelWidth] = useState<number>(loadPanelWidth);
  const dragStartRef = useRef<{ pointerX: number; startWidth: number } | null>(null);
  const panelWidthRef = useRef(panelWidth);
  panelWidthRef.current = panelWidth;

  const applyPanelWidth = (w: number): void => {
    const next = clampPanelWidth(w);
    panelWidthRef.current = next;
    setPanelWidth(next);
    savePanelWidth(next);
  };

  const handleResizePointerDown = (e: ReactPointerEvent<HTMLButtonElement>): void => {
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    dragStartRef.current = { pointerX: e.clientX, startWidth: panelWidth };
  };

  const handleResizePointerMove = (e: ReactPointerEvent<HTMLButtonElement>): void => {
    const drag = dragStartRef.current;
    if (!drag) return;
    // The panel is right-anchored: pulling the left edge outwards (leftwards)
    // widens it, pushing it inwards narrows it.
    setPanelWidth(clampPanelWidth(drag.startWidth + (drag.pointerX - e.clientX)));
  };

  const handleResizePointerEnd = (e: ReactPointerEvent<HTMLButtonElement>): void => {
    const drag = dragStartRef.current;
    if (!drag) return;
    dragStartRef.current = null;
    try { e.currentTarget.releasePointerCapture(e.pointerId); } catch { /* pointer already released */ }
    applyPanelWidth(drag.startWidth + (drag.pointerX - e.clientX));
  };

  const handleResizeKeyDown = (e: ReactKeyboardEvent<HTMLButtonElement>): void => {
    // Left widens (the left edge moves left), right narrows — mirroring the
    // drag direction. Home/End snap to the bounds.
    if (e.key === 'ArrowLeft') { e.preventDefault(); applyPanelWidth(panelWidthRef.current + PANEL_WIDTH_STEP); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); applyPanelWidth(panelWidthRef.current - PANEL_WIDTH_STEP); }
    else if (e.key === 'Home') { e.preventDefault(); applyPanelWidth(PANEL_WIDTH_MIN); }
    else if (e.key === 'End') { e.preventDefault(); applyPanelWidth(PANEL_WIDTH_MAX); }
  };

  // Escape closes the topmost open overlay (keyboard consistency). The list
  // below follows the JSX order: the LAST open entry is the visually topmost,
  // and a single press closes exactly that one (stacked dialogs first).
  const openOverlays: [boolean, () => void][] = [
    [Boolean(selectedStudent), () => setSelectedStudent(null)],
    [showStaffModal, () => setShowStaffModal(false)],
    [showExpenseModal, () => setShowExpenseModal(false)],
    [showVendorExpenseModal, () => setShowVendorExpenseModal(false)],
    [showSalaryModal, () => setShowSalaryModal(false)],
    [showCalendarModal, () => setShowCalendarModal(false)],
    [showPaymentForm, () => setShowPaymentForm(false)],
    [showAuditModal, () => setShowAuditModal(false)],
    [Boolean(ticketStudent), () => setTicketStudent(null)],
    [showParentModal, () => setShowParentModal(false)],
    [showLinkStudentModal, () => setShowLinkStudentModal(false)],
    [showNotifyModal, () => setShowNotifyModal(false)],
  ];
  useEscapeToClose(
    openOverlays.some(([open]) => open),
    () => {
      for (let i = openOverlays.length - 1; i >= 0; i--) {
        if (openOverlays[i][0]) {
          openOverlays[i][1]();
          return;
        }
      }
    },
  );
  // Focus trap: confine Tab to the currently-open overlay (same JSX order —
  // the last open entry is the visually topmost) and restore focus on close.
  const overlayRoots = useRef<(HTMLElement | null)[]>([]);
  useOverlayTraps(
    openOverlays.map(([open]) => open),
    (i) => overlayRoots.current[i] ?? null,
  );
  return (
    <>
      {/* --- Parent Profile Modal --- */}
      <AnimatePresence>
        {selectedStudent && (
          <div ref={(el) => { overlayRoots.current[0] = el; }} role="dialog" aria-modal="true" aria-label={t.studentDetails} aria-labelledby="modal-title-student-details" className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setSelectedStudent(null)}
              className="absolute inset-0 bg-slate-900/60 backdrop-blur-md"
            />
            <motion.div 
              initial={{ opacity: 0, scale: 0.9, y: 40 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 40 }}
              className={`relative ${currentTheme.card} w-full max-w-xl rounded-[3rem] shadow-2xl border ${currentTheme.border} overflow-hidden`}
            >
              {/* Header Banner */}
              <div className="h-24 relative" style={{ backgroundColor: currentTheme.header }}>
                <button 
                  onClick={() => setSelectedStudent(null)}
                  className="absolute top-6 right-6 p-2 bg-white/10 hover:bg-white/20 text-white rounded-2xl transition-all"
                >
                  <X size={20} />
                </button>
              </div>

              {/* Body Content */}
              <div className="px-10 pb-10 pt-4 space-y-6 max-h-[80vh] overflow-y-auto custom-scrollbar">
                {/* --- Student Card Layout --- */}
                <div className={`flex flex-col sm:flex-row items-center gap-6 p-6 rounded-[2.5rem] border ${currentTheme.border} ${currentTheme.isDark ? 'bg-emerald-900/5' : 'bg-slate-50/50'}`}>
                  {/* Photo Placeholder / Image */}
                  <div className={`w-28 h-28 flex-shrink-0 border-2 ${currentTheme.border} rounded-[2rem] overflow-hidden bg-slate-100 flex items-center justify-center relative shadow-inner`}>
                    {selectedStudent.photo ? (
                      <img 
                        src={selectedStudent.photo} 
                        alt={selectedStudent.name} 
                        className="w-full h-full object-cover" 
                        referrerPolicy="no-referrer"
                      />
                    ) : (
                      <div className="text-center">
                        <Users size={32} className="text-slate-400 mx-auto mb-1" />
                        <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest">PHOTO</span>
                      </div>
                    )}
                  </div>

                  {/* Student Essential Text Details */}
                  <div className="flex-1 text-center sm:text-left space-y-2">
                    <div>
                      <span className={`text-[10px] ${currentTheme.muted} font-black uppercase tracking-widest font-mono`}>
                        ID: {selectedStudent.studentId || '—'}
                      </span>
                      <h3 id="modal-title-student-details" className={`text-2xl font-black ${currentTheme.isDark ? 'text-emerald-400' : 'text-slate-800'} tracking-tight`}>
                        {selectedStudent.name}
                      </h3>
                    </div>

                    <div className="flex flex-wrap items-center justify-center sm:justify-start gap-3">
                      <span className="inline-block px-3 py-1 bg-blue-50 text-blue-600 rounded-xl text-xs font-black uppercase tracking-wider">
                        {getGradeDisplay(selectedStudent.grade, lang)}
                      </span>

                      {/* Status badge: Green for Active, Blue for Graduated, Grey for Left */}
                      {(() => {
                        const statusVal = selectedStudent.status || 'Active';
                        let badgeColors = 'text-emerald-700 bg-emerald-50 border-emerald-100';
                        if (statusVal === 'Graduated') badgeColors = 'text-blue-700 bg-blue-50 border-blue-100';
                        if (statusVal === 'Left') badgeColors = 'text-slate-500 bg-slate-100 border-slate-200';
                        return (
                          <span className={`inline-block px-3 py-1 rounded-xl text-xs font-black uppercase tracking-wider border ${badgeColors}`}>
                            {statusVal}
                          </span>
                        );
                      })()}
                    </div>
                  </div>
                </div>

                {/* --- Custom Tab Bar --- */}
                <div className="flex border-b border-slate-100 no-print gap-2">
                  <button
                    onClick={() => setStudentDetailTab('general')}
                    className={`flex-1 pb-3 text-xs font-black uppercase tracking-wider transition-all border-b-2 text-center ${
                      studentDetailTab === 'general'
                        ? 'border-blue-600 text-blue-600'
                        : `${currentTheme.muted} border-transparent hover:text-slate-600`
                    }`}
                  >
                    {t.generalInfo}
                  </button>
                  <button
                    onClick={() => setStudentDetailTab('parent')}
                    className={`flex-1 pb-3 text-xs font-black uppercase tracking-wider transition-all border-b-2 text-center ${
                      studentDetailTab === 'parent'
                        ? 'border-blue-600 text-blue-600'
                        : `${currentTheme.muted} border-transparent hover:text-slate-600`
                    }`}
                  >
                    {t.parentEmergency}
                  </button>
                  <button
                    onClick={() => setStudentDetailTab('medical')}
                    className={`flex-1 pb-3 text-xs font-black uppercase tracking-wider transition-all border-b-2 text-center ${
                      studentDetailTab === 'medical'
                        ? 'border-blue-600 text-blue-600'
                        : `${currentTheme.muted} border-transparent hover:text-slate-600`
                    }`}
                  >
                    {t.medicalHistory}
                  </button>
                </div>

                {/* --- Tab Panel Contents --- */}
                <div className="space-y-4">
                  {studentDetailTab === 'general' && (
                    <div className="space-y-4">
                      <div className="grid grid-cols-2 gap-4">
                        <div className={`p-5 ${currentTheme.isDark ? 'bg-emerald-900/10' : 'bg-slate-50'} rounded-2xl`}>
                          <span className={`text-[10px] font-black uppercase tracking-widest ${currentTheme.muted}`}>{t.enrollmentDate}</span>
                          <p className={`text-sm font-bold ${currentTheme.isDark ? 'text-emerald-500' : 'text-slate-800'} mt-1`}>
                            {selectedStudent.enrollmentDate || '2026-07-16'}
                          </p>
                        </div>
                        <div className={`p-5 ${currentTheme.isDark ? 'bg-emerald-900/10' : 'bg-slate-50'} rounded-2xl`}>
                          <span className={`text-[10px] font-black uppercase tracking-widest ${currentTheme.muted}`}>{t.academicYear}</span>
                          <p className={`text-sm font-bold ${currentTheme.isDark ? 'text-emerald-500' : 'text-slate-800'} mt-1`}>
                            {selectedStudent.academicYear || '2025-2026'}
                          </p>
                        </div>
                      </div>

                      <div className="grid grid-cols-3 gap-4">
                        <div className={`p-4 ${currentTheme.isDark ? 'bg-emerald-900/10' : 'bg-slate-50'} rounded-2xl text-center`}>
                          <span className={`text-[9px] font-black uppercase tracking-widest ${currentTheme.muted}`}>{t.totalDue}</span>
                          <p className={`text-xs font-extrabold ${currentTheme.muted} mt-1`}>
                            {formatCurrency(selectedStudent.totalDue)}
                          </p>
                        </div>
                        <div className={`p-4 ${currentTheme.isDark ? 'bg-emerald-900/10' : 'bg-slate-50'} rounded-2xl text-center`}>
                          <span className={`text-[9px] font-black uppercase tracking-widest ${currentTheme.muted}`}>{t.paid}</span>
                          <p className="text-xs font-extrabold text-emerald-600 mt-1">
                            {formatCurrency(selectedStudent.amountPaid)}
                          </p>
                        </div>
                        <div className={`p-4 ${currentTheme.isDark ? 'bg-[#FFF1F2]' : 'bg-rose-50'} rounded-2xl text-center`}>
                          <span className="text-[9px] font-black uppercase tracking-widest text-rose-500">{t.balance}</span>
                          <p className="text-xs font-black text-rose-600 mt-1">
                            {formatCurrency(selectedStudent.totalDue * (1 - (selectedStudent.scholarshipDiscount || 0) / 100) - selectedStudent.amountPaid)}
                          </p>
                        </div>
                      </div>

                      {/* Mini Payment Ledger */}
                      <div className="space-y-2">
                        <span className={`text-[10px] font-black uppercase tracking-widest ${currentTheme.muted}`}>{t.paymentHistoryLedger}</span>
                        <div className="space-y-2 max-h-24 overflow-y-auto pr-2 custom-scrollbar">
                          {selectedStudent.payments.length > 0 ? (
                            [...selectedStudent.payments].reverse().map((p, idx) => (
                              <div key={`${p.date}-${p.amount}-${idx}`} className={`flex items-center justify-between p-3 ${currentTheme.isDark ? 'bg-emerald-900/10' : 'bg-slate-50'} rounded-xl text-xs`}>
                                <div className="flex flex-col">
                                  <span className={currentTheme.muted}>{formatDate(p.date)}</span>
                                  {p.receiptNumber && <span className="text-[10px] text-slate-400 font-mono">{lang === 'fr' ? 'N°' : 'Ref'} {p.receiptNumber}</span>}
                                </div>
                                <div className="flex items-center gap-3">
                                  <span className="font-bold text-emerald-600">+{formatCurrency(p.amount)}</span>
                                  <button
                                    onClick={() => generatePaymentReceiptPdf({
                                      student: selectedStudent,
                                      payment: p,
                                      lang,
                                      cashierName: currentUser?.name || 'Administration'
                                    })}
                                    className="px-2 py-1 bg-emerald-600 hover:bg-emerald-700 text-white rounded text-[10px] font-bold transition-all shadow-sm flex items-center gap-1"
                                    title={t.downloadReceiptPdf}
                                  >
                                    📄 {t.receipt2}
                                  </button>
                                </div>
                              </div>
                            ))
                          ) : (
                            <p className={`text-xs ${currentTheme.muted} italic p-2`}>{t.noPayments}</p>
                          )}
                        </div>
                      </div>
                    </div>
                  )}

                  {studentDetailTab === 'parent' && (
                    <div className="space-y-4">
                      {/* Guardian Info Card */}
                      <div className={`p-5 ${currentTheme.isDark ? 'bg-[#1e293b]/50' : 'bg-slate-50'} rounded-2xl space-y-3`}>
                        <h4 className="text-[10px] font-black text-slate-400 uppercase tracking-widest">{t.guardianTitle}</h4>
                        <div className="grid grid-cols-2 gap-4 text-xs">
                          <div>
                            <span className={currentTheme.muted}>{t.parentName}</span>
                            <p className={`font-bold ${currentTheme.isDark ? 'text-emerald-500' : 'text-slate-800'}`}>{selectedStudent.parentName}</p>
                          </div>
                          <div>
                            <span className={currentTheme.muted}>{t.phone}</span>
                            <p className={`font-bold ${currentTheme.isDark ? 'text-emerald-500' : 'text-slate-800'}`}>{selectedStudent.parentPhone}</p>
                          </div>
                          <div className="col-span-2 border-t border-slate-100 pt-2 flex justify-between items-center">
                            <div>
                              <span className={currentTheme.muted}>{t.email}</span>
                              <p className={`font-semibold ${selectedStudent.parentEmail ? 'text-blue-600' : 'text-slate-400 italic text-xs'}`}>
                                {selectedStudent.parentEmail || (t.notProvided)}
                              </p>
                            </div>
                            {selectedStudent.parentEmail && (
                              <button 
                                onClick={() => copyToClipboard(selectedStudent.parentEmail)}
                                className="p-2 hover:bg-blue-50 text-blue-500 rounded-lg transition-all"
                                title={t.copyEmail}
                              >
                                <Copy size={14} />
                              </button>
                            )}
                          </div>
                        </div>
                      </div>

                      {/* Emergency Contact Card */}
                      <div className={`p-5 ${currentTheme.isDark ? 'bg-[#1e293b]/50' : 'bg-slate-50'} rounded-2xl space-y-3`}>
                        <h4 className="text-[10px] font-black text-rose-500 uppercase tracking-widest">{t.emergencyTitle}</h4>
                        <div className="grid grid-cols-2 gap-4 text-xs">
                          <div>
                            <span className={currentTheme.muted}>{t.contactName}</span>
                            <p className={`font-bold ${currentTheme.isDark ? 'text-emerald-500' : 'text-slate-800'}`}>
                              {selectedStudent.emergencyContactName || 'N/A'}
                            </p>
                          </div>
                          <div>
                            <span className={currentTheme.muted}>{t.relationshipLabel}</span>
                            <p className={`font-bold ${currentTheme.isDark ? 'text-emerald-500' : 'text-slate-800'}`}>
                              {selectedStudent.emergencyContactRelation || 'N/A'}
                            </p>
                          </div>
                          <div className="col-span-2 border-t border-slate-100 pt-2">
                            <span className={currentTheme.muted}>{t.emergencyPhoneLabel}</span>
                            <p className="font-black text-rose-600 text-sm">
                              {selectedStudent.emergencyContactPhone || 'N/A'}
                            </p>
                          </div>
                        </div>
                      </div>
                    </div>
                  )}

                  {studentDetailTab === 'medical' && (
                    <div className="space-y-4">
                      {/* Previous School */}
                      <div className={`p-5 ${currentTheme.isDark ? 'bg-[#1e293b]/50' : 'bg-slate-50'} rounded-2xl`}>
                        <span className={`text-[10px] font-black uppercase tracking-widest ${currentTheme.muted}`}>{t.previousSchoolHistory}</span>
                        <p className={`text-sm font-bold ${currentTheme.isDark ? 'text-emerald-500' : 'text-slate-800'} mt-1`}>
                          {selectedStudent.previousSchool || (t.noneFirstEnrollmentEntry)}
                        </p>
                      </div>

                      {/* Medical Notes */}
                      <div className={`p-5 ${currentTheme.isDark ? 'bg-[#1e293b]/50' : 'bg-slate-50'} rounded-2xl`}>
                        <span className="text-[10px] font-black uppercase tracking-widest text-rose-500">{t.medicalNotesTitle}</span>
                        <p className={`text-xs font-semibold ${currentTheme.isDark ? 'text-emerald-400/80' : 'text-slate-700'} mt-1 bg-white p-3 rounded-xl border border-slate-100`}>
                          {selectedStudent.medicalNotes || 'None'}
                        </p>
                      </div>
                    </div>
                  )}
                </div>

                {/* --- Accounting Notes (Sticky Note) --- */}
                <div className="pt-2">
                  <div className="bg-[#FEF9C3] p-6 rounded-[2rem] shadow-inner border border-yellow-200/50 relative transform rotate-1">
                    <div className="absolute top-5 right-6 text-yellow-600/30">
                      <StickyNote size={24} />
                    </div>
                    <h4 className="text-[9px] font-black text-yellow-700 uppercase tracking-widest mb-3 flex items-center gap-1.5">
                      <FileText size={12} />
                      {t.accountingNotes}
                    </h4>
                    <textarea 
                      defaultValue={selectedStudent.notes}
                      onBlur={(e) => {
                        const d = noteDateInput || undefined;
                        void handleSaveNote(selectedStudent.id, e.target.value, d);
                        setNoteDateInput('');
                      }}
                      placeholder={t.notesPlaceholder}
                      className="w-full bg-transparent border-none focus:ring-0 text-xs font-bold text-yellow-900 placeholder-yellow-700/40 resize-none min-h-[80px] custom-scrollbar"
                    />
                    <div className="mt-2 flex items-center justify-between gap-2 flex-wrap">
                      <label className="flex items-center gap-1.5 text-[9px] font-black text-yellow-600/70 uppercase tracking-widest">
                        <Calendar size={11} />
                        {t.alsoShowOnCalendar}
                        <input
                          type="date"
                          value={noteDateInput}
                          onChange={(e) => setNoteDateInput(e.target.value)}
                          className="ml-1 px-2 py-1 rounded-lg border border-yellow-300 bg-white/80 text-[10px] font-bold text-yellow-900 focus:outline-none focus:ring-2 focus:ring-yellow-500/30"
                        />
                      </label>
                      <span className="text-[9px] font-black text-yellow-600/50 uppercase tracking-widest">
                        {selectedStudent.lastNoteDate ? `Last updated: ${formatDate(selectedStudent.lastNoteDate)}` : ''}
                      </span>
                    </div>
                  </div>
                </div>

                {/* --- Bottom Actions Bar --- */}
                <div className="flex flex-col sm:flex-row gap-3 pt-4 border-t border-slate-100">
                  <button 
                    onClick={() => {
                      openEditModal(selectedStudent);
                      setSelectedStudent(null);
                    }}
                    className="flex-1 bg-blue-600 hover:bg-blue-700 text-white py-3.5 rounded-2xl font-black text-xs transition-all shadow-md flex items-center justify-center gap-2"
                  >
                    <FileText size={14} />
                    Edit Profile
                  </button>

                  <button 
                    onClick={() => setPrintStudentFile(selectedStudent)}
                    className="flex-1 bg-slate-800 hover:bg-slate-900 text-white py-3.5 rounded-2xl font-black text-xs transition-all shadow-md flex items-center justify-center gap-2"
                  >
                    <Printer size={14} />
                    Print Student File
                  </button>

                  <button 
                    onClick={() => setConfirmDeleteStudent(selectedStudent)}
                    className="px-6 py-3.5 rounded-2xl bg-rose-600 hover:bg-rose-700 text-white font-black text-xs transition-all shadow-md flex items-center justify-center gap-2"
                  >
                    <Trash2 size={14} />
                    {t.deleteStudent}
                  </button>

                  <button 
                    onClick={() => setSelectedStudent(null)}
                    className={`px-6 py-3.5 border ${currentTheme.border} ${currentTheme.muted} hover:text-slate-600 hover:bg-slate-50 rounded-2xl font-bold text-xs transition-all text-center`}
                  >
                    {t.close}
                  </button>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* --- Student Add/Edit Modal --- */}
      <AnimatePresence>
        {showStudentModal && (
          <StudentFormModal
            t={t}
            lang={lang}
            open={showStudentModal}
            editingStudent={editingStudent}
            studentForm={studentForm}
            setStudentForm={setStudentForm}
            handleStudentSubmit={handleStudentSubmit}
            onClose={() => setShowStudentModal(false)}
            onOpenAddClass={() => setShowAddClassModal(true)}
            onDeleteRequest={(student) => setConfirmDeleteStudent(student)}
            availableClasses={availableClasses}
    academicYears={academicYears}
    isPromoter={isPromoter}
    isGeneralManager={isGeneralManager}
            themeCard={currentTheme.card}
            themeBorder={currentTheme.border}
            themeHeader={currentTheme.header}
            themeMuted={currentTheme.muted}
            themeIsDark={currentTheme.isDark}
          />
        )}
      </AnimatePresence>

      {/* --- Add New Class / Section Modal --- */}
      <AnimatePresence>
        {showAddClassModal && (
          <AddClassModal
            t={t}
            open={showAddClassModal}
            newClassForm={newClassForm}
            setNewClassForm={setNewClassForm}
            handleCreateClassSubmit={handleCreateClassSubmit}
            onClose={() => setShowAddClassModal(false)}
            themeCard={currentTheme.card}
            themeBorder={currentTheme.border}
            themeHeader={currentTheme.header}
            themeMuted={currentTheme.muted}
            themeIsDark={currentTheme.isDark}
          />
        )}
      </AnimatePresence>

      {/* --- Edit Custom Class Modal --- */}
      <AnimatePresence>
        {showEditClassModal && (
          <EditClassModal
            t={t}
            open={showEditClassModal}
            editClassForm={editClassForm}
            setEditClassForm={setEditClassForm}
            handleEditClassSubmit={handleEditClassSubmit}
            onClose={() => setShowEditClassModal(false)}
            themeCard={currentTheme.card}
            themeBorder={currentTheme.border}
            themeHeader={currentTheme.header}
            themeMuted={currentTheme.muted}
            themeIsDark={currentTheme.isDark}
          />
        )}
      </AnimatePresence>

      {/* --- Staff Add/Edit Modal --- */}
      <AnimatePresence>
        {showStaffModal && (
          <div ref={(el) => { overlayRoots.current[1] = el; }} role="dialog" aria-modal="true" aria-label={editingStaff ? t.editStaff : t.addStaff} aria-labelledby="modal-title-staff-form" className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowStaffModal(false)}
              className="absolute inset-0 bg-slate-900/60 backdrop-blur-md"
            />
            <motion.div 
              initial={{ opacity: 0, scale: 0.9, y: 40 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 40 }}
              className={`relative ${currentTheme.card} w-full max-w-lg rounded-[3rem] shadow-2xl border ${currentTheme.border} overflow-hidden`}
            >
              <div className="p-8 border-b border-slate-50 flex justify-between items-center bg-[#0F172A] text-white" style={{ backgroundColor: currentTheme.header }}>
                <h2 id="modal-title-staff-form" className="text-xl font-bold flex items-center gap-3">
                  <Briefcase size={24} className="text-blue-400" />
                  {editingStaff ? t.editStaff : t.addStaff}
                </h2>
                <button onClick={() => setShowStaffModal(false)} className="p-2 hover:bg-white/10 rounded-xl transition-all">
                  <X size={20} />
                </button>
              </div>

              <form onSubmit={handleStaffSubmit} className="p-10 space-y-6 max-h-[70vh] overflow-y-auto custom-scrollbar">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="space-y-2">
                    <label className={`text-[10px] font-black ${currentTheme.muted} uppercase tracking-widest`}>{t.staffName}</label>
                    <input 
                      required
                      type="text" 
                      value={staffForm.name}
                      onChange={(e) => setStaffForm({ ...staffForm, name: e.target.value })}
                      className={`w-full px-6 py-4 ${currentTheme.isDark ? 'bg-emerald-900/10' : 'bg-slate-50'} border ${currentTheme.border} rounded-2xl focus:outline-none focus:ring-4 focus:ring-blue-500/5 focus:border-blue-500 transition-all text-sm font-semibold ${currentTheme.isDark ? 'text-emerald-500' : 'text-slate-800'}`}
                      placeholder="Jane Doe"
                    />
                  </div>
                  <div className="space-y-2">
                    <label className={`text-[10px] font-black ${currentTheme.muted} uppercase tracking-widest`}>{t.position}</label>
                    <input 
                      required
                      type="text" 
                      value={staffForm.position}
                      onChange={(e) => setStaffForm({ ...staffForm, position: e.target.value })}
                      className={`w-full px-6 py-4 ${currentTheme.isDark ? 'bg-emerald-900/10' : 'bg-slate-50'} border ${currentTheme.border} rounded-2xl focus:outline-none focus:ring-4 focus:ring-blue-500/5 focus:border-blue-500 transition-all text-sm font-semibold ${currentTheme.isDark ? 'text-emerald-500' : 'text-slate-800'}`}
                      placeholder="Teacher"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="space-y-2">
                    <label className={`text-[10px] font-black ${currentTheme.muted} uppercase tracking-widest`}>{t.phone}</label>
                    <input 
                      required
                      type="text" 
                      value={staffForm.phone}
                      onChange={(e) => setStaffForm({ ...staffForm, phone: e.target.value })}
                      className={`w-full px-6 py-4 ${currentTheme.isDark ? 'bg-emerald-900/10' : 'bg-slate-50'} border ${currentTheme.border} rounded-2xl focus:outline-none focus:ring-4 focus:ring-blue-500/5 focus:border-blue-500 transition-all text-sm font-semibold ${currentTheme.isDark ? 'text-emerald-500' : 'text-slate-800'}`}
                      placeholder="+223 70 00 00 00"
                    />
                  </div>
                  <div className="space-y-2">
                    <label className={`text-[10px] font-black ${currentTheme.muted} uppercase tracking-widest`}>{t.email}</label>
                    <input 
                      required
                      type="email" 
                      value={staffForm.email}
                      onChange={(e) => setStaffForm({ ...staffForm, email: e.target.value })}
                      className={`w-full px-6 py-4 ${currentTheme.isDark ? 'bg-emerald-900/10' : 'bg-slate-50'} border ${currentTheme.border} rounded-2xl focus:outline-none focus:ring-4 focus:ring-blue-500/5 focus:border-blue-500 transition-all text-sm font-semibold ${currentTheme.isDark ? 'text-emerald-500' : 'text-slate-800'}`}
                      placeholder="jane.doe@school.com"
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <label className={`text-[10px] font-black ${currentTheme.muted} uppercase tracking-widest`}>{t.monthlySalary} ({t.currency})</label>
                  <input 
                    required
                    type="number" 
                    value={staffForm.salary}
                    onChange={(e) => setStaffForm({ ...staffForm, salary: e.target.value })}
                    className={`w-full px-6 py-4 ${currentTheme.isDark ? 'bg-emerald-900/10' : 'bg-slate-50'} border ${currentTheme.border} rounded-2xl focus:outline-none focus:ring-4 focus:ring-blue-500/5 focus:border-blue-500 transition-all text-sm font-semibold ${currentTheme.isDark ? 'text-emerald-500' : 'text-slate-800'}`}
                    placeholder="150 000"
                  />
                </div>

                <div className="space-y-2">
                  <label className={`text-[10px] font-black ${currentTheme.muted} uppercase tracking-widest`}>{t.bankDetails}</label>
                  <input
                    type="text"
                    value={staffForm.bankDetails}
                    onChange={(e) => setStaffForm({ ...staffForm, bankDetails: e.target.value })}
                    className={`w-full px-6 py-4 ${currentTheme.isDark ? 'bg-emerald-900/10' : 'bg-slate-50'} border ${currentTheme.border} rounded-2xl focus:outline-none focus:ring-4 focus:ring-blue-500/5 focus:border-blue-500 transition-all text-sm font-semibold ${currentTheme.isDark ? 'text-emerald-500' : 'text-slate-800'}`}
                    placeholder="RIB: ML01 00001 ..."
                  />
                </div>

                <div className="space-y-2">
                  <label className={`text-[10px] font-black ${currentTheme.muted} uppercase tracking-widest`}>{t.emergencyContact}</label>
                  <input
                    type="text"
                    value={staffForm.emergencyContact}
                    onChange={(e) => setStaffForm({ ...staffForm, emergencyContact: e.target.value })}
                    className={`w-full px-6 py-4 ${currentTheme.isDark ? 'bg-emerald-900/10' : 'bg-slate-50'} border ${currentTheme.border} rounded-2xl focus:outline-none focus:ring-4 focus:ring-blue-500/5 focus:border-blue-500 transition-all text-sm font-semibold ${currentTheme.isDark ? 'text-emerald-500' : 'text-slate-800'}`}
                    placeholder="Spouse: +223 60 00 00 00"
                  />
                </div>

                <button type="submit" className="w-full bg-blue-600 hover:bg-blue-700 text-white py-5 rounded-2xl font-black text-sm transition-all shadow-xl shadow-blue-500/20">
                  {editingStaff ? t.saveChanges : t.submit}
                </button>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* --- Expense Modal --- */}
      <AnimatePresence>
        {showExpenseModal && (
          <div ref={(el) => { overlayRoots.current[2] = el; }} role="dialog" aria-modal="true" aria-label={t.addExpense} aria-labelledby="modal-title-add-expense" className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowExpenseModal(false)}
              className="absolute inset-0 bg-slate-900/60 backdrop-blur-md"
            />
            <motion.div 
              initial={{ opacity: 0, scale: 0.9, y: 40 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 40 }}
              className={`relative ${currentTheme.card} w-full max-w-lg rounded-[3rem] shadow-2xl border ${currentTheme.border} overflow-hidden`}
            >
              <div className="p-8 border-b border-rose-100 flex justify-between items-center bg-rose-600 text-white">
                <h2 id="modal-title-add-expense" className="text-xl font-bold flex items-center gap-3">
                  <Receipt size={24} />
                  {t.addExpense}
                </h2>
                <button onClick={() => setShowExpenseModal(false)} className="p-2 hover:bg-white/10 rounded-xl transition-all">
                  <X size={20} />
                </button>
              </div>

              <form onSubmit={handleExpenseSubmit} className="p-10 space-y-6">
                <div className="space-y-2">
                  <label className={`text-[10px] font-black ${currentTheme.muted} uppercase tracking-widest`}>{t.category}</label>
                  <select 
                    value={expenseForm.category}
                    onChange={(e) => setExpenseForm({ ...expenseForm, category: e.target.value })}
                    className={`w-full px-6 py-4 ${currentTheme.isDark ? 'bg-emerald-900/10' : 'bg-slate-50'} border ${currentTheme.border} rounded-2xl focus:outline-none focus:ring-4 focus:ring-rose-500/5 focus:border-rose-500 transition-all text-sm font-semibold ${currentTheme.isDark ? 'text-emerald-500' : 'text-slate-800'}`}
                  >
                    <option value="Supplies">{t.supplies}</option>
                    <option value="Utilities">{t.utilities}</option>
                    <option value="Maintenance">{t.maintenance}</option>
                    <option value="Other">{t.other}</option>
                  </select>
                </div>
                <div className="space-y-2">
                  <label className={`text-[10px] font-black ${currentTheme.muted} uppercase tracking-widest`}>{t.description}</label>
                  <input 
                    required
                    type="text" 
                    value={expenseForm.description}
                    onChange={(e) => setExpenseForm({ ...expenseForm, description: e.target.value })}
                    className={`w-full px-6 py-4 ${currentTheme.isDark ? 'bg-emerald-900/10' : 'bg-slate-50'} border ${currentTheme.border} rounded-2xl focus:outline-none focus:ring-4 focus:ring-rose-500/5 focus:border-rose-500 transition-all text-sm font-semibold ${currentTheme.isDark ? 'text-emerald-500' : 'text-slate-800'}`}
                    placeholder={t.electricityBill}
                  />
                </div>
                <div className="grid grid-cols-2 gap-6">
                  <div className="space-y-2">
                    <label className={`text-[10px] font-black ${currentTheme.muted} uppercase tracking-widest`}>{t.amount} ({t.currency})</label>
                    <input 
                      required
                      type="number" 
                      value={expenseForm.amount}
                      onChange={(e) => setExpenseForm({ ...expenseForm, amount: e.target.value })}
                      className={`w-full px-6 py-4 ${currentTheme.isDark ? 'bg-emerald-900/10' : 'bg-slate-50'} border ${currentTheme.border} rounded-2xl focus:outline-none focus:ring-4 focus:ring-rose-500/5 focus:border-rose-500 transition-all text-sm font-semibold ${currentTheme.isDark ? 'text-emerald-500' : 'text-slate-800'}`}
                      placeholder="25 000"
                    />
                  </div>
                  <div className="space-y-2">
                    <label className={`text-[10px] font-black ${currentTheme.muted} uppercase tracking-widest`}>{t.date}</label>
                    <input 
                      required
                      type="date" 
                      value={expenseForm.date}
                      onChange={(e) => setExpenseForm({ ...expenseForm, date: e.target.value })}
                      className={`w-full px-6 py-4 ${currentTheme.isDark ? 'bg-emerald-900/10' : 'bg-slate-50'} border ${currentTheme.border} rounded-2xl focus:outline-none focus:ring-4 focus:ring-rose-500/5 focus:border-rose-500 transition-all text-sm font-semibold ${currentTheme.isDark ? 'text-emerald-500' : 'text-slate-800'}`}
                    />
                  </div>
                </div>
                <button type="submit" className="w-full bg-rose-500 hover:bg-rose-600 text-white py-5 rounded-2xl font-black text-sm transition-all shadow-xl shadow-rose-500/20">
                  {t.submit}
                </button>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* --- Vendor Expense Modal --- */}
      <AnimatePresence>
        {showVendorExpenseModal && (
          <div ref={(el) => { overlayRoots.current[3] = el; }} role="dialog" aria-modal="true" aria-label={editingVendorExpense ? t.editVendorExpense : t.addVendorExpense} aria-labelledby="modal-title-vendor-expense-form" className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => {
                setShowVendorExpenseModal(false);
                setEditingVendorExpense(null);
              }}
              className="absolute inset-0 bg-slate-900/60 backdrop-blur-md"
            />
            <motion.div 
              initial={{ opacity: 0, scale: 0.9, y: 40 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 40 }}
              className={`relative ${currentTheme.card} w-full max-w-lg rounded-[3rem] shadow-2xl border ${currentTheme.border} overflow-hidden`}
            >
              <div className={`p-8 border-b ${currentTheme.border} flex justify-between items-center ${currentTheme.isDark ? 'bg-emerald-800' : 'bg-blue-600'} text-white`}>
                <h2 id="modal-title-vendor-expense-form" className="text-xl font-bold flex items-center gap-3">
                  <Receipt size={24} />
                  {editingVendorExpense ? t.editVendorExpense : t.addVendorExpense}
                </h2>
                <button 
                  onClick={() => {
                    setShowVendorExpenseModal(false);
                    setEditingVendorExpense(null);
                  }} 
                  className="p-2 hover:bg-white/10 rounded-xl transition-all"
                >
                  <X size={20} />
                </button>
              </div>

              <form onSubmit={handleVendorExpenseSubmit} className="p-10 space-y-6">
                {/* Vendor Name */}
                <div className="space-y-2">
                  <label className={`text-[10px] font-black ${currentTheme.muted} uppercase tracking-widest flex items-center justify-between`}>
                    <span>{t.vendorName}</span>
                    {!isPromoter && <span className="text-[9px] text-rose-500 font-bold">({t.promoterOnly})</span>}
                  </label>
                  <input 
                    required
                    type="text" 
                    value={vendorExpenseForm.vendorName}
                    disabled={!isPromoter}
                    onChange={(e) => setVendorExpenseForm({ ...vendorExpenseForm, vendorName: e.target.value })}
                    className={`w-full px-6 py-4 border rounded-2xl focus:outline-none transition-all text-sm font-semibold ${!isPromoter ? 'bg-slate-100 cursor-not-allowed opacity-70' : currentTheme.input}`}
                    placeholder={t.eGSenelec}
                  />
                </div>

                <div className="grid grid-cols-2 gap-6">
                  {/* Category */}
                  <div className="space-y-2">
                    <label className={`text-[10px] font-black ${currentTheme.muted} uppercase tracking-widest`}>{t.category}</label>
                    <select 
                      value={vendorExpenseForm.category}
                      onChange={(e) => setVendorExpenseForm({ ...vendorExpenseForm, category: e.target.value })}
                      className={`w-full px-6 py-4 border rounded-2xl focus:outline-none transition-all text-sm font-semibold ${currentTheme.input}`}
                    >
                      {expenseCategoryList.map(item => (
                        <option key={item.key} value={item.key}>{item.label}</option>
                      ))}
                    </select>
                  </div>

                  {/* Payment Status */}
                  <div className="space-y-2">
                    <label className={`text-[10px] font-black ${currentTheme.muted} uppercase tracking-widest`}>{t.paymentStatus}</label>
                    <select 
                      value={vendorExpenseForm.paymentStatus}
                      onChange={(e) => setVendorExpenseForm({ ...vendorExpenseForm, paymentStatus: e.target.value })}
                      className={`w-full px-6 py-4 border rounded-2xl focus:outline-none transition-all text-sm font-semibold ${currentTheme.input}`}
                    >
                      <option value="unpaid">{t.unpaid}</option>
                      <option value="partial">{t.partialPaid}</option>
                      <option value="paid">{t.fullyPaid}</option>
                    </select>
                  </div>
                </div>

                {/* Conditional Welfare Aid / Social Cases sub-fields */}
                {vendorExpenseForm.category === 'social_cases' && (
                  <div className={`p-6 ${currentTheme.isDark ? 'bg-rose-950/10' : 'bg-rose-50/40'} border ${currentTheme.isDark ? 'border-rose-950/30' : 'border-rose-100'} rounded-3xl space-y-4`}>
                    <p className="text-xs font-black uppercase tracking-widest text-rose-500 flex items-center gap-2">
                      <Heart size={14} className="text-rose-500 fill-rose-500/10" />
                      {t.studentWelfareSocialAidDetails}
                    </p>
                    
                    {/* Aid Type Dropdown */}
                    <div className="space-y-2">
                      <label className={`text-[10px] font-black ${currentTheme.muted} uppercase tracking-widest`}>
                        {t.typeOfAid}
                      </label>
                      <select 
                        required={vendorExpenseForm.category === 'social_cases'}
                        value={vendorExpenseForm.aidType}
                        onChange={(e) => setVendorExpenseForm({ ...vendorExpenseForm, aidType: e.target.value })}
                        className={`w-full px-6 py-4 border rounded-2xl focus:outline-none transition-all text-sm font-semibold ${currentTheme.input}`}
                      >
                        <option value="">{t.selectTypeOfAid}</option>
                        <option value="prise_en_charge">{t.tuitionWaiverPriseEnChargeScolarit}</option>
                        <option value="kits_fournitures">{t.suppliesSupportKitsScolairesFournitures}</option>
                        <option value="aide_urgence">{t.emergencyAidAideDUrgence}</option>
                      </select>
                    </div>

                    {/* Student Link Fields */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <label className={`text-[10px] font-black ${currentTheme.muted} uppercase tracking-widest`}>
                          {t.beneficiaryStudentNameOptional}
                        </label>
                        <input 
                          type="text" 
                          value={vendorExpenseForm.beneficiaryStudentName}
                          onChange={(e) => setVendorExpenseForm({ ...vendorExpenseForm, beneficiaryStudentName: e.target.value })}
                          className={`w-full px-6 py-4 border rounded-2xl focus:outline-none transition-all text-sm font-semibold ${currentTheme.input}`}
                          placeholder={t.eGIbrahimThera}
                        />
                      </div>
                      <div className="space-y-2">
                        <label className={`text-[10px] font-black ${currentTheme.muted} uppercase tracking-widest`}>
                          {t.studentGradeOptional}
                        </label>
                        <select 
                          value={vendorExpenseForm.beneficiaryStudentGrade}
                          onChange={(e) => setVendorExpenseForm({ ...vendorExpenseForm, beneficiaryStudentGrade: e.target.value })}
                          className={`w-full px-6 py-4 border rounded-2xl focus:outline-none transition-all text-sm font-semibold ${currentTheme.input}`}
                        >
                          <option value="">{t.selectGrade}</option>
                          <optgroup label={t.firstCyclePremierCycle}>
                            {availableClasses.filter(c => c.cycle === 'cycle1').map(c => (
                              <option key={c.id} value={c.id}>{lang === 'en' ? c.nameEn : c.nameFr}</option>
                            ))}
                          </optgroup>
                          <optgroup label={'Second Cycle'}>
                            {availableClasses.filter(c => c.cycle === 'cycle2').map(c => (
                              <option key={c.id} value={c.id}>{lang === 'en' ? c.nameEn : c.nameFr}</option>
                            ))}
                          </optgroup>
                          {availableClasses.some(c => c.cycle !== 'cycle1' && c.cycle !== 'cycle2') && (
                            <optgroup label={t.otherClasses}>
                              {availableClasses.filter(c => c.cycle !== 'cycle1' && c.cycle !== 'cycle2').map(c => (
                                <option key={c.id} value={c.id}>{lang === 'en' ? c.nameEn : c.nameFr}</option>
                              ))}
                            </optgroup>
                          )}
                        </select>
                      </div>
                    </div>
                  </div>
                )}

                <div className="grid grid-cols-2 gap-6">
                  {/* Total Amount */}
                  <div className="space-y-2">
                    <label className={`text-[10px] font-black ${currentTheme.muted} uppercase tracking-widest flex items-center justify-between`}>
                      <span>{t.amount} (XOF)</span>
                      {!isPromoter && <span className="text-[9px] text-rose-500 font-bold">({t.promoterOnly})</span>}
                    </label>
                    <input 
                      required
                      type="number" 
                      value={vendorExpenseForm.amount}
                      disabled={!isPromoter}
                      onChange={(e) => setVendorExpenseForm({ ...vendorExpenseForm, amount: e.target.value })}
                      className={`w-full px-6 py-4 border rounded-2xl focus:outline-none transition-all text-sm font-semibold ${!isPromoter ? 'bg-slate-100 cursor-not-allowed opacity-70' : currentTheme.input}`}
                      placeholder="50000"
                    />
                  </div>

                  {/* Due Date */}
                  <div className="space-y-2">
                    <label className={`text-[10px] font-black ${currentTheme.muted} uppercase tracking-widest`}>{t.dueDate2}</label>
                    <input 
                      required
                      type="date" 
                      value={vendorExpenseForm.dueDate}
                      onChange={(e) => setVendorExpenseForm({ ...vendorExpenseForm, dueDate: e.target.value })}
                      className={`w-full px-6 py-4 border rounded-2xl focus:outline-none transition-all text-sm font-semibold ${currentTheme.input}`}
                    />
                  </div>
                </div>

                {/* Amount Paid - Only visible if Partially Paid */}
                {vendorExpenseForm.paymentStatus === 'partial' && (
                  <div className="space-y-2">
                    <label className={`text-[10px] font-black ${currentTheme.muted} uppercase tracking-widest`}>{t.amountPaid} (XOF)</label>
                    <input 
                      required
                      type="number" 
                      value={vendorExpenseForm.amountPaid}
                      onChange={(e) => setVendorExpenseForm({ ...vendorExpenseForm, amountPaid: e.target.value })}
                      className={`w-full px-6 py-4 border rounded-2xl focus:outline-none transition-all text-sm font-semibold ${currentTheme.input}`}
                      placeholder="20000"
                    />
                  </div>
                )}

                {/* Description */}
                <div className="space-y-2">
                  <label className={`text-[10px] font-black ${currentTheme.muted} uppercase tracking-widest`}>{t.description}</label>
                  <input 
                    type="text" 
                    value={vendorExpenseForm.description}
                    onChange={(e) => setVendorExpenseForm({ ...vendorExpenseForm, description: e.target.value })}
                    className={`w-full px-6 py-4 border rounded-2xl focus:outline-none transition-all text-sm font-semibold ${currentTheme.input}`}
                    placeholder={t.optionalNotes}
                  />
                </div>

                <button 
                  type="submit" 
                  className={`w-full ${currentTheme.isDark ? 'bg-emerald-600 hover:bg-emerald-700' : 'bg-blue-600 hover:bg-blue-700'} text-white py-5 rounded-2xl font-black text-sm transition-all shadow-xl`}
                >
                  {t.submit}
                </button>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* --- Salary Payment Modal --- */}
      <AnimatePresence>
        {showSalaryModal && (
          <div ref={(el) => { overlayRoots.current[4] = el; }} role="dialog" aria-modal="true" aria-label={t.recordSalary} aria-labelledby="modal-title-record-salary" className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowSalaryModal(false)}
              className="absolute inset-0 bg-slate-900/60 backdrop-blur-md"
            />
            <motion.div 
              initial={{ opacity: 0, scale: 0.9, y: 40 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 40 }}
              className={`relative ${currentTheme.card} w-full max-w-lg rounded-[3rem] shadow-2xl border ${currentTheme.border} overflow-hidden`}
            >
              <div className="p-8 border-b border-slate-50 flex justify-between items-center bg-[#0F172A] text-white" style={{ backgroundColor: currentTheme.header }}>
                <h2 id="modal-title-record-salary" className="text-xl font-bold flex items-center gap-3">
                  <DollarSign size={24} className="text-emerald-400" />
                  {t.recordSalaryPayment}
                </h2>
                <button onClick={() => setShowSalaryModal(false)} className="p-2 hover:bg-white/10 rounded-xl transition-all">
                  <X size={20} />
                </button>
              </div>

              <form onSubmit={handleSalarySubmit} className="p-10 space-y-6">
                <div className="space-y-2">
                  <label className={`text-[10px] font-black ${currentTheme.muted} uppercase tracking-widest`}>{t.staffName}</label>
                  <select 
                    required
                    value={salaryForm.staffId}
                    onChange={(e) => {
                      const sId = e.target.value;
                      const s = staff.find(st => st.id === sId);
                      if (s) {
                        const paid = salaryPayments
                          .filter(p => p.staffId === sId && new Date(p.date).getMonth() === currentMonth)
                          .reduce((sum, p) => sum + p.amount, 0);
                        setSalaryForm({ ...salaryForm, staffId: sId, amount: (s.salary - paid).toString() });
                      } else {
                        setSalaryForm({ ...salaryForm, staffId: sId });
                      }
                    }}
                    className={`w-full px-6 py-4 ${currentTheme.isDark ? 'bg-emerald-900/10' : 'bg-slate-50'} border ${currentTheme.border} rounded-2xl focus:outline-none focus:ring-4 focus:ring-blue-500/5 focus:border-blue-500 transition-all text-sm font-semibold ${currentTheme.isDark ? 'text-emerald-500' : 'text-slate-800'}`}
                  >
                    <option value="">{t.selectStaff}</option>
                    {staff.map(s => {
                      const paid = salaryPayments
                        .filter(p => p.staffId === s.id && new Date(p.date).getMonth() === currentMonth)
                        .reduce((sum, p) => sum + p.amount, 0);
                      const bal = s.salary - paid;
                      return (
                        <option key={s.id} value={s.id}>{s.name} ({formatCurrency(bal)} {t.remainingBalance})</option>
                      );
                    })}
                  </select>
                </div>
                {salaryForm.staffId && (
                  <div className={`p-4 rounded-2xl ${currentTheme.isDark ? 'bg-emerald-900/20' : 'bg-slate-50'} border ${currentTheme.border}`}>
                    <div className="flex justify-between items-center text-xs">
                      <span className={currentTheme.muted}>{t.remainingBalance}</span>
                      <span className="font-black text-rose-600">
                        {(() => {
                          const s = staff.find(st => st.id === salaryForm.staffId);
                          if (!s) return formatCurrency(0);
                          const paid = salaryPayments
                            .filter(p => p.staffId === s.id && new Date(p.date).getMonth() === currentMonth)
                            .reduce((sum, p) => sum + p.amount, 0);
                          return formatCurrency(s.salary - paid);
                        })()}
                      </span>
                    </div>
                  </div>
                )}
                <div className="grid grid-cols-2 gap-6">
                  <div className="space-y-2">
                    <label className={`text-[10px] font-black ${currentTheme.muted} uppercase tracking-widest`}>{t.amount} ({t.currency})</label>
                    <input 
                      required
                      type="number" 
                      value={salaryForm.amount}
                      onChange={(e) => setSalaryForm({ ...salaryForm, amount: e.target.value })}
                      className={`w-full px-6 py-4 ${currentTheme.isDark ? 'bg-emerald-900/10' : 'bg-slate-50'} border ${currentTheme.border} rounded-2xl focus:outline-none focus:ring-4 focus:ring-blue-500/5 focus:border-blue-500 transition-all text-sm font-semibold ${currentTheme.isDark ? 'text-emerald-500' : 'text-slate-800'}`}
                    />
                  </div>
                  <div className="space-y-2">
                    <label className={`text-[10px] font-black ${currentTheme.muted} uppercase tracking-widest`}>{t.date}</label>
                    <input 
                      required
                      type="date" 
                      value={salaryForm.date}
                      onChange={(e) => setSalaryForm({ ...salaryForm, date: e.target.value })}
                      className={`w-full px-6 py-4 ${currentTheme.isDark ? 'bg-emerald-900/10' : 'bg-slate-50'} border ${currentTheme.border} rounded-2xl focus:outline-none focus:ring-4 focus:ring-blue-500/5 focus:border-blue-500 transition-all text-sm font-semibold ${currentTheme.isDark ? 'text-emerald-500' : 'text-slate-800'}`}
                    />
                  </div>
                </div>

                {salaryForm.staffId && salaryForm.amount && (
                  <button 
                    type="button"
                    onClick={() => generateInstallmentMemo(salaryForm.staffId, parseFloat(salaryForm.amount))}
                    className={`w-full py-4 rounded-2xl border ${currentTheme.isDark ? 'border-emerald-900/30 text-emerald-500 hover:bg-emerald-900/10' : 'border-slate-100 text-slate-600 hover:bg-slate-50'} text-xs font-bold transition-all flex items-center justify-center gap-2`}
                  >
                    <Copy size={16} />
                    {t.generateMemo}
                  </button>
                )}

                <button type="submit" className="w-full bg-emerald-600 hover:bg-emerald-700 text-white py-5 rounded-2xl font-black text-sm transition-all shadow-xl shadow-emerald-500/20">
                  {t.submit}
                </button>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* --- Calendar Day Modal --- */}
      <AnimatePresence>
        {showCalendarModal && selectedCalendarDay && (
          <div ref={(el) => { overlayRoots.current[5] = el; }} role="dialog" aria-modal="true" aria-label={t.paymentHistory} aria-labelledby="modal-title-payment-history" className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowCalendarModal(false)}
              className="absolute inset-0 bg-slate-900/60 backdrop-blur-md"
            />
            <motion.div 
              initial={{ opacity: 0, scale: 0.9, y: 40 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 40 }}
              className={`relative ${currentTheme.card} w-full max-w-lg rounded-[3rem] shadow-2xl border ${currentTheme.border} overflow-hidden`}
            >
              <div className="p-8 border-b border-slate-50 flex justify-between items-center bg-[#0F172A] text-white" style={{ backgroundColor: currentTheme.header }}>
                <h2 id="modal-title-payment-history" className="text-xl font-bold flex flex-col">
                  <span className="text-sm opacity-70 uppercase tracking-widest font-black">{getDayName(selectedCalendarDay.getDay())}</span>
                  <span>{selectedCalendarDay.toLocaleDateString(lang === 'en' ? 'en-US' : 'fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })}</span>
                </h2>
                <button onClick={() => setShowCalendarModal(false)} className="p-2 hover:bg-white/10 rounded-xl transition-all">
                  <X size={20} />
                </button>
              </div>

              <div className="p-10 space-y-8 max-h-[60vh] overflow-y-auto custom-scrollbar">
                {(() => {
                  const dayEvents = getEventsForDay(selectedCalendarDay);
                  const dayNotes = getNotesForDay(selectedCalendarDay);
                  if (dayEvents.length === 0 && dayNotes.length === 0) {
                    return (
                      <div className="py-10 text-center">
                        <div className={`w-16 h-16 rounded-full ${currentTheme.isDark ? 'bg-emerald-900/20 text-emerald-500' : 'bg-slate-100 text-slate-400'} flex items-center justify-center mx-auto mb-4`}>
                          <Calendar size={32} />
                        </div>
                        <p className={currentTheme.muted}>{t.noTasks}</p>
                      </div>
                    );
                  }

                  return (
                    <div className="space-y-6">
                      {dayNotes.length > 0 && (
                        <div className="p-6 rounded-2xl border border-yellow-200 bg-yellow-50/60">
                          <div className="flex items-center gap-4 mb-4">
                            <div className="p-3 rounded-xl bg-yellow-100 text-yellow-600">
                              <StickyNote size={20} />
                            </div>
                            <div>
                              <h4 className="font-black uppercase tracking-widest text-[10px] text-yellow-700">
                                {t.notes}
                              </h4>
                              <p className={`text-lg font-bold ${currentTheme.isDark ? 'text-emerald-400' : 'text-slate-800'}`}>
                                {dayNotes.length}
                              </p>
                            </div>
                          </div>
                          <div className="space-y-2">
                            {dayNotes.map((n) => (
                              <div key={n.id} className="flex justify-between items-start gap-3 text-sm py-2 border-t border-yellow-200">
                                {n.studentName && (
                                  <span className={`font-bold ${currentTheme.isDark ? 'text-emerald-500' : 'text-slate-800'} flex-shrink-0`}>{n.studentName}</span>
                                )}
                                <span className={`${currentTheme.muted} text-right`}>{n.text}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                      {dayEvents.map((event, idx) => (
                        <div key={idx} className={`p-6 rounded-2xl border ${currentTheme.border} ${
                          event.type === 'due' ? 'bg-rose-50/30' :
                          event.type === 'salary' ? 'bg-emerald-50/30' :
                          event.type === 'note' ? 'bg-yellow-50/60' :
                          event.type === 'todo' ? 'bg-violet-50/60' :
                          'bg-blue-50/30'
                        }`}>
                          <div className="flex items-center gap-4 mb-4">
                            <div className={`p-3 rounded-xl ${
                              event.type === 'due' ? 'bg-rose-100 text-rose-600' :
                              event.type === 'salary' ? 'bg-emerald-100 text-emerald-600' :
                              event.type === 'note' ? 'bg-yellow-100 text-yellow-600' :
                              event.type === 'todo' ? 'bg-violet-100 text-violet-600' :
                              'bg-blue-100 text-blue-600'
                            }`}>
                              {event.type === 'due' ? <Users size={20} /> : event.type === 'salary' ? <Briefcase size={20} /> : event.type === 'note' ? <StickyNote size={20} /> : event.type === 'todo' ? <CheckSquare size={20} /> : <Receipt size={20} />}
                            </div>
                            <div>
                              <h4 className={`font-black uppercase tracking-widest text-[10px] ${
                                event.type === 'due' ? 'text-rose-600' :
                                event.type === 'salary' ? 'text-emerald-600' :
                                event.type === 'note' ? 'text-yellow-700' :
                                event.type === 'todo' ? 'text-violet-600' :
                                'text-blue-600'
                              }`}>
                                {event.type === 'due' ? (t.studentFeesDue) : 
                                 event.type === 'salary' ? (t.staffSalaries) : 
                                 event.type === 'note' ? (t.notes) : 
                                 event.type === 'todo' ? (t.tasks) : 
                                 (t.expenses)}
                              </h4>
                              <p className={`text-lg font-bold ${currentTheme.isDark ? 'text-emerald-400' : 'text-slate-800'}`}>
                                {event.count}
                              </p>
                            </div>
                          </div>
                          
                          <div className="space-y-2">
                            {event.details?.map((detail, dIdx) => (
                              <div key={dIdx} className={`flex justify-between items-center text-sm py-2 border-t ${currentTheme.border}`}>
                                <span className={`${currentTheme.muted} ${detail.completed ? 'line-through opacity-60' : ''}`}>{detail.name}</span>
                                {detail.amount !== undefined && (
                                  <span className={`font-bold ${currentTheme.isDark ? 'text-emerald-500' : 'text-slate-800'}`}>{formatCurrency(detail.amount)}</span>
                                )}
                              </div>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  );
                })()}

                {/* Add a note on this date (Notes ⇄ Calendar bridge) */}
                <div className="pt-2 border-t border-slate-100">
                  <div className="bg-[#FEF9C3] p-5 rounded-2xl border border-yellow-200/70">                      <h4 className="text-[9px] font-black text-yellow-700 uppercase tracking-widest mb-3 flex items-center gap-1.5">
                      <StickyNote size={12} />
                      {t.addNoteForThisDay}
                    </h4>
                    <div className="space-y-2.5">
                      <textarea
                        value={noteText}
                        onChange={(e) => setNoteText(e.target.value)}
                        placeholder={t.notesPlaceholder}
                        rows={2}
                        className="w-full bg-white/70 border border-yellow-200 rounded-xl px-3 py-2 text-xs font-semibold text-yellow-900 placeholder-yellow-700/40 focus:outline-none focus:ring-2 focus:ring-yellow-500/30 resize-none custom-scrollbar"
                      />
                      <div className="flex justify-end">
                        <button
                          type="button"
                          disabled={savingNoteOnDate || !noteText.trim()}
                          onClick={() => { void saveNoteOnDate(selectedCalendarDay); }}
                          className="px-4 py-2 bg-yellow-500 hover:bg-yellow-600 disabled:opacity-40 disabled:cursor-not-allowed text-white rounded-xl text-xs font-bold transition-all active:scale-95"
                        >
                          {savingNoteOnDate ? t.saving : t.save}
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* --- Success Toast --- */}
      <AnimatePresence>
        {showSuccessToast && (
          <motion.div 
            initial={{ opacity: 0, y: 100 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 100 }}
            className="fixed bottom-10 left-1/2 -translate-x-1/2 z-[60] bg-emerald-600 text-white px-8 py-4 rounded-2xl shadow-2xl flex items-center gap-3 font-bold"
          >
            <CheckCircle2 size={20} />
            {t.successMessage}
          </motion.div>
        )}
      </AnimatePresence>

      {/* --- Welcome Toast --- */}
      <AnimatePresence>
        {welcomeMessage && (
          <motion.div 
            initial={{ opacity: 0, y: -100, scale: 0.9 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -100, scale: 0.9 }}
            className="fixed top-10 left-1/2 -translate-x-1/2 z-[110] bg-slate-900 text-white dark:bg-emerald-600 px-8 py-5 rounded-3xl shadow-2xl flex items-center gap-4 font-black text-sm border-2 border-emerald-500/20"
          >
            <div className="w-8 h-8 bg-emerald-500 rounded-xl flex items-center justify-center text-white">
              <ShieldCheck size={18} />
            </div>
            <div className="text-left">
              <p className="leading-tight">{welcomeMessage}</p>
              <p className="text-[10px] text-white/60 font-medium">
                {currentUser?.role === 'dev'
                  ? (t.systemDeveloperPortal)
                  : currentUser?.role === 'admin' 
                  ? (t.promoterOwnerPortal) 
                  : currentUser?.role === 'general_manager'
                  ? (t.generalManagerPortal)
                  : (t.accountantAccess)}
              </p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* --- To-Do Sidebar (Productivité panel) --- */}
      <AnimatePresence>
        {showTodoSidebar && (
          <ProductivityPanel
            t={t}
            open={showTodoSidebar}
            onClose={() => setShowTodoSidebar(false)}
            productivitySidebarTab={productivitySidebarTab}
            setProductivitySidebarTab={setProductivitySidebarTab}
            aiMessages={aiMessages}
            aiInput={aiInput}
            setAiInput={setAiInput}
            handleAiQuery={handleAiQuery}
            todoInput={todoInput}
            setTodoInput={setTodoInput}
            todoDate={todoDate}
            setTodoDate={setTodoDate}
            handleAddTodo={handleAddTodo}
            todos={todos}
            toggleTodo={toggleTodo}
            deleteTodo={deleteTodo}
            handleUpdateTodoDate={handleUpdateTodoDate}
            themeCard={currentTheme.card}
            themeBorder={currentTheme.border}
            themeMuted={currentTheme.muted}
            themeIsDark={currentTheme.isDark}
            themeHeader={currentTheme.header}
          />
        )}
      </AnimatePresence>

      {/* --- Payment Entry Modal --- */}
      <AnimatePresence>
        {showPaymentForm && (
          <div ref={(el) => { overlayRoots.current[6] = el; }} role="dialog" aria-modal="true" aria-label={t.paymentEntry} aria-labelledby="modal-title-payment-entry" className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowPaymentForm(false)}
              className="absolute inset-0 bg-slate-900/60 backdrop-blur-md"
            />
            <motion.div 
              initial={{ opacity: 0, scale: 0.9, y: 40 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 40 }}
              className={`relative ${currentTheme.card} w-full max-w-md rounded-[3rem] shadow-2xl border ${currentTheme.border} overflow-hidden`}
            >
              <div className="p-8 border-b border-slate-50 flex justify-between items-center bg-[#0F172A] text-white" style={{ backgroundColor: currentTheme.header }}>
                <h2 id="modal-title-payment-entry" className="text-xl font-bold flex items-center gap-3">
                  <CreditCard size={24} className="text-blue-400" />
                  {t.paymentEntry}
                </h2>
                <button 
                  onClick={() => setShowPaymentForm(false)}
                  className="p-2 hover:bg-white/10 rounded-xl transition-all"
                >
                  <X size={20} />
                </button>
              </div>

              <form onSubmit={handlePaymentSubmit} className="p-10 space-y-8">
                <div className="space-y-2">
                  <label className={`text-[10px] font-black ${currentTheme.muted} uppercase tracking-widest`}>{t.selectStudent}</label>
                  <select 
                    required
                    value={paymentStudentId}
                    onChange={(e) => setPaymentStudentId(e.target.value)}
                    className={`w-full px-6 py-4 ${currentTheme.isDark ? 'bg-emerald-900/10' : 'bg-slate-50'} border ${currentTheme.border} rounded-2xl focus:outline-none focus:ring-4 focus:ring-blue-500/5 focus:border-blue-500 transition-all text-sm font-semibold ${currentTheme.isDark ? 'text-emerald-500' : 'text-slate-800'}`}
                  >
                    <option value="" className={currentTheme.isDark ? 'bg-[#121212]' : 'bg-white'}>{t.selectStudent}...</option>
                    {students.map(s => (
                      <option key={s.id} value={s.id} className={currentTheme.isDark ? 'bg-[#121212]' : 'bg-white'}>{s.name} ({formatCurrency(s.totalDue * (1 - (s.scholarshipDiscount || 0) / 100) - s.amountPaid)} {t.balance})</option>
                    ))}
                  </select>
                </div>

                <div className="grid grid-cols-2 gap-6">
                  <div className="space-y-2">
                    <label className={`text-[10px] font-black ${currentTheme.muted} uppercase tracking-widest`}>{t.amount} ({t.currency})</label>
                    <div className="relative">
                      <input 
                        required
                        type="number" 
                        min="0"
                        step="1"
                        value={paymentAmount}
                        onChange={(e) => setPaymentAmount(e.target.value)}
                        className={`w-full px-6 py-4 ${currentTheme.isDark ? 'bg-emerald-900/10' : 'bg-slate-50'} border ${currentTheme.border} rounded-2xl focus:outline-none focus:ring-4 focus:ring-blue-500/5 focus:border-blue-500 transition-all text-sm font-semibold ${currentTheme.isDark ? 'text-emerald-500' : 'text-slate-800'}`}
                        placeholder="10 000"
                      />
                    </div>
                  </div>
                  <div className="space-y-2">
                    <label className={`text-[10px] font-black ${currentTheme.muted} uppercase tracking-widest`}>{t.paymentDate}</label>
                    <input 
                      required
                      type="date" 
                      value={paymentDate}
                      onChange={(e) => setPaymentDate(e.target.value)}
                      className={`w-full px-6 py-4 ${currentTheme.isDark ? 'bg-emerald-900/10' : 'bg-slate-50'} border ${currentTheme.border} rounded-2xl focus:outline-none focus:ring-4 focus:ring-blue-500/5 focus:border-blue-500 transition-all text-sm font-semibold ${currentTheme.isDark ? 'text-emerald-500' : 'text-slate-800'}`}
                    />
                  </div>
                </div>

                <button 
                  type="submit"
                  className="w-full bg-blue-600 hover:bg-blue-700 text-white py-5 rounded-2xl font-black text-sm transition-all shadow-xl shadow-blue-500/20 active:scale-[0.98]"
                >
                  {t.submit}
                </button>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* --- Yearly Final Audit Sheet Modal --- */}
      <AnimatePresence>
        {showAuditModal && auditYear && (
          <div ref={(el) => { overlayRoots.current[7] = el; }} role="dialog" aria-modal="true" aria-label={t.auditSheet} aria-labelledby="modal-title-audit-sheet" className="fixed inset-0 z-50 flex items-center justify-center p-4 no-print">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowAuditModal(false)}
              className="absolute inset-0 bg-slate-900/60 backdrop-blur-md"
            />
            <motion.div 
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className={`relative ${currentTheme.card} w-full max-w-4xl max-h-[85vh] overflow-y-auto rounded-[2.5rem] shadow-2xl border ${currentTheme.border} p-8 md:p-12 custom-scrollbar`}
            >
              {/* Modal header */}
              <div className="flex justify-between items-start mb-8 pb-6 border-b border-slate-100 dark:border-slate-800">
                <div className="flex items-center gap-4">
                  <div className="p-3 bg-emerald-50 text-emerald-600 rounded-2xl">
                    <TrendingUp size={24} />
                  </div>
                  <div>
                    <h3 id="modal-title-audit-sheet" className={`text-2xl font-black ${currentTheme.text}`}>
                      {t.finalAcademicAuditSheet}
                    </h3>
                    <p className={`text-sm ${currentTheme.muted} mt-0.5`}>
                      {t.certifiedFinancialReview.replace('{year}', auditYear)}
                    </p>
                  </div>
                </div>
                <button 
                  onClick={() => setShowAuditModal(false)}
                  className={`p-2 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-xl transition-all ${currentTheme.muted}`}
                >
                  <X size={20} />
                </button>
              </div>

              {/* Certified Document Content Preview */}
              <div className="p-8 border-2 border-slate-100 dark:border-slate-800 rounded-3xl bg-slate-50/50 dark:bg-slate-800/10 space-y-8 font-sans">
                {/* School Letterhead */}
                <div className="flex justify-between items-start border-b-2 border-slate-200 dark:border-slate-700 pb-6">
                  <div>
                    <h4 className="text-xl font-black text-slate-800 dark:text-slate-200 tracking-tight flex items-center gap-2">
                      {schoolLogo && (
                        <img src={schoolLogo} alt="Logo" className="w-8 h-8 rounded-lg object-cover" referrerPolicy="no-referrer" />
                      )}
                      {t.title}
                    </h4>
                    <p className="text-xs text-slate-500 mt-1 uppercase tracking-wider font-bold">{t.subtitle}</p>
                    <p className="text-[10px] text-slate-400">Ségou, Mali</p>
                  </div>
                  <div className="text-right">
                    <span className="px-3 py-1 bg-emerald-100 text-emerald-800 text-[10px] font-black rounded-full uppercase tracking-wider">
                      {t.archivedCertified}
                    </span>
                    <p className="text-xs text-slate-500 mt-2 font-bold">{t.date2} {new Date().toLocaleDateString(lang === 'en' ? 'en-US' : 'fr-FR')}</p>
                    <p className="text-[10px] text-slate-400">{t.auditId} AUD-{auditYear}-{Math.floor(1000 + Math.random() * 9000)}</p>
                  </div>
                </div>

                {/* Main Metrics Aggregation */}
                {(() => {
                  const { revenue, expenses, balance } = getYearStats(auditYear);
                  return (
                    <div className="space-y-6">
                      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                        <div className="p-6 bg-emerald-50/50 dark:bg-emerald-950/10 rounded-2xl border border-emerald-100 dark:border-emerald-950">
                          <span className="text-xs font-bold text-emerald-700 dark:text-emerald-400 uppercase tracking-wider">{t.totalRevenueA}</span>
                          <p className="text-2xl font-black text-emerald-600 mt-1">{formatCurrency(revenue)}</p>
                          <p className="text-[10px] text-slate-400 mt-1">{t.actualStudentFeesPaid}</p>
                        </div>

                        <div className="p-6 bg-rose-50/50 dark:bg-rose-950/10 rounded-2xl border border-rose-100 dark:border-rose-950">
                          <span className="text-xs font-bold text-rose-700 dark:text-rose-400 uppercase tracking-wider">{t.totalExpensesB}</span>
                          <p className="text-2xl font-black text-rose-600 mt-1">{formatCurrency(expenses)}</p>
                          <p className="text-[10px] text-slate-400 mt-1">{t.salariesVendorsUtilityPayments}</p>
                        </div>

                        <div className={`p-6 ${balance >= 0 ? 'bg-teal-50/50 dark:bg-teal-950/10 border-teal-100 dark:border-teal-950' : 'bg-red-50/50 dark:bg-red-950/10 border-red-100 dark:border-red-950'} rounded-2xl border`}>
                          <span className={`text-xs font-bold ${balance >= 0 ? 'text-teal-700 dark:text-teal-400' : 'text-red-700 dark:text-red-400'} uppercase tracking-wider`}>{t.netBalanceAB}</span>
                          <p className={`text-2xl font-black ${balance >= 0 ? 'text-teal-600' : 'text-red-600'} mt-1`}>{formatCurrency(balance)}</p>
                          <p className="text-[10px] text-slate-400 mt-1">{t.finalCashLedgerBalance}</p>
                        </div>
                      </div>

                      {/* Debts Carried Over (Reliquats) */}
                      {(() => {
                        const closedYearStudents = students.filter(s => s.academicYear === auditYear || (!s.academicYear && auditYear === '2024-2025'));
                        const studentsWithDebt = closedYearStudents.filter(s => {
                          const discount = s.scholarshipDiscount || 0;
                          const discountedTotal = s.totalDue * (1 - discount / 100);
                          return (discountedTotal - s.amountPaid) > 0;
                        });

                        return (
                          <div className="space-y-3 pt-4 border-t border-slate-200 dark:border-slate-700">
                            <h5 className="font-extrabold text-sm text-slate-700 dark:text-slate-300 uppercase tracking-wider">
                              {t.outstandingParentDebtsCarriedForward}
                            </h5>
                            {studentsWithDebt.length > 0 ? (
                              <div className="max-h-[200px] overflow-y-auto rounded-2xl border border-slate-100 dark:border-slate-800">
                                <table className="w-full text-left text-xs">
                                  <thead>
                                    <tr className="bg-slate-100 dark:bg-slate-800 border-b border-slate-200 dark:border-slate-700 font-bold text-slate-600 dark:text-slate-300">
                                      <th className="px-4 py-2.5">{t.studentName2}</th>
                                      <th className="px-4 py-2.5">{t.parentContact2}</th>
                                      <th className="px-4 py-2.5 text-right">{t.unpaidBalance}</th>
                                    </tr>
                                  </thead>
                                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                                    {studentsWithDebt.map(student => {
                                      const discount = student.scholarshipDiscount || 0;
                                      const discountedTotal = student.totalDue * (1 - discount / 100);
                                      const debt = discountedTotal - student.amountPaid;
                                      return (
                                        <tr key={student.id} className="text-slate-700 dark:text-slate-300">
                                          <td className="px-4 py-2 font-bold">{student.name}</td>
                                          <td className="px-4 py-2">{student.parentName} ({student.parentPhone})</td>
                                          <td className="px-4 py-2 text-right font-semibold text-rose-600">{formatCurrency(debt)}</td>
                                        </tr>
                                      );
                                    })}
                                  </tbody>
                                </table>
                              </div>
                            ) : (
                              <p className="text-xs text-slate-400 italic">
                                {t.noOutstandingStudentDebtsRecordedForCarryforward}
                              </p>
                            )}
                          </div>
                        );
                      })()}
                    </div>
                  );
                })()}

                {/* Audit Signature Block */}
                <div className="flex justify-between items-center pt-8 border-t-2 border-slate-200 dark:border-slate-700 text-xs">
                  <div>
                    <p className="font-bold text-slate-500">{t.certifiedBy}</p>
                    <p className="font-black text-slate-800 dark:text-slate-200 mt-1">Ibrahim Thera, Portal Admin</p>
                    <p className="text-slate-400 text-[10px]">{t.financeController}</p>
                  </div>
                  <div className="text-right">
                    <p className="font-bold text-slate-500">{t.sealSignature}</p>
                    <div className="h-10 w-40 border-b border-dashed border-slate-300 dark:border-slate-600 mt-2 ml-auto" />
                    <p className="text-[9px] text-slate-400 mt-1">Ibrahim Thera / Executive Signature</p>
                  </div>
                </div>
              </div>

              {/* Modal Actions */}
              <div className="flex justify-end gap-4 mt-8 pt-6 border-t border-slate-100 dark:border-slate-800">
                <button 
                  onClick={() => setShowAuditModal(false)}
                  className={`px-6 py-3 rounded-2xl border ${currentTheme.border} ${currentTheme.text} hover:bg-slate-50 text-sm font-bold transition-all`}
                >
                  {t.closePreview}
                </button>
                <button 
                  onClick={() => {
                    setTimeout(() => window.print(), 100);
                  }}
                  className="bg-emerald-600 hover:bg-emerald-700 text-white font-extrabold px-8 py-3 rounded-2xl text-sm transition-all flex items-center gap-2 shadow-lg shadow-emerald-600/20"
                >
                  <Printer size={18} />
                  {t.printAudit}
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* --- Personalized Late Payment Ticket Modal --- */}
      <AnimatePresence>
        {ticketStudent && (() => {
          const discount = ticketStudent.scholarshipDiscount || 0;
          const discountedTotal = ticketStudent.totalDue * (1 - discount / 100);
          const balance = discountedTotal - ticketStudent.amountPaid;
          
          return (
            <div ref={(el) => { overlayRoots.current[8] = el; }} role="dialog" aria-modal="true" aria-label={t.latePaymentTicket} aria-labelledby="modal-title-late-payment-ticket" className="fixed inset-0 z-50 flex items-center justify-center p-4 no-print">
              <motion.div 
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                onClick={() => setTicketStudent(null)}
                className="absolute inset-0 bg-slate-900/60 backdrop-blur-md"
              />
              <motion.div 
                initial={{ opacity: 0, scale: 0.9, y: 40 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.9, y: 40 }}
                className={`relative ${currentTheme.card} w-full max-w-lg rounded-[3rem] shadow-2xl border ${currentTheme.border} overflow-hidden`}
              >
                <div className="p-8 border-b border-slate-50 flex justify-between items-center bg-[#0F172A] text-white" style={{ backgroundColor: currentTheme.header }}>
                  <h2 id="modal-title-late-payment-ticket" className="text-xl font-bold flex items-center gap-3">
                    <Printer size={24} className="text-rose-400" />
                    {t.latePaymentTicket}
                  </h2>
                  <button 
                    onClick={() => setTicketStudent(null)}
                    className="p-2 hover:bg-white/10 rounded-xl transition-all"
                  >
                    <X size={20} />
                  </button>
                </div>

                <div className="p-10 space-y-6 max-h-[60vh] overflow-y-auto custom-scrollbar">
                  {/* Visual Slip Preview on Screen */}
                  <div className="border border-slate-200 rounded-2xl p-6 bg-slate-50 font-mono text-xs text-slate-800 space-y-4 shadow-inner">
                    <div className="text-center border-b border-dashed border-slate-300 pb-4">
                      <h3 className="font-bold text-base uppercase tracking-wider">{t.title}</h3>
                      <p className="text-[10px] text-slate-500">{t.subtitle}</p>
                      <h4 className="font-black text-rose-600 mt-2 text-sm uppercase tracking-widest">
                        {t.latePaymentTicket2}
                      </h4>
                    </div>

                    <div className="space-y-2 py-2">
                      <div className="flex justify-between">
                        <span className="font-bold">STUDENT:</span>
                        <span>{ticketStudent.name}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="font-bold">GRADE:</span>
                        <span>Classe : {getGradeDisplay(ticketStudent.grade, 'fr')} / Grade: {getGradeDisplay(ticketStudent.grade, 'en')}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="font-bold">PARENT:</span>
                        <span>{ticketStudent.parentName}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="font-bold">DUE DATE:</span>
                        <span>{formatDate(ticketStudent.dueDate)}</span>
                      </div>
                      <div className="flex justify-between border-t border-dashed border-slate-300 pt-2 text-rose-600 font-bold">
                        <span>TOTAL OWED:</span>
                        <span>{formatCurrency(balance)}</span>
                      </div>
                    </div>

                    <div className="border-t border-dashed border-slate-300 pt-4 text-center text-[10px] text-slate-600 leading-relaxed italic">
                      {t.overdueNotice}
                    </div>
                  </div>

                  <div className="flex gap-4">
                    <button 
                      onClick={() => {
                        setTimeout(() => window.print(), 100);
                      }}
                      className="flex-1 bg-rose-600 hover:bg-rose-700 text-white py-4 rounded-2xl font-black text-sm transition-all shadow-xl shadow-rose-500/20 flex items-center justify-center gap-2"
                    >
                      <Printer size={18} />
                      {t.printTicket}
                    </button>
                    <button 
                      onClick={() => setTicketStudent(null)}
                      className={`px-8 py-4 border ${currentTheme.border} ${currentTheme.muted} hover:text-slate-600 hover:bg-slate-50 rounded-2xl font-bold text-sm transition-all`}
                    >
                      {t.close}
                    </button>
                  </div>
                </div>
              </motion.div>
            </div>
          );
        })()}
      </AnimatePresence>

      {/* --- Actual Printable Ticket Hidden on Screen --- */}
      {ticketStudent && (() => {
        const discount = ticketStudent.scholarshipDiscount || 0;
        const discountedTotal = ticketStudent.totalDue * (1 - discount / 100);
        const balance = discountedTotal - ticketStudent.amountPaid;
        
        return (
          <div className="hidden print:block ticket-print-container font-mono text-sm text-black space-y-6">
            <div className="text-center border-b border-black pb-4">
              <h1 className="font-bold text-xl uppercase tracking-wider">{t.title}</h1>
              <p className="text-xs text-black/70">{t.subtitle}</p>
              <h2 className="font-bold text-lg mt-3 uppercase tracking-widest border border-black px-2 py-1 inline-block">
                {t.latePaymentTicket2}
              </h2>
            </div>

            <div className="space-y-3 py-2 text-base">
              <div className="flex justify-between">
                <span className="font-bold">STUDENT:</span>
                <span>{ticketStudent.name}</span>
              </div>
              <div className="flex justify-between">
                <span className="font-bold">GRADE:</span>
                <span>Classe : {getGradeDisplay(ticketStudent.grade, 'fr')} / Grade: {getGradeDisplay(ticketStudent.grade, 'en')}</span>
              </div>
              <div className="flex justify-between">
                <span className="font-bold">PARENT:</span>
                <span>{ticketStudent.parentName}</span>
              </div>
              <div className="flex justify-between">
                <span className="font-bold">DUE DATE:</span>
                <span>{formatDate(ticketStudent.dueDate)}</span>
              </div>
              <div className="flex justify-between border-t border-black pt-2 font-bold text-lg">
                <span>TOTAL OWED:</span>
                <span>{formatCurrency(balance)}</span>
              </div>
            </div>

            <div className="border-t border-black pt-4 text-center text-xs leading-relaxed font-bold italic">
              {t.overdueNotice}
            </div>

            <div className="text-center text-[10px] pt-8 border-t border-black/10">
              <p>{t.generatedOn} {formatDate(new Date().toISOString())}</p>
              <p className="mt-2 text-[8px] tracking-widest uppercase">{t.officialFinancialReceipt}</p>
            </div>
          </div>
        );
      })()}

      {/* --- Actual Printable Audit Report Hidden on Screen --- */}
      {auditYear && (() => {
        const { revenue, expenses, balance } = getYearStats(auditYear);
        const closedYearStudents = students.filter(s => s.academicYear === auditYear || (!s.academicYear && auditYear === '2024-2025'));
        const studentsWithDebt = closedYearStudents.filter(s => {
          const discount = s.scholarshipDiscount || 0;
          const discountedTotal = s.totalDue * (1 - discount / 100);
          return (discountedTotal - s.amountPaid) > 0;
        });

        return (
          <div className="hidden print:block print-container bg-white text-black font-sans space-y-8">
            <div className="text-center border-b-2 border-black pb-4">
              <h1 className="font-bold text-2xl uppercase tracking-wider">{t.title}</h1>
              <p className="text-xs text-black/70 uppercase tracking-widest">{t.subtitle}</p>
              <h2 className="font-black text-lg mt-3 uppercase tracking-wider border-2 border-black px-4 py-2 inline-block">
                {t.finalAcademicAuditReport}
              </h2>
              <p className="text-sm mt-2 font-semibold">{t.academicYear3} : {auditYear}</p>
            </div>

            <div className="grid grid-cols-3 gap-4 text-center py-4 border-b border-black">
              <div className="border border-black p-4 rounded-xl">
                <span className="text-[10px] font-bold block uppercase tracking-wide">{t.totalRevenue}</span>
                <span className="text-lg font-black">{formatCurrency(revenue)}</span>
              </div>
              <div className="border border-black p-4 rounded-xl">
                <span className="text-[10px] font-bold block uppercase tracking-wide">{t.totalExpenses2}</span>
                <span className="text-lg font-black">{formatCurrency(expenses)}</span>
              </div>
              <div className="border border-black p-4 rounded-xl">
                <span className="text-[10px] font-bold block uppercase tracking-wide">{t.netClosingBalance}</span>
                <span className="text-lg font-black">{formatCurrency(balance)}</span>
              </div>
            </div>

            {/* Debts Carried Over */}
            <div className="space-y-3">
              <h3 className="font-bold text-sm uppercase tracking-wider">
                {t.outstandingParentDebtsCarriedForwardReliquats}
              </h3>
              {studentsWithDebt.length > 0 ? (
                <table className="w-full text-left text-xs border border-black">
                  <thead>
                    <tr className="bg-slate-100 border-b border-black font-bold">
                      <th className="px-3 py-2 border-r border-black">{t.studentName2}</th>
                      <th className="px-3 py-2 border-r border-black">{'Parent / Contact'}</th>
                      <th className="px-3 py-2 text-right">{t.debtCarriedOver}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-black">
                    {studentsWithDebt.map(student => {
                      const discount = student.scholarshipDiscount || 0;
                      const discountedTotal = student.totalDue * (1 - discount / 100);
                      const debt = discountedTotal - student.amountPaid;
                      return (
                        <tr key={student.id}>
                          <td className="px-3 py-2 border-r border-black font-bold">{student.name}</td>
                          <td className="px-3 py-2 border-r border-black">{student.parentName} ({student.parentPhone})</td>
                          <td className="px-3 py-2 text-right font-bold">{formatCurrency(debt)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              ) : (
                <p className="text-xs italic">{t.noOutstandingStudentDebtsRecorded}</p>
              )}
            </div>

            {/* Certified signature block */}
            <div className="flex justify-between items-center pt-12 border-t border-black text-xs">
              <div>
                <p className="font-bold">{t.certifiedSincerelyBy}</p>
                <p className="font-black mt-1">Ibrahim Thera, Executive Admin</p>
                <p className="text-black/60 text-[10px]">{t.schoolDirectorController}</p>
              </div>
              <div className="text-right">
                <p className="font-bold">{t.authorizedSignature}</p>
                <div className="h-12 w-48 border-b border-dashed border-black mt-2 ml-auto" />
                <p className="text-[8px] text-black/60 mt-1">Ibrahim Thera / Official Board Seal</p>
              </div>
            </div>

            <div className="text-center text-[10px] pt-8 border-t border-black/10">
              <p>{t.systemCertifiedClosingDocument}</p>
              <p className="mt-1 font-bold">Finance Exécutive Admin Portal</p>
            </div>
          </div>
        );
      })()}

      {/* --- Actual Printable Student File Hidden on Screen --- */}
      {printStudentFile && (() => {
        return (
          <div className="hidden print:block print-student-file-container bg-white text-black font-sans p-12 space-y-8">
            {/* Header / Logo banner */}
            <div className="flex justify-between items-start border-b-2 border-black pb-6">
              <div>
                <h1 className="font-black text-2xl tracking-tight text-slate-900">COMPLEXE SCOLAIRE MAMA THERA</h1>
                <p className="text-xs uppercase tracking-widest text-slate-500 font-bold mt-1">{t.officialStudentProfileAcademicFile}</p>
                <p className="text-[10px] text-slate-400 mt-0.5">Phone: +223 70 00 00 00 | Email: contact@mamathera.edu.ml</p>
              </div>
              <div className="border border-slate-300 px-4 py-2 text-center rounded-xl bg-slate-50">
                <span className="text-[9px] font-black uppercase tracking-widest block text-slate-400">{t.studentId}</span>
                <span className="font-mono font-bold text-sm text-slate-800">
                  {printStudentFile.studentId || '—'}
                </span>
              </div>
            </div>

            {/* Profile Grid: Photo and Details */}
            <div className="grid grid-cols-4 gap-8">
              {/* Photo placeholder on Left */}
              <div className="col-span-1 border-2 border-slate-300 rounded-[2rem] h-40 overflow-hidden bg-slate-50 flex items-center justify-center relative shadow-inner">
                {printStudentFile.photo ? (
                  <img 
                    src={printStudentFile.photo} 
                    alt={printStudentFile.name} 
                    className="w-full h-full object-cover" 
                    referrerPolicy="no-referrer"
                  />
                ) : (
                  <div className="text-center">
                    <Users size={32} className="text-slate-400 mx-auto mb-1" />
                    <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest">PASSPORT</span>
                  </div>
                )}
              </div>

              {/* Main Info */}
              <div className="col-span-3 space-y-4">
                <div>
                  <h2 className="text-3xl font-black text-slate-900 tracking-tight">{printStudentFile.name}</h2>
                  <div className="flex gap-4 mt-2">
                    <span className="bg-slate-100 px-3 py-1 rounded-lg text-xs font-bold uppercase">
                      {t.class} {getGradeDisplay(printStudentFile.grade, 'fr')}
                    </span>
                    <span className="bg-slate-100 px-3 py-1 rounded-lg text-xs font-bold uppercase">
                      {t.status2} {printStudentFile.status || 'Active'}
                    </span>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4 text-xs">
                  <div>
                    <span className="font-bold text-slate-400 block uppercase tracking-wide">{t.enrollmentDate2}</span>
                    <span className="font-semibold text-slate-800">{printStudentFile.enrollmentDate || '2026-07-16'}</span>
                  </div>
                  <div>
                    <span className="font-bold text-slate-400 block uppercase tracking-wide">{t.academicYear2}</span>
                    <span className="font-semibold text-slate-800">{printStudentFile.academicYear || '2025-2026'}</span>
                  </div>
                </div>
              </div>
            </div>

            {/* General Info & Financial Ledger Section */}
            <div className="border border-slate-300 rounded-[2rem] p-6 space-y-4">
              <h3 className="text-xs font-black uppercase tracking-widest text-slate-900 border-b pb-2">{t.financialStatusLedger}</h3>
              <div className="grid grid-cols-3 gap-4 text-center">
                <div className="bg-slate-50 p-4 rounded-xl border border-slate-100">
                  <span className="text-[10px] font-bold text-slate-400 block uppercase">{t.totalTuitionDue}</span>
                  <span className="text-lg font-black text-slate-800">{formatCurrency(printStudentFile.totalDue)}</span>
                </div>
                <div className="bg-slate-50 p-4 rounded-xl border border-slate-100">
                  <span className="text-[10px] font-bold text-slate-400 block uppercase">{t.paidTuition}</span>
                  <span className="text-lg font-black text-emerald-600">+{formatCurrency(printStudentFile.amountPaid)}</span>
                </div>
                <div className="bg-rose-50 p-4 rounded-xl border border-rose-100">
                  <span className="text-[10px] font-bold text-rose-500 block uppercase">{t.remainingBalance2}</span>
                  <span className="text-lg font-black text-rose-600">{formatCurrency(printStudentFile.totalDue * (1 - (printStudentFile.scholarshipDiscount || 0) / 100) - printStudentFile.amountPaid)}</span>
                </div>
              </div>
            </div>

            {/* Parent & Emergency Info */}
            <div className="grid grid-cols-2 gap-6">
              <div className="border border-slate-300 rounded-[2rem] p-6 space-y-3">
                <h3 className="text-xs font-black uppercase tracking-widest text-slate-900 border-b pb-2">{t.guardianTitle}</h3>
                <div className="space-y-1.5 text-xs">
                  <p><strong className="text-slate-400">{t.name}</strong> <span className="font-bold text-slate-800">{printStudentFile.parentName}</span></p>
                  <p><strong className="text-slate-400">{t.phone3}</strong> <span className="font-semibold text-slate-800">{printStudentFile.parentPhone}</span></p>
                  <p><strong className="text-slate-400">{t.email2}</strong> <span className="font-semibold text-blue-600">{printStudentFile.parentEmail}</span></p>
                </div>
              </div>

              <div className="border border-slate-300 rounded-[2rem] p-6 space-y-3">
                <h3 className="text-xs font-black uppercase tracking-widest text-rose-500 border-b pb-2">{t.emergencyContact2}</h3>
                <div className="space-y-1.5 text-xs">
                  <p><strong className="text-slate-400">{t.contactPerson}</strong> <span className="font-bold text-slate-800">{printStudentFile.emergencyContactName || 'N/A'}</span></p>
                  <p><strong className="text-slate-400">{t.relationship3}</strong> <span className="font-semibold text-slate-800">{printStudentFile.emergencyContactRelation || 'N/A'}</span></p>
                  <p><strong className="text-slate-400">{t.phoneNumber}</strong> <span className="font-black text-rose-600">{printStudentFile.emergencyContactPhone || 'N/A'}</span></p>
                </div>
              </div>
            </div>

            {/* History & Medical Records */}
            <div className="border border-slate-300 rounded-[2rem] p-6 space-y-3">
              <h3 className="text-xs font-black uppercase tracking-widest text-slate-900 border-b pb-2">{t.medicalHistoryFile}</h3>
              <div className="grid grid-cols-2 gap-6 text-xs">
                <div>
                  <span className="font-bold text-slate-400 block uppercase">{t.previousSchoolTransferHistory}</span>
                  <p className="font-semibold text-slate-800 mt-1">{printStudentFile.previousSchool || (t.noneDirectAdmissionEntry)}</p>
                </div>
                <div>
                  <span className="font-bold text-slate-400 block uppercase">{t.allergiesMedicalNotesConditions}</span>
                  <p className="font-semibold text-slate-800 mt-1">{printStudentFile.medicalNotes || (t.noneClearProfile)}</p>
                </div>
              </div>
            </div>

            {/* Signature Area */}
            <div className="flex justify-between items-center pt-12 border-t border-slate-200 text-xs">
              <div>
                <p className="font-bold">{t.generatedAndVerifiedSincerelyBy}</p>
                <p className="font-black mt-1 text-slate-900">{currentUser?.name || 'Direction Complexe Scolaire MAMA THERA'}</p>
                <p className="text-slate-500 text-[10px]">{t.complexeScolaireMamaTheraAdministration}</p>
              </div>
              <div className="text-right">
                <p className="font-bold">{t.officialSealSignature}</p>
                <div className="h-12 w-48 border-b border-dashed border-slate-400 mt-2 ml-auto" />
                <p className="text-[8px] text-slate-400 mt-1">{t.officialBoardRepresentative}</p>
              </div>
            </div>
          </div>
        );
      })()}

      {/* --- Mobile Sidebar Toggle (Simplified) --- */}
      <div className="lg:hidden fixed bottom-6 left-6 z-50">
        <button 
          onClick={() => toggleLanguage(lang === 'en' ? 'fr' : 'en')}
          className="bg-blue-600 text-white p-4 rounded-full shadow-2xl shadow-blue-500/40"
        >
          <Globe size={24} />
        </button>
      </div>

      {/* --- Add / Edit Parent Modal --- */}
      {showParentModal && (
        <div ref={(el) => { overlayRoots.current[9] = el; }} role="dialog" aria-modal="true" aria-label={editingParent ? t.editParent : t.addParent} aria-labelledby="modal-title-parent-form" className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-fade-in no-print">
          <motion.div
            initial={{ scale: 0.95, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            className={`w-full max-w-xl ${currentTheme.card} p-8 rounded-[2rem] border ${currentTheme.border} shadow-2xl space-y-6 max-h-[90vh] overflow-y-auto`}
          >
            <div className="flex items-center justify-between pb-4 border-b border-slate-100 dark:border-slate-800">
              <h3 id="modal-title-parent-form" className={`text-xl font-black ${currentTheme.isDark ? 'text-white' : 'text-slate-900'}`}>
                {editingParent ? t.editParent : t.addParent}
              </h3>
              <button
                onClick={() => setShowParentModal(false)}
                className="p-2 text-slate-400 hover:text-slate-600 rounded-xl"
              >
                <X size={20} />
              </button>
            </div>

            <form onSubmit={handleParentSubmit} className="space-y-4">
              {editingParent && (() => {
                const linkedStudents = students.filter(s => s.parentId === editingParent.id);
                if (linkedStudents.length === 0) return null;
                return (
                  <div className={`p-4 rounded-2xl border ${currentTheme.border} ${currentTheme.isDark ? 'bg-slate-900/50' : 'bg-slate-50'}`}>
                    <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-2.5">{t.linkedStudents}</p>
                    <div className="space-y-2">
                      {linkedStudents.map(s => {
                        const discount = s.scholarshipDiscount || 0;
                        const discountedTotal = s.totalDue * (1 - discount / 100);
                        const balance = Math.max(0, discountedTotal - s.amountPaid);
                        return (
                          <div
                            key={s.id}
                            className={`flex items-center gap-2.5 px-3 py-2.5 rounded-xl border ${currentTheme.border} ${currentTheme.isDark ? 'bg-white/5' : 'bg-white'}`}
                          >
                            <div className="flex-1 min-w-0">
                              <p className={`text-xs font-bold truncate ${currentTheme.isDark ? 'text-white' : 'text-slate-800'}`}>
                                {s.name}
                              </p>
                              <p className={`mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 font-mono text-[10px] ${currentTheme.muted}`}>
                                <span className="flex items-center gap-1">
                                  <span className="font-black uppercase tracking-wide text-slate-400">{t.studentId}:</span>
                                  <span>{s.studentId || '—'}</span>
                                </span>
                                <span className="flex items-center gap-1">
                                  <span className="font-black uppercase tracking-wide text-slate-400">{t.grade}:</span>
                                  <span>{s.grade || '—'}</span>
                                </span>
                                <span className={`flex items-center gap-1 font-black ${balance > 0 ? 'text-rose-500' : 'text-emerald-600'}`}>
                                  {t.balance}: {formatCurrency(balance)}
                                </span>
                              </p>
                            </div>
                            <button
                              type="button"
                              title={t.recordPayment}
                              onClick={() => {
                                setPaymentStudentId(s.id);
                                setPaymentAmount('');
                                setShowParentModal(false);
                                setShowPaymentForm(true);
                              }}
                              className="p-2 rounded-lg bg-emerald-600 text-white hover:bg-emerald-700 transition-all shadow-sm flex-shrink-0"
                            >
                              <DollarSign size={14} />
                            </button>
                            <button
                              type="button"
                              title={t.viewStudentRecord}
                              onClick={() => {
                                setShowParentModal(false);
                                setSelectedStudent(s);
                              }}
                              className={`p-2 rounded-lg border ${currentTheme.border} text-blue-500 hover:bg-blue-50 dark:hover:bg-white/10 transition-all flex-shrink-0`}
                            >
                              <ExternalLink size={14} />
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })()}

              {!editingParent && (() => {
                const search = parentStudentSearch.toLowerCase().trim();
                const selectedClass = availableClasses.find(c => c.id === parentClassFilter);
                const filteredStudents = students.filter(s => {
                  const matchesSearch = !search ||
                    s.name.toLowerCase().includes(search) ||
                    (s.studentId || '').toLowerCase().includes(search) ||
                    (s.grade || '').toLowerCase().includes(search);
                  const gradeNorm = (s.grade || '').toLowerCase();
                  const matchesClass = parentClassFilter === 'all' || (
                    gradeNorm !== '' && (
                      gradeNorm === parentClassFilter.toLowerCase() ||
                      (selectedClass && (
                        gradeNorm === selectedClass.nameFr.toLowerCase() ||
                        gradeNorm === selectedClass.nameEn.toLowerCase()
                      ))
                    )
                  );
                  return matchesSearch && matchesClass;
                });
                return (
                  <div className="space-y-1">
                    <label className="text-[10px] font-black uppercase tracking-widest text-slate-400">{t.selectStudent}</label>
                    {parentForm.linkedStudentIds.length > 0 && (
                      <div className="flex flex-wrap gap-1.5">
                        {parentForm.linkedStudentIds.map(id => {
                          const st = students.find(s => s.id === id);
                          if (!st) return null;
                          return (
                            <span
                              key={id}
                              className="inline-flex items-center gap-1.5 pl-2.5 pr-1.5 py-1 rounded-full bg-emerald-600/10 border border-emerald-500/30 text-emerald-700 dark:text-emerald-300 text-[10px] font-black max-w-full"
                            >
                              <span className="truncate">{st.name}</span>
                              <button
                                type="button"
                                onClick={() => setParentForm({
                                  ...parentForm,
                                  linkedStudentIds: parentForm.linkedStudentIds.filter(sid => sid !== id),
                                })}
                                className="p-0.5 rounded-full text-emerald-600 dark:text-emerald-300 hover:bg-emerald-600/20 transition-all flex-shrink-0"
                                title="×"
                              >
                                <X size={10} />
                              </button>
                            </span>
                          );
                        })}
                      </div>
                    )}
                    {students.length === 0 ? (
                      <div className={`rounded-xl border ${currentTheme.border} ${currentTheme.isDark ? 'bg-slate-900' : 'bg-slate-50'} px-4 py-6 text-center space-y-3`}>
                        <div className="mx-auto w-10 h-10 rounded-full bg-slate-100 dark:bg-white/5 flex items-center justify-center">
                          <Users size={18} className="text-slate-400" />
                        </div>
                        <div className="space-y-1">
                          <p className={`text-xs font-black ${currentTheme.isDark ? 'text-white' : 'text-slate-700'}`}>{t.noStudentsInSystemTitle}</p>
                          <p className="text-[10px] font-semibold text-slate-400 leading-relaxed max-w-[250px] mx-auto">{t.noStudentsInSystemHint}</p>
                        </div>
                        <button
                          type="button"
                          onClick={() => { setShowParentModal(false); setShowStudentModal(true); }}
                          className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-emerald-600 text-white text-[10px] font-black hover:bg-emerald-700 transition-all shadow-sm shadow-emerald-600/20"
                        >
                          <Plus size={12} />
                          {t.addStudent}
                        </button>
                      </div>
                    ) : (
                      <div className={`rounded-xl border ${currentTheme.border} ${currentTheme.isDark ? 'bg-slate-900' : 'bg-slate-50'} overflow-hidden`}>
                        <div className={`flex items-center gap-2 px-3 py-2 border-b ${currentTheme.border}`}>
                        <Search size={14} className="text-slate-400 flex-shrink-0" />
                        <input
                          type="text"
                          value={parentStudentSearch}
                          onChange={(e) => setParentStudentSearch(e.target.value)}
                          placeholder={t.searchStudents}
                          className="w-full bg-transparent text-xs font-semibold outline-none placeholder:text-slate-400"
                        />
                        {parentStudentSearch && (
                          <button
                            type="button"
                            onClick={() => setParentStudentSearch('')}
                            title={t.clearSearch}
                            className="p-1 rounded-full text-slate-400 hover:text-slate-600 hover:bg-slate-200/60 dark:hover:bg-white/10 transition-all flex-shrink-0"
                          >
                            <X size={12} />
                          </button>
                        )}
                        <select
                          value={parentClassFilter}
                          onChange={(e) => setParentClassFilter(e.target.value)}
                          className={`text-[10px] font-black rounded-lg border ${currentTheme.border} ${currentTheme.isDark ? 'bg-slate-900 text-white' : 'bg-slate-50 text-slate-700'} px-2 py-1.5 flex-shrink-0 outline-none cursor-pointer`}
                        >
                          <option value="all" className="bg-slate-800 text-white">{t.allClasses}</option>
                          {availableClasses.map(c => (
                            <option key={c.id} value={c.id} className="bg-slate-800 text-white">
                              {lang === 'en' ? c.nameEn : c.nameFr}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div className="max-h-48 overflow-y-auto p-1.5 space-y-0.5 custom-scrollbar">
                        {filteredStudents.length === 0 && (
                          <div className="px-3 py-5 text-center space-y-2.5">
                            <p className="text-xs font-semibold text-slate-400">
                              {search
                                ? t.noStudentsFound.replace('{query}', search)
                                : t.noStudentsInClass}
                            </p>
                            {(search || parentClassFilter !== 'all') && (
                              <button
                                type="button"
                                onClick={() => {
                                  setParentStudentSearch('');
                                  setParentClassFilter('all');
                                }}
                                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-[10px] font-black text-slate-500 hover:bg-slate-100 dark:hover:bg-white/10 transition-all"
                              >
                                <X size={10} />
                                {t.clearSearch}
                              </button>
                            )}
                          </div>
                        )}
                        {filteredStudents.map((s) => {
                          const checked = parentForm.linkedStudentIds.includes(s.id);
                          return (
                            <label
                              key={s.id}
                              className={`flex items-center gap-2.5 px-2.5 py-2 rounded-lg cursor-pointer transition-all ${checked ? (currentTheme.isDark ? 'bg-emerald-900/30' : 'bg-emerald-50') : 'hover:bg-white/10'}`}
                            >
                              <input
                                type="checkbox"
                                checked={checked}
                                onChange={(e) => {
                                  const isChecked = e.target.checked;
                                  setParentForm({
                                    ...parentForm,
                                    linkedStudentIds: isChecked
                                      ? [...parentForm.linkedStudentIds, s.id]
                                      : parentForm.linkedStudentIds.filter(id => id !== s.id),
                                  });
                                }}
                                className="accent-emerald-600 w-4 h-4 flex-shrink-0"
                              />
                              <span className="flex-1 min-w-0">
                                <span className={`block text-xs font-bold truncate ${currentTheme.isDark ? 'text-white' : 'text-slate-800'}`}>
                                  {s.name}
                                </span>
                                <span className={`mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 font-mono text-[10px] ${currentTheme.muted}`}>
                                  <span className="flex items-center gap-1">
                                    <span className="font-black uppercase tracking-wide text-slate-400">{t.studentId}:</span>
                                    <span>{s.studentId || '—'}</span>
                                  </span>
                                  {s.grade ? (
                                    <span className="flex items-center gap-1">
                                      <span className="font-black uppercase tracking-wide text-slate-400">{t.grade}:</span>
                                      <span>{s.grade}</span>
                                    </span>
                                  ) : null}
                                </span>
                              </span>
                              {s.parentId && (
                                <span className="text-[9px] font-black uppercase tracking-wider text-amber-500 flex-shrink-0">{t.alreadyLinked}</span>
                              )}
                            </label>
                          );
                        })}
                      </div>
                    </div>
                    )}
                    {parentForm.linkedStudentIds.length > 0 && (
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-[10px] font-black text-emerald-600">
                          {t.studentsSelected.replace('{n}', String(parentForm.linkedStudentIds.length))}
                        </p>
                        <button
                          type="button"
                          onClick={() => setParentForm({ ...parentForm, linkedStudentIds: [] })}
                          className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[10px] font-black text-rose-500 hover:bg-rose-500/10 transition-all"
                        >
                          <X size={10} />
                          {t.deselectAll}
                        </button>
                      </div>
                    )}
                  </div>
                );
              })()}

              <div className="space-y-1">
                <label className="text-[10px] font-black uppercase tracking-widest text-slate-400">{t.parentName} *</label>
                <input
                  type="text"
                  required
                  value={parentForm.fullName}
                  onChange={(e) => setParentForm({ ...parentForm, fullName: e.target.value })}
                  placeholder={t.eGMamadouTraor}
                  className={`w-full p-3 text-xs font-bold rounded-xl border ${currentTheme.border} ${currentTheme.isDark ? 'bg-slate-900 text-white' : 'bg-slate-50 text-slate-800'}`}
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1">
                  <label className="text-[10px] font-black uppercase tracking-widest text-slate-400">{t.primaryPhone} *</label>
                  <input
                    type="text"
                    required
                    value={parentForm.primaryPhone}
                    onChange={(e) => setParentForm({ ...parentForm, primaryPhone: e.target.value })}
                    placeholder="+223 70 00 00 00"
                    className={`w-full p-3 text-xs font-bold rounded-xl border ${currentTheme.border} ${currentTheme.isDark ? 'bg-slate-900 text-white' : 'bg-slate-50 text-slate-800'}`}
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-[10px] font-black uppercase tracking-widest text-slate-400">{t.secondaryPhone}</label>
                  <input
                    type="text"
                    value={parentForm.secondaryPhone}
                    onChange={(e) => setParentForm({ ...parentForm, secondaryPhone: e.target.value })}
                    placeholder="+223 66 00 00 00"
                    className={`w-full p-3 text-xs font-bold rounded-xl border ${currentTheme.border} ${currentTheme.isDark ? 'bg-slate-900 text-white' : 'bg-slate-50 text-slate-800'}`}
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1">
                  <label className="text-[10px] font-black uppercase tracking-widest text-slate-400">{t.email}</label>
                  <input
                    type="email"
                    value={parentForm.email}
                    onChange={(e) => setParentForm({ ...parentForm, email: e.target.value })}
                    placeholder="parent@example.com"
                    className={`w-full p-3 text-xs font-bold rounded-xl border ${currentTheme.border} ${currentTheme.isDark ? 'bg-slate-900 text-white' : 'bg-slate-50 text-slate-800'}`}
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-[10px] font-black uppercase tracking-widest text-slate-400">{t.relationship} *</label>
                  <select
                    value={parentForm.relationship}
                    onChange={(e) => setParentForm({ ...parentForm, relationship: e.target.value })}
                    className={`w-full p-3 text-xs font-bold rounded-xl border ${currentTheme.border} ${currentTheme.isDark ? 'bg-slate-900 text-white' : 'bg-slate-50 text-slate-800'}`}
                  >
                    <option value="Father">{t.father}</option>
                    <option value="Mother">{t.mother}</option>
                    <option value="Guardian">{t.guardian}</option>
                    <option value="Uncle">{t.uncle}</option>
                    <option value="Aunt">{t.aunt}</option>
                    <option value="Other">{t.other}</option>
                  </select>
                </div>
              </div>

              <div className="space-y-1">
                <label className="text-[10px] font-black uppercase tracking-widest text-slate-400">{t.occupation} *</label>
                <input
                  type="text"
                  required
                  value={parentForm.occupation}
                  onChange={(e) => setParentForm({ ...parentForm, occupation: e.target.value })}
                  placeholder={t.eGCivilEngineerBankerMerchant}
                  className={`w-full p-3 text-xs font-bold rounded-xl border ${currentTheme.border} ${currentTheme.isDark ? 'bg-slate-900 text-white' : 'bg-slate-50 text-slate-800'}`}
                />
              </div>

              <div className="space-y-1">
                <label className="text-[10px] font-black uppercase tracking-widest text-slate-400">{t.address} *</label>
                <input
                  type="text"
                  required
                  value={parentForm.address}
                  onChange={(e) => setParentForm({ ...parentForm, address: e.target.value })}
                  placeholder={t.eGQuartierHippodromeBamako}
                  className={`w-full p-3 text-xs font-bold rounded-xl border ${currentTheme.border} ${currentTheme.isDark ? 'bg-slate-900 text-white' : 'bg-slate-50 text-slate-800'}`}
                />
              </div>

              <div className="space-y-1">
                <label className="text-[10px] font-black uppercase tracking-widest text-slate-400">{t.accountingNotes}</label>
                <textarea
                  rows={3}
                  value={parentForm.notes}
                  onChange={(e) => setParentForm({ ...parentForm, notes: e.target.value })}
                  placeholder={t.eGFamilyContactPreferencesOrSpecialNotes}
                  className={`w-full p-3 text-xs font-bold rounded-xl border ${currentTheme.border} ${currentTheme.isDark ? 'bg-slate-900 text-white' : 'bg-slate-50 text-slate-800'}`}
                />
              </div>

              <div className="pt-4 flex justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setShowParentModal(false)}
                  className="px-5 py-2.5 rounded-xl border border-slate-200 dark:border-slate-800 text-xs font-bold text-slate-600 dark:text-slate-400"
                >
                  {t.close}
                </button>
                <button
                  type="submit"
                  className="px-5 py-2.5 rounded-xl bg-emerald-600 text-white font-bold text-xs hover:bg-emerald-700 shadow-lg shadow-emerald-600/20"
                >
                  {t.saveChanges}
                </button>
              </div>
            </form>
          </motion.div>
        </div>
      )}

      {/* --- Link Student Modal --- */}
      {showLinkStudentModal && activeLinkingParent && (
        <div ref={(el) => { overlayRoots.current[10] = el; }} role="dialog" aria-modal="true" aria-label={t.linkStudent} aria-labelledby="modal-title-link-student" className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-fade-in no-print">
          <motion.div
            initial={{ scale: 0.95, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            className={`w-full max-w-md ${currentTheme.card} p-8 rounded-[2rem] border ${currentTheme.border} shadow-2xl space-y-6`}
          >
            <div className="flex items-center justify-between pb-4 border-b border-slate-100 dark:border-slate-800">
              <div>
                <h3 id="modal-title-link-student" className={`text-lg font-black ${currentTheme.isDark ? 'text-white' : 'text-slate-900'}`}>
                  {t.linkStudent}
                </h3>
                <p className="text-xs text-slate-400">
                  {t.attachChildTo.replace('{name}', activeLinkingParent.fullName)}
                </p>
              </div>
              <button
                onClick={() => setShowLinkStudentModal(false)}
                className="p-2 text-slate-400 hover:text-slate-600 rounded-xl"
              >
                <X size={20} />
              </button>
            </div>

            <form onSubmit={handleLinkStudentSubmit} className="space-y-4">
              <div className="space-y-1">
                <label className="text-[10px] font-black uppercase tracking-widest text-slate-400">{t.selectStudent}</label>
                <select
                  required
                  value={studentToLinkId}
                  onChange={(e) => setStudentToLinkId(e.target.value)}
                  className={`w-full p-3 text-xs font-bold rounded-xl border ${currentTheme.border} ${currentTheme.isDark ? 'bg-slate-900 text-white' : 'bg-slate-50 text-slate-800'}`}
                >
                  <option value="">-- {t.selectStudentToLink} --</option>
                  {students.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name} — {t.studentId}: {s.studentId || '—'} · {t.grade}: {s.grade || '—'}
                    </option>
                  ))}
                </select>
              </div>

              <div className="pt-4 flex justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setShowLinkStudentModal(false)}
                  className="px-5 py-2.5 rounded-xl border border-slate-200 dark:border-slate-800 text-xs font-bold text-slate-600 dark:text-slate-400"
                >
                  {t.close}
                </button>
                <button
                  type="submit"
                  disabled={!studentToLinkId}
                  className="px-5 py-2.5 rounded-xl bg-emerald-600 text-white font-bold text-xs hover:bg-emerald-700 disabled:opacity-50 shadow-lg shadow-emerald-600/20"
                >
                  {t.linkStudent}
                </button>
              </div>
            </form>
          </motion.div>
        </div>
      )}

      {/* --- Late Payment Notification Modal (WhatsApp / SMS Generator) --- */}
      {showNotifyModal && notifyParent && (
        <div ref={(el) => { overlayRoots.current[11] = el; }} role="dialog" aria-modal="true" aria-label={t.reminderModalTitle} aria-labelledby="modal-title-reminder" className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-fade-in no-print">
          <motion.div
            initial={{ scale: 0.95, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            className={`w-full max-w-xl ${currentTheme.card} p-6 sm:p-8 rounded-[2rem] border ${currentTheme.border} shadow-2xl space-y-6 max-h-[90vh] overflow-y-auto`}
          >
            {/* Modal Header */}
            <div className="flex items-start justify-between pb-4 border-b border-slate-100 dark:border-slate-800">
              <div className="flex items-center gap-3">
                <div className="p-3 rounded-2xl bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20">
                  <Bell size={24} />
                </div>
                <div>
                  <h3 id="modal-title-reminder" className={`text-lg font-black ${currentTheme.isDark ? 'text-white' : 'text-slate-900'}`}>
                    {t.reminderModalTitle}
                  </h3>
                  <p className="text-xs text-slate-400 font-medium">
                    {t.reminderModalSubtitle}
                  </p>
                </div>
              </div>
              <button
                onClick={() => setShowNotifyModal(false)}
                className="p-2 text-slate-400 hover:text-slate-600 rounded-xl"
              >
                <X size={20} />
              </button>
            </div>

            {/* Parent Summary Card */}
            <div className="p-4 rounded-2xl bg-rose-500/5 border border-rose-500/20 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <span className="text-[10px] font-black uppercase tracking-widest text-slate-400 block">{t.parentName}</span>
                <span className="text-sm font-black text-slate-900 dark:text-white">{notifyParent.fullName}</span>
                <span className="text-xs text-slate-500 block">({t[notifyParent.relationship.toLowerCase() as keyof typeof t] || notifyParent.relationship})</span>
              </div>
              <div className="text-left sm:text-right">
                <span className="text-[10px] font-black uppercase tracking-widest text-rose-500 block">{t.totalOutstandingBalance}</span>
                <span className="text-lg font-black text-rose-600 dark:text-rose-400 font-mono">
                  {formatCurrency(getParentOutstandingBalance(notifyParent))}
                </span>
              </div>
            </div>

            <div className="space-y-4">
              {/* Recipient Phone Selection */}
              <div className="space-y-1">
                <label className="text-[10px] font-black uppercase tracking-widest text-slate-400">{t.selectPhone} *</label>
                <div className="flex items-center gap-2">
                  <Phone size={16} className="text-slate-400" />
                  <select
                    value={notifySelectedPhone}
                    onChange={(e) => setNotifySelectedPhone(e.target.value)}
                    className={`w-full p-3 text-xs font-bold rounded-xl border ${currentTheme.border} ${currentTheme.isDark ? 'bg-slate-900 text-white' : 'bg-slate-50 text-slate-800'}`}
                  >
                    {notifyParent.phones.map((ph, idx) => (
                      <option key={idx} value={ph}>
                        {ph} {idx === 0 ? `(${t.primaryPhone})` : `(${t.secondaryPhone})`}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Template Selection Radio Buttons / Pills */}
              <div className="space-y-1">
                <label className="text-[10px] font-black uppercase tracking-widest text-slate-400">{t.selectTemplate}</label>
                <div className="grid grid-cols-3 gap-2">
                  <button
                    type="button"
                    onClick={() => handleNotifyTemplateChange('polite')}
                    className={`p-2.5 rounded-xl border text-xs font-bold transition-all ${
                      notifyTemplateType === 'polite'
                        ? 'bg-emerald-600 text-white border-emerald-600 shadow-md shadow-emerald-600/20'
                        : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 border-transparent hover:bg-slate-200'
                    }`}
                  >
                    {t.templatePolite}
                  </button>
                  <button
                    type="button"
                    onClick={() => handleNotifyTemplateChange('urgent')}
                    className={`p-2.5 rounded-xl border text-xs font-bold transition-all ${
                      notifyTemplateType === 'urgent'
                        ? 'bg-rose-600 text-white border-rose-600 shadow-md shadow-rose-600/20'
                        : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 border-transparent hover:bg-slate-200'
                    }`}
                  >
                    {t.templateUrgent}
                  </button>
                  <button
                    type="button"
                    onClick={() => handleNotifyTemplateChange('detailed')}
                    className={`p-2.5 rounded-xl border text-xs font-bold transition-all ${
                      notifyTemplateType === 'detailed'
                        ? 'bg-amber-600 text-white border-amber-600 shadow-md shadow-amber-600/20'
                        : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 border-transparent hover:bg-slate-200'
                    }`}
                  >
                    {t.templateDetailed}
                  </button>
                </div>
              </div>

              {/* Editable Message Text Box */}
              <div className="space-y-1">
                <div className="flex items-center justify-between">
                  <label className="text-[10px] font-black uppercase tracking-widest text-slate-400">{t.customMessage}</label>
                  {copiedToast && (
                    <span className="text-[10px] font-bold text-emerald-600 flex items-center gap-1 animate-pulse">
                      <CheckCircle2 size={12} />
                      {t.copiedToClipboard}
                    </span>
                  )}
                </div>
                <textarea
                  rows={6}
                  value={notifyCustomText}
                  onChange={(e) => setNotifyCustomText(e.target.value)}
                  className={`w-full p-3.5 text-xs font-mono font-medium rounded-xl border ${currentTheme.border} ${currentTheme.isDark ? 'bg-slate-900 text-white' : 'bg-slate-50 text-slate-800'} leading-relaxed`}
                />
              </div>
            </div>

            {/* One-Click Action Buttons */}
            <div className="pt-4 border-t border-slate-100 dark:border-slate-800 flex flex-col sm:flex-row items-center justify-between gap-3">
              <button
                type="button"
                onClick={handleCopyNotifyMessage}
                className="w-full sm:w-auto px-4 py-2.5 rounded-xl border border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-300 font-bold text-xs hover:bg-slate-100 dark:hover:bg-slate-800 flex items-center justify-center gap-2 transition-all"
              >
                <Copy size={16} />
                <span>{t.copyMessage}</span>
              </button>

              <div className="w-full sm:w-auto flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleSendSMS}
                  className="flex-1 sm:flex-initial px-4 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-900 dark:bg-slate-700 dark:hover:bg-slate-600 text-white font-bold text-xs shadow-md flex items-center justify-center gap-2 transition-all"
                >
                  <MessageSquare size={16} />
                  <span>{t.sendSMS}</span>
                </button>

                <button
                  type="button"
                  onClick={handleSendWhatsApp}
                  className="flex-1 sm:flex-initial px-5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs shadow-lg shadow-emerald-600/30 flex items-center justify-center gap-2 transition-all"
                >
                  <MessageSquare size={16} className="text-emerald-200" />
                  <span>{t.openWhatsApp}</span>
                </button>
              </div>
            </div>
          </motion.div>
        </div>
      )}

      {/* --- Student Delete Confirmation --- */}
      <ConfirmDialog
        open={!!confirmDeleteStudent}
        title={t.deleteStudent}
        message={t.deleteStudentConfirm.replace('{name}', confirmDeleteStudent?.name || '')}
        confirmLabel={t.deleteStudent}
        cancelLabel={t.cancel}
        danger={confirmDeleteStudent && confirmDeleteStudent.payments.length > 0 ? {
          mode: 'type',
          text: confirmDeleteStudent.name,
          hint: t.typeToConfirm.replace('{text}', confirmDeleteStudent.name),
        } : undefined}
        onConfirm={() => {
          if (confirmDeleteStudent) {
            deleteStudent(confirmDeleteStudent.id);
          }
          setConfirmDeleteStudent(null);
          setSelectedStudent(null);
          setShowStudentModal(false);
        }}
        onCancel={() => setConfirmDeleteStudent(null)}
        currentTheme={currentTheme}
      />
    </>
  );
}

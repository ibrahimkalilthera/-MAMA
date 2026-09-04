import { useRef, useState } from 'react';
import type { Dispatch, SetStateAction, FormEvent, KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Briefcase, Calendar, CheckCircle2, CheckSquare, Copy, CreditCard, DollarSign, FileText, Globe, Layers, Printer, Receipt, ShieldCheck, Sparkles, StickyNote, Trash2, Users, X } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { Student, Staff, Parent, Todo, Expense, SalaryPayment, VendorExpense } from '../lib/useSupabaseData';
import type { CalendarEvent, CurrentTheme, ManagedClass, ParentForm, SalaryForm, StaffForm, VendorExpenseForm } from '../app/mainViewsProps';
import type { TranslationDict } from '../i18n/translations';
import type { ReceiptDataOptions } from '../lib/pdfReceipt';
import { ConfirmDialog } from './ConfirmDialog';
import { ParentFormModal } from './ParentFormModal';
import { ProductivityPanel } from './ProductivityPanel';
import { StudentDetailsModal } from './StudentDetailsModal';
import { StudentFormModal } from './StudentFormModal';
import type { StudentForm } from './StudentFormModal';
import { VendorExpenseModal } from './VendorExpenseModal';
import { YearlyAuditSheetModal } from './YearlyAuditSheetModal';
import { NotifyParentModal } from './NotifyParentModal';
import { AddClassModal } from './AddClassModal';
import type { ClassForm } from './AddClassModal';
import { EditClassModal } from './EditClassModal';
import { useEscapeToClose } from '../lib/useEscapeToClose';
import { useOverlayTraps } from '../lib/focusStack';
import { visibleStudentIdentifier } from '../lib/studentIdentifiers';

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
  const [confirmDeleteStudent, setConfirmDeleteStudent] = useState<Student | null>(null);
  const { Briefcase, Calendar, CheckCircle2, CheckSquare, Copy, CreditCard, DollarSign, FileText, Globe, Layers, Printer, Receipt, ShieldCheck, Sparkles, StickyNote, Trash2, Users, X, academicYears, activeLinkingParent, aiInput, aiMessages, auditYear, availableClasses, copiedToast, copyToClipboard, currentMonth, currentTheme, currentUser, deleteStudent, deleteTodo, editClassForm, editingParent, editingStaff, editingStudent, editingVendorExpense, expenseCategoryList, expenseForm, formatCurrency, formatDate, generateInstallmentMemo, generatePaymentReceiptPdf, getDayName, getEventsForDay, getNotesForDay, getGradeDisplay, getParentOutstandingBalance, getYearStats, handleAddTodo, handleAiQuery, handleCopyNotifyMessage, handleCreateClassSubmit, handleEditClassSubmit, handleExpenseSubmit, handleLinkStudentSubmit, handleNotifyTemplateChange, handleParentSubmit, handlePaymentSubmit, handleSalarySubmit, handleSaveNote, handleSendSMS, handleSendWhatsApp, handleStaffSubmit, handleStudentSubmit, handleVendorExpenseSubmit, isPromoter, isGeneralManager, lang, newClassForm, noteText, savingNoteOnDate, saveNoteOnDate, setNoteText, notifyCustomText, notifyParent, notifySelectedPhone, notifyTemplateType, openEditModal, parentForm, paymentAmount, paymentDate, paymentStudentId, printStudentFile, productivitySidebarTab, salaryForm, salaryPayments, schoolLogo, selectedCalendarDay, selectedStudent, setAiInput, setEditClassForm, setEditingVendorExpense, setExpenseForm, setNewClassForm, setNotifyCustomText, setNotifySelectedPhone, setParentForm, setPaymentAmount, setPaymentDate, setPaymentStudentId, setPrintStudentFile, setProductivitySidebarTab, setSalaryForm, setSelectedStudent, setShowAddClassModal, setShowAuditModal, setShowCalendarModal, setShowEditClassModal, setShowExpenseModal, setShowLinkStudentModal, setShowNotifyModal, setShowParentModal, setShowPaymentForm, setShowSalaryModal, setShowStaffModal, setShowStudentModal, setShowTodoSidebar, setShowVendorExpenseModal, setStaffForm, setStudentDetailTab, setStudentForm, setStudentToLinkId, setTicketStudent, setTodoInput, setVendorExpenseForm, showAddClassModal, showAuditModal, showCalendarModal, showEditClassModal, showExpenseModal, showLinkStudentModal, showNotifyModal, showParentModal, showPaymentForm, showSalaryModal, showStaffModal, showStudentModal, showSuccessToast, showTodoSidebar, showVendorExpenseModal, staff, staffForm, studentDetailTab, studentForm, studentToLinkId, students, t, ticketStudent, todoDate, setTodoDate, todoInput, todos, toggleLanguage, toggleTodo, handleUpdateTodoDate, vendorExpenseForm, welcomeMessage } = props;

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
      {/* --- Student Details Fiche Modal --- */}
      <AnimatePresence>
        {selectedStudent && (
          <StudentDetailsModal
            t={t}
            lang={lang}
            student={selectedStudent}
            currentTheme={currentTheme}
            formatDate={formatDate}
            formatCurrency={formatCurrency}
            getGradeDisplay={getGradeDisplay}
            generatePaymentReceiptPdf={generatePaymentReceiptPdf}
            currentUser={currentUser}
            copyToClipboard={copyToClipboard}
            handleSaveNote={handleSaveNote}
            studentDetailTab={studentDetailTab}
            setStudentDetailTab={setStudentDetailTab}
            overlayRef={(el) => { overlayRoots.current[0] = el; }}
            onClose={() => setSelectedStudent(null)}
            onEdit={() => openEditModal(selectedStudent)}
            onPrint={() => setPrintStudentFile(selectedStudent)}
            onDeleteRequest={() => setConfirmDeleteStudent(selectedStudent)}
          />
        )}      </AnimatePresence>

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
          <VendorExpenseModal
            t={t}
            lang={lang}
            currentTheme={currentTheme}
            editingVendorExpense={editingVendorExpense}
            vendorExpenseForm={vendorExpenseForm}
            setVendorExpenseForm={setVendorExpenseForm}
            handleVendorExpenseSubmit={handleVendorExpenseSubmit}
            isPromoter={isPromoter}
            expenseCategoryList={expenseCategoryList}
            availableClasses={availableClasses}
            overlayRef={(el) => { overlayRoots.current[3] = el; }}
            onClose={() => {
              setShowVendorExpenseModal(false);
              setEditingVendorExpense(null);
            }}
          />
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
                        <div className={`w-16 h-16 rounded-full ${currentTheme.isDark ? 'bg-emerald-900/20 text-emerald-500' : 'bg-slate-100 text-slate-600'} flex items-center justify-center mx-auto mb-4`}>
                          <Calendar size={32} />
                        </div>
                        <p className={currentTheme.muted}>{t.noTasks}</p>
                      </div>
                    );
                  }

                  return (
                    <div className="space-y-6">
                      {dayNotes.length > 0 && (
                        <div className="p-6 rounded-2xl border border-yellow-200 dark:border-yellow-900/40 bg-yellow-50/60 dark:bg-yellow-950/30">
                          <div className="flex items-center gap-4 mb-4">
                            <div className="p-3 rounded-xl bg-yellow-100 dark:bg-yellow-950/60 text-yellow-800 dark:text-yellow-300">
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
                          event.type === 'due' ? 'bg-rose-50/30 dark:bg-rose-950/30' :
                          event.type === 'salary' ? 'bg-emerald-50/30 dark:bg-emerald-950/30' :
                          event.type === 'note' ? 'bg-yellow-50/60 dark:bg-yellow-950/30' :
                          event.type === 'todo' ? 'bg-violet-50/60 dark:bg-violet-950/30' :
                          'bg-blue-50/30 dark:bg-blue-950/30'
                        }`}>
                          <div className="flex items-center gap-4 mb-4">
                            <div className={`p-3 rounded-xl ${
                              event.type === 'due' ? 'bg-rose-100 dark:bg-rose-950/60 text-rose-600 dark:text-rose-300' :
                              event.type === 'salary' ? 'bg-emerald-100 dark:bg-emerald-950/60 text-emerald-600 dark:text-emerald-300' :
                              event.type === 'note' ? 'bg-yellow-100 dark:bg-yellow-950/60 text-yellow-700 dark:text-yellow-300' :
                              event.type === 'todo' ? 'bg-violet-100 dark:bg-violet-950/60 text-violet-700 dark:text-violet-300' :
                              'bg-blue-100 dark:bg-blue-950/60 text-blue-700 dark:text-blue-300'
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
                  <div className="bg-[#FEF9C3] p-5 rounded-2xl border border-yellow-200/70">                      <h4 className="text-[9px] font-black text-yellow-900 uppercase tracking-widest mb-3 flex items-center gap-1.5">
                      <StickyNote size={12} />
                      {t.addNoteForThisDay}
                    </h4>
                    <div className="space-y-2.5">
                      <textarea
                        value={noteText}
                        onChange={(e) => setNoteText(e.target.value)}
                        placeholder={t.notesPlaceholder}
                        rows={2}
                        className="w-full bg-white/70 dark:bg-slate-800 border border-yellow-200 dark:border-yellow-900/40 rounded-xl px-3 py-2 text-xs font-semibold text-yellow-900 dark:text-yellow-300 placeholder-yellow-700/40 dark:placeholder-yellow-500/40 focus:outline-none focus:ring-2 focus:ring-yellow-500/30 resize-none custom-scrollbar"
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
              <p className="text-[10px] text-white/90 font-medium">
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
          <YearlyAuditSheetModal
            t={t}
            lang={lang}
            currentTheme={currentTheme}
            auditYear={auditYear}
            schoolLogo={schoolLogo}
            students={students}
            getYearStats={getYearStats}
            formatCurrency={formatCurrency}
            overlayRef={(el) => { overlayRoots.current[7] = el; }}
            onClose={() => setShowAuditModal(false)}
          />
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
                        <span className="font-bold">{t.student}:</span>
                        <span>{ticketStudent.name}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="font-bold">{t.grade}:</span>
                        <span>Classe : {getGradeDisplay(ticketStudent.grade, 'fr')} / Grade: {getGradeDisplay(ticketStudent.grade, 'en')}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="font-bold">{t.parentLabel}:</span>
                        <span>{ticketStudent.parentName}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="font-bold">{t.dueDate}:</span>
                        <span>{formatDate(ticketStudent.dueDate)}</span>
                      </div>
                      <div className="flex justify-between border-t border-dashed border-slate-300 pt-2 text-rose-600 font-bold">
                        <span>{t.totalOwed}:</span>
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
                <span className="font-bold">{t.student}:</span>
                <span>{ticketStudent.name}</span>
              </div>
              <div className="flex justify-between">
                <span className="font-bold">{t.grade}:</span>
                <span>Classe : {getGradeDisplay(ticketStudent.grade, 'fr')} / Grade: {getGradeDisplay(ticketStudent.grade, 'en')}</span>
              </div>
              <div className="flex justify-between">
                <span className="font-bold">{t.parentLabel}:</span>
                <span>{ticketStudent.parentName}</span>
              </div>
              <div className="flex justify-between">
                <span className="font-bold">{t.dueDate}:</span>
                <span>{formatDate(ticketStudent.dueDate)}</span>
              </div>
              <div className="flex justify-between border-t border-black pt-2 font-bold text-lg">
                <span>{t.totalOwed}:</span>
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
                      <th className="px-3 py-2 border-r border-black">{t.parentContact2}</th>
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
                <p className="text-[10px] text-slate-400 mt-0.5">{t.phone2}: +223 70 00 00 00 | {t.email2} contact@mamathera.edu.ml</p>
              </div>
              {visibleStudentIdentifier(printStudentFile.grade, printStudentFile.studentId) && (
                <div className="border border-slate-300 px-4 py-2 text-center rounded-xl bg-slate-50">
                  <span className="text-[9px] font-black uppercase tracking-widest block text-slate-400">{t.studentId}</span>
                  <span className="font-mono font-bold text-sm text-slate-800">
                    {visibleStudentIdentifier(printStudentFile.grade, printStudentFile.studentId)}
                  </span>
                </div>
              )}
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
        <ParentFormModal
          t={t}
          lang={lang}
          currentTheme={currentTheme}
          editingParent={editingParent}
          students={students}
          availableClasses={availableClasses}
          parentForm={parentForm}
          setParentForm={setParentForm}
          handleParentSubmit={handleParentSubmit}
          formatCurrency={formatCurrency}
          overlayRef={(el) => { overlayRoots.current[9] = el; }}
          onClose={() => setShowParentModal(false)}
          onOpenStudentForm={() => setShowStudentModal(true)}
          onRecordPayment={(studentId) => {
            setPaymentStudentId(studentId);
            setPaymentAmount('');
            setShowPaymentForm(true);
          }}
          onViewStudent={(s) => setSelectedStudent(s)}
        />
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
                      {s.name}{visibleStudentIdentifier(s.grade, s.studentId) ? ` — ${t.studentId}: ${visibleStudentIdentifier(s.grade, s.studentId)}` : ''} · {t.grade}: {s.grade || '—'}
                    </option>
                  ))}
                </select>
              </div>

              <div className="pt-4 flex justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setShowLinkStudentModal(false)}
                  className="h-11 px-4 rounded-2xl border border-slate-200 dark:border-slate-800 text-xs font-bold text-slate-600 dark:text-slate-400 whitespace-nowrap"
                >
                  {t.close}
                </button>
                <button
                  type="submit"
                  disabled={!studentToLinkId}
                  className="h-11 px-4 rounded-2xl bg-emerald-600 text-white font-black text-xs hover:bg-emerald-700 disabled:opacity-50 shadow-lg shadow-emerald-600/20 whitespace-nowrap"
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
        <NotifyParentModal
          t={t}
          currentTheme={currentTheme}
          notifyParent={notifyParent}
          notifySelectedPhone={notifySelectedPhone}
          setNotifySelectedPhone={setNotifySelectedPhone}
          notifyCustomText={notifyCustomText}
          setNotifyCustomText={setNotifyCustomText}
          notifyTemplateType={notifyTemplateType}
          handleNotifyTemplateChange={handleNotifyTemplateChange}
          handleCopyNotifyMessage={handleCopyNotifyMessage}
          handleSendSMS={handleSendSMS}
          handleSendWhatsApp={handleSendWhatsApp}
          copiedToast={copiedToast}
          formatCurrency={formatCurrency}
          getParentOutstandingBalance={getParentOutstandingBalance}
          overlayRef={(el) => { overlayRoots.current[11] = el; }}
          onClose={() => setShowNotifyModal(false)}
        />
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

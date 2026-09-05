import { Fragment, useRef, useState } from 'react';
import type { Dispatch, ReactNode, SetStateAction, FormEvent, KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Briefcase, Calendar, CheckCircle2, CheckSquare, Copy, CreditCard, DollarSign, FileText, Globe, Layers, Printer, Receipt, ShieldCheck, Sparkles, StickyNote, Trash2, Users, X } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { Student, Staff, Parent, Todo, Expense, SalaryPayment, VendorExpense } from '../lib/useSupabaseData';
import type { CalendarEvent, CurrentTheme, ExpenseForm, ManagedClass, ParentForm, SalaryForm, StaffForm, VendorExpenseForm } from '../app/mainViewsProps';
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
import { StaffFormModal } from './StaffFormModal';
import { ExpenseFormModal } from './ExpenseFormModal';
import { RecordSalaryModal } from './RecordSalaryModal';
import { PaymentEntryModal } from './PaymentEntryModal';
import { CalendarDayModal } from './CalendarDayModal';
import { SuccessToast } from './SuccessToast';
import { WelcomeToast } from './WelcomeToast';
import { LinkStudentModal } from './LinkStudentModal';
import { LatePaymentTicketModal } from './LatePaymentTicketModal';
import { useEscapeToClose } from '../lib/useEscapeToClose';
import { useOverlayTraps } from '../lib/focusStack';
import { modalTokens } from '../lib/modalTokens';
import { visibleStudentIdentifier } from '../lib/studentIdentifiers';

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

type RegisterRef = (el: HTMLElement | null) => void;
const noopRegister: RegisterRef = () => {};

interface OverlayEntry {
  key: string;
  /** AppModals-managed: gets a trap slot + Escape entry. Self-managed children
   *  (StudentFormModal / AddClassModal / EditClassModal) push their own stack
   *  entries via `open` and are listed only to keep the DOM order identical. */
  coordinated: boolean;
  /** Wrap in <AnimatePresence> for exit animations. */
  presence: boolean;
  open: boolean;
  close: () => void;
  /** Position among coordinated entries — assigned by AppModals before render. */
  slot?: number;
  render: (register: RegisterRef, onClose: () => void) => ReactNode;
}

export function AppModals(props: AppModalsProps) {
  const [confirmDeleteStudent, setConfirmDeleteStudent] = useState<Student | null>(null);
  const { Briefcase, Calendar, CheckCircle2, CheckSquare, Copy, CreditCard, DollarSign, FileText, Globe, Layers, Printer, Receipt, ShieldCheck, Sparkles, StickyNote, Trash2, Users, X, academicYears, activeLinkingParent, aiInput, aiMessages, auditYear, availableClasses, copiedToast, copyToClipboard, currentMonth, currentTheme, currentUser, deleteStudent, deleteTodo, editClassForm, editingParent, editingStaff, editingStudent, editingVendorExpense, expenseCategoryList, expenseForm, formatCurrency, formatDate, generateInstallmentMemo, generatePaymentReceiptPdf, getDayName, getEventsForDay, getNotesForDay, getGradeDisplay, getParentOutstandingBalance, getYearStats, handleAddTodo, handleAiQuery, handleCopyNotifyMessage, handleCreateClassSubmit, handleEditClassSubmit, handleExpenseSubmit, handleLinkStudentSubmit, handleNotifyTemplateChange, handleParentSubmit, handlePaymentSubmit, handleSalarySubmit, handleSaveNote, handleSendSMS, handleSendWhatsApp, handleStaffSubmit, handleStudentSubmit, handleVendorExpenseSubmit, isPromoter, isGeneralManager, lang, newClassForm, noteText, savingNoteOnDate, saveNoteOnDate, setNoteText, notifyCustomText, notifyParent, notifySelectedPhone, notifyTemplateType, openEditModal, parentForm, paymentAmount, paymentDate, paymentStudentId, printStudentFile, productivitySidebarTab, salaryForm, salaryPayments, schoolLogo, selectedCalendarDay, selectedStudent, setAiInput, setEditClassForm, setEditingVendorExpense, setExpenseForm, setNewClassForm, setNotifyCustomText, setNotifySelectedPhone, setParentForm, setPaymentAmount, setPaymentDate, setPaymentStudentId, setPrintStudentFile, setProductivitySidebarTab, setSalaryForm, setSelectedStudent, setShowAddClassModal, setShowAuditModal, setShowCalendarModal, setShowEditClassModal, setShowExpenseModal, setShowLinkStudentModal, setShowNotifyModal, setShowParentModal, setShowPaymentForm, setShowSalaryModal, setShowStaffModal, setShowStudentModal, setShowTodoSidebar, setShowVendorExpenseModal, setStaffForm, setStudentDetailTab, setStudentForm, setStudentToLinkId, setTicketStudent, setTodoInput, setVendorExpenseForm, showAddClassModal, showAuditModal, showCalendarModal, showEditClassModal, showExpenseModal, showLinkStudentModal, showNotifyModal, showParentModal, showPaymentForm, showSalaryModal, showStaffModal, showStudentModal, showSuccessToast, showTodoSidebar, showVendorExpenseModal, staff, staffForm, studentDetailTab, studentForm, studentToLinkId, students, t, ticketStudent, todoDate, setTodoDate, todoInput, todos, toggleLanguage, toggleTodo, handleUpdateTodoDate, vendorExpenseForm, welcomeMessage  } = props;
  const tokens = modalTokens(currentTheme);

  // ── One ordered overlay registry ─────────────────────────────────────────
  // Every overlay hosted here appears EXACTLY once, in JSX/stack order: the
  // last entry whose `open` is true is the visual topmost — Escape closes it
  // and its focus-trap slot derives from its position, so adding or removing
  // an overlay only edits this list, never a numbered ref.
  const overlays: OverlayEntry[] = [
    {
      key: 'student-details',
      coordinated: true,
      presence: true,
      open: Boolean(selectedStudent),
      close: () => setSelectedStudent(null),
      render: (register, onClose) => selectedStudent ? (
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
          overlayRef={register}
          onClose={onClose}
          onEdit={() => openEditModal(selectedStudent)}
          onPrint={() => setPrintStudentFile(selectedStudent)}
          onDeleteRequest={() => setConfirmDeleteStudent(selectedStudent)}
        />
      ) : null,
    },
    {
      key: 'student-form',
      coordinated: false,
      presence: true,
      open: showStudentModal,
      close: () => setShowStudentModal(false),
      render: (register, onClose) => (
        <StudentFormModal
          t={t}
          lang={lang}
          open={showStudentModal}
          editingStudent={editingStudent}
          studentForm={studentForm}
          setStudentForm={setStudentForm}
          handleStudentSubmit={handleStudentSubmit}
          onClose={onClose}
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
      ),
    },
    {
      key: 'add-class',
      coordinated: false,
      presence: true,
      open: showAddClassModal,
      close: () => setShowAddClassModal(false),
      render: (register, onClose) => (
        <AddClassModal
          t={t}
          open={showAddClassModal}
          newClassForm={newClassForm}
          setNewClassForm={setNewClassForm}
          handleCreateClassSubmit={handleCreateClassSubmit}
          onClose={onClose}
          themeCard={currentTheme.card}
          themeBorder={currentTheme.border}
          themeHeader={currentTheme.header}
          themeMuted={currentTheme.muted}
          themeIsDark={currentTheme.isDark}
        />
      ),
    },
    {
      key: 'edit-class',
      coordinated: false,
      presence: true,
      open: showEditClassModal,
      close: () => setShowEditClassModal(false),
      render: (register, onClose) => (
        <EditClassModal
          t={t}
          open={showEditClassModal}
          editClassForm={editClassForm}
          setEditClassForm={setEditClassForm}
          handleEditClassSubmit={handleEditClassSubmit}
          onClose={onClose}
          themeCard={currentTheme.card}
          themeBorder={currentTheme.border}
          themeHeader={currentTheme.header}
          themeMuted={currentTheme.muted}
          themeIsDark={currentTheme.isDark}
        />
      ),
    },
    {
      key: 'staff',
      coordinated: true,
      presence: true,
      open: showStaffModal,
      close: () => setShowStaffModal(false),
      render: (register, onClose) => (
        <StaffFormModal
          t={t}
          currentTheme={currentTheme}
          editingStaff={editingStaff}
          staffForm={staffForm}
          setStaffForm={setStaffForm}
          handleStaffSubmit={handleStaffSubmit}
          overlayRef={register}
          onClose={onClose}
        />
      ),
    },
    {
      key: 'expense',
      coordinated: true,
      presence: true,
      open: showExpenseModal,
      close: () => setShowExpenseModal(false),
      render: (register, onClose) => (
        <ExpenseFormModal
          t={t}
          currentTheme={currentTheme}
          expenseForm={expenseForm}
          setExpenseForm={setExpenseForm}
          handleExpenseSubmit={handleExpenseSubmit}
          overlayRef={register}
          onClose={onClose}
        />
      ),
    },
    {
      key: 'vendor',
      coordinated: true,
      presence: true,
      open: showVendorExpenseModal,
      close: () => {
        setShowVendorExpenseModal(false);
        setEditingVendorExpense(null);
      },
      render: (register, onClose) => (
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
          overlayRef={register}
          onClose={onClose}
        />
      ),
    },
    {
      key: 'salary',
      coordinated: true,
      presence: true,
      open: showSalaryModal,
      close: () => setShowSalaryModal(false),
      render: (register, onClose) => (
        <RecordSalaryModal
          t={t}
          currentTheme={currentTheme}
          staff={staff}
          salaryPayments={salaryPayments}
          currentMonth={currentMonth}
          salaryForm={salaryForm}
          setSalaryForm={setSalaryForm}
          formatCurrency={formatCurrency}
          generateInstallmentMemo={generateInstallmentMemo}
          handleSalarySubmit={handleSalarySubmit}
          overlayRef={register}
          onClose={onClose}
        />
      ),
    },
    {
      key: 'calendar',
      coordinated: true,
      presence: true,
      open: Boolean(showCalendarModal && selectedCalendarDay),
      close: () => setShowCalendarModal(false),
      render: (register, onClose) => showCalendarModal && selectedCalendarDay ? (
        <CalendarDayModal
          t={t}
          lang={lang}
          currentTheme={currentTheme}
          selectedCalendarDay={selectedCalendarDay}
          getDayName={getDayName}
          getEventsForDay={getEventsForDay}
          getNotesForDay={getNotesForDay}
          noteText={noteText}
          setNoteText={setNoteText}
          savingNoteOnDate={savingNoteOnDate}
          saveNoteOnDate={saveNoteOnDate}
          formatCurrency={formatCurrency}
          overlayRef={register}
          onClose={onClose}
        />
      ) : null,
    },
    {
      key: 'payment',
      coordinated: true,
      presence: true,
      open: showPaymentForm,
      close: () => setShowPaymentForm(false),
      render: (register, onClose) => (
        <PaymentEntryModal
          t={t}
          currentTheme={currentTheme}
          students={students}
          paymentStudentId={paymentStudentId}
          setPaymentStudentId={setPaymentStudentId}
          paymentAmount={paymentAmount}
          setPaymentAmount={setPaymentAmount}
          paymentDate={paymentDate}
          setPaymentDate={setPaymentDate}
          formatCurrency={formatCurrency}
          handlePaymentSubmit={handlePaymentSubmit}
          overlayRef={register}
          onClose={onClose}
        />
      ),
    },
    {
      key: 'audit',
      coordinated: true,
      presence: true,
      open: Boolean(showAuditModal && auditYear),
      close: () => setShowAuditModal(false),
      render: (register, onClose) => showAuditModal && auditYear ? (
        <YearlyAuditSheetModal
          t={t}
          lang={lang}
          currentTheme={currentTheme}
          auditYear={auditYear}
          schoolLogo={schoolLogo}
          students={students}
          getYearStats={getYearStats}
          formatCurrency={formatCurrency}
          overlayRef={register}
          onClose={onClose}
        />
      ) : null,
    },
    {
      key: 'ticket',
      coordinated: true,
      presence: true,
      open: Boolean(ticketStudent),
      close: () => setTicketStudent(null),
      render: (register, onClose) => ticketStudent ? (
        <LatePaymentTicketModal
          t={t}
          currentTheme={currentTheme}
          student={ticketStudent}
          getGradeDisplay={getGradeDisplay}
          formatDate={formatDate}
          formatCurrency={formatCurrency}
          overlayRef={register}
          onClose={onClose}
        />
      ) : null,
    },
    {
      key: 'parent',
      coordinated: true,
      presence: false,
      open: showParentModal,
      close: () => setShowParentModal(false),
      render: (register, onClose) => (
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
          overlayRef={register}
          onClose={onClose}
          onOpenStudentForm={() => setShowStudentModal(true)}
          onRecordPayment={(studentId) => {
            setPaymentStudentId(studentId);
            setPaymentAmount('');
            setShowPaymentForm(true);
          }}
          onViewStudent={(s) => setSelectedStudent(s)}
        />
      ),
    },
    {
      key: 'link-student',
      coordinated: true,
      presence: false,
      open: Boolean(showLinkStudentModal && activeLinkingParent),
      close: () => setShowLinkStudentModal(false),
      render: (register, onClose) => showLinkStudentModal && activeLinkingParent ? (
        <LinkStudentModal
          t={t}
          currentTheme={currentTheme}
          activeLinkingParent={activeLinkingParent}
          students={students}
          studentToLinkId={studentToLinkId}
          setStudentToLinkId={setStudentToLinkId}
          handleLinkStudentSubmit={handleLinkStudentSubmit}
          overlayRef={register}
          onClose={onClose}
        />
      ) : null,
    },
    {
      key: 'notify',
      coordinated: true,
      presence: false,
      open: Boolean(showNotifyModal && notifyParent),
      close: () => setShowNotifyModal(false),
      render: (register, onClose) => showNotifyModal && notifyParent ? (
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
          overlayRef={register}
          onClose={onClose}
        />
      ) : null,
    },
  ];
  let slot = 0;
  for (const o of overlays) {
    if (o.coordinated) o.slot = slot++;
  }
  const coordinatedOverlays = overlays.filter((o) => o.coordinated);

  useEscapeToClose(
    coordinatedOverlays.some((o) => o.open),
    () => {
      for (let i = coordinatedOverlays.length - 1; i >= 0; i--) {
        if (coordinatedOverlays[i].open) {
          coordinatedOverlays[i].close();
          return;
        }
      }
    },
  );
  // Focus trap: confine Tab to the currently-open overlay (same registry order
  // — the last open entry is the visually topmost) and restore focus on close.
  const overlayRoots = useRef<(HTMLElement | null)[]>([]);
  useOverlayTraps(
    coordinatedOverlays.map((o) => o.open),
    (i) => overlayRoots.current[i] ?? null,
  );
  return (
    <>
      {/* Overlays — rendered from the single ordered registry above. */}
      {overlays.map((o) => {
        const register: RegisterRef = o.coordinated
          ? (el) => { overlayRoots.current[o.slot!] = el; }
          : noopRegister;
        const rendered = o.open ? o.render(register, o.close) : null;
        return (
          <Fragment key={o.key}>
            {o.presence ? <AnimatePresence>{rendered}</AnimatePresence> : rendered}
          </Fragment>
        );
      })}

      {/* --- SuccessToast --- */}
      <AnimatePresence>
        {showSuccessToast && (
          <SuccessToast t={t} />
        )}
      </AnimatePresence>


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
                    <tr className={`${tokens.paperFillMid} border-b border-black font-bold`}>
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
                <div className={`border border-slate-300 px-4 py-2 text-center rounded-xl ${tokens.paperFillLight}`}>
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
              <div className={`col-span-1 border-2 border-slate-300 rounded-[2rem] h-40 overflow-hidden ${tokens.paperFillLight} flex items-center justify-center relative shadow-inner`}>
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
                    <span className={`${tokens.paperFillMid} px-3 py-1 rounded-lg text-xs font-bold uppercase`}>
                      {t.class} {getGradeDisplay(printStudentFile.grade, 'fr')}
                    </span>
                    <span className={`${tokens.paperFillMid} px-3 py-1 rounded-lg text-xs font-bold uppercase`}>
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
                <div className={`${tokens.paperFillLight} p-4 rounded-xl border border-slate-100`}>
                  <span className="text-[10px] font-bold text-slate-400 block uppercase">{t.totalTuitionDue}</span>
                  <span className="text-lg font-black text-slate-800">{formatCurrency(printStudentFile.totalDue)}</span>
                </div>
                <div className={`${tokens.paperFillLight} p-4 rounded-xl border border-slate-100`}>
                  <span className="text-[10px] font-bold text-slate-400 block uppercase">{t.paidTuition}</span>
                  <span className="text-lg font-black text-emerald-600">+{formatCurrency(printStudentFile.amountPaid)}</span>
                </div>
                <div className={`${tokens.paperFillAlert} p-4 rounded-xl border border-rose-100`}>
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


import { Fragment, useRef, useState } from 'react';
import type { ReactNode, FormEvent, KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Briefcase, Calendar, CheckCircle2, CheckSquare, Copy, CreditCard, DollarSign, FileText, Layers, Printer, Receipt, ShieldCheck, Sparkles, StickyNote, Trash2, Users, X } from 'lucide-react';
import type { Student } from '../lib/useSupabaseData';
import { ADMIN_POSITIONS } from '../lib/adminPositions';
import { ConfirmDialog } from './ConfirmDialog';
import { ParentFormModal } from './ParentFormModal';
import { ProductivityPanel } from './ProductivityPanel';
import { StudentDetailsModal } from './StudentDetailsModal';
import { StudentFormModal } from './StudentFormModal';
import { VendorExpenseModal } from './VendorExpenseModal';
import { YearlyAuditSheetModal } from './YearlyAuditSheetModal';
import { NotifyParentModal } from './NotifyParentModal';
import { AddClassModal } from './AddClassModal';
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
import { AuditReportPrint } from './AuditReportPrint';
import { StudentFilePrint } from './StudentFilePrint';

export type { AppModalsProps } from '../app/appModalsProps';
import type { AppModalsProps } from '../app/appModalsProps';


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
  const { Briefcase, Calendar, CheckCircle2, CheckSquare, Copy, CreditCard, DollarSign, FileText, Layers, Printer, Receipt, ShieldCheck, Sparkles, StickyNote, Trash2, Users, X, academicYears, activeLinkingParent, aiInput, aiMessages, auditYear, availableClasses, copiedToast, copyToClipboard, currentMonth, currentTheme, currentUser, deleteStudent, deleteTodo, editClassForm, editingParent, editingStaff, editingStudent, editingVendorExpense, expenseCategoryList, expenseForm, formatCurrency, formatDate, generateInstallmentMemo, generatePaymentReceiptPdf, getDayName, getEventsForDay, getNotesForDay, getGradeDisplay, getParentOutstandingBalance, getYearStats, handleAddTodo, handleAiQuery, handleCopyNotifyMessage, handleCreateClassSubmit, handleEditClassSubmit, handleExpenseSubmit, handleLinkStudentSubmit, handleNotifyTemplateChange, handleParentSubmit, handlePaymentSubmit, handleSalarySubmit, handleSaveNote, handleSendSMS, handleSendWhatsApp, handleStaffSubmit, handleStudentSubmit, handleVendorExpenseSubmit, isPromoter, isGeneralManager, lang, newClassForm, noteText, savingNoteOnDate, saveNoteOnDate, setNoteText, notifyCustomText, notifyParent, notifySelectedPhone, notifyTemplateType, openEditModal, parentForm, paymentAmount, paymentDate, paymentStudentId, printStudentFile, productivitySidebarTab, salaryForm, salaryPayments, schoolLogo, selectedCalendarDay, selectedStudent, setAiInput, setEditClassForm, setEditingVendorExpense, setExpenseForm, setNewClassForm, setNotifyCustomText, setNotifySelectedPhone, setParentForm, setPaymentAmount, setPaymentDate, setPaymentStudentId, setPrintStudentFile, setProductivitySidebarTab, setSalaryForm, setSelectedStudent, setShowAddClassModal, setShowAuditModal, setShowCalendarModal, setShowEditClassModal, setShowExpenseModal, setShowLinkStudentModal, setShowNotifyModal, setShowParentModal, setShowPaymentForm, setShowSalaryModal, setShowStaffModal, setShowStudentModal, setShowTodoSidebar, setShowVendorExpenseModal, setStaffForm, setStudentDetailTab, setStudentForm, setStudentToLinkId, setTicketStudent, setTodoInput, setVendorExpenseForm, showAddClassModal, showAuditModal, showCalendarModal, showEditClassModal, showExpenseModal, showLinkStudentModal, showNotifyModal, showParentModal, showPaymentForm, showSalaryModal, showStaffModal, showStudentModal, showSuccessToast, showTodoSidebar, showVendorExpenseModal, staff, staffForm, staffModalMode, studentDetailTab, studentForm, studentToLinkId, students, t, ticketStudent, todoDate, setTodoDate, todoInput, todos, toggleTodo, handleUpdateTodoDate, vendorExpenseForm, welcomeMessage  } = props;
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
          currentTheme={currentTheme}
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
          currentTheme={currentTheme}
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
          currentTheme={currentTheme}
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
          adminMode={staffModalMode === 'admin'}
          techniqueMode={staffModalMode === 'technique'}
          positionOptions={staffModalMode === 'admin' ? ADMIN_POSITIONS[lang] : undefined}
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
          isGeneralManager={isGeneralManager}
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
            currentTheme={currentTheme}
          />
        )}
      </AnimatePresence>

      {/* --- SuccessToast --- */}
      <AnimatePresence>
        {showSuccessToast && (
          <SuccessToast t={t} />
        )}
      </AnimatePresence>


      {/* --- Printable Annual Audit Report (extracted component) --- */}
      {auditYear && (
        <AuditReportPrint
          t={t}
          auditYear={auditYear}
          students={students}
          getYearStats={getYearStats}
          formatCurrency={formatCurrency}
          tokens={tokens}
        />
      )}

      {/* --- Printable Student Academic File (extracted component) --- */}
      {printStudentFile && (
        <StudentFilePrint
          t={t}
          student={printStudentFile}
          currentUser={currentUser}
          getGradeDisplay={getGradeDisplay}
          formatCurrency={formatCurrency}
          tokens={tokens}
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


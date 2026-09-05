/**
 * App shell — the root layout JSX of the application (extracted from App.tsx).
 *
 * Owns: auth/loading gate, sidebar + header + banners, the lazy MainViews /
 * AppModals mounts (spread of the `viewsProps` wiring), floating chat, the
 * app-level modals (promotion, add-user, excel import, payroll draft), and the
 * global chrome (offline banner, env badge, toasts, confirm dialog, inactivity
 * warning).
 *
 * Props: the SAME contract MainViews/AppModals consume (`MainViewsProps &
 * AppModalsProps`, supplied by App via `{...viewsProps}`) plus `viewsProps`
 * itself and the ~49 shell-only values (auth gate, toast, confirm dialog,
 * chat state, …). App.tsx keeps the state cluster + the wiring literal.
 */
import { lazy, Suspense } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import type { MainViewsProps } from '../app/mainViewsProps';
import type { AppModalsProps } from './AppModals';
import type { User } from '../app/types';
import type { useFloatingChat } from '../app/useFloatingChat';
import type { useNotificationWatch } from '../app/useNotificationWatch';
import type { useDashboard } from '../app/useDashboard';
import type { useInactivityLogout } from '../app/useInactivityLogout';
import type { useToast } from '../lib/useToast';
import type { useSupabaseData } from '../lib/useSupabaseData';
import type { useYearOps } from '../app/useYearOps';
import type { useExports } from '../app/useExports';
import type { usePayroll } from '../app/usePayroll';
import type { getAppEnv } from '../lib/networkUtils';
import type { ImportCategory } from '../lib/excelImporter';
import type { generateMultiYearReportPdf } from '../lib/pdfMultiYearReport';
import type { generateFinancialReportPdf } from '../lib/pdfFinancialReport';
import { ToastContainer, OfflineBanner, EnvBadge } from './ToastNotification';
import { FloatingChat } from './FloatingChat';
import { InactivityWarning } from './InactivityWarning';
import { ConfirmDialog } from './ConfirmDialog';
import { AppLoadingScreen } from './AppLoadingScreen';
import { Sidebar } from './Sidebar';
import { AppHeader } from './AppHeader';
import { WelcomeBanner } from './WelcomeBanner';
import { LockedYearBanner } from './LockedYearBanner';
import { Login } from './Login';
import { AddUserModal } from './AddUserModal';
import { ExcelImportHost, MonthlyDraftHost } from './ModalHosts';
import { AnimatePresence } from 'motion/react';
import { AlertTriangle } from 'lucide-react';

const PromotionWizardModal = lazy(() => import('./PromotionWizardModal').then(m => ({ default: m.PromotionWizardModal })));
const ArchivesView = lazy(() => import('./ArchivesView').then(m => ({ default: m.ArchivesView })));
const AppModals = lazy(() => import('./AppModals').then(m => ({ default: m.AppModals })));
const MainViews = lazy(() => import('./MainViews').then(m => ({ default: m.MainViews })));

export type ActiveTab =
  | 'dashboard' | 'students' | 'parents' | 'payroll' | 'expenses'
  | 'settings' | 'calendar' | 'notes' | 'archives' | 'audit';

type ConfirmAction = { title: string; message: string; confirmLabel: string; onConfirm: () => void };

/** Shell-only values App passes alongside the `viewsProps` wiring. */
export interface AppShellExtras {
  viewsProps: MainViewsProps & AppModalsProps;
  /** Tighten the loose AppModalsProps.currentUser to the real user shape. */
  currentUser: User | null;
  /** Overload-tightened: MonthlyDraftHost takes an `unknown` amount. */
  formatCurrency: (amount: unknown) => string;
  authLoading: boolean;
  supabaseLoading: boolean;
  supabaseError: string | null;
  appEnv: ReturnType<typeof getAppEnv>;
  toast: ReturnType<typeof useToast>;
  fetchAll: ReturnType<typeof useSupabaseData>['fetchAll'];
  setActiveTab: Dispatch<SetStateAction<ActiveTab>>;
  openAddStudentModal: () => void;
  setSelectedYear: Dispatch<SetStateAction<string>>;
  setSearchTerm: Dispatch<SetStateAction<string>>;
  studentGradeFilter: string;
  setStudentGradeFilter: Dispatch<SetStateAction<string>>;
  setIsPromotionWizardOpen: Dispatch<SetStateAction<boolean>>;
  setShowExcelImport: Dispatch<SetStateAction<boolean>>;
  generateMultiYearReportPdf: typeof generateMultiYearReportPdf;
  lockedYears: string[];
  vendorExpensesTab: 'general' | 'all' | 'vendors';
  handleExport: ReturnType<typeof useExports>['handleExport'];
  generateFinancialReportPdf: typeof generateFinancialReportPdf;
  notifications: ReturnType<typeof useDashboard>['notifications'];
  readNotificationIds: ReturnType<typeof useNotificationWatch>['readNotificationIds'];
  markNotificationRead: ReturnType<typeof useNotificationWatch>['markNotificationRead'];
  markNotificationUnread: ReturnType<typeof useNotificationWatch>['markNotificationUnread'];
  markAllNotificationsRead: ReturnType<typeof useNotificationWatch>['markAllNotificationsRead'];
  openCalendarOnDate: ReturnType<typeof useNotificationWatch>['openCalendarOnDate'];
  handleCloseCurrentYear: ReturnType<typeof useYearOps>['handleCloseCurrentYear'];
  setAuditYear: Dispatch<SetStateAction<string | null>>;
  isFloatingChatOpen: boolean;
  setIsFloatingChatOpen: Dispatch<SetStateAction<boolean>>;
  floatingChatMessages: ReturnType<typeof useFloatingChat>['floatingChatMessages'];
  floatingChatInput: string;
  setFloatingChatInput: Dispatch<SetStateAction<string>>;
  handleFloatingAiQuery: ReturnType<typeof useFloatingChat>['handleFloatingAiQuery'];
  isPromotionWizardOpen: boolean;
  batchPromoteStudents: ReturnType<typeof useSupabaseData>['batchPromoteStudents'];
  showAddUserModal: boolean;
  showExcelImport: boolean;
  batchImportData: (
    category: ImportCategory,
    records: Record<string, unknown>[],
    options: { academicYear: string; duplicateStrategy: 'skip' | 'update' }
  ) => Promise<{ inserted: number; updated: number; errors: number }>;
  showMonthlyDraftModal: boolean;
  selectedDraftMonth: number;
  selectedDraftYear: number;
  handleExportMonthlyPayrollExcel: ReturnType<typeof usePayroll>['handleExportMonthlyPayrollExcel'];
  pendingQueueCount: number;
  isSyncing: boolean;
  syncOfflineQueue: ReturnType<typeof useSupabaseData>['syncOfflineQueue'];
  confirmAction: ConfirmAction | null;
  setConfirmAction: Dispatch<SetStateAction<ConfirmAction | null>>;
  inactivity: ReturnType<typeof useInactivityLogout>;
}

export function AppShell(props: MainViewsProps & AppModalsProps & AppShellExtras) {
  const {
    viewsProps, authLoading, supabaseLoading, supabaseError, appEnv, toast, fetchAll,
    t, currentUser, auth, lang, toggleLanguage, currentTheme, theme, ticketStudent,
    formatDate, schoolLogo, activeTab, setActiveTab, payrollWindowStatus, fetchAuditLogs,
    showTodoSidebar, setShowTodoSidebar, openAddStudentModal, setShowPaymentForm,
    selectedYear, setSelectedYear, academicYears, availableClasses, searchTerm,
    setSearchTerm, studentGradeFilter, setStudentGradeFilter, setIsPromotionWizardOpen,
    setShowExcelImport, setSelectedDraftMonth, setSelectedDraftYear,
    setShowMonthlyDraftModal, generateMultiYearReportPdf, lockedYears, students,
    expenses, vendorExpenses, salaryPayments, handlePrint, vendorExpensesTab,
    handleExport, generateFinancialReportPdf, generateExpensesReportPdf,
    notifications, setSelectedStudent, readNotificationIds, markNotificationRead,
    markAllNotificationsRead, markNotificationUnread, openCalendarOnDate, getYearStats,
    formatCurrency, handleCloseCurrentYear, setAuditYear, setShowAuditModal,
    isFloatingChatOpen, setIsFloatingChatOpen, floatingChatMessages, floatingChatInput,
    setFloatingChatInput, handleFloatingAiQuery, isPromotionWizardOpen,
    batchPromoteStudents, showAddUserModal, setShowAddUserModal, setUserProfiles,
    showExcelImport, batchImportData, showMonthlyDraftModal, selectedDraftMonth,
    selectedDraftYear, staff, handleExportMonthlyPayrollExcel, setSalaryForm,
    setShowSalaryModal, pendingQueueCount, isSyncing, syncOfflineQueue, confirmAction,
    setConfirmAction, inactivity,
  } = props;

  return (
    <>
      {authLoading ? (
<AppLoadingScreen title={t.restoringSession} subtitle={t.checkingAuthentication} />
      ) : !currentUser ? (
        <Login onLogin={auth.signIn} lang={lang} setLang={toggleLanguage} t={t} />
      ) : supabaseLoading ? (
<AppLoadingScreen title={t.loadingFinanceSuite} subtitle={t.connectingToDatabase} />
      ) : (
        <div className={`min-h-screen ${currentTheme.bg} flex font-sans ${currentTheme.text} transition-colors duration-300 theme-${theme} ${currentTheme.isDark ? 'dark ' : ''}${ticketStudent ? 'no-print-ticket' : ''}`}>
          {/* Environment Badge (dev/staging only) */}
          <EnvBadge env={appEnv} />
          {/* Offline Banner */}
          <OfflineBanner lang={lang} t={t} />
          {/* Toast Notifications */}
          <ToastContainer toasts={toast.toasts} onDismiss={toast.removeToast} />
          {supabaseError && (
            <div className="fixed top-0 left-0 right-0 z-50 bg-red-600 text-white text-center py-2 text-xs font-semibold flex items-center justify-center gap-3">
              <span className="flex items-center gap-1.5"><AlertTriangle size={14} className="flex-shrink-0" /> {t.databaseConnectionIssue}: {supabaseError}</span>
              <button
                onClick={() => fetchAll()}
                className="px-3 py-1 bg-white/20 hover:bg-white/30 rounded-lg font-bold text-[10px] uppercase tracking-wider transition-colors"
              >
                {t.retry}
              </button>
            </div>
          )}
          
          {/* Print Header */}
      <div className="hidden print:block print-header">
        <div className="flex justify-between items-center">
          <div>
            <h1 className="text-2xl font-bold text-slate-900">{t.title}</h1>
            <p className="text-sm text-slate-500">{t.subtitle}</p>
          </div>
          <div className="text-right">
            <h2 className="text-xl font-bold text-slate-900">{t.monthlyReport}</h2>
            <p className="text-sm text-slate-500">{formatDate(new Date().toISOString())}</p>
          </div>
        </div>
      </div>
      
      <Sidebar
        t={t}
        schoolLogo={schoolLogo}
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        payrollWindowStatus={payrollWindowStatus}
        currentUser={currentUser}
        fetchAuditLogs={fetchAuditLogs}
        showTodoSidebar={showTodoSidebar}
        setShowTodoSidebar={setShowTodoSidebar}
        onSignOut={() => auth.signOut()}
        onToggleLanguage={() => toggleLanguage(lang === 'en' ? 'fr' : 'en')}
        onAddStudent={openAddStudentModal}
        onRecordPayment={() => setShowPaymentForm(true)}
      />

      {/* --- Main Content --- */}
      <main className={`flex-1 lg:ml-64 p-8 lg:p-12 transition-all duration-300 ${showTodoSidebar ? 'lg:mr-80' : ''}`}>
        
        <AppHeader
          t={t}
          lang={lang}
          currentTheme={currentTheme}
          activeTab={activeTab}
          currentUser={currentUser}
          selectedYear={selectedYear}
          setSelectedYear={setSelectedYear}
          academicYears={academicYears}
          availableClasses={availableClasses}
          searchTerm={searchTerm}
          setSearchTerm={setSearchTerm}
          studentGradeFilter={studentGradeFilter}
          setStudentGradeFilter={setStudentGradeFilter}
          onPromoteClass={() => setIsPromotionWizardOpen(true)}
          onImportExcel={() => setShowExcelImport(true)}
          onOpenMonthlyDraft={() => {
            setSelectedDraftMonth(new Date().getMonth());
            setSelectedDraftYear(new Date().getFullYear());
            setShowMonthlyDraftModal(true);
          }}
          onAddStudent={openAddStudentModal}
          onPrintReport={() => {
            if (activeTab === 'archives') {
              generateMultiYearReportPdf({
                academicYears,
                lockedYears,
                students,
                expenses,
                vendorExpenses,
                salaryPayments,
                lang,
              });
            } else if (activeTab === 'expenses') {
              generateExpensesReportPdf({
                expenses,
                vendorExpenses,
                selectedYear,
                subTab: vendorExpensesTab,
                lang,
              });
            } else {
              handlePrint();
            }
          }}
          onExportLate={handleExport}
          onFinancialReportPdf={() => generateFinancialReportPdf({
            students,
            expenses,
            vendorExpenses,
            salaryPayments,
            selectedYear,
            lang
          })}
          notifications={notifications}
          onOpenStudent={(studentId) => {
            const student = students.find(s => s.id === studentId);
            if (student) setSelectedStudent(student);
          }}
          readNotificationIds={readNotificationIds}
          onMarkNotificationRead={markNotificationRead}
          onMarkAllNotificationsRead={markAllNotificationsRead}
          onMarkNotificationUnread={markNotificationUnread}
  onOpenCalendarDate={openCalendarOnDate}
onOpenPayroll={() => setActiveTab('payroll')}
/>

        <WelcomeBanner t={t} currentUser={currentUser} />

        <LockedYearBanner t={t} show={lockedYears.includes(selectedYear)} />

        {/* --- Views (dashboard, students, parents, payroll, expenses, calendar, notes, audit, settings) --- */}
        <Suspense fallback={<div className={`${currentTheme.card} p-8 rounded-[2.5rem] border ${currentTheme.border} shadow-xl shadow-slate-200/50 animate-pulse`}><div className="h-6 w-64 bg-slate-300 dark:bg-slate-700 rounded-lg mb-8" /><div className="h-[400px] w-full bg-slate-200 dark:bg-slate-800 rounded-2xl" /></div>}>
          <MainViews {...viewsProps} />
        </Suspense>

        {/* --- Yearly Comparison & Archives View --- */}
        {activeTab === 'archives' && (
          <Suspense fallback={<div className={`${currentTheme.card} p-8 rounded-[2.5rem] border ${currentTheme.border} shadow-xl shadow-slate-200/50 animate-pulse`}><div className="h-6 w-72 bg-slate-300 dark:bg-slate-700 rounded-lg mb-8" /><div className="h-[320px] w-full bg-slate-200 dark:bg-slate-800 rounded-2xl" /></div>}>
            <ArchivesView
              lang={lang}
              t={t}
              currentTheme={currentTheme}
              academicYears={academicYears}
              lockedYears={lockedYears}
              students={students}
              expenses={expenses}
              vendorExpenses={vendorExpenses}
              salaryPayments={salaryPayments}
              selectedYear={selectedYear}
              currentUser={currentUser}
              getYearStats={getYearStats}
              formatCurrency={formatCurrency}
              generateMultiYearReportPdf={generateMultiYearReportPdf}
              handlePrint={handlePrint}
              handleCloseCurrentYear={handleCloseCurrentYear}
              setAuditYear={setAuditYear}
              setShowAuditModal={setShowAuditModal}
            />
          </Suspense>
        )}
      </main>

      <Suspense fallback={null}>
        <AppModals {...viewsProps} />
      </Suspense>

      {/* Floating AI chat widget — panel + FAB (src/components/FloatingChat.tsx). */}
      <FloatingChat
        t={t}
        isFloatingChatOpen={isFloatingChatOpen}
        setIsFloatingChatOpen={setIsFloatingChatOpen}
        floatingChatMessages={floatingChatMessages}
        floatingChatInput={floatingChatInput}
        setFloatingChatInput={setFloatingChatInput}
        handleFloatingAiQuery={handleFloatingAiQuery}
        themeCard={currentTheme.card}
        themeBorder={currentTheme.border}
        themeHeader={currentTheme.header}
        themeIsDark={currentTheme.isDark}
      />
        </div>
      )}

      {/* Academic Year Promotion Wizard Modal */}
      <Suspense fallback={null}>
        <PromotionWizardModal
          isOpen={isPromotionWizardOpen}
          onClose={() => setIsPromotionWizardOpen(false)}
          students={students}
          availableAcademicYears={academicYears}
          currentAcademicYear={selectedYear || '2025-2026'}
          onPromote={batchPromoteStudents}
          language={lang}
          t={t}
        />
      </Suspense>

      {/* Add Staff / User Account Modal */}
      <AnimatePresence>
        {showAddUserModal && (
          <AddUserModal
            onClose={() => setShowAddUserModal(false)}
            onCreated={(profiles) => setUserProfiles(profiles)}
            createStaffUser={auth.createStaffUser}
            fetchAllProfiles={auth.fetchAllProfiles}
            t={t}
            currentTheme={currentTheme}
            toastError={(msg) => toast.error(msg)}
            toastSuccess={(msg) => toast.success(msg)}
          />
        )}
      </AnimatePresence>

      {/* Smart Excel Import Modal */}
      <ExcelImportHost
        isOpen={showExcelImport}
        onClose={() => setShowExcelImport(false)}
        lang={lang}
        t={t}
        academicYears={academicYears}
        selectedYear={selectedYear}
        batchImportData={batchImportData}
        themeCard={currentTheme.card}
        themeBorder={currentTheme.border}
        themeMuted={currentTheme.muted}
        themeIsDark={currentTheme.isDark}
      />

      {/* Monthly Payroll Draft Modal */}
      <MonthlyDraftHost
        isOpen={showMonthlyDraftModal}
        onClose={() => setShowMonthlyDraftModal(false)}
        monthIndex={selectedDraftMonth}
        year={selectedDraftYear}
        onMonthChange={setSelectedDraftMonth}
        onYearChange={setSelectedDraftYear}
        lang={lang}
        t={t}
        staff={staff}
        salaryPayments={salaryPayments}
        selectedYear={selectedYear}
        onExportExcel={handleExportMonthlyPayrollExcel}
        onRecordPayment={(staffId, balance) => {
          setSalaryForm({ staffId, amount: balance.toString(), date: new Date().toISOString().split('T')[0] });
          setShowSalaryModal(true);
        }}
        formatCurrency={formatCurrency}
        currentTheme={currentTheme}
      />

      {/* Global Toast Notifications & Offline Resilience Banner */}
      <OfflineBanner
        lang={lang}
        pendingCount={pendingQueueCount}
        isSyncing={isSyncing}
        onSync={syncOfflineQueue}
        t={t}
      />
      <EnvBadge env={appEnv} />
      <ToastContainer toasts={toast.toasts} onDismiss={toast.removeToast} />

      {/* --- Global Confirmation Dialog --- */}
      <ConfirmDialog
        open={!!confirmAction}
        title={confirmAction?.title || ''}
        message={confirmAction?.message || ''}
        confirmLabel={confirmAction?.confirmLabel || ''}
        cancelLabel={t.cancel}
        onConfirm={() => {
          const action = confirmAction;
          setConfirmAction(null);
          action?.onConfirm();
        }}
        onCancel={() => setConfirmAction(null)}
        currentTheme={currentTheme}
      />

      {/* Inactivity auto-logout warning (see useInactivityLogout) */}
      <InactivityWarning
        open={inactivity.warningOpen}
        remainingSeconds={inactivity.remainingSeconds}
        onStay={inactivity.reset}
        t={t}
        currentTheme={currentTheme}
      />
    </>
  );
}

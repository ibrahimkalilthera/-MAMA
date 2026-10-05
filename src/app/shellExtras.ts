/**
 * Shell-only extras — everything `<AppShell>` needs beyond the `viewsProps`
 * wiring: data-loading flags, tab/navigation setters, the notification bell
 * callbacks, the floating chat, the promotion wizard gate, the offline queue
 * and the confirm/inactivity hooks.
 *
 * Extracted from src/app/viewsWiring.ts (split campaign, no behaviour change):
 * this literal is what pushed that file against the 700-line budget. It is a
 * pure function of the same `ShellDeps` the wiring already receives plus the
 * built `viewsProps`, so it belongs in its own module rather than inline.
 *
 * Typed on the FULL contracts on purpose: `deps: ShellDeps` and the return
 * `AppShellExtras` mean a shell prop renamed in any of the three interfaces
 * fails here (tsc), instead of silently reaching the shell as `undefined`.
 *
 * Two PDF generators are imported directly rather than read from `deps`: like
 * `viewsProps`, the shell supplies them itself (they are Omitted from
 * `ShellDeps`), so they are the module's own imports, exactly as before.
 */
import type { MainViewsProps } from './mainViewsProps';
import type { AppModalsProps } from '../components/AppModals';
import type { AppShellExtras } from '../components/AppShell';
import type { ShellDeps } from './shellDeps';
import { generateMultiYearReportPdf } from '../lib/pdfMultiYearReport';
import { generateFinancialReportPdf } from '../lib/pdfFinancialReport';

export function buildShellExtras(
  deps: ShellDeps,
  viewsProps: MainViewsProps & AppModalsProps,
): AppShellExtras {
  const {
    fetchAll,
    authLoading,
    currentUser,
    supabaseLoading,
    supabaseError,
    appEnv,
    toast,
    setActiveTab,
    openAddStudentModal,
    setSelectedYear,
    setSearchTerm,
    studentGradeFilter,
    setStudentGradeFilter,
    setIsPromotionWizardOpen,
    setShowExcelImport,
    lockedYears,
    vendorExpensesTab,
    handleExport,
    notifications,
    readNotificationIds, deletedNotificationIds,
    markNotificationRead, markAllNotificationsRead,
    markNotificationUnread, deleteNotification,
    clearAllNotifications, restoreDeletedNotifications,
    openCalendarOnDate,
    handleCloseCurrentYear,
    setAuditYear,
    isFloatingChatOpen,
    setIsFloatingChatOpen,
    floatingChatMessages,
    floatingChatInput,
    setFloatingChatInput,
    handleFloatingAiQuery,
    isPromotionWizardOpen,
    batchPromoteStudents,
    showAddUserModal,
    showExcelImport,
    batchImportData,
    showMonthlyDraftModal,
    selectedDraftMonth,
    selectedDraftYear,
    handleExportMonthlyPayrollExcel,
    pendingQueueCount, isSyncing, syncOfflineQueue,
    confirmAction,
    setConfirmAction,
    inactivity,
    formatCurrency,
  } = deps;

  return {
    viewsProps,
    fetchAll,
    authLoading,
    currentUser,
    supabaseLoading,
    supabaseError,
    appEnv,
    toast,
    setActiveTab,
    openAddStudentModal,
    setSelectedYear,
    setSearchTerm,
    studentGradeFilter,
    setStudentGradeFilter,
    setIsPromotionWizardOpen,
    setShowExcelImport,
    generateMultiYearReportPdf,
    lockedYears,
    vendorExpensesTab,
    handleExport,
    generateFinancialReportPdf,
    notifications,
    // Carillon (lu / supprimé) — apparié deux par ligne : budget de lignes.
    readNotificationIds, deletedNotificationIds,
    markNotificationRead, markAllNotificationsRead,
    markNotificationUnread, deleteNotification,
    clearAllNotifications, restoreDeletedNotifications,
    openCalendarOnDate,
    handleCloseCurrentYear,
    setAuditYear,
    isFloatingChatOpen,
    setIsFloatingChatOpen,
    floatingChatMessages,
    floatingChatInput,
    setFloatingChatInput,
    handleFloatingAiQuery,
    isPromotionWizardOpen,
    batchPromoteStudents,
    showAddUserModal,
    showExcelImport,
    batchImportData,
    showMonthlyDraftModal,
    selectedDraftMonth,
    selectedDraftYear,
    handleExportMonthlyPayrollExcel,
    pendingQueueCount, isSyncing, syncOfflineQueue,
    // File hors ligne : ce qui attend, et ce que la base a déjà refusé.
    pendingFailures: deps.pendingFailures, cacheSavedAt: deps.cacheSavedAt,
    confirmAction,
    setConfirmAction,
    inactivity,
    formatCurrency,
  };
}

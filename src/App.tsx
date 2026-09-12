/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useEffect, useMemo, useRef, FormEvent } from 'react';
import { useSupabaseData } from './lib/useSupabaseData';
import { sameYearMonth } from './lib/dateWindows';
import { useToast } from './lib/useToast';
import { useFloatingChat } from './app/useFloatingChat';
import { useAuthWelcome } from './app/useAuthWelcome';
import { useTodoSidebar } from './app/useTodoSidebar';
import { useParents } from './app/useParents';
import { usePayments } from './app/usePayments';
import { usePayroll } from './app/usePayroll';
import { useClasses } from './app/useClasses';
import { useDashboard } from './app/useDashboard';
import { useExports } from './app/useExports';
import { useTheme } from './app/useTheme';
import { useStudents } from './app/useStudents';
import { useExpenses } from './app/useExpenses';
import { useUsers } from './app/useUsers';
import { useInactivityLogout } from './app/useInactivityLogout';
import { fetchInactivityMinutes, saveInactivityMinutes } from './lib/teamSettings';
import { logAuditEvent } from './lib/auditLogger';
import { useYear } from './app/yearContext';
import { getReadNotificationIds, saveReadNotificationIds } from './lib/notificationReads';
import { playNotificationChime } from './lib/notificationSound';
import { findNewNotifications } from './lib/notificationWatch';
import { useYearOps } from './app/useYearOps';
import { buildShellProps } from './app/viewsWiring';
import { getAppEnv, formatSupabaseError } from './lib/networkUtils';
import { AppShell } from './components/AppShell';

import { formatCurrency as formatCurrencyImpl, formatDateLang } from './lib/formatters';

import { translations } from './i18n/translations';
import type { Language, User, Parent, Student, Staff, SalaryPayment, Expense, VendorExpense, Todo, SchoolClass } from './app/types';


// --- Components ---


export default function App() {
  const [lang, setLang] = useState<Language>('fr');
  // Derived once per render; declared early so every effect below can list
  // translated strings in its dependency array (tsc: no use-before-declaration).
  const t = translations[lang];

  const toggleLanguage = (newLang: Language) => {
    setLang(newLang);
    setTimeout(() => {
      document.querySelectorAll('[data-i18n]').forEach((el) => {
        const key = el.getAttribute('data-i18n');
        if (key) {
          const text = translations[newLang][key as keyof typeof translations['en']];
          if (text) {
            el.textContent = text;
          }
        }
      });
    }, 0);
  };

  // Data is now fetched from Supabase via the useSupabaseData hook
  // Toast notifications provide user-facing feedback for all database operations
  const toast = useToast();
  const appEnv = getAppEnv();

  // Bilingual operation labels for toast messages
  const operationLabels: Record<string, { en: string; fr: string }> = useMemo(() => ({
    addParent: { en: 'Parent added', fr: 'Parent ajouté' },
    updateParent: { en: 'Parent updated', fr: 'Parent mis à jour' },
    deleteParent: { en: 'Parent deleted', fr: 'Parent supprimé' },
    addStudent: { en: 'Student added', fr: 'Élève ajouté(e)' },
    updateStudent: { en: 'Student updated', fr: 'Élève mis(e) à jour' },
    deleteStudent: { en: 'Student deleted', fr: 'Élève supprimé(e)' },
    addPayment: { en: 'Payment recorded', fr: 'Paiement enregistré' },
    addStaff: { en: 'Staff added', fr: 'Employé ajouté' },
    updateStaff: { en: 'Staff updated', fr: 'Employé mis à jour' },
    deleteStaff: { en: 'Staff deleted', fr: 'Employé supprimé' },
    addSalaryPayment: { en: 'Salary recorded', fr: 'Salaire enregistré' },
    addExpense: { en: 'Expense added', fr: 'Dépense ajoutée' },
    addVendorExpense: { en: 'Vendor expense added', fr: 'Charge fournisseur ajoutée' },
    updateVendorExpense: { en: 'Vendor expense updated', fr: 'Charge fournisseur mise à jour' },
    deleteVendorExpense: { en: 'Vendor expense deleted', fr: 'Charge fournisseur supprimée' },
    addTodo: { en: 'Task added', fr: 'Tâche ajoutée' },
  }), []);

  const supabaseData = useSupabaseData({
    onMutationSuccess: (operation) => {
      const label = operationLabels[operation];
      if (label) {
        toast.success(label[lang]);
      }
    },
    onMutationError: (operation, errorMessage) => {
      const formatted = formatSupabaseError({ message: errorMessage }, lang);
      toast.error(`${formatted.title}: ${formatted.message}`);
    },
    onRetry: (attempt) => {
      toast.retrying(t.retryingConnection.replace('{n}', String(attempt)));
    },
  });
const {
    customClasses,
    addCustomClass,
    updateCustomClass,
    deleteCustomClass,
    parents, setParents,
    students, setStudents,
    staff, setStaff,
    salaryPayments, setSalaryPayments,
    expenses, setExpenses,
    vendorExpenses, setVendorExpenses,
    todos, setTodos,
    loading: supabaseLoading,
    error: supabaseError,
    pendingQueueCount,
    isSyncing,
    auditLogs,
    fetchAuditLogs,
    syncOfflineQueue,
    fetchAll,
    addPayment,
    addSalaryPayment,
    addExpense,
    deleteStudent,
    deleteStaff,
    deleteParent,
    updateParent,
    addParent,
    updateStudent,
    addStudent,
    updateStaff,
    addStaff,
    addVendorExpense,
    updateVendorExpense,
    deleteVendorExpense,
    deleteExpense,
    addTodo: addTodoItem,
    updateTodo: updateTodoItem,
    deleteTodo: deleteTodoItem,
    batchPromoteStudents,
    batchImportData,
  } = supabaseData;


  const [showSuccessToast, setShowSuccessToast] = useState(false);
  const showToast = () => {
    setShowSuccessToast(true);
    setTimeout(() => setShowSuccessToast(false), 3000);
  };
  const [copied, setCopied] = useState(false);
  const [activeTab, setActiveTab] = useState<'dashboard' | 'students' | 'parents' | 'payroll' | 'expenses' | 'settings' | 'calendar' | 'notes' | 'archives' | 'audit'>('dashboard');
  // Auth/welcome domain (session, greeting banner, profiles, admin tab guard) —
  // extracted to src/app/useAuthWelcome.ts.
  const authWelcomeData = useAuthWelcome({ t, activeTab, setActiveTab });
const {
    auth, currentUser, isPromoter, isGeneralManager, authLoading,
    userProfiles, setUserProfiles,
    welcomeMessage, setWelcomeMessage,
  } = authWelcomeData;

  // Inactivity auto-logout: TEAM-wide configurable window (stored in the
  // app_settings table, applied by every account), warning countdown before
  // cut. localStorage only caches the team value for an instant start.
  const [teamInactivityMinutes, setTeamInactivityMinutes] = useState<number | null>(null);
  useEffect(() => {
    if (!auth.user) {
      setTeamInactivityMinutes(null);
      return;
    }
    let cancelled = false;
    void fetchInactivityMinutes().then((value) => {
      if (!cancelled) setTeamInactivityMinutes(value);
    });
    return () => { cancelled = true; };
  }, [auth.user]);

  const inactivity = useInactivityLogout({
    enabled: !!auth.user && !authLoading,
    signOut: auth.signOut,
    teamMinutes: teamInactivityMinutes,
    onMinutesCommit: (m) => {
      setTeamInactivityMinutes(m);
      void saveInactivityMinutes(m);
      void logAuditEvent({
        action: 'update_setting',
        targetType: 'app_settings',
        details: JSON.stringify({ key: 'inactivity_minutes', value: m }),
        user: auth.profile
          ? { id: auth.profile.id, email: auth.profile.email, full_name: auth.profile.fullName, role: auth.profile.role }
          : null,
      });
    },
  });

  // Users/settings domain (add-user modal, role management, password reset) —
  // extracted to src/app/useUsers.ts.
  const usersData = useUsers({
    t, auth, userProfiles, setUserProfiles,
    toast,
  });
const {
    showAddUserModal, setShowAddUserModal,
    userSearchTerm, setUserSearchTerm,
    userRoleFilter, setUserRoleFilter,
    updatingUserId, setUpdatingUserId,
    passwordTarget, setPasswordTarget,
    passwordInput, setPasswordInput,
    handleUpdateRole,
    handleToggleRole,
    handleSendPasswordReset,
    handleSetPassword,
  } = usersData;

  // Academic-year state (selected/locked) — owned by the YearProvider, read
  // here through the context and passed down to the domain hooks as deps.
  const yearData = useYear();
const { selectedYear, setSelectedYear, lockedYears, setLockedYears } = yearData;
  const [showAuditModal, setShowAuditModal] = useState(false);
  const [auditYear, setAuditYear] = useState<string | null>(null);

  const [academicYears, setAcademicYears] = useState<string[]>(['2026-2027', '2027-2028', '2028-2029']);
  const [isPromotionWizardOpen, setIsPromotionWizardOpen] = useState(false);
  const [showExcelImport, setShowExcelImport] = useState(false);

  const themeData = useTheme();
const {
    theme, setTheme,
    schoolLogo, setSchoolLogo,
    logoColor, setLogoColor,
    logoInputRef,
    currentTheme,
    handleLogoUpload,
  } = themeData;

  // Expenses/vendors domain (modals, filters, calendar, forms, tickets) —
  // extracted to src/app/useExpenses.ts.
  const expensesData = useExpenses({
    t, lang, selectedYear, lockedYears, isPromoter, isGeneralManager, currentUser,
    addExpense, deleteExpense, addVendorExpense, updateVendorExpense, deleteVendorExpense,
    showToast,
    toastError: (msg) => toast.error(msg),
  });
const {
    showExpenseModal, setShowExpenseModal,
    showVendorExpenseModal, setShowVendorExpenseModal,
    vendorExpensesTab, setVendorExpensesTab,
    generalExpenseCategoryFilter, setGeneralExpenseCategoryFilter,
    generalExpenseSearch, setGeneralExpenseSearch,
    vendorSearch, setVendorSearch,
    vendorCategoryFilter, setVendorCategoryFilter,
    vendorStatusFilter, setVendorStatusFilter,
    calendarDate, setCalendarDate,
    showCalendarModal, setShowCalendarModal,
    expenseForm, setExpenseForm,
    vendorExpenseForm, setVendorExpenseForm,
    editingVendorExpense, setEditingVendorExpense,
    ticketStudent, setTicketStudent,
    expenseCategoryList,
    handleDeleteExpense,
    handleExpenseSubmit,
    handleVendorExpenseSubmit,
    handleEditVendorExpense,
    handleDeleteVendorExpense,
    getDaysInMonth,
    changeMonth,
    getMonthName,
    getDayName,
  } = expensesData;

  const today = new Date().toISOString().split('T')[0];

  // Students domain (list, sort, add/edit modal, notes, flags, A4 print) —
  // extracted to src/app/useStudents.ts.
  const studentsData = useStudents({
    t, lang, today, selectedYear, lockedYears, isPromoter, isGeneralManager,
    students, addStudent, updateStudent,
    showToast,
    toastError: (msg) => toast.error(msg),
  });
const {
    searchTerm, setSearchTerm,
    selectedStudent, setSelectedStudent,
    showStudentModal, setShowStudentModal,
    editingStudent, setEditingStudent,
    studentGradeFilter, setStudentGradeFilter,
    studentSortKey, setStudentSortKey,
    studentSortOrder, setStudentSortOrder,
    handleSort,
    studentForm, setStudentForm,
    studentDetailTab, setStudentDetailTab,
    printStudentFile, setPrintStudentFile,
    filteredStudents,
    handleStudentSubmit,
    openEditModal,
    handleSaveNote,
    toggleFlag,
  } = studentsData;
  const currentMonth = new Date().getMonth();
  const currentYear = new Date().getFullYear();

  // --- Calculations ---

  const dashboardData = useDashboard({
    t, today, currentMonth, selectedYear,
    students, staff, expenses, vendorExpenses, salaryPayments,
  });
const {
    stats,
    notifications,
    lateStudents,
    chartData,
    pieData,
    missedMonths,
    payrollWindowStatus,
  } = dashboardData;

  // --- Notification read-state (persisted per user in localStorage) ---

  const notifUserId = auth.profile?.id ?? 'guest';
  const [readNotificationIds, setReadNotificationIds] = useState<string[]>([]);

  useEffect(() => {
    setReadNotificationIds(getReadNotificationIds(notifUserId));
  }, [notifUserId]);

  useEffect(() => {
    // Prune dismissed ids that no longer correspond to a live reminder, so a
    // reminder that comes back later (new due period) notifies again.
    const liveIds = new Set(notifications.map(n => n.id));
    saveReadNotificationIds(notifUserId, readNotificationIds.filter(id => liveIds.has(id)));
  }, [readNotificationIds, notifUserId, notifications]);

  const markNotificationRead = (id: string): void => {
    setReadNotificationIds(prev => (prev.includes(id) ? prev : [...prev, id]));
  };

  const markNotificationUnread = (id: string): void => {
    setReadNotificationIds(prev => (prev.includes(id) ? prev.filter(x => x !== id) : prev));
  };

  const openCalendarOnDate = (date: string): void => {
    // Parse as a LOCAL calendar day (never UTC midnight — month display
    // must not shift in negative-UTC timezones).
    const [y, m, d] = date.split('-').map(Number);
    const day = new Date(y, m - 1, d);
    setCalendarDate(day);
    setSelectedCalendarDay(day);
    setShowCalendarModal(true);
    setActiveTab('calendar');
  };

  const markAllNotificationsRead = (): void => {
    setReadNotificationIds(notifications.map(n => n.id));
  };

  // --- In-session notification alerts (chime + toast) ---

  const prevNotifIdsRef = useRef<ReadonlySet<string> | null>(null);

  useEffect(() => {
    const prev = prevNotifIdsRef.current;
    const fresh = findNewNotifications(prev, notifications);
    prevNotifIdsRef.current = new Set(notifications.map(n => n.id));
    // First observation (session start) never alerts.
    if (!prev || fresh.length === 0) return;
    playNotificationChime();
    if (fresh.length === 1) {
      toast.warning(fresh[0].message);
    } else {
      toast.warning(t.newNotifications.replace('{n}', String(fresh.length)));
    }
  }, [notifications, t, toast]);

  // Light background refresh so reminders can actually appear mid-session
  // (another staff member's changes). Silent: no loading flash, no error
  // banner; skipped when the tab is hidden or the device is offline.
  useEffect(() => {
    if (!auth.user) return;
    const poll = setInterval(() => {
      if (document.visibilityState === 'visible' && navigator.onLine) {
        void fetchAll({ silent: true });
      }
    }, 60000);
    return () => clearInterval(poll);
  }, [auth.user, fetchAll]);

  // --- Handlers ---

  const generateInstallmentMemo = (staffId: string, amount: number) => {
    const s = staff.find(st => st.id === staffId);
    if (!s) return;
    
    const paymentsThisMonth = salaryPayments.filter(p => p.staffId === s.id && sameYearMonth(p.date, currentYear, currentMonth));
    const paidThisMonth = paymentsThisMonth.reduce((sum, p) => sum + p.amount, 0) + amount;
    const balance = s.salary - paidThisMonth;
    
    const memo = t.helloInstallment
      .replace('{name}', s.name)
      .replace('{amount}', formatCurrency(amount))
      .replace('{balance}', formatCurrency(balance));
    
    copyToClipboard(memo);
    showToast();
  };

  // Year-operations domain (close current year + year stats) — extracted to
  // src/app/useYearOps.ts.
  const yearOpsData = useYearOps({
    t, currentUser, students, expenses, vendorExpenses, salaryPayments,
    updateStudent, addStudent,
    selectedYear, lockedYears, setLockedYears, setAcademicYears, setAuditYear, setShowAuditModal,
    showToast,
    toastError: (msg) => toast.error(msg),
  });
const {
    handleCloseCurrentYear,
    getYearStats,
  } = yearOpsData;

  // Chat IA (aba Productividade + widget flutuante) — dominio extraido para
  // src/app/useFloatingChat.ts (estado, saudacao, Escape e os 2 handlers).
  const chatData = useFloatingChat({
    lang, t, stats, students, staff, salaryPayments, expenses, vendorExpenses,
    formatCurrency: formatCurrencyImpl,
    formatDate: (dateStr: string) => formatDateLang(dateStr, lang),
  });
const {
    aiMessages, setAiMessages, aiInput, setAiInput, handleAiQuery,
    isFloatingChatOpen, setIsFloatingChatOpen,
    floatingChatMessages, floatingChatInput, setFloatingChatInput, handleFloatingAiQuery,
  } = chatData;

  // To-Do list + Productivité panel domain — extracted to src/app/useTodoSidebar.ts.
  const todoData = useTodoSidebar({
    todos, t,
    handleSaveNote,
    addTodoItem, updateTodoItem, deleteTodoItem,
  });
const {
    todoInput, setTodoInput, todoDate, setTodoDate,
    showTodoSidebar, setShowTodoSidebar,
    productivitySidebarTab, setProductivitySidebarTab,
    handleAddTodo, toggleTodo, deleteTodo, handleUpdateTodoDate,
  } = todoData;


  const exportsData = useExports({
    t, lateStudents,
    students, staff, expenses, salaryPayments,
    showToast,
  });
const {
    handleExport,
    handleExportAllData,
    handlePrint,
  } = exportsData;

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const formatCurrency = formatCurrencyImpl;
  // Global confirmation dialog state — owned here because it is shared by
  // several delete flows (parents, classes, staff, vendor expenses, …).
  const [confirmAction, setConfirmAction] = useState<{ title: string; message: string; confirmLabel: string; onConfirm: () => void } | null>(null);

  // Parents domain (directory, link-student, notify/reminder, ledger PDF) —
  // extracted to src/app/useParents.ts.
  const parentsData = useParents({
    t, lang, formatCurrency,
    students, setStudents,
    addParent, updateParent, deleteParent, updateStudent,
    setWelcomeMessage,
    setConfirmAction,
  });
const {
    expandedParentId, setExpandedParentId,
    parentSearchTerm, setParentSearchTerm,
    showParentModal, setShowParentModal,
    editingParent, setEditingParent,
    parentForm, setParentForm,
    showLinkStudentModal, setShowLinkStudentModal,
    activeLinkingParent, setActiveLinkingParent,
    studentToLinkId, setStudentToLinkId,
    parentChildrenSortBy, setParentChildrenSortBy,
    showNotifyModal, setShowNotifyModal,
    notifyParent, setNotifyParent,
    notifySelectedPhone, setNotifySelectedPhone,
    notifyTemplateType, setNotifyTemplateType,
    notifyCustomText, setNotifyCustomText,
    copiedToast, setCopiedToast,
    buildReminderText,
    openNotifyModal,
    handleNotifyTemplateChange,
    handleSendWhatsApp,
    handleSendSMS,
    handleCopyNotifyMessage,
    getChildrenForParent,
    getParentOutstandingBalance,
    getParentPaymentHistory,
    handleExportParentLedgerPdf,
    handleParentSubmit,
    handleLinkStudentSubmit,
    handleUnlinkStudent,
    handleDeleteParent,
    openEditParentModal,
  } = parentsData;

const paymentsData = usePayments({
  t, lang, selectedYear, lockedYears, students, staff, expenses, todos, currentUser,
  addPayment,
  toastError: (msg) => toast.error(msg),
});
const {
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
} = paymentsData;

const payrollData = usePayroll({
  t, lang, selectedYear, lockedYears, staff, salaryPayments, showToast,
  addStaff, updateStaff, addSalaryPayment, schoolLogo,
  toastError: (msg) => toast.error(msg),
});
const {
  showStaffModal, setShowStaffModal,
  staffModalMode, setStaffModalMode,
  showSalaryModal, setShowSalaryModal,
  showMonthlyDraftModal, setShowMonthlyDraftModal,
  selectedDraftMonth, setSelectedDraftMonth,
  selectedDraftYear, setSelectedDraftYear,
  staffForm, setStaffForm,
  staffSearchTerm, setStaffSearchTerm,
  staffPositionFilter, setStaffPositionFilter,
  visibleBankDetails, setVisibleBankDetails,
  salaryForm, setSalaryForm,
  editingStaff, setEditingStaff,
  filteredStaff,
  adminStaffCount,
  handleStaffSubmit,
  handleSalarySubmit,
  openEditStaffModal,
  handleExportStaffReceiptPdf,
  handleExportMonthlyPayrollExcel,
} = payrollData;

  const classesData = useClasses({
    t, customClasses, toast,
    autoSelectGrade: (grade: string) => setStudentForm(prev => ({ ...prev, grade })),
    setConfirmAction,
    addCustomClass, updateCustomClass, deleteCustomClass,
  });
const {
    showEditClassModal, setShowEditClassModal,
    editingClassRowId, setEditingClassRowId,
    editClassForm, setEditClassForm,
    showAddClassModal, setShowAddClassModal,
    newClassForm, setNewClassForm,
    handleCreateClassSubmit,
    openEditClass,
    handleEditClassSubmit,
    handleDeleteClass,
  } = classesData;

  // Open the add-student modal (shared by the sidebar and header buttons).
  const openAddStudentModal = () => {
    setEditingStudent(null);
    setStudentForm({
      name: '',
      parentName: '',
      parentEmail: '',
      parentPhone: '',
      totalDue: '',
      scholarshipDiscount: '0',
      dueDate: new Date().toISOString().split('T')[0],
      academicYear: selectedYear || '2024-2025',
      grade: '',
      studentId: '',
      photo: '',
      emergencyContactName: '',
      emergencyContactRelation: '',
      emergencyContactPhone: '',
      medicalNotes: 'None',
      enrollmentDate: new Date().toISOString().split('T')[0],
      previousSchool: '',
      status: 'Active'
    });
    setShowStudentModal(true);
  };


  // Single wiring object for the two shell components (<MainViews> and
  // <AppModals>). The intersection type keeps both contracts honest — tsc
  // fails if a key is missing or mistyped — and the wiring guard
  // (scripts/check-component-props.mjs) resolves the literal in
  // src/app/viewsWiring.ts against both interfaces, so a partial wiring
  // still fails the gate. The literal moved there so App.tsx stays under
  // the line budget; buildShellProps recombines it with the shell extras.
  const shellProps = buildShellProps({
    ...supabaseData,
    ...authWelcomeData,
    ...usersData,
    ...themeData,
    ...expensesData,
    ...studentsData,
    ...dashboardData,
    ...yearOpsData,
    ...chatData,
    ...todoData,
    ...exportsData,
    ...parentsData,
    ...paymentsData,
    ...payrollData,
    ...classesData,
    ...yearData,
    supabaseLoading: supabaseData.loading,
    supabaseError: supabaseData.error,
    lang,
    t,
    toast,
    appEnv,
    inactivity,
    inactivityMinutes: inactivity.minutes,
    setInactivityMinutes: inactivity.setMinutes,
    activeTab,
    setActiveTab,
    currentMonth,
    today,
    generateInstallmentMemo,
    showSuccessToast,
    copyToClipboard,
    toggleLanguage,
    openAddStudentModal,
    setSelectedYear,
    lockedYears,
    academicYears,
    auditYear,
    setAuditYear,
    showAuditModal,
    setShowAuditModal,
    setIsPromotionWizardOpen,
    isPromotionWizardOpen,
    setShowExcelImport,
    showExcelImport,
    readNotificationIds,
    markNotificationRead,
    markAllNotificationsRead,
    markNotificationUnread,
    openCalendarOnDate,
    confirmAction,
    setConfirmAction,
    formatCurrency,
  });

  return (
    <AppShell {...shellProps} />
  );
}

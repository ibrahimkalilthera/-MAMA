/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useEffect, useMemo, useRef, FormEvent, lazy, Suspense } from 'react';
import { useSupabaseData } from './lib/useSupabaseData';
import type { UserProfile } from './lib/useAuth';
import type { MainViewsProps } from './app/mainViewsProps';
import type { AppModalsProps } from './components/AppModals';
import { ToastContainer, OfflineBanner, EnvBadge } from './components/ToastNotification';
import { useToast } from './lib/useToast';
import { useFloatingChat } from './app/useFloatingChat';
import { FloatingChat } from './components/FloatingChat';
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
import { InactivityWarning } from './components/InactivityWarning';
import { useYear } from './app/yearContext';
import { getReadNotificationIds, saveReadNotificationIds } from './lib/notificationReads';
import { playNotificationChime } from './lib/notificationSound';
import { findNewNotifications } from './lib/notificationWatch';
import { useYearOps } from './app/useYearOps';
import type { ImportCategory } from './lib/excelImporter';
import { getAppEnv, formatSupabaseError } from './lib/networkUtils';
import { generatePaymentReceiptPdf } from './lib/pdfReceipt';
import { generateStaffPayslipPdf } from './lib/pdfPayroll';
import { generateFinancialReportPdf } from './lib/pdfFinancialReport';
import { generateMultiYearReportPdf } from './lib/pdfMultiYearReport';
import { generateExpensesReportPdf } from './lib/pdfExpensesReport';
import { generateMonthlyPayrollDraftPdf } from './lib/pdfPayrollDraft';
import { AnimatePresence } from 'motion/react';
import { ConfirmDialog } from './components/ConfirmDialog';
import { AppLoadingScreen } from './components/AppLoadingScreen';
import { Sidebar } from './components/Sidebar';
import { AppHeader } from './components/AppHeader';
import { WelcomeBanner } from './components/WelcomeBanner';
import { LockedYearBanner } from './components/LockedYearBanner';

const PromotionWizardModal = lazy(() => import('./components/PromotionWizardModal').then(m => ({ default: m.PromotionWizardModal })));
const DashboardCharts = lazy(() => import('./components/DashboardCharts').then(m => ({ default: m.DashboardCharts })));
const MultiYearChart = lazy(() => import('./components/MultiYearChart').then(m => ({ default: m.MultiYearChart })));
const ArchivesView = lazy(() => import('./components/ArchivesView').then(m => ({ default: m.ArchivesView })));
const AppModals = lazy(() => import('./components/AppModals').then(m => ({ default: m.AppModals })));
const MainViews = lazy(() => import('./components/MainViews').then(m => ({ default: m.MainViews })));
import { HighlightText, ChartsFallback } from './components/SharedUi';
import { formatCurrency as formatCurrencyImpl, formatDateLang, getGradeDisplay as getGradeDisplayImpl } from './lib/formatters';
import { getStudentStanding } from './lib/classes';
import { Login } from './components/Login';
import { AddUserModal } from './components/AddUserModal';
import { ExcelImportHost, MonthlyDraftHost } from './components/ModalHosts';

import { 
  LayoutDashboard, 
  Users, 
  Layers,
  CreditCard, 
  AlertCircle, 
  CheckCircle2, 
  Clock, 
  Plus, 
  Globe,
  TrendingUp,
  DollarSign,
  Search,
  Mail,
  Phone,
  MessageSquare,
  X,
  Download,
  Copy,
  ChevronRight,
  ChevronLeft,
  Printer,
  ShieldCheck,
  Calendar,
  FileText,
  Bell,
  StickyNote,
  Trash2,
  CheckSquare,
  UploadCloud,
  Flag,
  Briefcase,
  Receipt,
  PieChart,
  Wallet,
  Lock,
  LogOut,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  GraduationCap,
  TrendingDown,
  Coins,
  Edit2,
  Zap,
  Droplet,
  Wifi,
  Sparkles,
  AlertTriangle,
  BookOpen,
  Heart,
  UserPlus,
  ChevronDown,
  ChevronUp,
  MapPin,
  UserCheck,
  Link as LinkIcon,
  Unlink,
  FileSpreadsheet,
  Sun,
  Utensils,
  Landmark,
  Award,
  Wrench,
  Shield,
  Cpu,
  Sprout,
  Hammer
} from 'lucide-react';
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
    addTodo: addTodoItem,
    updateTodo: updateTodoItem,
    deleteTodo: deleteTodoItem,
    batchPromoteStudents,
    batchImportData,
  } = useSupabaseData({
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


  const [showSuccessToast, setShowSuccessToast] = useState(false);
  const showToast = () => {
    setShowSuccessToast(true);
    setTimeout(() => setShowSuccessToast(false), 3000);
  };
  const [copied, setCopied] = useState(false);
  const [activeTab, setActiveTab] = useState<'dashboard' | 'students' | 'parents' | 'payroll' | 'expenses' | 'settings' | 'calendar' | 'notes' | 'archives' | 'audit'>('dashboard');
  // Auth/welcome domain (session, greeting banner, profiles, admin tab guard) —
  // extracted to src/app/useAuthWelcome.ts.
  const {
    auth, currentUser, isPromoter, isGeneralManager, authLoading,
    userProfiles, setUserProfiles,
    welcomeMessage, setWelcomeMessage,
  } = useAuthWelcome({ t, activeTab, setActiveTab });

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
  } = useUsers({
    t, auth, userProfiles, setUserProfiles,
    toast,
  });

  // Academic-year state (selected/locked) — owned by the YearProvider, read
  // here through the context and passed down to the domain hooks as deps.
  const { selectedYear, setSelectedYear, lockedYears, setLockedYears } = useYear();
  const [showAuditModal, setShowAuditModal] = useState(false);
  const [auditYear, setAuditYear] = useState<string | null>(null);

  const [academicYears, setAcademicYears] = useState<string[]>(['2026-2027', '2027-2028', '2028-2029']);
  const [isPromotionWizardOpen, setIsPromotionWizardOpen] = useState(false);
  const [showExcelImport, setShowExcelImport] = useState(false);

  const {
    theme, setTheme,
    schoolLogo, setSchoolLogo,
    logoColor, setLogoColor,
    logoInputRef,
    currentTheme,
    handleLogoUpload,
  } = useTheme();

  // Expenses/vendors domain (modals, filters, calendar, forms, tickets) —
  // extracted to src/app/useExpenses.ts.
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
    handleExpenseSubmit,
    handleVendorExpenseSubmit,
    handleEditVendorExpense,
    handleDeleteVendorExpense,
    getDaysInMonth,
    changeMonth,
    getMonthName,
    getDayName,
  } = useExpenses({
    t, lang, selectedYear, lockedYears, isPromoter, isGeneralManager, currentUser,
    addExpense, addVendorExpense, updateVendorExpense, deleteVendorExpense,
    showToast,
  });

  const today = new Date().toISOString().split('T')[0];

  // Students domain (list, sort, add/edit modal, notes, flags, A4 print) —
  // extracted to src/app/useStudents.ts.
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
  } = useStudents({
    t, lang, today, selectedYear, lockedYears, isPromoter, isGeneralManager,
    students, addStudent, updateStudent,
    showToast,
  });
  const currentMonth = new Date().getMonth();

  // --- Calculations ---

  const {
    stats,
    notifications,
    lateStudents,
    chartData,
    pieData,
    missedMonths,
    payrollWindowStatus,
  } = useDashboard({
    t, today, currentMonth, selectedYear,
    students, staff, expenses, vendorExpenses, salaryPayments,
  });

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
    
    const paymentsThisMonth = salaryPayments.filter(p => p.staffId === s.id && new Date(p.date).getMonth() === currentMonth);
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
  const {
    handleCloseCurrentYear,
    getYearStats,
  } = useYearOps({
    t, currentUser, students, expenses, vendorExpenses, salaryPayments,
    updateStudent, addStudent,
    selectedYear, lockedYears, setLockedYears, setAcademicYears, setAuditYear, setShowAuditModal,
    showToast,
  });

  // Chat IA (aba Productividade + widget flutuante) — dominio extraido para
  // src/app/useFloatingChat.ts (estado, saudacao, Escape e os 2 handlers).
  const {
    aiMessages, setAiMessages, aiInput, setAiInput, handleAiQuery,
    isFloatingChatOpen, setIsFloatingChatOpen,
    floatingChatMessages, floatingChatInput, setFloatingChatInput, handleFloatingAiQuery,
  } = useFloatingChat({
    lang, t, stats, students, staff, salaryPayments, expenses, vendorExpenses,
    formatCurrency: formatCurrencyImpl,
    formatDate: (dateStr: string) => formatDateLang(dateStr, lang),
  });

  // To-Do list + Productivité panel domain — extracted to src/app/useTodoSidebar.ts.
  const {
    todoInput, setTodoInput, todoDate, setTodoDate,
    showTodoSidebar, setShowTodoSidebar,
    productivitySidebarTab, setProductivitySidebarTab,
    handleAddTodo, toggleTodo, deleteTodo, handleUpdateTodoDate,
  } = useTodoSidebar({
    todos, t,
    handleSaveNote,
    addTodoItem, updateTodoItem, deleteTodoItem,
  });


  const {
    handleExport,
    handleExportAllData,
    handlePrint,
  } = useExports({
    t, lateStudents,
    students, staff, expenses, salaryPayments,
    showToast,
  });

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
  } = useParents({
    t, lang, formatCurrency,
    students, setStudents,
    addParent, updateParent, deleteParent, updateStudent,
    setWelcomeMessage,
    setConfirmAction,
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
} = usePayments({
  t, lang, selectedYear, lockedYears, students, staff, expenses, todos, currentUser,
  addPayment,
});

const {
  showStaffModal, setShowStaffModal,
  showSalaryModal, setShowSalaryModal,
  showMonthlyDraftModal, setShowMonthlyDraftModal,
  selectedDraftMonth, setSelectedDraftMonth,
  selectedDraftYear, setSelectedDraftYear,
  staffForm, setStaffForm,
  staffSearchTerm, setStaffSearchTerm,
  visibleBankDetails, setVisibleBankDetails,
  salaryForm, setSalaryForm,
  editingStaff, setEditingStaff,
  filteredStaff,
  handleStaffSubmit,
  handleSalarySubmit,
  openEditStaffModal,
  handleExportStaffReceiptPdf,
  handleExportMonthlyPayrollExcel,
} = usePayroll({
  t, lang, selectedYear, lockedYears, staff, salaryPayments, showToast,
  addStaff, updateStaff, addSalaryPayment,
});

  const {
    availableClasses,
    showEditClassModal, setShowEditClassModal,
    editingClassRowId, setEditingClassRowId,
    editClassForm, setEditClassForm,
    showAddClassModal, setShowAddClassModal,
    newClassForm, setNewClassForm,
    handleCreateClassSubmit,
    openEditClass,
    handleEditClassSubmit,
    handleDeleteClass,
  } = useClasses({
    t, customClasses, toast,
    autoSelectGrade: (grade: string) => setStudentForm(prev => ({ ...prev, grade })),
    setConfirmAction,
    addCustomClass, updateCustomClass, deleteCustomClass,
  });

  const formatDate = (dateStr: string) => formatDateLang(dateStr, lang);

  const getGradeDisplay = (grade: string | undefined, currentLang: 'en' | 'fr' = lang) =>
    getGradeDisplayImpl(grade, availableClasses, t, currentLang);


  const getStatus = (student: Student) => {
    const standing = getStudentStanding(student, today);

    if (standing.key === 'settled') {
      return { 
        label: t.settle, 
        color: 'text-emerald-600 bg-emerald-50 border-emerald-100', 
        icon: <CheckCircle2 size={14} />,
        standing: t.goodStanding
      };
    }

    if (standing.key === 'overdue') {
      return { 
        label: `${standing.daysOverdue} ${t.daysOverdue}`, 
        color: 'text-rose-600 bg-rose-50 border-rose-100 animate-badge-pulse', 
        icon: <Clock size={14} />,
        standing: t.overdue
      };
    }

    if (standing.key === 'dueSoon') {
      return { 
        label: t.dueSoon, 
        color: 'text-amber-600 bg-amber-50 border-amber-100', 
        icon: <AlertCircle size={14} />,
        standing: t.partial
      };
    }

    return { 
      label: t.partial, 
      color: 'text-blue-600 bg-blue-50 border-blue-100', 
      icon: <Calendar size={14} />,
      standing: t.partial
    };
  };

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
  // (scripts/check-component-props.mjs) resolves THIS literal against both
  // interfaces, so a partial wiring still fails the gate.
  const viewsProps: MainViewsProps & AppModalsProps = {
  AlertCircle,
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  Award,
  Bell,
  BookOpen,
  Briefcase,
  Calendar,
  ChartsFallback,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Clock,
  Coins,
  Cpu,
  CreditCard,
  DashboardCharts,
  DollarSign,
  Download,
  Droplet,
  Edit2,
  FileText,
  Flag,
  Globe,
  GraduationCap,
  Hammer,
  Heart,
  HighlightText,
  Landmark,
  Layers,
  Mail,
  MapPin,
  Phone,
  PieChart,
  Plus,
  Printer,
  Receipt,
  Search,
  Shield,
  ShieldCheck,
  Sparkles,
  Sprout,
  StickyNote,
  Sun,
  Suspense,
  Trash2,
  TrendingDown,
  TrendingUp,
  Unlink,
  UploadCloud,
  UserCheck,
  UserPlus,
  Users,
  Utensils,
  Wallet,
  Wifi,
  X,
  Zap,
  activeTab,
  auditLogs,
  auth,
  availableClasses,
  calendarDate,
  changeMonth,
  chartData,
  currentMonth,
  currentTheme,
  deleteStaff,
  deleteStudent,
  deleteTodo,
  expandedParentId,
  expenseCategoryList,
  expenses,
  fetchAuditLogs,
  filteredStaff,
  filteredStudents,
  formatCurrency,
  formatDate,
  generateExpensesReportPdf,
  generateStaffPayslipPdf,
  getChildrenForParent,
  getDayName,
  getDaysInMonth,
  getEventsForDay,
  getNotesForDay,
  getGradeDisplay,
  getMonthName,
  getParentOutstandingBalance,
  getParentPaymentHistory,
  getStatus,
  handleAddTodo,
  handleDeleteClass,
  handleDeleteParent,
  handleDeleteVendorExpense,
  handleExportAllData,
  handleExportParentLedgerPdf,
  handleExportStaffReceiptPdf,
  handleLogoUpload,
  handlePrint,
  handleSendPasswordReset,
  handleSetPassword,
  handleSort,
  handleUnlinkStudent,
  handleUpdateRole,
  isPromoter,
  isGeneralManager,
  lang,
  lateStudents,
  logoColor,
  logoInputRef,
  missedMonths,
  openEditClass,
  openEditModal,
  openEditParentModal,
  openEditStaffModal,
  openNotifyModal,
  parentChildrenSortBy,
  parentSearchTerm,
  parents,
  payrollWindowStatus,
  pieData,
  salaryForm,
  salaryPayments,
  schoolLogo,
  searchTerm,
  selectedYear,
  setActiveLinkingParent,
  setCalendarDate,
  setEditingParent,
  setEditingStaff,
  setEditingVendorExpense,
  setExpandedParentId,
  setLogoColor,
  setParentChildrenSortBy,
  setParentForm,
  setParentSearchTerm,
  setSalaryForm,
  setSchoolLogo,
  setSelectedCalendarDay,
  setSelectedDraftMonth,
  setSelectedDraftYear,
  setSelectedStudent,
  setShowAddClassModal,
  setShowAddUserModal,
  setShowCalendarModal,
  setShowLinkStudentModal,
  setShowMonthlyDraftModal,
  setShowParentModal,
  setShowSalaryModal,
  setShowStaffModal,
  setShowVendorExpenseModal,
  setStaffForm,
  setStaffSearchTerm,
  setStudentToLinkId,
  setTheme,
  setTicketStudent,
  setTodoInput,
  setUserProfiles,
  setUserRoleFilter,
  setUserSearchTerm,
  setVendorCategoryFilter,
  setVendorExpenseForm,
  setVendorSearch,
  setVendorStatusFilter,
  setVisibleBankDetails,
  staff,
  staffSearchTerm,
  stats,
  studentSortKey,
  studentSortOrder,
  t,
  theme,
  today,
  todoDate,
  setTodoDate,
  todoInput,
  todos,
  toggleFlag,
  toggleLanguage,
  toggleTodo,
  handleUpdateTodoDate,
  inactivityMinutes: inactivity.minutes,
  setInactivityMinutes: inactivity.setMinutes,
  passwordInput,
  passwordTarget,
  setPasswordInput,
  setPasswordTarget,
  updatingUserId,
  userProfiles,
  userRoleFilter,
  userSearchTerm,
  vendorCategoryFilter,
  vendorExpenses,
  vendorSearch,
  vendorStatusFilter,
  visibleBankDetails,
  CheckSquare,
  Copy,
  MessageSquare,
  academicYears,
  activeLinkingParent,
  aiInput,
  aiMessages,
  auditYear,
  copiedToast,
  copyToClipboard,
  currentUser,
  editClassForm,
  editingParent,
  editingStaff,
  editingStudent,
  editingVendorExpense,
  expenseForm,
  generateInstallmentMemo,
  generatePaymentReceiptPdf,
  getYearStats,
  handleAiQuery,
  handleCopyNotifyMessage,
  handleCreateClassSubmit,
  handleEditClassSubmit,
  handleExpenseSubmit,
  handleLinkStudentSubmit,
  handleNotifyTemplateChange,
  handleParentSubmit,
  handlePaymentSubmit,
  handleSalarySubmit,
  handleSaveNote,
  handleSendSMS,
  handleSendWhatsApp,
  handleStaffSubmit,
  handleStudentSubmit,
  handleVendorExpenseSubmit,
  newClassForm,
  notifyCustomText,
  notifyParent,
  notifySelectedPhone,
  notifyTemplateType,
  noteText,
  parentForm,
  paymentAmount,
  paymentDate,
  paymentStudentId,
  printStudentFile,
  productivitySidebarTab,
  savingNoteOnDate,
  saveNoteOnDate,
  selectedCalendarDay,
  selectedStudent,
  setAiInput,
  setEditClassForm,
  setExpenseForm,
  setNewClassForm,
  setNotifyCustomText,
  setNoteText,
  setNotifySelectedPhone,
  setPaymentAmount,
  setPaymentDate,
  setPaymentStudentId,
  setPrintStudentFile,
  setProductivitySidebarTab,
  setShowAuditModal,
  setShowEditClassModal,
  setShowExpenseModal,
  setShowNotifyModal,
  setShowPaymentForm,
  setShowStudentModal,
  setShowTodoSidebar,
  setStudentDetailTab,
  setStudentForm,
  showAddClassModal,
  showAuditModal,
  showCalendarModal,
  showEditClassModal,
  showExpenseModal,
  showLinkStudentModal,
  showNotifyModal,
  showParentModal,
  showPaymentForm,
  showSalaryModal,
  showStaffModal,
  showStudentModal,
  showSuccessToast,
  showTodoSidebar,
  showVendorExpenseModal,
  staffForm,
  studentDetailTab,
  studentForm,
  studentToLinkId,
  students,
  ticketStudent,
  vendorExpenseForm,
  welcomeMessage,
  };
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
            themeCard={currentTheme.card}
            themeBorder={currentTheme.border}
            themeMuted={currentTheme.muted}
            themeIsDark={currentTheme.isDark}
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
        themeCard={currentTheme.card}
        themeBorder={currentTheme.border}
        themeMuted={currentTheme.muted}
        themeIsDark={currentTheme.isDark}
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


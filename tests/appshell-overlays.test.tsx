// Regression test for the AppShell extraction: the shell must mount
// EnvBadge, OfflineBanner and ToastContainer EXACTLY ONCE. The original
// extraction left a duplicated overlay block (top + bottom of the shell),
// which made every toast/badge render twice — fixed by removing the stale
// trio, locked here so it can never come back.
//
// Each overlay has a unique z-index marker (z-[9997] EnvBadge, z-[9998]
// OfflineBanner, z-[9999] ToastContainer) — counting those markers in the
// real mounted DOM is the assertion. Content is forced visible (env 'dev',
// pendingQueueCount > 0, one toast) so an absent component cannot pass
// vacuously, and the toast message is also counted to catch double cards.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';
import type { LucideIcon } from 'lucide-react';
import { translations } from '../src/i18n/translations';
import { AppShell } from '../src/components/AppShell';
import type { CurrentTheme } from '../src/app/mainViewsProps';
import { installDomGlobals } from './harness';

const t = translations.fr;

const theme: CurrentTheme = {
  bg: 'bg-slate-100',
  card: 'bg-white',
  text: 'text-slate-900',
  muted: 'text-slate-500',
  border: 'border-slate-200',
  header: '#0F172A',
  sidebar: 'bg-slate-800',
  accent: 'text-emerald-600',
  accentBg: 'bg-emerald-50',
  accentHover: 'hover:bg-emerald-100',
  accentShadow: 'shadow-emerald-200',
  tableHeader: 'bg-slate-100',
  rowHover: 'hover:bg-slate-50',
  input: 'bg-white',
  isDark: false,
};

const noop = () => {};
const asyncNoop = async () => {};
const icon = (() => null) as unknown as LucideIcon;

const TOAST_MESSAGE = 'Toast de test — rendu unique';

/** Props du shell : union MainViewsProps & AppModalsProps & AppShellExtras. */
function shellProps(): Record<string, unknown> {
  return {
    // ── AppShellExtras ──
    authLoading: false,
    supabaseLoading: false,
    supabaseError: null,
    fetchAll: asyncNoop,
    appEnv: 'dev', // force le badge DEV visible
    toast: {
      toasts: [{ id: 't1', type: 'error', message: TOAST_MESSAGE }],
      removeToast: noop,
    },
    setActiveTab: noop,
    openAddStudentModal: noop,
    setSelectedYear: noop,
    setSearchTerm: noop,
    studentGradeFilter: '',
    setStudentGradeFilter: noop,
    setIsPromotionWizardOpen: noop,
    setShowExcelImport: noop,
    generateMultiYearReportPdf: asyncNoop,
    lockedYears: [],
    vendorExpensesTab: 'general',
    handleExport: noop,
    generateFinancialReportPdf: asyncNoop,
    notifications: [],
    readNotificationIds: [],
    markNotificationRead: noop,
    markAllNotificationsRead: noop,
    markNotificationUnread: noop,
    openCalendarOnDate: noop,
    handleCloseCurrentYear: asyncNoop,
    setAuditYear: noop,
    isFloatingChatOpen: false,
    setIsFloatingChatOpen: noop,
    floatingChatMessages: [],
    floatingChatInput: '',
    setFloatingChatInput: noop,
    handleFloatingAiQuery: noop,
    isPromotionWizardOpen: false,
    batchPromoteStudents: asyncNoop,
    showAddUserModal: false,
    showExcelImport: false,
    batchImportData: asyncNoop,
    showMonthlyDraftModal: false,
    selectedDraftMonth: 0,
    selectedDraftYear: 2026,
    handleExportMonthlyPayrollExcel: asyncNoop,
    pendingQueueCount: 2, // force la bannière offline visible (ligne en attente)
    isSyncing: false,
    syncOfflineQueue: asyncNoop,
    confirmAction: null,
    setConfirmAction: noop,
    inactivity: { warningOpen: false, remainingSeconds: 0, reset: noop },

    // ── champs lus par le shell et ses enfants directs ──
    t,
    lang: 'fr' as const,
    toggleLanguage: noop,
    currentTheme: theme,
    theme: 'emerald',
    ticketStudent: null,
    formatDate: (d: string) => d,
    schoolLogo: null,
    currentUser: { name: 'Admin', role: 'admin' },
    auth: { signIn: asyncNoop, signOut: noop, createStaffUser: asyncNoop, fetchAllProfiles: asyncNoop },
    activeTab: 'dashboard',
    payrollWindowStatus: { isOpen: false, label: '' },
    fetchAuditLogs: asyncNoop,
    showTodoSidebar: false,
    setShowTodoSidebar: noop,
    setShowPaymentForm: noop,
    selectedYear: '2026-2027',
    academicYears: ['2026-2027'],
    availableClasses: [],
    searchTerm: '',
    students: [],
    expenses: [],
    vendorExpenses: [],
    salaryPayments: [],
    staff: [],
    handlePrint: noop,
    setSelectedStudent: noop,
    getYearStats: () => ({ revenue: 0, expenses: 0, balance: 0 }),
    formatCurrency: (n: unknown) => `${n} XOF`,
    setSalaryForm: noop,
    setShowSalaryModal: noop,
    setUserProfiles: noop,
    setSelectedDraftMonth: noop,
    setSelectedDraftYear: noop,
    setShowMonthlyDraftModal: noop,
    generateExpensesReportPdf: asyncNoop,

    // ── icônes (contrat MainViews/AppModals) ──
    Bell: icon, Briefcase: icon, Calendar: icon, CheckCircle2: icon, CheckSquare: icon,
    Copy: icon, CreditCard: icon, DollarSign: icon, FileText: icon, Globe: icon,
    Heart: icon, Layers: icon, MessageSquare: icon, Phone: icon, Plus: icon,
    Printer: icon, Receipt: icon, ShieldCheck: icon, Sparkles: icon, StickyNote: icon,
    Trash2: icon, TrendingUp: icon, Users: icon, X: icon,

    // ── viewsProps (MainViews & AppModals — lazy, rendu en fallback ici) ──
    viewsProps: {
      Bell: icon, Briefcase: icon, Calendar: icon, CheckCircle2: icon, CheckSquare: icon,
      Copy: icon, CreditCard: icon, DollarSign: icon, FileText: icon, Globe: icon,
      Heart: icon, Layers: icon, MessageSquare: icon, Phone: icon, Plus: icon,
      Printer: icon, Receipt: icon, ShieldCheck: icon, Sparkles: icon, StickyNote: icon,
      Trash2: icon, TrendingUp: icon, Users: icon, X: icon,
      t,
      currentTheme: theme,
      lang: 'fr' as const,
      currentMonth: 0,
      currentYear: 2026,
      academicYears: ['2026-2027'],
      availableClasses: [],
      students: [],
      staff: [],
      salaryPayments: [],
      expenses: [],
      vendorExpenses: [],
      todos: [],
      aiMessages: [],
      aiInput: '',
      todoInput: '',
      todoDate: '',
      noteText: '',
      savingNoteOnDate: false,
      notifyCustomText: '',
      notifyTemplateType: 'whatsapp',
      copiedToast: false,
      expenseForm: { category: '', description: '', amount: '', date: '' },
      parentForm: { fullName: '', primaryPhone: '', secondaryPhone: '', email: '', address: '', occupation: '', relationship: '', notes: '', linkedStudentIds: [] },
      salaryForm: { staffId: '', amount: '', date: '' },
      staffForm: { name: '', role: 'staff', phone: '', salary: '', joinedDate: '' },
      vendorExpenseForm: { vendorName: '', category: '', amount: '', amountPaid: '', dueDate: '', paymentStatus: 'unpaid' },
      newClassForm: { name: '', cycle: 'other' },
      editClassForm: { name: '', cycle: 'other' },
      auditYear: null,
      selectedStudent: null,
      editingStudent: null,
      editingStaff: null,
      editingParent: null,
      editingVendorExpense: null,
      activeLinkingParent: null,
      studentToLinkId: '',
      studentDetailTab: 'overview',
      paymentStudentId: '',
      paymentAmount: '',
      paymentDate: '',
      studentForm: { name: '', grade: '', parentName: '', parentPhone: '', totalDue: '', amountPaid: '' },
      currentUser: { name: 'Admin', role: 'admin' },
      formatCurrency: (n: number) => `${n} XOF`,
      formatDate: (d: string) => d,
      getDayName: (i: number) => String(i),
      getEventsForDay: () => [],
      getNotesForDay: () => [],
      getYearStats: () => ({ revenue: 0, expenses: 0, balance: 0 }),
      generateInstallmentMemo: noop,
      generatePaymentReceiptPdf: asyncNoop,
      handleStudentSubmit: asyncNoop,
      handleParentSubmit: asyncNoop,
      handleStaffSubmit: asyncNoop,
      handleExpenseSubmit: asyncNoop,
      handleVendorExpenseSubmit: asyncNoop,
      handleSalarySubmit: asyncNoop,
      handlePaymentSubmit: asyncNoop,
      handleCreateClassSubmit: asyncNoop,
      handleEditClassSubmit: asyncNoop,
      handleLinkStudentSubmit: asyncNoop,
      handleNotifyTemplateChange: noop,
      handleCopyNotifyMessage: noop,
      handleSendSMS: noop,
      handleSendWhatsApp: noop,
      handleAddTodo: asyncNoop,
      toggleTodo: asyncNoop,
      deleteTodo: asyncNoop,
      handleUpdateTodoDate: asyncNoop,
      handleAiQuery: asyncNoop,
      handleSaveNote: asyncNoop,
      saveNoteOnDate: asyncNoop,
      deleteStudent: asyncNoop,
      setStudentForm: noop,
      setStaffForm: noop,
      setParentForm: noop,
      setExpenseForm: noop,
      setVendorExpenseForm: noop,
      setSalaryForm: noop,
      setPaymentAmount: noop,
      setPaymentDate: noop,
      setPaymentStudentId: noop,
      setNewClassForm: noop,
      setEditClassForm: noop,
      setSelectedStudent: noop,
      setStudentDetailTab: noop,
      setAuditYear: noop,
      setAiInput: noop,
      setTodoInput: noop,
      setTodoDate: noop,
      setNoteText: noop,
      setNotifyCustomText: noop,
      setNotifySelectedPhone: noop,
      setStudentToLinkId: noop,
      setShowStudentModal: noop,
      setShowParentModal: noop,
      setShowStaffModal: noop,
      setStaffModalMode: noop,
      setShowExpenseModal: noop,
      setShowVendorExpenseModal: noop,
      setShowSalaryModal: noop,
      setShowPaymentForm: noop,
      setShowCalendarModal: noop,
      setShowAddClassModal: noop,
      setShowEditClassModal: noop,
      setShowLinkStudentModal: noop,
      setShowNotifyModal: noop,
      setShowAuditModal: noop,
      setShowTodoSidebar: noop,
      setPrintStudentFile: noop,
      setTicketStudent: noop,
      setEditingStaff: noop,
      setEditingParent: noop,
      setEditingVendorExpense: noop,
      setEditingStudent: noop,
      setProductivitySidebarTab: noop,
      openEditModal: noop,
      getParentOutstandingBalance: () => 0,
      fetchAuditLogs: asyncNoop,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      Suspense: ({ children }: any) => children,
    },
  };
}

describe('AppShell — overlays rendus une seule fois', () => {
  const win = installDomGlobals({
    extra: {
      requestAnimationFrame: (cb: FrameRequestCallback): number =>
        setTimeout(() => cb(performance.now()), 16) as unknown as number,
      cancelAnimationFrame: (id: number): void => clearTimeout(id),
    },
  });
  // WAAPI : le ticker de happy-dom n'avance jamais — animations instantanées.
  const finishedAnimation = {
    finished: Promise.resolve(),
    currentTime: 0,
    playState: 'finished',
    effect: null,
    onfinish: null,
    oncancel: null,
    play: () => {},
    pause: () => {},
    cancel: () => {},
    finish: () => {},
    reverse: () => {},
    commitStyles: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
  };
  win.Element.prototype.animate = (() => finishedAnimation) as unknown as typeof win.Element.prototype.animate;
  win.Element.prototype.getAnimations = (() => []) as unknown as typeof win.Element.prototype.getAnimations;
  (win.HTMLElement.prototype as { animate?: unknown }).animate = finishedAnimation;

  it('En vBadge, OfflineBanner et ToastContainer apparaissent chacun exactement une fois', async () => {
    const container = win.document.createElement('div');
    win.document.body.appendChild(container);
    const root: Root = createRoot(container as unknown as Element);

    await act(async () => {
      root.render(createElement(AppShell, shellProps() as never));
    });

    // Chaque overlay porte un z-index unique — compter ses occurrences.
    const envBadges = container.querySelectorAll('[class*="z-[9997]"]');
    const offlineBanners = container.querySelectorAll('[class*="z-[9998]"]');
    const toastContainers = container.querySelectorAll('[class*="z-[9999]"]');

    assert.equal(envBadges.length, 1, `EnvBadge rendu ${envBadges.length} fois (attendu 1)`);
    assert.equal(offlineBanners.length, 1, `OfflineBanner rendu ${offlineBanners.length} fois (attendu 1)`);
    assert.equal(toastContainers.length, 1, `ToastContainer rendu ${toastContainers.length} fois (attendu 1)`);

    // Contenu réellement visible (pas de rendu vide qui passerait à vide) :
    assert.ok(envBadges[0].textContent?.includes('DEV'), 'EnvBadge doit afficher DEV');
    assert.ok(offlineBanners[0].textContent?.includes(String(2)), 'OfflineBanner doit afficher le nombre de lignes en attente');
    assert.ok(toastContainers[0].textContent?.includes(TOAST_MESSAGE), 'ToastContainer doit afficher le message du toast');

    // Un double ToastContainer produirait DEUX cartes avec le même message :
    const messageCount = container.textContent?.split(TOAST_MESSAGE).length ?? 1;
    assert.equal(messageCount, 2, `le message du toast apparaît ${messageCount - 1} fois (attendu 1)`);

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });
});
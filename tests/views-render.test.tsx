import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createElement, createRef, Suspense } from 'react';
import type { ReactNode } from 'react';
import { renderToString } from 'react-dom/server';
import type { LucideIcon } from 'lucide-react';
import { translations } from '../src/i18n/translations';
import type { TranslationDict } from '../src/i18n/translations';
import { MainViewsContext } from '../src/app/mainViewsContext';
import type {
  MainViewsProps,
  CurrentTheme,
  DashboardStats,
  ParentLedgerEntry,
  ParentSort,
  PayrollWindowStatus,
  RoleFilter,
  SalaryForm,
  SortKey,
  StaffForm,
  StudentStatus,
  ThemeId,
  ParentForm,
  VendorExpenseForm,
} from '../src/app/mainViewsProps';
import type { AuditLogEntry } from '../src/lib/auditLogger';
import type { AuthState, UserProfile } from '../src/lib/useAuth';
import type { CalendarDay } from '../src/lib/classes';
import { DashboardView } from '../src/components/DashboardView';
import { StudentsView } from '../src/components/StudentsView';
import { ParentsView } from '../src/components/ParentsView';
import { PayrollView } from '../src/components/PayrollView';
import { ExpensesView } from '../src/components/ExpensesView';

// ─── Shared stubs ────────────────────────────────────────────────────────────

const noop = () => {};
const asyncNoop = async () => {};
const boolNoop = async () => true;
const zero = () => 0;
const emptyString = () => '';
const emptyArray = () => [];
const iconStub = (() => null) as unknown as LucideIcon;

const currentTheme: CurrentTheme = {
  bg: '#fff',
  card: '#fff',
  text: '#111',
  muted: '#666',
  border: '#e2e8f0',
  header: '#fff',
  sidebar: '#fff',
  accent: '#059669',
  accentBg: '#059669',
  accentHover: '#047857',
  accentShadow: 'rgba(5,150,105,0.3)',
  tableHeader: '#f8fafc',
  rowHover: '#f1f5f9',
  input: '#fff',
  isDark: false,
};

const stats: DashboardStats = {
  totalOutstanding: 0,
  collectedMonth: 0,
  prevMonthCollected: 0,
  lateParentsCount: 0,
  totalFees: 0,
  totalCollected: 0,
  totalExpenses: 0,
  totalArrears: 0,
  expensesThisMonth: 0,
  enrolledStudentsCount: 0,
};

const payrollWindowStatus: PayrollWindowStatus = {
  currentDay: 1,
  currentCalendarYear: 2026,
  currentCalendarMonth: 0,
  totalPaidCurrentMonth: 0,
  isOverdue: false,
  isOpen: true,
};

const auth: AuthState = {
  user: null,
  profile: null,
  loading: false,
  error: null,
  isAdmin: true,
  signIn: async () => ({ success: true }),
  signOut: asyncNoop,
  fetchAllProfiles: async () => [],
  updateUserRole: async () => true,
  createStaffUser: async () => ({ success: true }),
  sendPasswordReset: async () => ({ success: true }),
};

const salaryForm: SalaryForm = { staffId: '', amount: '', date: '' };
const staffForm: StaffForm = {
  name: '',
  position: '',
  salary: '',
  email: '',
  phone: '',
  bankDetails: '',
  emergencyContact: '',
};
const parentForm: ParentForm = {
  fullName: '',
  primaryPhone: '',
  secondaryPhone: '',
  email: '',
  address: '',
  occupation: '',
  relationship: 'Father',
  notes: '',
  linkedStudentIds: [],
};
const vendorExpenseForm: VendorExpenseForm = {
  vendorName: '',
  category: '',
  amount: '',
  dueDate: '',
  paymentStatus: '',
  amountPaid: '',
  description: '',
  aidType: '',
  beneficiaryStudentName: '',
  beneficiaryStudentGrade: '',
};

const getStatus = (): StudentStatus => ({ label: '', color: '', icon: null, standing: '' });

const noopSetter = noop as never;

/**
 * Builds a complete MainViewsProps with safe defaults so any view can be
 * rendered in isolation. Overrides can be passed per test.
 */
function makeProps(overrides: Partial<MainViewsProps> = {}): MainViewsProps {
  return {
    // Icons (all mapped to a no-op stub — they don't affect SSR output)
    AlertCircle: iconStub,
    ArrowDown: iconStub,
    ArrowUp: iconStub,
    ArrowUpDown: iconStub,
    Award: iconStub,
    Bell: iconStub,
    BookOpen: iconStub,
    Briefcase: iconStub,
    Calendar: iconStub,
    ChartsFallback: (() => null) as never,
    CheckCircle2: iconStub,
    ChevronDown: iconStub,
    ChevronLeft: iconStub,
    ChevronRight: iconStub,
    ChevronUp: iconStub,
    Clock: iconStub,
    Coins: iconStub,
    Cpu: iconStub,
    CreditCard: iconStub,
    DashboardCharts: (() => null) as never,
    DollarSign: iconStub,
    Download: iconStub,
    Droplet: iconStub,
    Edit2: iconStub,
    FileText: iconStub,
    Flag: iconStub,
    Globe: iconStub,
    GraduationCap: iconStub,
    Hammer: iconStub,
    Heart: iconStub,
    HighlightText: (({ text }: { text?: string }) => <>{text}</>) as never,
    Landmark: iconStub,
    Layers: iconStub,
    Mail: iconStub,
    MapPin: iconStub,
    Phone: iconStub,
    PieChart: iconStub,
    Plus: iconStub,
    Printer: iconStub,
    Receipt: iconStub,
    Search: iconStub,
    Shield: iconStub,
    ShieldCheck: iconStub,
    Sparkles: iconStub,
    Sprout: iconStub,
    StickyNote: iconStub,
    Sun: iconStub,
    Suspense: Suspense as never,
    Trash2: iconStub,
    TrendingDown: iconStub,
    TrendingUp: iconStub,
    Unlink: iconStub,
    UploadCloud: iconStub,
    UserCheck: iconStub,
    UserPlus: iconStub,
    Users: iconStub,
    Utensils: iconStub,
    Wallet: iconStub,
    Wifi: iconStub,
    X: iconStub,
    Zap: iconStub,

    // Data
    activeTab: 'dashboard',
    auditLogs: [] as AuditLogEntry[],
    auth,
    availableClasses: [],
    calendarDate: new Date(2026, 0, 15),
    chartData: [],
    currentMonth: 0,
    currentTheme,
    expandedParentId: null,
    expenseCategoryList: [],
    expenses: [],
    filteredStaff: [],
    filteredStudents: [],
    lateStudents: [],
    logoColor: null,
    logoInputRef: createRef<HTMLInputElement>(),
    missedMonths: [],
    parentChildrenSortBy: 'highest_balance' as ParentSort,
    parentSearchTerm: '',
    parents: [],
    payrollWindowStatus,
    pieData: [],
    salaryForm,
    salaryPayments: [],
    schoolLogo: null,
    searchTerm: '',
    selectedYear: '2026-2027',
    staff: [],
    staffSearchTerm: '',
    stats,
    studentSortKey: null as SortKey | null,
    studentSortOrder: 'asc',
    t: translations.en as TranslationDict,
    theme: 'navy' as ThemeId,
    today: '2026-01-15',
    todoInput: '',
    todos: [],
    updatingUserId: null,
    userProfiles: [] as UserProfile[],
    userRoleFilter: 'all' as RoleFilter,
    userSearchTerm: '',
    vendorCategoryFilter: 'all',
    vendorExpenses: [],
    vendorSearch: '',
    vendorStatusFilter: 'all',
    visibleBankDetails: {},

    // Handlers (safe no-ops)
    changeMonth: noop,
    deleteStaff: boolNoop,
    deleteStudent: boolNoop,
    deleteTodo: boolNoop,
    fetchAuditLogs: asyncNoop,
    formatCurrency: (amount: number) => `${amount ?? 0} XOF`,
    formatDate: (dateStr: string) => dateStr || '',
    generateExpensesReportPdf: asyncNoop,
    generateStaffPayslipPdf: asyncNoop,
    getChildrenForParent: emptyArray,
    getDayName: emptyString,
    getDaysInMonth: (() => []) as () => CalendarDay[],
    getEventsForDay: emptyArray,
    getGradeDisplay: emptyString,
    getMonthName: emptyString,
    getParentOutstandingBalance: zero,
    getParentPaymentHistory: (() => []) as () => ParentLedgerEntry[],
    getStatus,
    handleAddTodo: asyncNoop,
    handleDeleteClass: asyncNoop,
    handleDeleteParent: asyncNoop,
    handleDeleteVendorExpense: asyncNoop,
    handleExportAllData: asyncNoop,
    handleExportParentLedgerPdf: asyncNoop,
    handleLogoUpload: noop,
    handlePrint: noop,
    handleSendPasswordReset: asyncNoop,
    handleSort: noop,
    handleUnlinkStudent: asyncNoop,
    handleUpdateRole: asyncNoop,
    isPromoter: true,
    lang: 'fr' as const,
    openEditClass: noop,
    openEditModal: noop,
    openEditParentModal: noop,
    openEditStaffModal: noop,
    openNotifyModal: noop,
    toggleFlag: asyncNoop,
    toggleLanguage: noop,
    toggleTodo: asyncNoop,

    // Setters (no-ops)
    setActiveLinkingParent: noopSetter,
    setCalendarDate: noopSetter,
    setEditingParent: noopSetter,
    setEditingStaff: noopSetter,
    setEditingVendorExpense: noopSetter,
    setExpandedParentId: noopSetter,
    setLogoColor: noopSetter,
    setParentChildrenSortBy: noopSetter,
    setParentForm: noopSetter,
    setParentSearchTerm: noopSetter,
    setSalaryForm: noopSetter,
    setSchoolLogo: noopSetter,
    setSelectedCalendarDay: noopSetter,
    setSelectedDraftMonth: noopSetter,
    setSelectedDraftYear: noopSetter,
    setSelectedStudent: noopSetter,
    setShowAddClassModal: noopSetter,
    setShowAddUserModal: noopSetter,
    setShowCalendarModal: noopSetter,
    setShowLinkStudentModal: noopSetter,
    setShowMonthlyDraftModal: noopSetter,
    setShowParentModal: noopSetter,
    setShowSalaryModal: noopSetter,
    setShowStaffModal: noopSetter,
    setShowVendorExpenseModal: noopSetter,
    setStaffForm: noopSetter,
    setStaffSearchTerm: noopSetter,
    setStudentToLinkId: noopSetter,
    setTheme: noopSetter,
    setTicketStudent: noopSetter,
    setTodoInput: noopSetter,
    setUserProfiles: noopSetter,
    setUserRoleFilter: noopSetter,
    setUserSearchTerm: noopSetter,
    setVendorCategoryFilter: noopSetter,
    setVendorExpenseForm: noopSetter,
    setVendorSearch: noopSetter,
    setVendorStatusFilter: noopSetter,
    setVisibleBankDetails: noopSetter,

    ...overrides,
  };
}

/** Renders a view inside the MainViewsContext provider, returning the SSR HTML. */
function renderWithContext(view: ReactNode, overrides: Partial<MainViewsProps> = {}): string {
  return renderToString(
    createElement(
      MainViewsContext.Provider,
      { value: makeProps(overrides) },
      view
    )
  );
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('views render inside MainViewsContext', () => {
  const views: { name: string; node: ReactNode; expectedText: string }[] = [
    { name: 'DashboardView', node: createElement(DashboardView), expectedText: 'cashBalance' },
    { name: 'StudentsView', node: createElement(StudentsView), expectedText: 'studentName' },
    { name: 'ParentsView', node: createElement(ParentsView), expectedText: 'addParent' },
    { name: 'PayrollView', node: createElement(PayrollView), expectedText: 'staffName' },
    { name: 'ExpensesView', node: createElement(ExpensesView), expectedText: 'generalExpenses' },
  ];

  for (const { name, node, expectedText } of views) {
    it(`${name} renders without error and emits content`, () => {
      const html = renderWithContext(node);
      assert.ok(html.length > 0, `${name} produced empty output`);
      assert.ok(
        html.includes(translations.en[expectedText as keyof TranslationDict]),
        `${name} output should contain translation key "${expectedText}"`
      );
    });
  }

  it('each view still renders with a minimal/empty dataset (no data crash)', () => {
    // Same as above but explicitly with empty arrays — guards against
    // rendering code that assumes non-empty collections.
    for (const { node } of views) {
      const html = renderWithContext(node);
      assert.ok(html.length > 0);
    }
  });

  it('useMainViews() throws when rendered outside the provider', () => {
    for (const { node } of views) {
      assert.throws(
        () => renderToString(node),
        /useMainViews must be used inside <MainViews>/,
        'expected the hook to throw outside MainViewsContext'
      );
    }
  });
});

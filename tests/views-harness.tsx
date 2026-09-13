// ─────────────────────────────────────────────────────────────────────────────
// tests/views-harness.tsx — le contexte dont une vue a besoin pour être rendue.
//
// Sorti de tests/views-render.test.tsx le 2026-09-13 : il y vivait en ~400
// lignes de littéral, donc AUCUNE autre suite ne pouvait rendre une vue avec des
// données — et c'est exactement ce qui avait laissé le regroupement d'incidents et
// l'export CSV assertés par expression régulière sur la source, un an de vert sans
// une seule exécution de la vue.
//
// Deux propriétés qui comptent, et qui ne se voient pas :
//   • le défaut est VIDE (aucune collection peuplée). Un cas qui veut des données
//     doit les passer — sinon il mesurerait le contexte d'un autre ;
//   • `makeProps` couvre TOUTES les props exigées (le contrôle de câblage le
//     vérifie sur le composant), donc une prop nouvelle fait échouer la
//     compilation ici au lieu de passer inaperçue dans un rendu à moitié câblé.
//
// @param overrides les données du cas — c’est ici que se joue « avec de vraies données »
// ─────────────────────────────────────────────────────────────────────────────
import { createElement, createRef, Suspense } from 'react';
import type { ReactNode } from 'react';
import { renderToString } from 'react-dom/server';
import type { LucideIcon } from 'lucide-react';
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
import { translations } from '../src/i18n/translations';
import type { TranslationDict } from '../src/i18n/translations';

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
  accentText: 'text-white',
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
  setUserPassword: async () => ({ success: true }),
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
  inpsNumber: '',
  hireDate: '',
  familyStatus: '',
  childrenCount: '',
  travelAllowance: '',
  communicationAllowance: '',
  housingAllowance: '',
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
export function makeProps(overrides: Partial<MainViewsProps> = {}): MainViewsProps {
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
    generalExpenseCategoryFilter: 'all',
    generalExpenseSearch: '',
    filteredStaff: [],
    filteredStudents: [],
    lateStudents: [],
    logoColor: null,
    logoInputRef: createRef<HTMLInputElement>(),
    missedMonths: [],
    parentChildrenSortBy: 'highest_balance' as ParentSort,
    parentSearchTerm: '',
    parents: [],
    passwordInput: '',
    passwordTarget: null,
    payrollWindowStatus,
    pieData: [],
    salaryForm,
    salaryPayments: [],
    schoolLogo: null,
    searchTerm: '',
    selectedYear: '2026-2027',
    staff: [],
    adminStaffCount: 0,
    staffPositionFilter: 'all' as const,
    staffSearchTerm: '',
    stats,
    studentSortKey: null as SortKey | null,
    studentSortOrder: 'asc',
    t: translations.en as TranslationDict,
    theme: 'navy' as ThemeId,
    today: '2026-01-15',
    inactivityMinutes: 0,
    setInactivityMinutes: noop,
    todoDate: '2026-01-15',
    todoInput: '',
    todos: [],
    updatingUserId: null,
    userProfiles: [] as UserProfile[],
    userRoleFilter: 'all' as RoleFilter,
    userSearchTerm: '',
    vendorCategoryFilter: 'all',
    vendorExpenses: [],
    vendorExpensesTab: 'general' as const,
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
    handleDeleteExpense: asyncNoop,
    handleDeleteVendorExpense: asyncNoop,
  handleExportAllData: asyncNoop,
  handleExportParentLedgerPdf: asyncNoop,
  handleExportStaffReceiptPdf: asyncNoop,
  handleLogoUpload: noop,
    handlePrint: noop,
    handleSendPasswordReset: asyncNoop,
    handleSort: noop,
    handleUnlinkStudent: asyncNoop,
    handleUpdateRole: asyncNoop,
    handleUpdateTodoDate: boolNoop,
    isPromoter: true,
    isGeneralManager: false,
    lang: 'fr' as const,
    openEditClass: noop,
    openEditModal: noop,
    openEditParentModal: noop,
    openEditStaffModal: noop,
    openNotifyModal: noop,
    handleSetPassword: asyncNoop,
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
    setPasswordInput: noopSetter,
    setPasswordTarget: noopSetter,
    setParentSearchTerm: noopSetter,
    setPaymentAmount: noopSetter,
    setPaymentStudentId: noopSetter,
    setShowPaymentForm: noopSetter,
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
    setShowExpenseModal: noopSetter,
    setShowMonthlyDraftModal: noopSetter,
    setExpenseForm: noopSetter,
    setGeneralExpenseCategoryFilter: noopSetter,
    setGeneralExpenseSearch: noopSetter,
    setVendorExpensesTab: noopSetter,
    setShowParentModal: noopSetter,
    setShowSalaryModal: noopSetter,
    setShowStaffModal: noopSetter,
    setShowVendorExpenseModal: noopSetter,
    staffModalMode: 'employee' as const,
    setStaffModalMode: noopSetter,
    setStaffPositionFilter: noopSetter,
    setStaffForm: noopSetter,
    setStaffSearchTerm: noopSetter,
    setStudentToLinkId: noopSetter,
    setTheme: noopSetter,
    setTicketStudent: noopSetter,
    setTodoDate: noopSetter,
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
export function renderWithContext(view: ReactNode, overrides: Partial<MainViewsProps> = {}): string {
  return renderToString(
    createElement(
      MainViewsContext.Provider,
      { value: makeProps(overrides) },
      view
    )
  );
}

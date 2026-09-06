/**
 * Single source of truth for the MainViews props contract.
 *
 * Every prop the app shell hands to the views is declared here, exactly once:
 *   • src/App.tsx imports the helper types (ManagedClass, CalendarEvent,
 *     ThemeId, …) and passes the full props object to <MainViews>;
 *   • src/components/MainViews.tsx types its context (MainViewsContext) and
 *     hook (useMainViews) with MainViewsProps — the views read their slice of
 *     the contract through that context;
 *   • scripts/check-component-props.mjs parses THIS file to prove every
 *     required prop is actually passed at the render site (186/186);
 *   • tests/mainviews-props.test.ts asserts the contract's invariants (a
 *     single definition, all props required, no `any`, wiring pointed here).
 *
 * Types only — no runtime code, so importing it costs nothing at runtime.
 */
import type { ComponentType, Dispatch, SetStateAction, FormEvent, ChangeEvent, ReactNode, RefObject } from 'react';
import type { LucideIcon } from 'lucide-react';
import type { Student, Staff, Parent, Todo, Expense, SalaryPayment, VendorExpense } from '../lib/useSupabaseData';
import type { AuthState, UserProfile } from '../lib/useAuth';
import type { AuditLogEntry } from '../lib/auditLogger';
import type { TranslationDict } from '../i18n/translations';
import type { SchoolClass } from './types';
import type { CalendarDay } from '../lib/classes';
import type { PayslipDataOptions } from '../lib/pdfPayroll';
import type { ExpensesReportOptions } from '../lib/pdfExpensesReport';
import type { AppRole } from '../lib/useAuth';

export type ThemeId = 'navy' | 'cream' | 'slate' | 'emerald' | 'bordeaux' | 'midnight';
export type ManagedClass = SchoolClass & { rowId?: string };
export type RoleFilter = 'all' | 'admin' | 'staff' | 'dev' | 'general_manager' | 'econome';
export type SortKey = 'name' | 'parentName' | 'balance' | 'dueDate';
export type ParentSort = 'highest_balance' | 'alphabetical';

export interface DashboardStats {
  totalOutstanding: number;
  collectedMonth: number;
  prevMonthCollected: number;
  lateParentsCount: number;
  totalFees: number;
  totalCollected: number;
  totalExpenses: number;
  totalArrears: number;
  expensesThisMonth: number;
  enrolledStudentsCount: number;
}

export interface PayrollWindowStatus {
  currentDay: number;
  currentCalendarYear: number;
  currentCalendarMonth: number;
  totalPaidCurrentMonth: number;
  isOverdue: boolean;
  isOpen: boolean;
}

export interface CalendarEvent {
  type: 'due' | 'salary' | 'expense' | 'note' | 'todo';
  count: number;
  label: string;
  details: { name: string; amount?: number; completed?: boolean }[];
}

export interface StaffForm {
  name: string;
  position: string;
  salary: string;
  email: string;
  phone: string;
  bankDetails: string;
  emergencyContact: string;
  /** Bulletin de paie details — string fields, parsed on submit. */
  inpsNumber: string;
  hireDate: string;
  familyStatus: string; // FamilyStatus code or ''
  childrenCount: string;
  travelAllowance: string;
  communicationAllowance: string;
  housingAllowance: string;
}

/** Which staff form the modal opens with: employee (free position) or admin member (position dropdown). */
export type StaffModalMode = 'employee' | 'admin';

/** Staff-directory position bucket: everyone, curated admin roles, or non-admin employees. */
export type StaffPositionFilter = 'all' | 'admin' | 'employee';

export interface SalaryForm {
  staffId: string;
  amount: string;
  date: string;
}

export interface ParentForm {
  fullName: string;
  primaryPhone: string;
  secondaryPhone: string;
  email: string;
  address: string;
  occupation: string;
  relationship: string;
  notes: string;
  linkedStudentIds: string[];
}

export interface ExpenseForm {
  category: string;
  description: string;
  amount: string;
  date: string;
}

export interface VendorExpenseForm {
  vendorName: string;
  category: string;
  amount: string;
  dueDate: string;
  paymentStatus: string;
  amountPaid: string;
  description: string;
  aidType: string;
  beneficiaryStudentName: string;
  beneficiaryStudentGrade: string;
}

export interface CurrentTheme {
  bg: string;
  card: string;
  text: string;
  muted: string;
  border: string;
  header: string;
  sidebar: string;
  accent: string;
  accentBg: string;
  accentHover: string;
  accentShadow: string;
  tableHeader: string;
  rowHover: string;
  input: string;
  isDark: boolean;
}

export interface StudentStatus {
  label: string;
  color: string;
  icon: ReactNode;
  standing: string;
}

export interface ParentLedgerEntry {
  receiptNumber: string;
  studentName: string;
  studentId: string;
  date: string;
  amount: number;
  academicYear?: string;
}

export interface ThemeOption {
  id: ThemeId;
  label: string;
  color: string;
}

export interface RoleTab {
  id: 'all' | 'admin' | 'staff' | 'general_manager' | 'econome';
  label: string;
}

export interface MainViewsProps {
  AlertCircle: LucideIcon;
  ArrowDown: LucideIcon;
  ArrowUp: LucideIcon;
  ArrowUpDown: LucideIcon;
  Award: LucideIcon;
  Bell: LucideIcon;
  BookOpen: LucideIcon;
  Briefcase: LucideIcon;
  Calendar: LucideIcon;
  ChartsFallback: ComponentType<{ isDark: boolean }>;
  CheckCircle2: LucideIcon;
  ChevronDown: LucideIcon;
  ChevronLeft: LucideIcon;
  ChevronRight: LucideIcon;
  ChevronUp: LucideIcon;
  Clock: LucideIcon;
  Coins: LucideIcon;
  Cpu: LucideIcon;
  CreditCard: LucideIcon;
  DashboardCharts: ComponentType<{
    chartData: { name: string; income: number; expenses: number }[];
    pieData: { name: string; value: number }[];
    t: { incomeVsExpenses: string; income: string; expenses: string; feeStatus: string };
    currentTheme: { isDark: boolean };
  }>;
  DollarSign: LucideIcon;
  Download: LucideIcon;
  Droplet: LucideIcon;
  Edit2: LucideIcon;
  FileText: LucideIcon;
  Flag: LucideIcon;
  Globe: LucideIcon;
  GraduationCap: LucideIcon;
  Hammer: LucideIcon;
  Heart: LucideIcon;
  HighlightText: ComponentType<{ text: string; highlight: string }>;
  Landmark: LucideIcon;
  Layers: LucideIcon;
  Mail: LucideIcon;
  MapPin: LucideIcon;
  Phone: LucideIcon;
  PieChart: LucideIcon;
  Plus: LucideIcon;
  Printer: LucideIcon;
  Receipt: LucideIcon;
  Search: LucideIcon;
  Shield: LucideIcon;
  ShieldCheck: LucideIcon;
  Sparkles: LucideIcon;
  Sprout: LucideIcon;
  StickyNote: LucideIcon;
  Sun: LucideIcon;
  Suspense: ComponentType<{ fallback?: ReactNode; children?: ReactNode }>;
  Trash2: LucideIcon;
  TrendingDown: LucideIcon;
  TrendingUp: LucideIcon;
  Unlink: LucideIcon;
  UploadCloud: LucideIcon;
  UserCheck: LucideIcon;
  UserPlus: LucideIcon;
  Users: LucideIcon;
  Utensils: LucideIcon;
  Wallet: LucideIcon;
  Wifi: LucideIcon;
  X: LucideIcon;
  Zap: LucideIcon;
  activeTab: 'dashboard' | 'students' | 'parents' | 'payroll' | 'expenses' | 'settings' | 'calendar' | 'notes' | 'archives' | 'audit';
  auditLogs: AuditLogEntry[];
  auth: AuthState;
  availableClasses: ManagedClass[];
  calendarDate: Date;
  changeMonth: (offset: number) => void;
  chartData: { name: string; income: number; expenses: number }[];
  currentMonth: number;
  currentTheme: CurrentTheme;
  deleteStaff: (id: string) => Promise<boolean>;
  deleteStudent: (id: string) => Promise<boolean>;
  deleteTodo: (id: string) => Promise<boolean>;
  expandedParentId: string | null;
  expenseCategoryList: { key: string; label: string }[];
  expenses: Expense[];
  generalExpenseCategoryFilter: string;
  generalExpenseSearch: string;
  fetchAuditLogs: () => Promise<void>;
  filteredStaff: Staff[];
  filteredStudents: Student[];
  formatCurrency: (amount: number) => string;
  formatDate: (dateStr: string) => string;
  generateExpensesReportPdf: (opts: ExpensesReportOptions) => Promise<void>;
  generateStaffPayslipPdf: (opts: PayslipDataOptions) => Promise<void>;
  getChildrenForParent: (parent: Parent) => Student[];
  getDayName: (dayIndex: number) => string;
  getDaysInMonth: (date: Date) => CalendarDay[];
  getEventsForDay: (date: Date) => CalendarEvent[];
  getGradeDisplay: (grade: string | undefined, currentLang?: 'en' | 'fr') => string;
  getMonthName: (monthIndex: number) => string;
  getParentOutstandingBalance: (parent: Parent) => number;
  getParentPaymentHistory: (parent: Parent) => ParentLedgerEntry[];
  getStatus: (student: Student) => StudentStatus;
  handleAddTodo: (e: FormEvent) => Promise<void>;
  handleDeleteClass: (c: ManagedClass) => Promise<void>;
  handleDeleteParent: (parentId: string) => Promise<void>;
  handleDeleteVendorExpense: (id: string) => Promise<void>;
  handleExportAllData: () => Promise<void>;
  handleExportParentLedgerPdf: (parent: Parent) => Promise<void>;
  handleExportStaffReceiptPdf: (staffMember: Staff) => Promise<void>;
  handleLogoUpload: (e: ChangeEvent<HTMLInputElement>) => void;
  handlePrint: () => void;
  handleSendPasswordReset: (email: string) => Promise<void>;
  handleSort: (key: SortKey) => void;
  handleUnlinkStudent: (studentId: string) => Promise<void>;
  handleUpdateRole: (targetProfile: UserProfile, newRole: AppRole) => Promise<void>;
  isPromoter: boolean;
  /** Gestionnaire Principal — finance admin without user/settings/audit access. */
  isGeneralManager: boolean;
  lang: 'en' | 'fr';
  lateStudents: Student[];
  logoColor: string | null;
  logoInputRef: RefObject<HTMLInputElement | null>;
  /** Missed payroll months of the current school year (Sep start, year-aware). */
  missedMonths: { year: number; month: number }[];
  openEditClass: (c: ManagedClass) => void;
  openEditModal: (student: Student) => void;
  openEditParentModal: (parent: Parent) => void;
  openEditStaffModal: (s: Staff) => void;
  openNotifyModal: (parent: Parent) => void;
  parentChildrenSortBy: ParentSort;
  parentSearchTerm: string;
  parents: Parent[];
  payrollWindowStatus: PayrollWindowStatus;
  pieData: { name: string; value: number }[];
  salaryForm: SalaryForm;
  salaryPayments: SalaryPayment[];
  schoolLogo: string | null;
  searchTerm: string;
  selectedYear: string;
  setActiveLinkingParent: Dispatch<SetStateAction<Parent | null>>;
  setCalendarDate: Dispatch<SetStateAction<Date>>;
  setEditingParent: Dispatch<SetStateAction<Parent | null>>;
  setEditingStaff: Dispatch<SetStateAction<Staff | null>>;
  setEditingVendorExpense: Dispatch<SetStateAction<VendorExpense | null>>;
  setExpandedParentId: Dispatch<SetStateAction<string | null>>;
  setExpenseForm: Dispatch<SetStateAction<ExpenseForm>>;
  setGeneralExpenseCategoryFilter: Dispatch<SetStateAction<string>>;
  setGeneralExpenseSearch: Dispatch<SetStateAction<string>>;
  setLogoColor: Dispatch<SetStateAction<string | null>>;
  setParentChildrenSortBy: Dispatch<SetStateAction<ParentSort>>;
  setParentForm: Dispatch<SetStateAction<ParentForm>>;
  setParentSearchTerm: Dispatch<SetStateAction<string>>;
  /** Payment quick-actions (parent card): prefill the entry form + open it. */
  setPaymentAmount: Dispatch<SetStateAction<string>>;
  setPaymentStudentId: Dispatch<SetStateAction<string>>;
  setShowPaymentForm: Dispatch<SetStateAction<boolean>>;
  setSalaryForm: Dispatch<SetStateAction<SalaryForm>>;
  setSchoolLogo: Dispatch<SetStateAction<string | null>>;
  setSelectedCalendarDay: Dispatch<SetStateAction<Date | null>>;
  setSelectedDraftMonth: Dispatch<SetStateAction<number>>;
  setSelectedDraftYear: Dispatch<SetStateAction<number>>;
  setSelectedStudent: Dispatch<SetStateAction<Student | null>>;
  setShowAddClassModal: Dispatch<SetStateAction<boolean>>;
  setShowAddUserModal: Dispatch<SetStateAction<boolean>>;
  setShowCalendarModal: Dispatch<SetStateAction<boolean>>;
  setShowLinkStudentModal: Dispatch<SetStateAction<boolean>>;
  setShowExpenseModal: Dispatch<SetStateAction<boolean>>;
  setShowMonthlyDraftModal: Dispatch<SetStateAction<boolean>>;
  setShowParentModal: Dispatch<SetStateAction<boolean>>;
  setShowSalaryModal: Dispatch<SetStateAction<boolean>>;
  setShowStaffModal: Dispatch<SetStateAction<boolean>>;
  setShowVendorExpenseModal: Dispatch<SetStateAction<boolean>>;
  setStaffForm: Dispatch<SetStateAction<StaffForm>>;
  setStaffModalMode: Dispatch<SetStateAction<StaffModalMode>>;
  setStaffPositionFilter: Dispatch<SetStateAction<StaffPositionFilter>>;
  setStaffSearchTerm: Dispatch<SetStateAction<string>>;
  setStudentToLinkId: Dispatch<SetStateAction<string>>;
  setTheme: Dispatch<SetStateAction<ThemeId>>;
  setTicketStudent: Dispatch<SetStateAction<Student | null>>;
  setTodoInput: Dispatch<SetStateAction<string>>;
  setUserProfiles: Dispatch<SetStateAction<UserProfile[]>>;
  setUserRoleFilter: Dispatch<SetStateAction<RoleFilter>>;
  setUserSearchTerm: Dispatch<SetStateAction<string>>;
  setVendorCategoryFilter: Dispatch<SetStateAction<string>>;
  setVendorExpenseForm: Dispatch<SetStateAction<VendorExpenseForm>>;
  setVendorSearch: Dispatch<SetStateAction<string>>;
  setVendorStatusFilter: Dispatch<SetStateAction<string>>;
  setVisibleBankDetails: Dispatch<SetStateAction<Record<string, boolean>>>;
  setVendorExpensesTab: Dispatch<SetStateAction<'general' | 'vendors'>>;
  staff: Staff[];
  adminStaffCount: number;
  staffModalMode: StaffModalMode;
  staffPositionFilter: StaffPositionFilter;
  staffSearchTerm: string;
  stats: DashboardStats;
  studentSortKey: SortKey | null;
  studentSortOrder: 'asc' | 'desc';
  t: TranslationDict;
  theme: ThemeId;
  today: string;
  todoInput: string;
  todoDate: string;
  setTodoDate: Dispatch<SetStateAction<string>>;
  todos: Todo[];
  toggleFlag: (id: string) => Promise<void>;
  toggleLanguage: (lang: 'en' | 'fr') => void;
  toggleTodo: (id: string) => Promise<void>;
  handleUpdateTodoDate: (id: string, date: string) => Promise<boolean>;
  updatingUserId: string | null;
  passwordTarget: UserProfile | null;
  setPasswordTarget: Dispatch<SetStateAction<UserProfile | null>>;
  passwordInput: string;
  setPasswordInput: Dispatch<SetStateAction<string>>;
  handleSetPassword: () => Promise<void>;
  userProfiles: UserProfile[];
  userRoleFilter: RoleFilter;
  inactivityMinutes: number;
  setInactivityMinutes: (minutes: number) => void;
  userSearchTerm: string;
  vendorCategoryFilter: string;
  vendorExpenses: VendorExpense[];
  vendorExpensesTab: 'general' | 'vendors';
  vendorSearch: string;
  vendorStatusFilter: string;
  visibleBankDetails: Record<string, boolean>;
}

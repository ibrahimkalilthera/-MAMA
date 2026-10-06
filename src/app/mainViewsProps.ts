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
import type { Payment } from '../lib/domainTypes';
import type { ReceiptDataOptions } from '../lib/pdfReceipt';
import type { ArchivedPayment } from '../lib/paymentUndo';
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

/** Which staff form the modal opens with: employee (free position), technical-center member (same free position), or admin member (position dropdown). */
export type StaffModalMode = 'employee' | 'technique' | 'admin';

/** Staff-directory position bucket: everyone, curated admin roles, or non-admin employees. */
export type StaffPositionFilter = 'all' | 'admin' | 'employee' | 'technique';

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
  accentText: string;
  accentHover: string;
  /** Solid accent surface and readable ink when an ancestor `.group` is hovered. */
  accentGroupHover: string;
  accentShadow: string;
  /** Soft accent surface (icon chips, quiet buttons, section headings).
   *  Authored per-view as `bg-emerald-50 text-emerald-600` before it became a
   *  token; `accentSoftText` is its readable ink. */
  accentSoft: string;
  accentSoftText: string;
  accentSoftHover: string;
  /** Accent ink applied on hover — a quiet control that lights up to the accent
   *  (dismiss buttons, inline text links). Carries the same readable ink as
   *  `accentSoftText`, so it does not darken or lighten beyond the theme. */
  accentSoftTextHover: string;
  /** Solid accent as a raw colour — feeds gradients and banner icon ink. */
  accentHex: string;
  /** Darker stop paired with `accentHex` in accent gradients. */
  accentHexDeep: string;
  /** Input/search focus ring that follows the accent. */
  accentRing: string;
  /** Accent-tinted hairline border — chips, role pills and soft role cards. */
  accentBorder: string;
  /**
   * Neutral inset surface that follows the theme (fields, avatars, chips, panel
   * headers). Replaces the old `isDark ? 'bg-emerald-900/*' : 'bg-slate-50'`
   * pairing, which tinted a neutral surface green on dark themes.
   */
  surfaceInset: string;
  /** Solid accent border on hover — the logo dropzone's "drop here" state. */
  accentBorderHover: string;

  /**
   * Neutral strong ink for body/label text — replaces the old
   * `isDark ? 'text-emerald-500' : 'text-slate-800'` convention. On dark themes
   * body text is near-white; on light themes it stays slate-800. Green is thus
   * reserved for its semantic role (paid/success) and never used as ordinary
   * text ink in a dark theme.
   */
  inkStrong: string;
  /** Accent surfaces for the always-dark sidebar rail (low-alpha tints). */
  accentSoftDark: string;
  accentSoftDarkHover: string;
  accentSoftDarkText: string;
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
  activeTab: 'dashboard' | 'students' | 'parents' | 'payroll' | 'expenses' | 'settings' | 'calendar' | 'notes' | 'archives' | 'audit' | 'paymentHistory';
  auditLogs: AuditLogEntry[];
  auth: AuthState;
  availableClasses: ManagedClass[];
  calendarDate: Date;
  changeMonth: (offset: number) => void;
  chartData: { name: string; income: number; expenses: number }[];
  currentMonth: number;
  /** Le millésime du MÊME instant que `currentMonth` (une seule horloge dans
   *  App.tsx) : les vues qui filtrent « ce mois-ci » comparent mois ET année,
   *  qui doivent venir du même référentiel. */
  currentYear: number;
  currentTheme: CurrentTheme;
  deleteStaff: (id: string) => Promise<boolean>;
  deleteStudent: (id: string) => Promise<boolean>;
  deleteTodo: (id: string) => Promise<boolean>;
  /**
   * Retire le SEUL reçu fautif (montant saisi deux fois, mauvais élève), écrit
   * une entrée `DELETE_PAYMENT` au journal et redescend `students.amount_paid`.
   * L'Historique des paiements l'offre là où une caisse relit son geste.
   */
  deletePayment: (studentId: string, payment: Payment) => Promise<boolean>;
  expandedParentId: string | null;
  expenseCategoryList: { key: string; label: string }[];
  expenses: Expense[];
  generalExpenseCategoryFilter: string;
  generalExpenseSearch: string;
  fetchAuditLogs: () => Promise<void>;
  fetchAuditJournalRange: (fromIso: string, toIso: string) => Promise<AuditLogEntry[]>;
  /**
   * Annule la suppression d'un paiement à partir de son instantané (le
   * `metadata` de l'entrée `DELETE_PAYMENT`, relu par la vue Audit). Écrit une
   * entrée `RESTORE_PAYMENT`. Voir `src/lib/paymentUndo.ts`.
   */
  restorePayment: (archived: ArchivedPayment) => Promise<boolean>;
  filteredStaff: Staff[];
  /**
   * L'annuaire COMPLET des élèves. `filteredStudents` est la liste de l'onglet
   * Élèves, filtrée par la recherche et la classe : elle est parfaite pour CET
   * onglet, impropre pour NOMMER un élève ailleurs — une recherche active y
   * ferait disparaître des noms, et une ligne du journal se lirait « élève
   * inconnu » alors qu'il est bien dans l'école.
   */
  students: Student[];
  filteredStudents: Student[];
  formatCurrency: (amount: number) => string;
  formatDate: (dateStr: string) => string;
  generateExpensesReportPdf: (opts: ExpensesReportOptions) => Promise<void>;
  /**
   * Le reçu d'un paiement : l'aperçu s'ouvre (le fichier part au SECOND geste,
   * depuis la modale) — c'est ce qui permet à une ligne de l'historique de
   * MONTRER le reçu sans le télécharger dans le dos de l'utilisateur.
   */
  generatePaymentReceiptPdf: (opts: ReceiptDataOptions) => Promise<void>;
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
  handleDeleteExpense: (id: string) => Promise<void>;
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
  /** Le rôle peut-il SUPPRIMER une ligne ? Décidé par la base (`src/lib/deleteRights.ts`),
   *  pas par l'écran : un bouton de suppression n'existe pas là où le serveur refuse. */
  canDelete: boolean;
  /**
   * Le rôle peut-il supprimer un paiement d'élève ? Décidé par la BASE
   * (`public.is_payment_deleter()` : admin, dev, econome — voir
   * `src/lib/paymentRights.ts`), pas par l'écran. C'est un droit PLUS LARGE que
   * `canDelete` : l'économe corrige sa caisse sans pouvoir rien détruire d'autre.
   */
  canDeletePayment: boolean;
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
  userSearchTerm: string;
  vendorCategoryFilter: string;
  vendorExpenses: VendorExpense[];
  vendorExpensesTab: 'general' | 'vendors';
  vendorSearch: string;
  vendorStatusFilter: string;
  visibleBankDetails: Record<string, boolean>;
}

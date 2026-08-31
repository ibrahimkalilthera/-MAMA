import { lazy, Suspense, createContext, useContext } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { AlertCircle, ArrowDown, ArrowUp, ArrowUpDown, Award, Bell, BookOpen, Briefcase, Calendar, CheckCircle2, ChevronDown, ChevronLeft, ChevronRight, ChevronUp, Clock, Coins, Cpu, CreditCard, DollarSign, Download, Droplet, Edit2, FileText, Flag, Globe, GraduationCap, Hammer, Heart, Landmark, Layers, Mail, MapPin, Phone, PieChart, Plus, Printer, Receipt, Search, Shield, ShieldCheck, Sparkles, Sprout, StickyNote, Sun, Trash2, TrendingDown, TrendingUp, Unlink, UploadCloud, UserCheck, UserPlus, Users, Utensils, Wallet, Wifi, X, Zap } from 'lucide-react';
import type { ComponentType, Dispatch, SetStateAction, FormEvent, ChangeEvent, ReactNode, RefObject } from 'react';
import type { LucideIcon } from 'lucide-react';
import type { Student, Staff, Parent, Todo, Expense, SalaryPayment, VendorExpense } from '../lib/useSupabaseData';
import type { AuthState, UserProfile } from '../lib/useAuth';
import type { AuditLogEntry } from '../lib/auditLogger';
import type { TranslationDict } from '../i18n/translations';
import type { SchoolClass } from '../app/types';
import type { CalendarDay } from '../lib/classes';
import type { PayslipDataOptions } from '../lib/pdfPayroll';
import type { ExpensesReportOptions } from '../lib/pdfExpensesReport';
import { HighlightText, ChartsFallback } from './SharedUi';

export type ThemeId = 'navy' | 'cream' | 'slate' | 'emerald' | 'bordeaux' | 'midnight';
export type ManagedClass = SchoolClass & { rowId?: string };
export type RoleFilter = 'all' | 'admin' | 'staff' | 'dev';
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
  type: 'due' | 'salary' | 'expense';
  count: number;
  label: string;
  details: { name: string; amount: number }[];
}

export interface StaffForm {
  name: string;
  position: string;
  salary: string;
  email: string;
  phone: string;
  bankDetails: string;
  emergencyContact: string;
}

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

const DashboardCharts = lazy(() => import('./DashboardCharts').then(m => ({ default: m.DashboardCharts })));
const DashboardView = lazy(() => import('./DashboardView').then(m => ({ default: m.DashboardView })));
const StudentsView = lazy(() => import('./StudentsView').then(m => ({ default: m.StudentsView })));
const ParentsView = lazy(() => import('./ParentsView').then(m => ({ default: m.ParentsView })));
const PayrollView = lazy(() => import('./PayrollView').then(m => ({ default: m.PayrollView })));
const ExpensesView = lazy(() => import('./ExpensesView').then(m => ({ default: m.ExpensesView })));

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
  ChartsFallback: ComponentType<any>;
  CheckCircle2: LucideIcon;
  ChevronDown: LucideIcon;
  ChevronLeft: LucideIcon;
  ChevronRight: LucideIcon;
  ChevronUp: LucideIcon;
  Clock: LucideIcon;
  Coins: LucideIcon;
  Cpu: LucideIcon;
  CreditCard: LucideIcon;
  DashboardCharts: ComponentType<any>;
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
  HighlightText: ComponentType<any>;
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
  Suspense: ComponentType<any>;
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
  handleLogoUpload: (e: ChangeEvent<HTMLInputElement>) => void;
  handlePrint: () => void;
  handleSendPasswordReset: (email: string) => Promise<void>;
  handleSort: (key: SortKey) => void;
  handleUnlinkStudent: (studentId: string) => Promise<void>;
  handleUpdateRole: (targetProfile: UserProfile, newRole: 'admin' | 'staff' | 'dev') => Promise<void>;
  isPromoter: boolean;
  lang: 'en' | 'fr';
  lateStudents: Student[];
  logoColor: string | null;
  logoInputRef: RefObject<HTMLInputElement | null>;
  missedMonths: number[];
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
  setLogoColor: Dispatch<SetStateAction<string | null>>;
  setParentChildrenSortBy: Dispatch<SetStateAction<ParentSort>>;
  setParentForm: Dispatch<SetStateAction<ParentForm>>;
  setParentSearchTerm: Dispatch<SetStateAction<string>>;
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
  setShowMonthlyDraftModal: Dispatch<SetStateAction<boolean>>;
  setShowParentModal: Dispatch<SetStateAction<boolean>>;
  setShowSalaryModal: Dispatch<SetStateAction<boolean>>;
  setShowStaffModal: Dispatch<SetStateAction<boolean>>;
  setShowVendorExpenseModal: Dispatch<SetStateAction<boolean>>;
  setStaffForm: Dispatch<SetStateAction<StaffForm>>;
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
  staff: Staff[];
  staffSearchTerm: string;
  stats: DashboardStats;
  studentSortKey: SortKey | null;
  studentSortOrder: 'asc' | 'desc';
  t: TranslationDict;
  theme: ThemeId;
  today: string;
  todoInput: string;
  todos: Todo[];
  toggleFlag: (id: string) => Promise<void>;
  toggleLanguage: (lang: 'en' | 'fr') => void;
  toggleTodo: (id: string) => Promise<void>;
  updatingUserId: string | null;
  userProfiles: UserProfile[];
  userRoleFilter: RoleFilter;
  userSearchTerm: string;
  vendorCategoryFilter: string;
  vendorExpenses: VendorExpense[];
  vendorSearch: string;
  vendorStatusFilter: string;
  visibleBankDetails: Record<string, boolean>;
}

// Views are rendered inside <MainViews> and read everything they need from this
// context instead of receiving the full 186-prop object through {…props}.
export const MainViewsContext = createContext<MainViewsProps | null>(null);

export function useMainViews(): MainViewsProps {
  const ctx = useContext(MainViewsContext);
  if (!ctx) throw new Error('useMainViews must be used inside <MainViews>');
  return ctx;
}

export function MainViews(props: MainViewsProps) {
  const { expenses, AlertCircle, ArrowDown, ArrowUp, ArrowUpDown, Award, Bell, BookOpen, Briefcase, Calendar, ChartsFallback, CheckCircle2, ChevronDown, ChevronLeft, ChevronRight, ChevronUp, Clock, Coins, Cpu, CreditCard, DashboardCharts, DollarSign, Download, Droplet, Edit2, FileText, Flag, Globe, GraduationCap, Hammer, Heart, HighlightText, Landmark, Layers, Mail, MapPin, Phone, PieChart, Plus, Printer, Receipt, Search, Shield, ShieldCheck, Sparkles, Sprout, StickyNote, Sun, Suspense, Trash2, TrendingDown, TrendingUp, Unlink, UploadCloud, UserCheck, UserPlus, Users, Utensils, Wallet, Wifi, X, Zap, activeTab, auditLogs, auth, availableClasses, calendarDate, changeMonth, currentTheme, deleteTodo, fetchAuditLogs, getDayName, getDaysInMonth, getEventsForDay, getMonthName, handleAddTodo, handleDeleteClass, handleExportAllData, handleLogoUpload, handleSendPasswordReset, handleUpdateRole, lang, logoColor, logoInputRef, openEditClass, parents, schoolLogo, setCalendarDate, setLogoColor, setSchoolLogo, setSelectedCalendarDay, setShowAddClassModal, setShowAddUserModal, setShowCalendarModal, setTheme, setTodoInput, setUserProfiles, setUserRoleFilter, setUserSearchTerm, staff, t, theme, today, todoInput, todos, toggleLanguage, toggleTodo, updatingUserId, userProfiles, userRoleFilter, userSearchTerm } = props;
  return (
    <MainViewsContext.Provider value={props}>
    <>
        {activeTab === 'dashboard' && (
          <Suspense fallback={<div className={`${currentTheme.card} p-6 rounded-2xl border ${currentTheme.border} animate-pulse`}><div className="h-6 w-56 bg-slate-200 dark:bg-slate-700 rounded-lg mb-6" /><div className="h-[240px] w-full bg-slate-100 dark:bg-slate-800 rounded-xl" /></div>}>
            <DashboardView />
          </Suspense>
        )}

        {activeTab === 'students' && (
          <Suspense fallback={<div className={`${currentTheme.card} p-6 rounded-2xl border ${currentTheme.border} animate-pulse`}><div className="h-6 w-56 bg-slate-200 dark:bg-slate-700 rounded-lg mb-6" /><div className="h-[240px] w-full bg-slate-100 dark:bg-slate-800 rounded-xl" /></div>}>
            <StudentsView />
          </Suspense>
        )}

        {activeTab === 'parents' && (
          <Suspense fallback={<div className={`${currentTheme.card} p-6 rounded-2xl border ${currentTheme.border} animate-pulse`}><div className="h-6 w-56 bg-slate-200 dark:bg-slate-700 rounded-lg mb-6" /><div className="h-[240px] w-full bg-slate-100 dark:bg-slate-800 rounded-xl" /></div>}>
            <ParentsView />
          </Suspense>
        )}

        {activeTab === 'payroll' && (
          <Suspense fallback={<div className={`${currentTheme.card} p-6 rounded-2xl border ${currentTheme.border} animate-pulse`}><div className="h-6 w-56 bg-slate-200 dark:bg-slate-700 rounded-lg mb-6" /><div className="h-[240px] w-full bg-slate-100 dark:bg-slate-800 rounded-xl" /></div>}>
            <PayrollView />
          </Suspense>
        )}

        {activeTab === 'expenses' && (
          <Suspense fallback={<div className={`${currentTheme.card} p-6 rounded-2xl border ${currentTheme.border} animate-pulse`}><div className="h-6 w-56 bg-slate-200 dark:bg-slate-700 rounded-lg mb-6" /><div className="h-[240px] w-full bg-slate-100 dark:bg-slate-800 rounded-xl" /></div>}>
            <ExpensesView />
          </Suspense>
        )}

        {/* --- Calendar View --- */}
        {activeTab === 'calendar' && (
          <div className="space-y-8">
            <div className="flex justify-between items-center no-print">
              <div className="flex items-center gap-4">
                <button 
                  onClick={() => changeMonth(-1)}
                  className={`p-2 rounded-xl ${currentTheme.isDark ? 'bg-emerald-900/20 text-emerald-500' : 'bg-slate-100 text-slate-600'} hover:bg-blue-600 hover:text-white transition-all`}
                >
                  <ChevronLeft size={20} />
                </button>
                <h3 className={`text-2xl font-bold ${currentTheme.isDark ? 'text-emerald-400' : 'text-slate-800'} min-w-[200px] text-center`}>
                  {getMonthName(calendarDate.getMonth())} {calendarDate.getFullYear()}
                </h3>
                <button 
                  onClick={() => changeMonth(1)}
                  className={`p-2 rounded-xl ${currentTheme.isDark ? 'bg-emerald-900/20 text-emerald-500' : 'bg-slate-100 text-slate-600'} hover:bg-blue-600 hover:text-white transition-all`}
                >
                  <ChevronRight size={20} />
                </button>
              </div>
              <button 
                onClick={() => setCalendarDate(new Date())}
                className={`px-6 py-2 rounded-xl border ${currentTheme.border} ${currentTheme.muted} font-bold text-sm hover:bg-slate-50 transition-all`}
              >
                {t.today}
              </button>
            </div>

            <div className={`${currentTheme.card} rounded-[2.5rem] border ${currentTheme.border} shadow-xl overflow-hidden`}>
              <div className={`grid grid-cols-7 border-b ${currentTheme.border} ${currentTheme.isDark ? 'bg-emerald-900/20' : 'bg-slate-50/50'}`}>
                {[0, 1, 2, 3, 4, 5, 6].map(i => (
                  <div key={i} className={`py-4 text-center text-[10px] font-black uppercase tracking-widest ${currentTheme.muted}`}>
                    {getDayName(i)}
                  </div>
                ))}
              </div>
              <div className="grid grid-cols-7">
                {getDaysInMonth(calendarDate).map((day, i) => {
                  const events = getEventsForDay(day.date);
                  const isToday = day.date.toDateString() === new Date().toDateString();
                  
                  return (
                    <div 
                      key={i}
                      onClick={() => {
                        setSelectedCalendarDay(day.date);
                        setShowCalendarModal(true);
                      }}
                      className={`min-h-[120px] p-4 border-b border-r ${currentTheme.border} cursor-pointer hover:bg-blue-50/30 transition-all relative ${!day.isCurrentMonth ? 'opacity-30' : ''}`}
                    >
                      <span className={`text-sm font-bold ${isToday ? 'bg-blue-600 text-white w-7 h-7 flex items-center justify-center rounded-full' : (currentTheme.isDark ? 'text-emerald-500' : 'text-slate-800')}`}>
                        {day.date.getDate()}
                      </span>
                      
                      <div className="mt-2 space-y-1">
                        {events.map((event, idx) => (
                          <div 
                            key={idx}
                            className={`flex items-center gap-1.5 px-2 py-1 rounded-lg text-[8px] font-black uppercase tracking-widest ${
                              event.type === 'due' ? 'bg-rose-100 text-rose-600' :
                              event.type === 'salary' ? 'bg-emerald-100 text-emerald-600' :
                              'bg-blue-100 text-blue-600'
                            }`}
                          >
                            <div className={`w-1.5 h-1.5 rounded-full ${
                              event.type === 'due' ? 'bg-rose-500' :
                              event.type === 'salary' ? 'bg-emerald-500' :
                              'bg-blue-500'
                            }`} />
                            {event.count}
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}

        {/* --- Notes View --- */}
        {activeTab === 'notes' && (
          <div className="max-w-4xl space-y-8">
            <div className={`${currentTheme.card} p-10 rounded-[2.5rem] border ${currentTheme.border} shadow-xl shadow-slate-200/50`}>
              <div className="flex items-center gap-4 mb-8">
                <div className={`p-4 ${currentTheme.isDark ? 'bg-emerald-900/20 text-emerald-500' : 'bg-slate-100 text-slate-600'} rounded-3xl`}>
                  <StickyNote size={32} />
                </div>
                <div>
                  <h3 className={`text-2xl font-black ${currentTheme.isDark ? 'text-emerald-400' : 'text-slate-800'}`}>{t.notes}</h3>
                  <p className={currentTheme.muted}>{t.manageYourPersonalAccountingNotes}</p>
                </div>
              </div>
              
              <div className="space-y-6">
                <form onSubmit={handleAddTodo} className="flex gap-4">
                  <input 
                    type="text"
                    value={todoInput}
                    onChange={(e) => setTodoInput(e.target.value)}
                    placeholder={t.taskPlaceholder}
                    className={`flex-1 px-6 py-4 ${currentTheme.isDark ? 'bg-emerald-900/10' : 'bg-slate-50'} border ${currentTheme.border} rounded-2xl focus:outline-none focus:ring-4 focus:ring-blue-500/5 focus:border-blue-500 transition-all text-sm font-semibold ${currentTheme.isDark ? 'text-emerald-500' : 'text-slate-800'}`}
                  />
                  <button 
                    type="submit"
                    className="bg-blue-600 hover:bg-blue-700 text-white px-8 py-4 rounded-2xl font-black text-sm transition-all flex items-center gap-2 shadow-lg shadow-blue-500/20"
                  >
                    <Plus size={20} />
                    {t.addTask}
                  </button>
                </form>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {todos.map(todo => (
                    <motion.div 
                      layout
                      key={todo.id}
                      className={`p-6 rounded-3xl border ${currentTheme.border} ${currentTheme.card} shadow-sm flex items-center justify-between group`}
                    >
                      <div className="flex items-center gap-4">
                        <button 
                          onClick={() => toggleTodo(todo.id)}
                          className={`w-6 h-6 rounded-lg border-2 flex items-center justify-center transition-all ${todo.completed ? 'bg-emerald-500 border-emerald-500 text-white' : 'border-slate-200 hover:border-blue-400'}`}
                        >
                          {todo.completed && <CheckCircle2 size={14} />}
                        </button>
                        <span className={`text-sm font-bold ${todo.completed ? 'line-through text-slate-300' : (currentTheme.isDark ? 'text-emerald-500' : 'text-slate-700')}`}>
                          {todo.text}
                        </span>
                      </div>
                      <button 
                        onClick={() => deleteTodo(todo.id)}
                        className="p-2 text-rose-400 hover:bg-rose-50 rounded-xl transition-all opacity-0 group-hover:opacity-100"
                      >
                        <Trash2 size={18} />
                      </button>
                    </motion.div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* --- Audit Trail View --- */}
        {activeTab === 'audit' && auth?.isAdmin && (
          <div className="space-y-6">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div>
                <h2 className="text-xl font-black tracking-tight flex items-center gap-2">
                  <ShieldCheck className="text-emerald-500" size={24} />
                  <span>{t.systemAuditTrailSecurityLogs}</span>
                </h2>
                <p className={`text-xs ${currentTheme.muted} mt-1`}>
                  {t.tamperEvidentActivityLogTrackingPaymentsExpensesAndStaffActionsInBamako}
                </p>
              </div>
              <button
                onClick={() => fetchAuditLogs()}
                className="px-4 py-2 bg-slate-800 hover:bg-slate-900 text-white rounded-xl text-xs font-bold transition-all shadow-sm flex items-center gap-2 self-start sm:self-auto active:scale-95"
              >
                <span>{t.refreshLogs}</span>
              </button>
            </div>

            <div className={`${currentTheme.card} border ${currentTheme.border} rounded-2xl overflow-hidden shadow-sm`}>
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className={`${currentTheme.isDark ? 'bg-emerald-900/20' : 'bg-slate-50/50'} ${currentTheme.muted} text-[10px] font-black uppercase tracking-[0.2em]`}>
                      <th className="px-6 py-4">{t.timestamp}</th>
                      <th className="px-6 py-4">{t.staffUser}</th>
                      <th className="px-6 py-4">{'Action'}</th>
                      <th className="px-6 py-4">{t.details}</th>
                    </tr>
                  </thead>
                  <tbody className={`divide-y ${currentTheme.border}`}>
                    {auditLogs.length > 0 ? (
                      auditLogs.map((log) => {
                        const isPayment = log.action === 'RECORD_PAYMENT';
                        const isExpense = log.action === 'ADD_EXPENSE' || log.action === 'ADD_VENDOR_EXPENSE';
                        const isDelete = log.action.includes('DELETE');

                        const badgeColor = isPayment
                          ? 'bg-emerald-500/10 text-emerald-600 border-emerald-500/20'
                          : isExpense
                          ? 'bg-amber-500/10 text-amber-600 border-amber-500/20'
                          : isDelete
                          ? 'bg-rose-500/10 text-rose-600 border-rose-500/20'
                          : 'bg-blue-500/10 text-blue-600 border-blue-500/20';

                        return (
                          <tr key={log.id} className={`${currentTheme.rowHover} transition-all`}>
                            <td className="px-6 py-4 whitespace-nowrap">
                              <span className={`text-xs font-mono ${currentTheme.muted}`}>
                                {new Date(log.createdAt).toLocaleString(lang === 'fr' ? 'fr-FR' : 'en-US')}
                              </span>
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap">
                              <div className="flex flex-col">
                                <span className={`text-xs font-bold ${currentTheme.text}`}>{log.userName || 'Staff'}</span>
                                <span className="text-[10px] text-slate-400 font-mono">{log.userEmail}</span>
                              </div>
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap">
                              <span className={`text-[10px] font-black tracking-wider uppercase px-2.5 py-1 rounded-full border ${badgeColor}`}>
                                {log.action}
                              </span>
                            </td>
                            <td className="px-6 py-4">
                              <span className={`text-xs font-medium ${currentTheme.text}`}>{log.details || '—'}</span>
                            </td>
                          </tr>
                        );
                      })
                    ) : (
                      <tr>
                        <td colSpan={4} className="px-6 py-12 text-center text-slate-400 italic">
                          {t.noAuditLogEntriesRecordedYet}
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* --- Settings View --- */}
        {activeTab === 'settings' && auth?.isAdmin && (
          <div className="max-w-2xl space-y-8">
            <div className={`${currentTheme.card} p-10 rounded-[2.5rem] border ${currentTheme.border} shadow-xl shadow-slate-200/50`}>
              <h3 className={`text-xl font-bold ${currentTheme.isDark ? 'text-emerald-400' : 'text-slate-800'} mb-8`}>Localization & Preferences</h3>
              <div className="space-y-6">
                <div className={`flex items-center justify-between p-6 ${currentTheme.isDark ? 'bg-emerald-900/10' : 'bg-slate-50'} rounded-3xl`}>
                  <div className="flex items-center gap-4">
                    <div className={`p-3 ${currentTheme.card} rounded-2xl text-blue-600 shadow-sm`}>
                      <Globe size={20} />
                    </div>
                    <div>
                      <p className={`font-bold ${currentTheme.isDark ? 'text-emerald-500' : 'text-slate-800'}`}>{t.systemLanguage}</p>
                      <p className={`text-xs ${currentTheme.muted}`}>{t.changeTheInterfaceLanguage}</p>
                    </div>
                  </div>
                  <button 
                    onClick={() => toggleLanguage(lang === 'en' ? 'fr' : 'en')}
                    className={`px-6 py-2 ${currentTheme.card} border ${currentTheme.border} rounded-xl text-sm font-bold ${currentTheme.isDark ? 'text-emerald-500' : 'text-slate-700'} hover:bg-slate-50 transition-all`}
                  >
                    {t.english}
                  </button>
                </div>
                
                <div className={`flex items-center justify-between p-6 ${currentTheme.isDark ? 'bg-emerald-900/10' : 'bg-slate-50'} rounded-3xl`}>
                  <div className="flex items-center gap-4">
                    <div className={`p-3 ${currentTheme.card} rounded-2xl text-emerald-600 shadow-sm`}>
                      <DollarSign size={20} />
                    </div>
                    <div>
                      <p className={`font-bold ${currentTheme.isDark ? 'text-emerald-500' : 'text-slate-800'}`}>{t.currencyFormat}</p>
                      <p className={`text-xs ${currentTheme.muted}`}>{t.current} {t.currency}</p>
                    </div>
                  </div>
                  <span className={`text-xs font-black ${currentTheme.muted} uppercase tracking-widest`}>{t.autoDetected}</span>
                </div>

                {/* Theme Selection */}
                <div className="space-y-4 pt-4 border-t border-slate-100">
                  <h4 className={`text-sm font-black ${currentTheme.muted} uppercase tracking-widest`}>{t.themeSettings}</h4>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
                    {[
                      { id: 'navy', label: t.corporateNavy, color: 'bg-[#0f172a]' },
                      { id: 'emerald', label: t.emeraldGreen, color: 'bg-[#064E3B]' },
                      { id: 'cream', label: t.warmCreamLedger, color: 'bg-[#FDFBF7]' },
                      { id: 'bordeaux', label: t.bordeauxRed, color: 'bg-[#881337]' },
                      { id: 'slate', label: t.slateSlate, color: 'bg-[#1E293B]' },
                      { id: 'midnight', label: t.midnightDark, color: 'bg-[#030712]' }
                    ].map((tOption: { id: ThemeId; label: string; color: string }) => (
                      <button
                        key={tOption.id}
                        onClick={() => setTheme(tOption.id)}
                        className={`p-4 rounded-2xl border-2 transition-all flex flex-col items-center gap-3 ${
                          theme === tOption.id 
                            ? 'border-emerald-600 bg-emerald-500/10 shadow-md ring-2 ring-emerald-500/30' 
                            : `${currentTheme.border} ${currentTheme.isDark ? 'hover:bg-emerald-900/10' : 'hover:bg-slate-50'}`
                        }`}
                      >
                        <div className={`w-10 h-10 rounded-full ${tOption.color} border border-slate-200 shadow-inner flex items-center justify-center`}>
                          {theme === tOption.id && <span className="text-white text-xs">✓</span>}
                        </div>
                        <span className={`text-xs font-bold ${currentTheme.isDark ? 'text-emerald-500' : 'text-slate-800'} text-center`}>{tOption.label}</span>
                      </button>
                    ))}
                  </div>
                </div>

                {/* Logo Upload */}
                <div className={`space-y-4 pt-4 border-t ${currentTheme.border}`}>
                  <h4 className={`text-sm font-black ${currentTheme.muted} uppercase tracking-widest`}>{t.uploadLogo}</h4>
                  <div className="flex items-center gap-6">
                    <div 
                      onClick={() => logoInputRef.current?.click()}
                      className={`w-24 h-24 rounded-3xl border-2 border-dashed ${currentTheme.border} flex flex-col items-center justify-center cursor-pointer hover:border-blue-400 transition-all overflow-hidden relative group`}
                    >
                      {schoolLogo ? (
                        <>
                          <img src={schoolLogo} alt="Logo" className="w-full h-full object-contain p-2" />
                          <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                            <UploadCloud size={20} className="text-white" />
                          </div>
                        </>
                      ) : (
                        <>
                          <UploadCloud size={24} className={currentTheme.muted} />
                          <span className={`text-[10px] ${currentTheme.muted} mt-2 font-bold`}>Upload</span>
                        </>
                      )}
                    </div>
                    <div className="flex-1">
                      <p className={`text-sm font-bold ${currentTheme.isDark ? 'text-emerald-500' : 'text-slate-800'}`}>{t.logoAccentColor}</p>
                      <p className={`text-xs ${currentTheme.muted} mb-4`}>{t.headerSync}</p>
                      {logoColor && (
                        <div className="flex items-center gap-3">
                          <div 
                            className="w-8 h-8 rounded-lg border border-white/20 shadow-sm" 
                            style={{ backgroundColor: logoColor }}
                          />
                          <span className={`text-xs font-mono font-bold ${currentTheme.muted}`}>{logoColor.toUpperCase()}</span>
                          <button 
                            onClick={() => { setSchoolLogo(null); setLogoColor(null); }}
                            className="text-xs text-rose-500 font-bold hover:underline"
                          >
                            Reset
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                  <input 
                    type="file" 
                    ref={logoInputRef}
                    onChange={handleLogoUpload}
                    accept="image/*"
                    className="hidden"
                  />
                </div>

                {/* Backup & Export */}
                <div className={`space-y-4 pt-8 border-t ${currentTheme.border}`}>
                  <h4 className={`text-sm font-black ${currentTheme.muted} uppercase tracking-widest`}>{t.backupSettings}</h4>
                  <div className={`p-8 ${currentTheme.isDark ? 'bg-emerald-900/10' : 'bg-slate-50'} rounded-[2.5rem] border ${currentTheme.border} flex flex-col md:flex-row items-center justify-between gap-6`}>
                    <div className="flex items-center gap-4">
                      <div className={`p-4 ${currentTheme.card} rounded-3xl text-blue-600 shadow-lg`}>
                        <UploadCloud size={32} />
                      </div>
                      <div>
                        <p className={`text-lg font-black ${currentTheme.isDark ? 'text-emerald-500' : 'text-slate-800'}`}>{t.exportData}</p>
                        <p className={`text-xs ${currentTheme.muted}`}>{t.downloadAFullBackupOfYourSchoolDataInExcelFormat}</p>
                      </div>
                    </div>
                    <button 
                      onClick={handleExportAllData}
                      className="bg-slate-800 hover:bg-slate-900 text-white px-8 py-4 rounded-2xl font-black text-sm transition-all flex items-center gap-2 shadow-xl shadow-slate-800/20 active:scale-[0.98]"
                    >
                      <Download size={20} />
                      {t.exportData}
                    </button>
                  </div>
                </div>
                {/* Classes & Sections Configuration Card */}
                <div className={`space-y-4 pt-8 border-t ${currentTheme.border}`}>
                  <div className="flex items-center justify-between">
                    <div>
                      <h4 className={`text-base font-black ${currentTheme.isDark ? 'text-emerald-400' : 'text-slate-800'} flex items-center gap-2`}>
                        <Layers size={20} className="text-blue-500" />
                        {t.classesGradeLevelsManagement}
                      </h4>
                      <p className={`text-xs ${currentTheme.muted} mt-0.5`}>
                        {t.addSections1a1b1c1d2a7bOrCustomGradesAcrossSchoolCycles}
                      </p>
                    </div>
                    <button
                      onClick={() => setShowAddClassModal(true)}
                      className="px-4 py-2.5 bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs rounded-xl shadow-md transition-all flex items-center gap-1.5 active:scale-95"
                    >
                      <Plus size={14} />
                      <span>{t.addClassSection}</span>
                    </button>
                  </div>

                  <div className={`p-6 rounded-[2rem] border ${currentTheme.border} ${currentTheme.isDark ? 'bg-emerald-900/10' : 'bg-slate-50'} space-y-4`}>
                    <div>
                      <div className="flex items-center justify-between mb-2">
                        <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">
                          {t.firstCycle1stTo6thYear}
                        </p>
                        <span className="text-[10px] font-bold text-slate-400">
                          {availableClasses.filter(c => c.cycle === 'cycle1').length} {'classes'}
                        </span>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {availableClasses.filter(c => c.cycle === 'cycle1').map(c => (
                          <span key={c.id} className="px-3 py-1 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs font-bold text-slate-800 dark:text-emerald-400 shadow-sm flex items-center gap-1.5">
                            <span>{c.id}</span>
                            <span className="text-[10px] text-slate-400 font-normal">({c.section})</span>
                            {c.isCustom && (
                              <>
                                <button
                                  type="button"
                                  onClick={() => openEditClass(c)}
                                  title={t.renameClass}
                                  className="ml-1 p-0.5 rounded-md hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-400 hover:text-blue-500 transition-all"
                                >
                                  <Edit2 size={11} />
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleDeleteClass(c)}
                                  title={t.deleteClass}
                                  className="p-0.5 rounded-md hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-400 hover:text-rose-500 transition-all"
                                >
                                  <Trash2 size={11} />
                                </button>
                              </>
                            )}
                          </span>
                        ))}
                      </div>
                    </div>

                    <div className="pt-3 border-t border-slate-200/50 dark:border-slate-800">
                      <div className="flex items-center justify-between mb-2">
                        <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">
                          {t.secondCycle7thTo9thYear}
                        </p>
                        <span className="text-[10px] font-bold text-slate-400">
                          {availableClasses.filter(c => c.cycle === 'cycle2').length} {'classes'}
                        </span>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {availableClasses.filter(c => c.cycle === 'cycle2').map(c => (
                          <span key={c.id} className="px-3 py-1 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs font-bold text-slate-800 dark:text-emerald-400 shadow-sm flex items-center gap-1.5">
                            <span>{c.id}</span>
                            <span className="text-[10px] text-slate-400 font-normal">({c.section})</span>
                            {c.isCustom && (
                              <>
                                <button
                                  type="button"
                                  onClick={() => openEditClass(c)}
                                  title={t.renameClass}
                                  className="ml-1 p-0.5 rounded-md hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-400 hover:text-blue-500 transition-all"
                                >
                                  <Edit2 size={11} />
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleDeleteClass(c)}
                                  title={t.deleteClass}
                                  className="p-0.5 rounded-md hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-400 hover:text-rose-500 transition-all"
                                >
                                  <Trash2 size={11} />
                                </button>
                              </>
                            )}
                          </span>
                        ))}
                      </div>
                    </div>

                    {availableClasses.some(c => c.cycle !== 'cycle1' && c.cycle !== 'cycle2') && (
                      <div className="pt-3 border-t border-slate-200/50 dark:border-slate-800">
                        <div className="flex items-center justify-between mb-2">
                          <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">
                            {t.otherCustomClasses2}
                          </p>
                          <span className="text-[10px] font-bold text-slate-400">
                            {availableClasses.filter(c => c.cycle !== 'cycle1' && c.cycle !== 'cycle2').length}
                          </span>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          {availableClasses.filter(c => c.cycle !== 'cycle1' && c.cycle !== 'cycle2').map(c => (
                            <span key={c.id} className="px-3 py-1 bg-blue-50 dark:bg-blue-900/30 border border-blue-200 dark:border-blue-800 rounded-xl text-xs font-bold text-blue-700 dark:text-blue-300 shadow-sm flex items-center gap-1.5">
                              <span>{c.id}</span>
                              {c.isCustom && (
                                <>
                                  <button
                                    type="button"
                                    onClick={() => openEditClass(c)}
                                    title={t.renameClass}
                                    className="ml-1 p-0.5 rounded-md hover:bg-blue-100 dark:hover:bg-blue-800 text-blue-400 hover:text-blue-600 transition-all"
                                  >
                                    <Edit2 size={11} />
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => handleDeleteClass(c)}
                                    title={t.deleteClass}
                                    className="p-0.5 rounded-md hover:bg-blue-100 dark:hover:bg-blue-800 text-blue-400 hover:text-rose-500 transition-all"
                                  >
                                    <Trash2 size={11} />
                                  </button>
                                </>
                              )}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                {/* User & Role Management (Exclusive to Admin / Promoter / Dev settings) */}
                <div className={`space-y-6 pt-8 border-t ${currentTheme.border}`}>
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                    <div>
                      <h4 className={`text-base font-black ${currentTheme.isDark ? 'text-emerald-400' : 'text-slate-800'} flex items-center gap-2`}>
                        <ShieldCheck size={20} className="text-emerald-500" />
                        {t.staffAccessRoleManagement}
                      </h4>
                      <p className={`text-xs ${currentTheme.muted} mt-0.5`}>
                        {t.assignOrAdjustPermissionsForAdministratorsGeneralManagersAndAccountants}
                      </p>
                    </div>
                    
                    <div className="flex items-center gap-2">
                      <button 
                        onClick={() => auth.fetchAllProfiles().then(profiles => setUserProfiles(profiles))}
                        className={`p-2.5 rounded-xl border ${currentTheme.border} ${currentTheme.card} ${currentTheme.isDark ? 'text-emerald-400 hover:text-emerald-300 hover:bg-white/5' : 'text-slate-600 hover:text-slate-900 hover:bg-slate-50'} transition-all text-xs font-bold flex items-center gap-1.5 shadow-sm`}
                        title={t.refreshUserList}
                      >
                        <span>↻</span>
                        <span className="hidden sm:inline">{t.refresh}</span>
                      </button>

                      <button
                        onClick={() => {
                          setShowAddUserModal(true);
                        }}
                        className="bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-2.5 rounded-xl text-xs font-black transition-all flex items-center gap-2 shadow-lg shadow-emerald-600/20 active:scale-95"
                      >
                        <UserPlus size={16} />
                        <span>{t.addStaffAccount2}</span>
                      </button>
                    </div>
                  </div>

                  {/* Role Definitions & Stats Banner */}
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <div className={`p-4 rounded-2xl border ${currentTheme.border} ${currentTheme.isDark ? 'bg-emerald-950/20 border-emerald-500/30' : 'bg-emerald-50/70 border-emerald-200'}`}>
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-[10px] font-black uppercase tracking-wider text-emerald-600 dark:text-emerald-400 flex items-center gap-1.5">
                          <span>👑</span> {t.promoterAdmins}
                        </span>
                        <span className="text-xs font-black bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 px-2 py-0.5 rounded-full">
                          {userProfiles.filter(p => p.role === 'admin').length}
                        </span>
                      </div>
                      <p className={`text-[11px] ${currentTheme.isDark ? 'text-emerald-300/80' : 'text-emerald-800'}`}>
                        {t.fullControlFeePolicyClosingSchoolYearsRoleAssignment}
                      </p>
                    </div>

                    <div className={`p-4 rounded-2xl border ${currentTheme.border} ${currentTheme.isDark ? 'bg-blue-950/20 border-blue-500/30' : 'bg-blue-50/70 border-blue-200'}`}>
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-[10px] font-black uppercase tracking-wider text-blue-600 dark:text-blue-400 flex items-center gap-1.5">
                          <span>💼</span> {t.staffAccountants}
                        </span>
                        <span className="text-xs font-black bg-blue-500/20 text-blue-600 dark:text-blue-400 px-2 py-0.5 rounded-full">
                          {userProfiles.filter(p => p.role === 'staff').length}
                        </span>
                      </div>
                      <p className={`text-[11px] ${currentTheme.isDark ? 'text-blue-300/80' : 'text-blue-800'}`}>
                        {t.studentEnrollmentPaymentReceiptsPayrollDailyExpenses}
                      </p>
                    </div>

                    <div className={`p-4 rounded-2xl border ${currentTheme.border} ${currentTheme.isDark ? 'bg-purple-950/20 border-purple-500/30' : 'bg-purple-50/70 border-purple-200'}`}>
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-[10px] font-black uppercase tracking-wider text-purple-600 dark:text-purple-400 flex items-center gap-1.5">
                          <span>⚡</span> {t.engineeringDev}
                        </span>
                        <span className="text-xs font-black bg-purple-500/20 text-purple-600 dark:text-purple-400 px-2 py-0.5 rounded-full">
                          {userProfiles.filter(p => p.role === 'dev').length}
                        </span>
                      </div>
                      <p className={`text-[11px] ${currentTheme.isDark ? 'text-purple-300/80' : 'text-purple-800'}`}>
                        {t.technicalSystemMaintenanceAndDatabaseMigrations}
                      </p>
                    </div>
                  </div>

                  {/* Filter & Search Bar */}
                  <div className="flex flex-col sm:flex-row gap-3">
                    <div className="relative flex-1">
                      <input 
                        type="text"
                        value={userSearchTerm}
                        onChange={(e) => setUserSearchTerm(e.target.value)}
                        placeholder={t.searchByNameOrEmail}
                        className={`w-full pl-10 pr-4 py-2.5 rounded-xl border ${currentTheme.border} ${currentTheme.isDark ? 'bg-white/5 text-white' : 'bg-slate-50 text-slate-800'} text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-emerald-500/30`}
                      />
                      <Users size={15} className={`absolute left-3.5 top-1/2 -translate-y-1/2 ${currentTheme.muted}`} />
                    </div>

                    <div className="flex items-center gap-1 p-1 bg-white/5 rounded-xl border border-white/10 self-start">
                      {[
                        { id: 'all', label: t.all },
                        { id: 'admin', label: 'Admins' },
                        { id: 'staff', label: t.staff2 },
                      ].map((tab: { id: 'all' | 'admin' | 'staff'; label: string }) => (
                        <button
                          key={tab.id}
                          onClick={() => setUserRoleFilter(tab.id)}
                          className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                            userRoleFilter === tab.id
                              ? 'bg-emerald-600 text-white shadow-sm'
                              : `${currentTheme.muted} hover:text-white`
                          }`}
                        >
                          {tab.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Registered Users Cards */}
                  <div className="space-y-3">
                    {userProfiles
                      .filter(p => {
                        const matchesSearch = !userSearchTerm || 
                          p.fullName.toLowerCase().includes(userSearchTerm.toLowerCase()) || 
                          p.email.toLowerCase().includes(userSearchTerm.toLowerCase());
                        const matchesRole = userRoleFilter === 'all' || p.role === userRoleFilter;
                        return matchesSearch && matchesRole;
                      })
                      .length === 0 ? (
                      <div className={`text-xs ${currentTheme.muted} italic p-8 rounded-2xl text-center border ${currentTheme.border} ${currentTheme.card}`}>
                        {t.noUsersMatchingYourSearch}
                      </div>
                    ) : (
                      userProfiles
                        .filter(p => {
                          const matchesSearch = !userSearchTerm || 
                            p.fullName.toLowerCase().includes(userSearchTerm.toLowerCase()) || 
                            p.email.toLowerCase().includes(userSearchTerm.toLowerCase());
                          const matchesRole = userRoleFilter === 'all' || p.role === userRoleFilter;
                          return matchesSearch && matchesRole;
                        })
                        .map(profile => {
                          const isCurrentUser = auth.profile?.id === profile.id;
                          const isDev = profile.role === 'dev';
                          const isAdmin = profile.role === 'admin';
                          const isStaff = profile.role === 'staff';

                          return (
                            <div 
                              key={profile.id} 
                              className={`flex flex-col md:flex-row md:items-center justify-between p-5 ${currentTheme.card} border ${
                                isCurrentUser ? 'border-emerald-500/40 ring-1 ring-emerald-500/20' : currentTheme.border
                              } rounded-2xl gap-4 shadow-sm transition-all hover:border-emerald-500/30`}
                            >
                              <div className="flex items-center gap-4">
                                <div className={`w-12 h-12 rounded-2xl flex items-center justify-center text-white font-black text-sm shadow-md flex-shrink-0 ${
                                  isDev ? 'bg-purple-600 shadow-purple-500/20' :
                                  isAdmin ? 'bg-emerald-600 shadow-emerald-500/20' : 
                                  'bg-blue-600 shadow-blue-500/20'
                                }`}>
                                  {profile.fullName.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase()}
                                </div>
                                <div className="min-w-0">
                                  <div className="flex items-center gap-2 flex-wrap">
                                    <p className={`text-sm font-bold truncate ${currentTheme.isDark ? 'text-white' : 'text-slate-900'}`}>
                                      {profile.fullName}
                                    </p>
                                    {isCurrentUser && (
                                      <span className="px-2 py-0.5 rounded-full text-[9px] font-black uppercase tracking-wider bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
                                        {t.you}
                                      </span>
                                    )}
                                    <span className={`px-2.5 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider flex items-center gap-1 ${
                                      isDev 
                                        ? 'bg-purple-500/20 text-purple-400 border border-purple-500/30' 
                                        : isAdmin 
                                        ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30' 
                                        : 'bg-blue-500/20 text-blue-400 border border-blue-500/30'
                                    }`}>
                                      {isDev && <span>⚡</span>}
                                      {isAdmin && <span>👑</span>}
                                      {isStaff && <span>💼</span>}
                                      {isDev 
                                        ? (t.developer)
                                        : isAdmin 
                                        ? (t.promoterAdmin2) 
                                        : (t.staffAccountant)}
                                    </span>
                                  </div>
                                  <p className={`text-xs ${currentTheme.muted} mt-0.5`}>{profile.email}</p>
                                </div>
                              </div>

                              <div className="flex items-center gap-2.5 self-end md:self-auto flex-wrap">
                                {/* Role Selector Dropdown */}
                                {!isDev && (
                                  <div className="flex items-center gap-1.5">
                                    <label className={`text-[10px] font-bold ${currentTheme.muted} hidden sm:inline`}>
                                      {t.role}
                                    </label>
                                    <select
                                      value={profile.role}
                                      disabled={updatingUserId === profile.id}
                                      onChange={(e) => handleUpdateRole(profile, e.target.value as 'admin' | 'staff' | 'dev')}
                                      className={`px-3 py-2 rounded-xl text-xs font-bold border transition-all cursor-pointer ${
                                        isAdmin
                                          ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-500 hover:bg-emerald-500/20'
                                          : 'bg-blue-500/10 border-blue-500/30 text-blue-500 hover:bg-blue-500/20'
                                      } ${updatingUserId === profile.id ? 'opacity-50 cursor-wait' : ''}`}
                                    >
                                      <option value="admin" className="bg-slate-800 text-white">
                                        👑 {t.promoterAdminFull}
                                      </option>
                                      <option value="staff" className="bg-slate-800 text-white">
                                        💼 {t.staffAccountant}
                                      </option>
                                    </select>
                                  </div>
                                )}

                                {/* Password Reset Button */}
                                <button
                                  onClick={() => handleSendPasswordReset(profile.email)}
                                  className="px-3 py-2 bg-slate-800 hover:bg-slate-900 text-white rounded-xl text-xs font-bold transition-all shadow-sm active:scale-95 flex items-center gap-1.5 border border-white/10"
                                  title={t.sendPasswordResetEmail}
                                >
                                  <span>🔑</span>
                                  <span>{t.resetPass}</span>
                                </button>
                              </div>
                            </div>
                          );
                        })
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

    </>
    </MainViewsContext.Provider>
  );
}

/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useMemo, FormEvent, ChangeEvent, useEffect, useRef, useCallback, lazy, Suspense } from 'react';
import { useSupabaseData } from './lib/useSupabaseData';
import type { UserProfile } from './lib/useAuth';
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
import type { ImportCategory } from './lib/excelImporter';
import { getAppEnv, formatSupabaseError } from './lib/networkUtils';
import { generatePaymentReceiptPdf } from './lib/pdfReceipt';
import { generateStaffPayslipPdf } from './lib/pdfPayroll';
import { generateFinancialReportPdf } from './lib/pdfFinancialReport';
import { generateMultiYearReportPdf } from './lib/pdfMultiYearReport';
import { generateExpensesReportPdf } from './lib/pdfExpensesReport';
import { generateMonthlyPayrollDraftPdf } from './lib/pdfPayrollDraft';
import { motion, AnimatePresence } from 'motion/react';
import { ConfirmDialog } from './components/ConfirmDialog';

const PromotionWizardModal = lazy(() => import('./components/PromotionWizardModal').then(m => ({ default: m.PromotionWizardModal })));
const DashboardCharts = lazy(() => import('./components/DashboardCharts').then(m => ({ default: m.DashboardCharts })));
const MultiYearChart = lazy(() => import('./components/MultiYearChart').then(m => ({ default: m.MultiYearChart })));
const ArchivesView = lazy(() => import('./components/ArchivesView').then(m => ({ default: m.ArchivesView })));
const AppModals = lazy(() => import('./components/AppModals').then(m => ({ default: m.AppModals })));
const MainViews = lazy(() => import('./components/MainViews').then(m => ({ default: m.MainViews })));
import { HighlightText, ChartsFallback } from './components/SharedUi';
import { formatCurrency as formatCurrencyImpl, formatDateLang, getGradeDisplay as getGradeDisplayImpl, getMonthName as getMonthNameImpl, getDayName as getDayNameImpl } from './lib/formatters';
import { getCalendarDays, getStudentStanding } from './lib/classes';
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
import type { ThemeId } from './app/mainViewsProps';


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

  const [showAddUserModal, setShowAddUserModal] = useState(false);
  const [userSearchTerm, setUserSearchTerm] = useState('');
  const [userRoleFilter, setUserRoleFilter] = useState<'all' | 'admin' | 'staff' | 'dev'>('all');
  const [updatingUserId, setUpdatingUserId] = useState<string | null>(null);

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
        toast.success(`✅ ${label[lang]}`);
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


  const [searchTerm, setSearchTerm] = useState('');
  const [selectedStudent, setSelectedStudent] = useState<Student | null>(null);
  const [showStudentModal, setShowStudentModal] = useState(false);
  const [editingStudent, setEditingStudent] = useState<Student | null>(null);
  const [showSuccessToast, setShowSuccessToast] = useState(false);
  const [copied, setCopied] = useState(false);
  const [activeTab, setActiveTab] = useState<'dashboard' | 'students' | 'parents' | 'payroll' | 'expenses' | 'settings' | 'calendar' | 'notes' | 'archives' | 'audit'>('dashboard');
  // Auth/welcome domain (session, greeting banner, profiles, admin tab guard) —
  // extracted to src/app/useAuthWelcome.ts.
  const {
    auth, currentUser, isPromoter, authLoading,
    userProfiles, setUserProfiles,
    welcomeMessage, setWelcomeMessage,
  } = useAuthWelcome({ t, activeTab, setActiveTab });
  const [selectedYear, setSelectedYear] = useState<string>('2026-2027');
  const [lockedYears, setLockedYears] = useState<string[]>([]);
  const [showAuditModal, setShowAuditModal] = useState(false);
  const [auditYear, setAuditYear] = useState<string | null>(null);

  const [academicYears, setAcademicYears] = useState<string[]>(['2026-2027', '2027-2028', '2028-2029']);
  const [isPromotionWizardOpen, setIsPromotionWizardOpen] = useState(false);
  const [showExcelImport, setShowExcelImport] = useState(false);

  const [studentGradeFilter, setStudentGradeFilter] = useState<string>('all');
  const [theme, setTheme] = useState<'navy' | 'cream' | 'slate' | 'emerald' | 'bordeaux' | 'midnight'>('navy');
  const [schoolLogo, setSchoolLogo] = useState<string | null>(null);
  const [logoColor, setLogoColor] = useState<string | null>(null);
  const logoInputRef = useRef<HTMLInputElement>(null);

  // New State for Payroll & Expenses
  // staff, expenses, vendorExpenses, salaryPayments are now provided by useSupabaseData hook above
  
  const [showExpenseModal, setShowExpenseModal] = useState(false);
  const [showVendorExpenseModal, setShowVendorExpenseModal] = useState(false);
  const [vendorExpensesTab, setVendorExpensesTab] = useState<'general' | 'vendors'>('general');
  const [generalExpenseCategoryFilter, setGeneralExpenseCategoryFilter] = useState<string>('all');
  const [generalExpenseSearch, setGeneralExpenseSearch] = useState<string>('');
  const [vendorSearch, setVendorSearch] = useState('');
  const [vendorCategoryFilter, setVendorCategoryFilter] = useState<string>('all');
  const [vendorStatusFilter, setVendorStatusFilter] = useState<string>('all');
  
  const [calendarDate, setCalendarDate] = useState(new Date());
  const [showCalendarModal, setShowCalendarModal] = useState(false);
  const [expenseForm, setExpenseForm] = useState({ category: 'Other', description: '', amount: '', date: new Date().toISOString().split('T')[0] });
  const [vendorExpenseForm, setVendorExpenseForm] = useState({ 
    vendorName: '', 
    category: 'stationery', 
    amount: '', 
    dueDate: new Date().toISOString().split('T')[0], 
    paymentStatus: 'unpaid', 
    amountPaid: '', 
    description: '',
    aidType: '',
    beneficiaryStudentName: '',
    beneficiaryStudentGrade: ''
  });
  
  const [editingVendorExpense, setEditingVendorExpense] = useState<VendorExpense | null>(null);

  const [ticketStudent, setTicketStudent] = useState<Student | null>(null);

  // Sorting state for student list
  const [studentSortKey, setStudentSortKey] = useState<'name' | 'parentName' | 'balance' | 'dueDate' | null>(null);
  const [studentSortOrder, setStudentSortOrder] = useState<'asc' | 'desc'>('asc');

  const handleSort = (key: 'name' | 'parentName' | 'balance' | 'dueDate') => {
    if (studentSortKey === key) {
      setStudentSortOrder(prev => prev === 'asc' ? 'desc' : 'asc');
    } else {
      setStudentSortKey(key);
      setStudentSortOrder('asc');
    }
  };

  // Student Form State
  const [studentForm, setStudentForm] = useState({
    name: '',
    parentName: '',
    parentEmail: '',
    parentPhone: '',
    totalDue: '',
    scholarshipDiscount: '0',
    dueDate: new Date().toISOString().split('T')[0],
    academicYear: '2024-2025',
    grade: '',
    // Student Profiles & Enrollment Fields
    studentId: '',
    photo: '',
    emergencyContactName: '',
    emergencyContactRelation: '',
    emergencyContactPhone: '',
    medicalNotes: 'None',
    enrollmentDate: new Date().toISOString().split('T')[0],
    previousSchool: '',
    status: 'Active' as 'Active' | 'Graduated' | 'Left'
  });

  // State for active tab in student detailed viewer
  const [studentDetailTab, setStudentDetailTab] = useState<'general' | 'parent' | 'medical'>('general');
  // State for triggering A4 student file printout
  const [printStudentFile, setPrintStudentFile] = useState<Student | null>(null);

  const today = new Date().toISOString().split('T')[0];
  const currentMonth = new Date().getMonth();

  const expenseCategoryList = useMemo(() => {
    const keys = [
      'insurance',
      'social_cases',
      'exam_bac',
      'exam_def',
      'electricity',
      'water',
      'social_events',
      'internet',
      'stationery',
      'security_maintenance',
      'machine_management',
      'taxes',
      'furniture',
      'solar_energy',
      'reforestation',
      'catering',
      'works_renovation',
      'training'
    ];
    return keys
      .map(key => ({ key, label: (t as Record<string, string>)[key] || key }))
      .sort((a, b) => a.label.localeCompare(b.label, lang === 'en' ? 'en' : 'fr', { sensitivity: 'base' }));
  }, [t, lang]);

  // --- Theme Logic ---
  useEffect(() => {
    const savedTheme = localStorage.getItem('school-finance-theme');
    const savedLogo = localStorage.getItem('school-finance-logo');
    const savedLogoColor = localStorage.getItem('school-finance-logo-color');
    if (savedTheme) {
      if (savedTheme === 'midnight') setTheme('slate');
      else if (savedTheme === 'modern') setTheme('cream');
      else setTheme(savedTheme as ThemeId);
    }
    if (savedLogo) setSchoolLogo(savedLogo);
    if (savedLogoColor) setLogoColor(savedLogoColor);
  }, []);

  useEffect(() => {
    localStorage.setItem('school-finance-theme', theme);
  }, [theme]);

  // Automated effect to trigger print and clean up state
  useEffect(() => {
    if (printStudentFile) {
      const timer = setTimeout(() => {
        window.print();
        setPrintStudentFile(null);
      }, 300);
      return () => clearTimeout(timer);
    }
  }, [printStudentFile]);

  useEffect(() => {
    if (schoolLogo) {
      localStorage.setItem('school-finance-logo', schoolLogo);
    } else {
      localStorage.removeItem('school-finance-logo');
    }
    if (logoColor) {
      localStorage.setItem('school-finance-logo-color', logoColor);
    } else {
      localStorage.removeItem('school-finance-logo-color');
    }
  }, [schoolLogo, logoColor]);

  const currentTheme = useMemo(() => {
    const isCream = theme === 'cream';
    const isSlate = theme === 'slate';
    const isEmerald = theme === 'emerald';
    const isBordeaux = theme === 'bordeaux';
    const isMidnight = theme === 'midnight';

    const isDark = isSlate || isMidnight;

    return {
      bg: isMidnight 
        ? 'bg-[#090D16]' 
        : isSlate 
        ? 'bg-[#1E293B]' 
        : isEmerald 
        ? 'bg-[#F0FDF4]' 
        : isBordeaux 
        ? 'bg-[#FFF1F2]' 
        : isCream 
        ? 'bg-[#FDFBF7]' 
        : 'bg-[#F8FAFC]',

      card: isMidnight 
        ? 'bg-[#111827]' 
        : isSlate 
        ? 'bg-[#334155]' 
        : 'bg-white',

      text: isMidnight 
        ? 'text-[#F9FAFB]' 
        : isSlate 
        ? 'text-[#F8FAFC]' 
        : isEmerald 
        ? 'text-[#064E3B]' 
        : isBordeaux 
        ? 'text-[#881337]' 
        : isCream 
        ? 'text-[#1A1A1A]' 
        : 'text-slate-900',

      muted: isMidnight 
        ? 'text-[#9CA3AF]' 
        : isSlate 
        ? 'text-[#94A3B8]' 
        : isEmerald 
        ? 'text-[#047857]' 
        : isBordeaux 
        ? 'text-[#9F1239]' 
        : isCream 
        ? 'text-[#6B6659]' 
        : 'text-slate-400',

      border: isMidnight 
        ? 'border-[#1F2937]' 
        : isSlate 
        ? 'border-[#475569]' 
        : isEmerald 
        ? 'border-[#BBF7D0]' 
        : isBordeaux 
        ? 'border-[#FECDD3]' 
        : isCream 
        ? 'border-[#E5DEC9]' 
        : 'border-slate-100',

      header: logoColor || (isMidnight ? '#030712' : isSlate ? '#0F172A' : isEmerald ? '#064E3B' : isBordeaux ? '#881337' : isCream ? '#1E5E3A' : '#0F172A'),

      sidebar: isMidnight ? 'bg-[#030712]' : isSlate ? 'bg-[#1E293B]' : isEmerald ? 'bg-[#064E3B]' : isBordeaux ? 'bg-[#881337]' : isCream ? 'bg-[#1B2D1D]' : 'bg-[#0F172A]',

      accent: isMidnight ? 'amber-400' : isSlate ? 'sky-400' : isEmerald ? 'emerald-600' : isBordeaux ? 'rose-600' : isCream ? '[#1E5E3A]' : 'blue-600',

      accentBg: isMidnight ? 'bg-amber-500' : isSlate ? 'bg-sky-500' : isEmerald ? 'bg-emerald-600' : isBordeaux ? 'bg-rose-600' : isCream ? 'bg-[#1E5E3A]' : 'bg-blue-600',

      accentHover: isMidnight ? 'hover:bg-amber-600' : isSlate ? 'hover:bg-sky-600' : isEmerald ? 'hover:bg-emerald-700' : isBordeaux ? 'hover:bg-rose-700' : isCream ? 'hover:bg-[#15462B]' : 'hover:bg-blue-700',

      accentShadow: isMidnight ? 'shadow-amber-500/20' : isSlate ? 'shadow-sky-500/20' : isEmerald ? 'shadow-emerald-600/20' : isBordeaux ? 'shadow-rose-600/20' : isCream ? 'shadow-emerald-700/20' : 'shadow-blue-500/20',

      tableHeader: isDark ? 'bg-[#1E293B]/50 text-[#F8FAFC]' : isEmerald ? 'bg-[#DCFCE7] text-[#065F46]' : isBordeaux ? 'bg-[#FFE4E6] text-[#9F1239]' : isCream ? 'bg-[#F4EFE0] text-[#5C5647]' : 'bg-slate-50/50 text-slate-400',

      rowHover: isDark ? 'hover:bg-[#475569]/50' : isEmerald ? 'hover:bg-[#F0FDF4]' : isBordeaux ? 'hover:bg-[#FFF1F2]' : isCream ? 'hover:bg-[#FAF7F0]' : 'hover:bg-slate-50/80',

      input: isMidnight ? 'bg-[#111827] border-[#374151] text-white' : isSlate ? 'bg-[#1E293B] border-[#475569] text-[#F8FAFC]' : isEmerald ? 'bg-[#F0FDF4] border-[#A7F3D0] text-[#064E3B]' : isBordeaux ? 'bg-[#FFF1F2] border-[#FECDD3] text-[#881337]' : isCream ? 'bg-[#FCFAF2] border-[#DCD3B6] text-[#1A1A1A]' : 'bg-slate-50 border-slate-200 text-slate-900',

      isDark
    };
  }, [theme, logoColor]);

  // --- Calculations ---

  const getYearStats = (year: string) => {
    const filteredStudents = students.filter(s => s.academicYear === year || (!s.academicYear && year === '2024-2025'));
    const filteredExpenses = expenses.filter(e => e.academicYear === year || (!e.academicYear && year === '2024-2025'));
    const filteredVendorExpenses = vendorExpenses.filter(v => v.academicYear === year || (!v.academicYear && year === '2024-2025'));
    const filteredSalaryPayments = salaryPayments.filter(s => s.academicYear === year || (!s.academicYear && year === '2024-2025'));

    const totalRevenue = filteredStudents.reduce((acc, s) => acc + s.amountPaid, 0);

    const totalVendorExpensesPaid = filteredVendorExpenses.reduce((acc, v) => {
      if (v.paymentStatus === 'paid') {
        return acc + v.amount;
      } else if (v.paymentStatus === 'partial') {
        return acc + (v.amountPaid || 0);
      }
      return acc;
    }, 0);

    const totalExpenses = filteredExpenses.reduce((acc, e) => acc + e.amount, 0) + 
                          filteredSalaryPayments.reduce((acc, s) => acc + s.amount, 0) +
                          totalVendorExpensesPaid;

    const balance = totalRevenue - totalExpenses;

    return {
      revenue: totalRevenue,
      expenses: totalExpenses,
      balance
    };
  };

  const filteredStudents = useMemo(() => {
    const list = students.filter(s => 
      (!selectedYear || s.academicYear === selectedYear || !s.academicYear) &&
      (studentGradeFilter === 'all' || (s.grade && s.grade.toLowerCase() === studentGradeFilter.toLowerCase())) &&
      (s.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
       s.parentName.toLowerCase().includes(searchTerm.toLowerCase()) ||
       (s.studentId && s.studentId.toLowerCase().includes(searchTerm.toLowerCase())) ||
       (s.grade && s.grade.toLowerCase().includes(searchTerm.toLowerCase())))
    );

    if (studentSortKey) {
      list.sort((a, b) => {
        if (studentSortKey === 'name') {
          return studentSortOrder === 'asc' 
            ? a.name.localeCompare(b.name, lang) 
            : b.name.localeCompare(a.name, lang);
        } else if (studentSortKey === 'parentName') {
          return studentSortOrder === 'asc' 
            ? a.parentName.localeCompare(b.parentName, lang) 
            : b.parentName.localeCompare(a.parentName, lang);
        }

        let valueA: number | string | undefined;
        let valueB: number | string | undefined;

        if (studentSortKey === 'balance') {
          const discountA = a.scholarshipDiscount || 0;
          const discountedTotalA = a.totalDue * (1 - discountA / 100);
          valueA = discountedTotalA - a.amountPaid;

          const discountB = b.scholarshipDiscount || 0;
          const discountedTotalB = b.totalDue * (1 - discountB / 100);
          valueB = discountedTotalB - b.amountPaid;
        } else if (studentSortKey === 'dueDate') {
          valueA = a.dueDate;
          valueB = b.dueDate;
        }

        if (valueA === undefined || valueA === null) return 1;
        if (valueB === undefined || valueB === null) return -1;

        if (valueA < valueB) return studentSortOrder === 'asc' ? -1 : 1;
        if (valueA > valueB) return studentSortOrder === 'asc' ? 1 : -1;
        return 0;
      });
    }

    return list;
  }, [students, searchTerm, studentGradeFilter, selectedYear, studentSortKey, studentSortOrder, lang]);

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

  // --- Handlers ---

  const handleUpdateRole = async (targetProfile: UserProfile, newRole: 'admin' | 'staff' | 'dev') => {
    if (targetProfile.role === newRole) return;
    setUpdatingUserId(targetProfile.id);
    const ok = await auth.updateUserRole(targetProfile.id, newRole);
    if (ok) {
      setUserProfiles(prev => prev.map(p => p.id === targetProfile.id ? { ...p, role: newRole } : p));
      const roleLabel = newRole === 'admin' ? t.roleAdminPromoter : newRole === 'dev' ? t.roleDeveloper : t.roleStaffAccountant;
      toast.success(t.roleUpdated.replace('{name}', targetProfile.fullName).replace('{role}', roleLabel));
    } else {
      toast.error(t.failedToUpdateRole);
    }
    setUpdatingUserId(null);
  };

  const handleToggleRole = async (targetProfile: UserProfile) => {
    const newRole = targetProfile.role === 'admin' ? 'staff' : 'admin';
    await handleUpdateRole(targetProfile, newRole);
  };

  const handleSendPasswordReset = async (email: string) => {
    const res = await auth.sendPasswordReset(email);
    if (res.success) {
      toast.success(t.passwordResetEmailSent.replace('{email}', email));
    } else {
      toast.error(res.error || (t.failedToSendResetEmail));
    }
  };

  const handleStudentSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (lockedYears.includes(selectedYear)) {
      alert(t.thisAcademicYearIsLocked);
      return;
    }
    
    // Validation: Email is optional, but if provided, must be valid
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (studentForm.parentEmail && studentForm.parentEmail.trim() && !emailRegex.test(studentForm.parentEmail.trim())) {
      alert(t.invalidEmail);
      return;
    }

    const amount = parseFloat(studentForm.totalDue);
    if (isNaN(amount) || amount < 0) {
      alert(t.invalidAmount);
      return;
    }

    const studentData = {
      ...studentForm,
      parentEmail: studentForm.parentEmail.trim(),
      totalDue: amount,
      scholarshipDiscount: isPromoter
        ? (parseFloat(studentForm.scholarshipDiscount) || 0)
        : (editingStudent?.scholarshipDiscount || 0),
      notes: editingStudent?.notes || '',
    };

    const savedStudent = editingStudent
      ? await updateStudent(editingStudent.id, studentData)
      : await addStudent({ ...studentData, amountPaid: 0 });
    if (!savedStudent) return;

    setShowStudentModal(false);
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
    showToast();
  };

  const openEditModal = (student: Student) => {
    setEditingStudent(student);
    setStudentForm({
      name: student.name,
      parentName: student.parentName,
      parentEmail: student.parentEmail,
      parentPhone: student.parentPhone,
      totalDue: student.totalDue.toString(),
      scholarshipDiscount: (student.scholarshipDiscount || 0).toString(),
      dueDate: student.dueDate,
      academicYear: student.academicYear || '2024-2025',
      grade: student.grade || '',
      studentId: student.studentId || `MT-2026-${student.id.replace('ST', '')}`,
      photo: student.photo || '',
      emergencyContactName: student.emergencyContactName || '',
      emergencyContactRelation: student.emergencyContactRelation || '',
      emergencyContactPhone: student.emergencyContactPhone || '',
      medicalNotes: student.medicalNotes || 'None',
      enrollmentDate: student.enrollmentDate || new Date().toISOString().split('T')[0],
      previousSchool: student.previousSchool || '',
      status: student.status || 'Active'
    });
    setShowStudentModal(true);
  };

  const handleSaveNote = async (studentId: string, note: string) => {
    const ok = await updateStudent(studentId, { notes: note, lastNoteDate: today });
    if (!ok) return;
    if (selectedStudent?.id === studentId) {
      setSelectedStudent({ ...selectedStudent, notes: note, lastNoteDate: today });
    }
    showToast();
  };

  const toggleFlag = async (id: string) => {
    const student = students.find(s => s.id === id);
    if (!student) return;
    await updateStudent(id, { flagged: !student.flagged });
  };

  const handleExpenseSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (lockedYears.includes(selectedYear)) {
      alert(t.thisAcademicYearIsLocked);
      return;
    }
    const amount = parseFloat(expenseForm.amount);
    if (isNaN(amount) || amount < 0) return;

    const saved = await addExpense({ ...expenseForm, amount, academicYear: selectedYear });
    if (!saved) return;
    setShowExpenseModal(false);
    setExpenseForm({ category: 'Other', description: '', amount: '', date: new Date().toISOString().split('T')[0] });
    showToast();
  };

  const handleVendorExpenseSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!editingVendorExpense && !isPromoter) {
      alert(t.onlyThePromoterCanCreateAVendorExpense);
      return;
    }
    if (lockedYears.includes(selectedYear)) {
      alert(t.thisAcademicYearIsLocked);
      return;
    }
    const parsedAmount = parseFloat(vendorExpenseForm.amount);
    const amountPaid = parseFloat(vendorExpenseForm.amountPaid) || 0;
    const amount = isPromoter ? parsedAmount : (editingVendorExpense?.amount ?? parsedAmount);
    if (isNaN(amount) || amount < 0) return;

    const vendorData = {
      vendorName: isPromoter ? vendorExpenseForm.vendorName.trim() : (editingVendorExpense?.vendorName || vendorExpenseForm.vendorName.trim()),
      category: vendorExpenseForm.category,
      amount,
      dueDate: vendorExpenseForm.dueDate,
      paymentStatus: vendorExpenseForm.paymentStatus as VendorExpense['paymentStatus'],
      amountPaid: vendorExpenseForm.paymentStatus === 'paid' ? amount : (vendorExpenseForm.paymentStatus === 'unpaid' ? 0 : amountPaid),
      description: vendorExpenseForm.description.trim(),
      academicYear: selectedYear,
      aidType: vendorExpenseForm.category === 'social_cases' ? (vendorExpenseForm.aidType as VendorExpense['aidType']) : undefined,
      beneficiaryStudentName: vendorExpenseForm.category === 'social_cases' ? vendorExpenseForm.beneficiaryStudentName : undefined,
      beneficiaryStudentGrade: vendorExpenseForm.category === 'social_cases' ? vendorExpenseForm.beneficiaryStudentGrade : undefined,
    };

    const saved = editingVendorExpense
      ? await updateVendorExpense(editingVendorExpense.id, vendorData)
      : await addVendorExpense(vendorData);
    if (!saved) return;

    if (editingVendorExpense) {
      setEditingVendorExpense(null);
    }

    setShowVendorExpenseModal(false);
    setVendorExpenseForm({
      vendorName: '',
      category: 'stationery',
      amount: '',
      dueDate: new Date().toISOString().split('T')[0],
      paymentStatus: 'unpaid',
      amountPaid: '',
      description: '',
      aidType: '',
      beneficiaryStudentName: '',
      beneficiaryStudentGrade: '',
    });
    showToast();
  };

  const handleEditVendorExpense = (v: VendorExpense) => {
    setEditingVendorExpense(v);
    setVendorExpenseForm({
      vendorName: v.vendorName,
      category: v.category,
      amount: String(v.amount),
      dueDate: v.dueDate,
      paymentStatus: v.paymentStatus,
      amountPaid: String(v.amountPaid),
      description: v.description || '',
      aidType: v.aidType || '',
      beneficiaryStudentName: v.beneficiaryStudentName || '',
      beneficiaryStudentGrade: v.beneficiaryStudentGrade || ''
    });
    setShowVendorExpenseModal(true);
  };

  const handleDeleteVendorExpense = async (id: string) => {
    if (lockedYears.includes(selectedYear)) {
      alert(t.thisAcademicYearIsLocked);
      return;
    }
    if (currentUser?.role !== 'admin' && currentUser?.role !== 'dev') {
      alert(t.onlyThePromoterCanDeleteExpenses);
      return;
    }
    if (await deleteVendorExpense(id)) showToast();
  };

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

  const handleCloseCurrentYear = async () => {
    if (currentUser?.role !== 'admin' && currentUser?.role !== 'dev') {
      alert(t.onlyPromoterOwnerCanCloseAcademicYears);
      return;
    }
    if (lockedYears.includes(selectedYear)) {
      alert(t.thisAcademicYearIsAlreadyLocked);
      return;
    }

    const parts = selectedYear.split('-');
    let nextYear = '';
    if (parts.length === 2) {
      const y1 = parseInt(parts[0], 10);
      const y2 = parseInt(parts[1], 10);
      if (!isNaN(y1) && !isNaN(y2)) {
        nextYear = `${y1 + 1}-${y2 + 1}`;
      }
    }
    if (!nextYear) {
      nextYear = '2025-2026';
    }

    const currentYearStudents = students.filter(s => s.academicYear === selectedYear || (!s.academicYear && selectedYear === '2024-2025'));
    const ops: Promise<boolean>[] = [];

    // Group carry-over balances by next-year student name so that multiple
    // current-year students sharing a name accumulate into a single next-year
    // student (matching the previous local-state behaviour).
    const carryOverByName = new Map<string, number>();
    const firstByName = new Map<string, Student>();
    currentYearStudents.forEach(student => {
      const discount = student.scholarshipDiscount || 0;
      const discountedTotal = student.totalDue * (1 - discount / 100);
      const balance = discountedTotal - student.amountPaid;

      if (balance <= 0) return;

      carryOverByName.set(student.name, (carryOverByName.get(student.name) || 0) + balance);
      if (!firstByName.has(student.name)) {
        firstByName.set(student.name, student);
      }
    });

    carryOverByName.forEach((balance, name) => {
      const existing = students.find(s => s.name === name && s.academicYear === nextYear);
      if (existing) {
        const note = existing.notes
          ? `${existing.notes}\nCarryover debt from ${selectedYear}: +${balance} CFA`
          : `Carryover debt from ${selectedYear}: +${balance} CFA`;
        ops.push(updateStudent(existing.id, { totalDue: existing.totalDue + balance, notes: note }));
      } else {
        const student = firstByName.get(name)!;
        ops.push(addStudent({
          name: student.name,
          parentName: student.parentName,
          parentEmail: student.parentEmail,
          parentPhone: student.parentPhone,
          totalDue: balance,
          scholarshipDiscount: 0,
          dueDate: student.dueDate,
          amountPaid: 0,
          notes: `Opening Balance (Debt carried over from ${selectedYear}): ${balance} CFA`,
          academicYear: nextYear,
          grade: student.grade || '',
          status: 'Active',
        }).then(r => r !== null));
      }
    });

    const results = await Promise.all(ops);
    if (results.some(ok => !ok)) {
      alert(t.someCarryOverBalancesCouldNotBeSaved);
      return;
    }

    setLockedYears(prev => [...prev, selectedYear]);

    setAcademicYears(prev => {
      if (!prev.includes(nextYear)) {
        return [...prev, nextYear];
      }
      return prev;
    });

    setAuditYear(selectedYear);
    setShowAuditModal(true);
    showToast();
  };

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
    todoInput, setTodoInput, showTodoSidebar, setShowTodoSidebar,
    productivitySidebarTab, setProductivitySidebarTab,
    handleAddTodo, toggleTodo, deleteTodo,
  } = useTodoSidebar({
    todos, t,
    handleSaveNote,
    addTodoItem, updateTodoItem, deleteTodoItem,
  });

  const handleLogoUpload = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const base64 = event.target?.result as string;
      setSchoolLogo(base64);
      try {
        localStorage.setItem('school-finance-logo', base64);
      } catch (err) {
        console.warn('Failed to save logo to localStorage:', err);
      }

      // Extract color
      const img = new Image();
      img.src = base64;
      img.onload = () => {
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        canvas.width = img.width;
        canvas.height = img.height;
        ctx.drawImage(img, 0, 0);
        const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
        
        let r = 0, g = 0, b = 0;
        let count = 0;
        // Sample pixels
        for (let i = 0; i < data.length; i += 40) {
          r += data[i];
          g += data[i + 1];
          b += data[i + 2];
          count++;
        }
        r = Math.floor(r / count);
        g = Math.floor(g / count);
        b = Math.floor(b / count);
        setLogoColor(`rgb(${r}, ${g}, ${b})`);
      };
    };
    reader.readAsDataURL(file);
  };

  const showToast = () => {
    setShowSuccessToast(true);
    setTimeout(() => setShowSuccessToast(false), 3000);
  };

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
} = usePayments({
  t, lang, selectedYear, lockedYears, students, staff, expenses, currentUser,
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

  const getDaysInMonth = (date: Date) => getCalendarDays(date);

  const changeMonth = (offset: number) => {
    const newDate = new Date(calendarDate);
    newDate.setMonth(newDate.getMonth() + offset);
    setCalendarDate(newDate);
  };

  const getMonthName = (monthIndex: number) => getMonthNameImpl(monthIndex, t);

  const getDayName = (dayIndex: number) => getDayNameImpl(dayIndex, t);

  return (
    <>
      {authLoading ? (
        <div className="min-h-screen flex items-center justify-center" style={{ background: 'linear-gradient(135deg, #0C1222 0%, #111827 50%, #0F172A 100%)' }}>
          <div className="text-center">
            <div className="relative w-14 h-14 mx-auto mb-8">
              <div className="absolute inset-0 rounded-full border-2 border-white/[0.06]"></div>
              <div className="absolute inset-0 rounded-full border-2 border-emerald-500 border-t-transparent animate-spin"></div>
              <div className="absolute inset-2 rounded-full bg-emerald-500/10 flex items-center justify-center">
                <ShieldCheck size={18} className="text-emerald-400" />
              </div>
            </div>
            <h2 className="text-xl font-semibold text-white tracking-tight mb-2">{t.restoringSession}</h2>
            <p className="text-slate-500 text-sm font-medium">{t.checkingAuthentication}</p>
          </div>
        </div>
      ) : !currentUser ? (
        <Login onLogin={auth.signIn} lang={lang} setLang={toggleLanguage} t={t} />
      ) : supabaseLoading ? (
        <div className="min-h-screen flex items-center justify-center" style={{ background: 'linear-gradient(135deg, #0C1222 0%, #111827 50%, #0F172A 100%)' }}>
          <div className="text-center">
            <div className="relative w-14 h-14 mx-auto mb-8">
              <div className="absolute inset-0 rounded-full border-2 border-white/[0.06]"></div>
              <div className="absolute inset-0 rounded-full border-2 border-emerald-500 border-t-transparent animate-spin"></div>
              <div className="absolute inset-2 rounded-full bg-emerald-500/10 flex items-center justify-center">
                <ShieldCheck size={18} className="text-emerald-400" />
              </div>
            </div>
            <h2 className="text-xl font-semibold text-white tracking-tight mb-2">{t.loadingFinanceSuite}</h2>
            <p className="text-slate-500 text-sm font-medium">{t.connectingToDatabase}</p>
          </div>
        </div>
      ) : (
        <div className={`min-h-screen ${currentTheme.bg} flex font-sans ${currentTheme.text} transition-colors duration-300 theme-${theme} ${ticketStudent ? 'no-print-ticket' : ''}`}>
          {/* Environment Badge (dev/staging only) */}
          <EnvBadge env={appEnv} />
          {/* Offline Banner */}
          <OfflineBanner lang={lang} t={t} />
          {/* Toast Notifications */}
          <ToastContainer toasts={toast.toasts} onDismiss={toast.removeToast} />
          {supabaseError && (
            <div className="fixed top-0 left-0 right-0 z-50 bg-red-600 text-white text-center py-2 text-xs font-semibold flex items-center justify-center gap-3">
              <span>⚠️ {t.databaseConnectionIssue}: {supabaseError}</span>
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
      
      {/* --- Sidebar --- */}
      <aside className={`w-64 text-white fixed h-full z-40 hidden lg:flex flex-col transition-colors duration-300`} style={{ background: 'linear-gradient(180deg, #0C1222 0%, #111827 50%, #0F172A 100%)' }}>
        <div className="p-6 pb-4" style={{ backgroundColor: 'transparent' }}>
          <div className="flex items-center gap-3 mb-1">
            {schoolLogo ? (
              <img src={schoolLogo} alt="Logo" className="w-9 h-9 rounded-lg object-cover ring-2 ring-white/10" referrerPolicy="no-referrer" />
            ) : (
              <div className="bg-emerald-600/90 p-2 rounded-lg shadow-lg shadow-emerald-500/20">
                <ShieldCheck size={22} />
              </div>
            )}
            <div>
              <h1 className="font-bold text-base leading-tight tracking-tight" style={{ color: '#FFFFFF' }}>{t.title}</h1>
              <p className="text-[9px] uppercase tracking-[0.12em] font-semibold mt-0.5" style={{ color: 'rgba(255, 255, 255, 0.65)' }}>{t.subtitle}</p>
            </div>
          </div>
        </div>

        <div className="mx-4 mb-3 border-t border-white/[0.06]"></div>

        <nav className="flex-1 px-3 space-y-0.5 mt-1 custom-scrollbar overflow-y-auto">
          <button 
            onClick={() => setActiveTab('dashboard')}
            className={`nav-item w-full flex items-center gap-3 px-4 py-2.5 rounded-lg transition-all ${activeTab === 'dashboard' ? 'nav-item-active bg-white/[0.08] text-white shadow-sm' : 'text-white/50 hover:text-white/80 hover:bg-white/[0.04]'}`}
          >
            <LayoutDashboard size={20} />
            <span className="font-semibold text-sm" data-i18n="navDashboard">{t.navDashboard}</span>
          </button>
          
          <button 
            onClick={() => setActiveTab('students')}
            className={`nav-item w-full flex items-center gap-3 px-4 py-2.5 rounded-lg transition-all ${activeTab === 'students' ? 'nav-item-active bg-white/[0.08] text-white shadow-sm' : 'text-white/50 hover:text-white/80 hover:bg-white/[0.04]'}`}
          >
            <Users size={20} />
            <span className="font-semibold text-sm" data-i18n="navStudents">{t.navStudents}</span>
          </button>

          <button 
            onClick={() => setActiveTab('parents')}
            className={`nav-item w-full flex items-center gap-3 px-4 py-2.5 rounded-lg transition-all ${activeTab === 'parents' ? 'nav-item-active bg-white/[0.08] text-white shadow-sm' : 'text-white/50 hover:text-white/80 hover:bg-white/[0.04]'}`}
          >
            <MessageSquare size={20} />
            <span className="font-semibold text-sm" data-i18n="navParents">{t.navParents}</span>
          </button>

          <button 
            onClick={() => setActiveTab('payroll')}
            className={`nav-item w-full flex items-center gap-3 px-4 py-2.5 rounded-lg transition-all ${activeTab === 'payroll' ? 'nav-item-active bg-white/[0.08] text-white shadow-sm' : 'text-white/50 hover:text-white/80 hover:bg-white/[0.04]'}`}
          >
            <div className="flex items-center justify-between w-full gap-2">
              <div className="flex items-center gap-3 min-w-0">
                <Briefcase size={20} className="flex-shrink-0" />
                <span className="font-semibold text-sm truncate" data-i18n="payroll">{t.payroll}</span>
              </div>
              {payrollWindowStatus.isOverdue ? (
                <span className="bg-rose-700 text-white text-[8px] font-black px-1.5 py-0.5 rounded uppercase tracking-wider whitespace-nowrap shadow-sm animate-badge-pulse flex-shrink-0" data-i18n="overdue">
                  {t.overdue}
                </span>
              ) : payrollWindowStatus.isOpen ? (
                <span className="bg-blue-600 text-white text-[8px] font-black px-1.5 py-0.5 rounded uppercase tracking-wider whitespace-nowrap shadow-sm flex-shrink-0">
                  {t.open}
                </span>
              ) : (
                <Lock size={14} className="text-white/40 flex-shrink-0" />
              )}
            </div>
          </button>

          <button 
            onClick={() => setActiveTab('expenses')}
            className={`nav-item w-full flex items-center gap-3 px-4 py-2.5 rounded-lg transition-all ${activeTab === 'expenses' ? 'nav-item-active bg-white/[0.08] text-white shadow-sm' : 'text-white/50 hover:text-white/80 hover:bg-white/[0.04]'}`}
          >
            <Receipt size={20} />
            <span className="font-semibold text-sm" data-i18n="expenses">{t.expenses}</span>
          </button>

          <button 
            onClick={() => setActiveTab('calendar')}
            className={`nav-item w-full flex items-center gap-3 px-4 py-2.5 rounded-lg transition-all ${activeTab === 'calendar' ? 'nav-item-active bg-white/[0.08] text-white shadow-sm' : 'text-white/50 hover:text-white/80 hover:bg-white/[0.04]'}`}
          >
            <Calendar size={20} />
            <span className="font-semibold text-sm" data-i18n="navCalendar">{t.navCalendar}</span>
          </button>

          <button 
            onClick={() => setActiveTab('notes')}
            className={`nav-item w-full flex items-center gap-3 px-4 py-2.5 rounded-lg transition-all ${activeTab === 'notes' ? 'nav-item-active bg-white/[0.08] text-white shadow-sm' : 'text-white/50 hover:text-white/80 hover:bg-white/[0.04]'}`}
          >
            <StickyNote size={20} />
            <span className="font-semibold text-sm" data-i18n="notes">{t.notes}</span>
          </button>

          <button 
            onClick={() => setActiveTab('archives')}
            className={`nav-item w-full flex items-center gap-3 px-4 py-2.5 rounded-lg transition-all ${activeTab === 'archives' ? 'nav-item-active bg-white/[0.08] text-white shadow-sm' : 'text-white/50 hover:text-white/80 hover:bg-white/[0.04]'}`}
          >
            <TrendingUp size={20} />
            <span className="font-semibold text-sm" data-i18n="navArchives">{t.navArchives}</span>
          </button>

          {(currentUser?.role === 'admin' || currentUser?.role === 'dev') && (
            <>
              <button 
                onClick={() => {
                  setActiveTab('audit');
                  fetchAuditLogs();
                }}
                className={`nav-item w-full flex items-center gap-3 px-4 py-2.5 rounded-lg transition-all ${activeTab === 'audit' ? 'nav-item-active bg-white/[0.08] text-white shadow-sm' : 'text-white/50 hover:text-white/80 hover:bg-white/[0.04]'}`}
              >
                <ShieldCheck size={20} />
                <span className="font-semibold text-sm">{t.auditTrail}</span>
              </button>

              <button 
                onClick={() => setActiveTab('settings')}
                className={`nav-item w-full flex items-center gap-3 px-4 py-2.5 rounded-lg transition-all ${activeTab === 'settings' ? 'nav-item-active bg-white/[0.08] text-white shadow-sm' : 'text-white/50 hover:text-white/80 hover:bg-white/[0.04]'}`}
              >
                <Globe size={20} />
                <span className="font-semibold text-sm" data-i18n="navSettings">{t.navSettings}</span>
              </button>
            </>
          )}

          <button 
            onClick={() => setShowTodoSidebar(!showTodoSidebar)}
            className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all ${showTodoSidebar ? 'bg-amber-500 text-white shadow-lg shadow-amber-500/20' : 'text-white/40 hover:text-white hover:bg-white/5'}`}
          >
            <CheckSquare size={20} />
            <span className="font-semibold text-sm" data-i18n="productivity">{t.productivity}</span>
          </button>
          
          <div className="pt-4 pb-2 px-4">
            <p className="text-[10px] font-black text-white/20 uppercase tracking-widest" data-i18n="actions">{t.actions}</p>
          </div>

          <button 
            onClick={() => auth.signOut()}
            className="w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all text-rose-400 hover:text-rose-300 hover:bg-rose-500/10 mt-auto"
          >
            <LogOut size={20} />
            <span className="font-semibold text-sm" data-i18n="signOut">{t.signOut}</span>
          </button>

          <div className="space-y-2 pt-2">
            <button 
              onClick={() => {
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
              }}
              className="w-full flex items-center gap-3 px-4 py-3 rounded-xl bg-emerald-600/20 hover:bg-emerald-600/30 text-emerald-300 border border-emerald-500/30 transition-all font-bold text-xs"
            >
              <Plus size={18} className="text-emerald-400" />
              <span>{t.addStudent}</span>
            </button>

            <button 
              onClick={() => setShowPaymentForm(true)}
              className="w-full flex items-center gap-3 px-4 py-3 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white shadow-lg shadow-emerald-600/20 transition-all font-bold text-xs"
            >
              <DollarSign size={18} />
              <span>{t.recordPayment}</span>
            </button>
          </div>
        </nav>

        <div className="p-6 border-t border-white/5">
          <button 
            onClick={() => toggleLanguage(lang === 'en' ? 'fr' : 'en')}
            className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-xl border border-white/10 hover:bg-white/5 transition-all text-sm font-bold"
          >
            <Globe size={18} />
            {t.langToggle}
          </button>
        </div>
      </aside>

      {/* --- Main Content --- */}
      <main className={`flex-1 lg:ml-64 p-8 lg:p-12 transition-all duration-300 ${showTodoSidebar ? 'lg:mr-80' : ''}`}>
        
        {/* --- Notifications Panel --- */}
        <AnimatePresence>
          {notifications.length > 0 && (
            <motion.div 
              initial={{ opacity: 0, y: -20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="mb-8 flex gap-4 overflow-x-auto pb-2 custom-scrollbar"
            >
              {notifications.map(n => (
                <div 
                  key={n.id}
                  onClick={() => {
                    const student = students.find(s => s.id === n.studentId);
                    if (student) setSelectedStudent(student);
                  }}
                  className={`flex-shrink-0 flex items-center gap-3 px-6 py-4 rounded-2xl border cursor-pointer transition-all hover:scale-[1.02] ${n.type === 'due' ? 'bg-amber-50 border-amber-100 text-amber-700' : 'bg-rose-50 border-rose-100 text-rose-700 animate-subtle-pulse'}`}
                >
                  <Bell size={18} className={n.type === 'due' ? 'text-amber-500' : 'text-rose-500'} />
                  <span className="text-xs font-bold whitespace-nowrap">{n.message}</span>
                </div>
              ))}
            </motion.div>
          )}
        </AnimatePresence>

        {/* --- Header --- */}
        <header className="flex flex-col md:flex-row justify-between items-start md:items-center gap-6 mb-12">
          <div>
            <h2 className={`text-3xl font-bold ${currentTheme.isDark ? 'text-emerald-400' : 'text-slate-800'} tracking-tight`}>
              {activeTab === 'dashboard' ? t.dashboard : 
               activeTab === 'students' ? t.students :
               activeTab === 'parents' ? t.parents :
               activeTab === 'payroll' ? t.payroll :
               activeTab === 'expenses' ? t.expenses : 
               activeTab === 'calendar' ? t.calendar : 
               activeTab === 'archives' ? t.yearlyArchives : 
               activeTab === 'audit' ? (t.auditTrail) : t.settings}
            </h2>
            <p className={`${currentTheme.muted} text-sm mt-1 flex items-center gap-2`}>
              <Calendar size={14} />
              {new Date().toLocaleDateString(lang === 'en' ? 'en-US' : 'fr-FR', { month: 'long', day: 'numeric', year: 'numeric' })}
            </p>
          </div>

          <div className="flex items-center gap-4 w-full md:w-auto no-print">
            <div className="relative">
              <select 
                value={selectedYear}
                onChange={(e) => setSelectedYear(e.target.value)}
                className={`pl-10 pr-4 py-3 ${currentTheme.card} ${currentTheme.border} border rounded-2xl shadow-sm focus:outline-none focus:ring-4 focus:ring-${currentTheme.accent}/5 focus:border-${currentTheme.accent} transition-all text-sm font-bold ${currentTheme.text} appearance-none cursor-pointer`}
              >
                <option value="">{t.allYears}</option>
                {academicYears.map(year => (
                  <option key={year} value={year}>{year}</option>
                ))}
              </select>
              <Calendar className={`absolute left-4 top-1/2 -translate-y-1/2 ${currentTheme.muted}`} size={16} />
            </div>

            {activeTab === 'students' && (
              <button 
                onClick={() => setIsPromotionWizardOpen(true)}
                className="px-4 py-3 bg-emerald-700 hover:bg-emerald-800 text-white font-bold text-xs rounded-2xl shadow-lg shadow-emerald-700/20 transition-all flex items-center gap-2"
              >
                <GraduationCap size={18} />
                <span className="hidden sm:inline uppercase tracking-widest">{t.promoteClass}</span>
              </button>
            )}

            {/* Import Excel Button — visible on data tabs */}
            {(activeTab === 'students' || activeTab === 'parents' || activeTab === 'payroll' || activeTab === 'expenses') && (currentUser?.role === 'admin' || currentUser?.role === 'dev') && (
              <button 
                onClick={() => setShowExcelImport(true)}
                className="px-4 py-3 bg-violet-600 hover:bg-violet-700 text-white font-bold text-xs rounded-2xl shadow-lg shadow-violet-600/20 transition-all flex items-center gap-2 active:scale-[0.97]"
              >
                <FileSpreadsheet size={18} />
                <span className="hidden sm:inline uppercase tracking-widest">{t.importExcel}</span>
              </button>
            )}

            {activeTab === 'payroll' && (
              <button 
                onClick={() => {
                  setSelectedDraftMonth(new Date().getMonth());
                  setSelectedDraftYear(new Date().getFullYear());
                  setShowMonthlyDraftModal(true);
                }}
                className="px-4 py-3 bg-emerald-700 hover:bg-emerald-800 text-white font-bold text-xs rounded-2xl shadow-lg shadow-emerald-700/20 transition-all flex items-center gap-2 active:scale-[0.97]"
                title={t.monthlyPayrollDraft}
              >
                <FileText size={18} />
                <span className="hidden sm:inline uppercase tracking-widest">{t.monthlyDraft}</span>
              </button>
            )}

            {(activeTab === 'students' || activeTab === 'payroll' || activeTab === 'archives' || activeTab === 'expenses') && (
              <button 
                onClick={() => {
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
                className={`p-3 rounded-2xl ${currentTheme.isDark ? 'bg-emerald-900/20 text-emerald-500' : 'bg-slate-100 text-slate-600'} hover:bg-emerald-600 hover:text-white transition-all shadow-sm flex items-center gap-2`}
                title={activeTab === 'archives' ? (t.downloadMultiYearPdf) : activeTab === 'expenses' ? (t.downloadExpensesPdf) : t.printReport}
              >
                {(activeTab === 'archives' || activeTab === 'expenses') ? <FileText size={20} /> : <Printer size={20} />}
                <span className="hidden sm:inline font-bold text-xs uppercase tracking-widest">
                  {activeTab === 'archives' ? (t.multiYearPdf) : activeTab === 'expenses' ? (t.expensesPdf) : t.printReport}
                </span>
              </button>
            )}
            {(activeTab === 'students' || activeTab === 'parents') && (
              <div className="relative flex-1 md:w-80">
                <Search className={`absolute left-4 top-1/2 -translate-y-1/2 ${currentTheme.muted}`} size={18} />
                <input 
                  type="text" 
                  placeholder={t.searchPlaceholder}
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className={`w-full pl-12 pr-4 py-3 ${currentTheme.card} ${currentTheme.border} border rounded-2xl shadow-sm focus:outline-none focus:ring-4 focus:ring-${currentTheme.accent}/5 focus:border-${currentTheme.accent} transition-all text-sm ${currentTheme.text}`}
                />
              </div>
            )}
            {activeTab === 'students' && (
              <div className="relative min-w-[170px]">
                <select
                  value={studentGradeFilter}
                  onChange={(e) => setStudentGradeFilter(e.target.value)}
                  className={`w-full pl-10 pr-4 py-3 ${currentTheme.card} ${currentTheme.border} border rounded-2xl shadow-sm focus:outline-none focus:ring-4 focus:ring-blue-500/5 focus:border-blue-500 transition-all text-xs font-bold ${currentTheme.text} appearance-none cursor-pointer`}
                >
                  <option value="all">{t.allClasses}</option>
                  <optgroup label={t.firstCycle1stTo6th}>
                    {availableClasses.filter(c => c.cycle === 'cycle1').map(c => (
                      <option key={c.id} value={c.id}>{lang === 'en' ? c.nameEn : c.nameFr}</option>
                    ))}
                  </optgroup>
                  <optgroup label={t.secondCycle7thTo9th}>
                    {availableClasses.filter(c => c.cycle === 'cycle2').map(c => (
                      <option key={c.id} value={c.id}>{lang === 'en' ? c.nameEn : c.nameFr}</option>
                    ))}
                  </optgroup>
                  {availableClasses.some(c => c.cycle !== 'cycle1' && c.cycle !== 'cycle2') && (
                    <optgroup label={t.otherClasses}>
                      {availableClasses.filter(c => c.cycle !== 'cycle1' && c.cycle !== 'cycle2').map(c => (
                        <option key={c.id} value={c.id}>{lang === 'en' ? c.nameEn : c.nameFr}</option>
                      ))}
                    </optgroup>
                  )}
                </select>
                <Layers className={`absolute left-3.5 top-1/2 -translate-y-1/2 ${currentTheme.muted}`} size={16} />
              </div>
            )}
            {activeTab === 'dashboard' && (
              <div className="flex items-center gap-3">
                <button 
                  onClick={() => generateFinancialReportPdf({
                    students,
                    expenses,
                    vendorExpenses,
                    salaryPayments,
                    selectedYear,
                    lang
                  })}
                  className="bg-emerald-600 hover:bg-emerald-700 text-white px-5 py-3 rounded-2xl text-sm font-bold transition-all flex items-center gap-2 shadow-lg shadow-emerald-500/20 active:scale-[0.98]"
                  title={t.exportFinancialReportPdf}
                >
                  <FileText size={18} />
                  <span className="hidden sm:inline">{t.financialReportPdf}</span>
                </button>
                <button 
                  onClick={handleExport}
                  className={`${currentTheme.card} border ${currentTheme.border} ${currentTheme.text} px-5 py-3 rounded-2xl text-sm font-bold hover:bg-slate-50 transition-all flex items-center gap-2 shadow-sm`}
                >
                  <Download size={18} />
                  <span className="hidden sm:inline">{t.exportLate}</span>
                </button>
              </div>
            )}
            {activeTab === 'students' && (
              <button 
                onClick={() => {
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
                }}
                className={`${currentTheme.accentBg} text-white px-5 py-3 rounded-2xl text-sm font-bold ${currentTheme.accentHover} transition-all flex items-center gap-2 shadow-lg ${currentTheme.accentShadow}`}
              >
                <Plus size={18} />
                <span className="hidden sm:inline">{t.addStudent}</span>
              </button>
            )}
          </div>
        </header>

        {/* --- Persistent Welcome Banner (No Print) --- */}
        <div className="welcome-banner mb-8 p-5 rounded-2xl relative overflow-hidden flex flex-col sm:flex-row sm:items-center justify-between gap-4 no-print shadow-md" style={{ background: 'linear-gradient(135deg, #0F172A 0%, #1E293B 100%)', border: '1px solid rgba(255,255,255,0.08)' }}>
          <div className="flex items-center gap-3.5 z-10">
            <div className="w-10 h-10 rounded-xl bg-emerald-600 flex items-center justify-center shadow-lg shadow-emerald-500/25 flex-shrink-0">
              <ShieldCheck size={20} className="text-white" />
            </div>
            <div>
              <h3 className="font-bold text-base tracking-tight" style={{ color: '#FFFFFF' }}>
                {t.welcomeBack}, <span style={{ color: '#34D399' }}>{currentUser?.name || currentUser?.username}</span> !
              </h3>
              <p className="text-[11px] font-medium" style={{ color: '#94A3B8' }}>
                {(currentUser?.name || currentUser?.username || '').toLowerCase().includes('mamadou')
                  ? (t.generalManagerFullAdministrationFinancialAccess)
                  : (currentUser?.name || currentUser?.username || '').toLowerCase().includes('fanta')
                  ? (t.schoolPromoterDirectorExecutiveOversight)
                  : currentUser?.role === 'dev'
                  ? (t.systemDeveloperFullTechnicalAdminAccess)
                  : currentUser?.role === 'admin' 
                  ? (t.administratorFullSystemAccess)
                  : (t.accountantAccessFinanceReceipts)}
              </p>
            </div>
          </div>
          <div className="z-10 flex items-center gap-2">
            <span className={`px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-[0.08em] ${
              currentUser?.role === 'dev' ? 'bg-purple-500/20 text-purple-400 border border-purple-500/20' :
              currentUser?.role === 'admin' ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/20' : 'bg-blue-500/20 text-blue-400 border border-blue-500/20'
            }`}>
              {(currentUser?.name || currentUser?.username || '').toLowerCase().includes('mamadou')
                ? (t.generalManager)
                : (currentUser?.name || currentUser?.username || '').toLowerCase().includes('fanta')
                ? (t.promoter)
                : currentUser?.role === 'dev'
                ? (t.developer)
                : currentUser?.role === 'admin'
                ? (t.admin)
                : (t.accountant)}
            </span>
          </div>
        </div>

        {/* --- Locked Academic Year Banner --- */}
        {lockedYears.includes(selectedYear) && (
          <div className="mb-8 flex items-center justify-between p-6 bg-rose-50 border border-rose-200 rounded-3xl text-rose-800 shadow-sm no-print">
            <div className="flex items-center gap-4">
              <div className="p-3 bg-rose-100 rounded-2xl text-rose-600">
                <Lock size={24} />
              </div>
              <div>
                <p className="font-extrabold text-lg">
                  {t.academicYearLocked}
                </p>
                <p className="text-xs opacity-90">
                  {t.thisAcademicYearHasBeenClosedAndArchivedAllRecordsAreCurrentlyInReadOnlyMode}
                </p>
              </div>
            </div>
            <span className="px-4 py-1.5 bg-rose-600 text-white rounded-xl text-xs font-black uppercase tracking-wider">
              {t.readOnly}
            </span>
          </div>
        )}

        {/* --- Views (dashboard, students, parents, payroll, expenses, calendar, notes, audit, settings) --- */}
        <Suspense fallback={<div className={`${currentTheme.card} p-8 rounded-[2.5rem] border ${currentTheme.border} shadow-xl shadow-slate-200/50 animate-pulse`}><div className="h-6 w-64 bg-slate-300 dark:bg-slate-700 rounded-lg mb-8" /><div className="h-[400px] w-full bg-slate-200 dark:bg-slate-800 rounded-2xl" /></div>}>
          <MainViews
        AlertCircle={AlertCircle}
        ArrowDown={ArrowDown}
        ArrowUp={ArrowUp}
        ArrowUpDown={ArrowUpDown}
        Award={Award}
        Bell={Bell}
        BookOpen={BookOpen}
        Briefcase={Briefcase}
        Calendar={Calendar}
        ChartsFallback={ChartsFallback}
        CheckCircle2={CheckCircle2}
        ChevronDown={ChevronDown}
        ChevronLeft={ChevronLeft}
        ChevronRight={ChevronRight}
        ChevronUp={ChevronUp}
        Clock={Clock}
        Coins={Coins}
        Cpu={Cpu}
        CreditCard={CreditCard}
        DashboardCharts={DashboardCharts}
        DollarSign={DollarSign}
        Download={Download}
        Droplet={Droplet}
        Edit2={Edit2}
        FileText={FileText}
        Flag={Flag}
        Globe={Globe}
        GraduationCap={GraduationCap}
        Hammer={Hammer}
        Heart={Heart}
        HighlightText={HighlightText}
        Landmark={Landmark}
        Layers={Layers}
        Mail={Mail}
        MapPin={MapPin}
        Phone={Phone}
        PieChart={PieChart}
        Plus={Plus}
        Printer={Printer}
        Receipt={Receipt}
        Search={Search}
        Shield={Shield}
        ShieldCheck={ShieldCheck}
        Sparkles={Sparkles}
        Sprout={Sprout}
        StickyNote={StickyNote}
        Sun={Sun}
        Suspense={Suspense}
        Trash2={Trash2}
        TrendingDown={TrendingDown}
        TrendingUp={TrendingUp}
        Unlink={Unlink}
        UploadCloud={UploadCloud}
        UserCheck={UserCheck}
        UserPlus={UserPlus}
        Users={Users}
        Utensils={Utensils}
        Wallet={Wallet}
        Wifi={Wifi}
        X={X}
        Zap={Zap}
        activeTab={activeTab}
        auditLogs={auditLogs}
        auth={auth}
        availableClasses={availableClasses}
        calendarDate={calendarDate}
        changeMonth={changeMonth}
        chartData={chartData}
        currentMonth={currentMonth}
        currentTheme={currentTheme}
        deleteStaff={deleteStaff}
        deleteStudent={deleteStudent}
        deleteTodo={deleteTodo}
        expandedParentId={expandedParentId}
        expenseCategoryList={expenseCategoryList}
        expenses={expenses}
        fetchAuditLogs={fetchAuditLogs}
        filteredStaff={filteredStaff}
        filteredStudents={filteredStudents}
        formatCurrency={formatCurrency}
        formatDate={formatDate}
        generateExpensesReportPdf={generateExpensesReportPdf}
        generateStaffPayslipPdf={generateStaffPayslipPdf}
        getChildrenForParent={getChildrenForParent}
        getDayName={getDayName}
        getDaysInMonth={getDaysInMonth}
        getEventsForDay={getEventsForDay}
        getGradeDisplay={getGradeDisplay}
        getMonthName={getMonthName}
        getParentOutstandingBalance={getParentOutstandingBalance}
        getParentPaymentHistory={getParentPaymentHistory}
        getStatus={getStatus}
        handleAddTodo={handleAddTodo}
        handleDeleteClass={handleDeleteClass}
        handleDeleteParent={handleDeleteParent}
        handleDeleteVendorExpense={handleDeleteVendorExpense}
        handleExportAllData={handleExportAllData}
        handleExportParentLedgerPdf={handleExportParentLedgerPdf}
        handleLogoUpload={handleLogoUpload}
        handlePrint={handlePrint}
        handleSendPasswordReset={handleSendPasswordReset}
        handleSort={handleSort}
        handleUnlinkStudent={handleUnlinkStudent}
        handleUpdateRole={handleUpdateRole}
        isPromoter={isPromoter}
        lang={lang}
        lateStudents={lateStudents}
        logoColor={logoColor}
        logoInputRef={logoInputRef}
        missedMonths={missedMonths}
        openEditClass={openEditClass}
        openEditModal={openEditModal}
        openEditParentModal={openEditParentModal}
        openEditStaffModal={openEditStaffModal}
        openNotifyModal={openNotifyModal}
        parentChildrenSortBy={parentChildrenSortBy}
        parentSearchTerm={parentSearchTerm}
        parents={parents}
        payrollWindowStatus={payrollWindowStatus}
        pieData={pieData}
        salaryForm={salaryForm}
        salaryPayments={salaryPayments}
        schoolLogo={schoolLogo}
        searchTerm={searchTerm}
        selectedYear={selectedYear}
        setActiveLinkingParent={setActiveLinkingParent}
        setCalendarDate={setCalendarDate}
        setEditingParent={setEditingParent}
        setEditingStaff={setEditingStaff}
        setEditingVendorExpense={setEditingVendorExpense}
        setExpandedParentId={setExpandedParentId}
        setLogoColor={setLogoColor}
        setParentChildrenSortBy={setParentChildrenSortBy}
        setParentForm={setParentForm}
        setParentSearchTerm={setParentSearchTerm}
        setSalaryForm={setSalaryForm}
        setSchoolLogo={setSchoolLogo}
        setSelectedCalendarDay={setSelectedCalendarDay}
        setSelectedDraftMonth={setSelectedDraftMonth}
        setSelectedDraftYear={setSelectedDraftYear}
        setSelectedStudent={setSelectedStudent}
        setShowAddClassModal={setShowAddClassModal}
        setShowAddUserModal={setShowAddUserModal}
        setShowCalendarModal={setShowCalendarModal}
        setShowLinkStudentModal={setShowLinkStudentModal}
        setShowMonthlyDraftModal={setShowMonthlyDraftModal}
        setShowParentModal={setShowParentModal}
        setShowSalaryModal={setShowSalaryModal}
        setShowStaffModal={setShowStaffModal}
        setShowVendorExpenseModal={setShowVendorExpenseModal}
        setStaffForm={setStaffForm}
        setStaffSearchTerm={setStaffSearchTerm}
        setStudentToLinkId={setStudentToLinkId}
        setTheme={setTheme}
        setTicketStudent={setTicketStudent}
        setTodoInput={setTodoInput}
        setUserProfiles={setUserProfiles}
        setUserRoleFilter={setUserRoleFilter}
        setUserSearchTerm={setUserSearchTerm}
        setVendorCategoryFilter={setVendorCategoryFilter}
        setVendorExpenseForm={setVendorExpenseForm}
        setVendorSearch={setVendorSearch}
        setVendorStatusFilter={setVendorStatusFilter}
        setVisibleBankDetails={setVisibleBankDetails}
        staff={staff}
        staffSearchTerm={staffSearchTerm}
        stats={stats}
        studentSortKey={studentSortKey}
        studentSortOrder={studentSortOrder}
        t={t}
        theme={theme}
        today={today}
        todoInput={todoInput}
        todos={todos}
        toggleFlag={toggleFlag}
        toggleLanguage={toggleLanguage}
        toggleTodo={toggleTodo}
        updatingUserId={updatingUserId}
        userProfiles={userProfiles}
        userRoleFilter={userRoleFilter}
        userSearchTerm={userSearchTerm}
        vendorCategoryFilter={vendorCategoryFilter}
        vendorExpenses={vendorExpenses}
        vendorSearch={vendorSearch}
        vendorStatusFilter={vendorStatusFilter}
        visibleBankDetails={visibleBankDetails}
        />
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
        <AppModals
        Bell={Bell}
        Briefcase={Briefcase}
        Calendar={Calendar}
        CheckCircle2={CheckCircle2}
        CheckSquare={CheckSquare}
        Copy={Copy}
        CreditCard={CreditCard}
        DollarSign={DollarSign}
        FileText={FileText}
        Globe={Globe}
        Heart={Heart}
        Layers={Layers}
        MessageSquare={MessageSquare}
        Phone={Phone}
        Plus={Plus}
        Printer={Printer}
        Receipt={Receipt}
        ShieldCheck={ShieldCheck}
        Sparkles={Sparkles}
        StickyNote={StickyNote}
        Trash2={Trash2}
        TrendingUp={TrendingUp}
        Users={Users}
        X={X}
        academicYears={academicYears}
        activeLinkingParent={activeLinkingParent}
        aiInput={aiInput}
        aiMessages={aiMessages}
        auditYear={auditYear}
        availableClasses={availableClasses}
        copiedToast={copiedToast}
        copyToClipboard={copyToClipboard}
        currentMonth={currentMonth}
        currentTheme={currentTheme}
        currentUser={currentUser}
        deleteStudent={deleteStudent}
        deleteTodo={deleteTodo}
        editClassForm={editClassForm}
        editingParent={editingParent}
        editingStaff={editingStaff}
        editingStudent={editingStudent}
        editingVendorExpense={editingVendorExpense}
        expenseCategoryList={expenseCategoryList}
        expenseForm={expenseForm}
        formatCurrency={formatCurrency}
        formatDate={formatDate}
        generateInstallmentMemo={generateInstallmentMemo}
        generatePaymentReceiptPdf={generatePaymentReceiptPdf}
        getDayName={getDayName}
        getEventsForDay={getEventsForDay}
        getGradeDisplay={getGradeDisplay}
        getParentOutstandingBalance={getParentOutstandingBalance}
        getYearStats={getYearStats}
        handleAddTodo={handleAddTodo}
        handleAiQuery={handleAiQuery}
        handleCopyNotifyMessage={handleCopyNotifyMessage}
        handleCreateClassSubmit={handleCreateClassSubmit}
        handleEditClassSubmit={handleEditClassSubmit}
        handleExpenseSubmit={handleExpenseSubmit}
        handleLinkStudentSubmit={handleLinkStudentSubmit}
        handleNotifyTemplateChange={handleNotifyTemplateChange}
        handleParentSubmit={handleParentSubmit}
        handlePaymentSubmit={handlePaymentSubmit}
        handleSalarySubmit={handleSalarySubmit}
        handleSaveNote={handleSaveNote}
        handleSendSMS={handleSendSMS}
        handleSendWhatsApp={handleSendWhatsApp}
        handleStaffSubmit={handleStaffSubmit}
        handleStudentSubmit={handleStudentSubmit}
        handleVendorExpenseSubmit={handleVendorExpenseSubmit}
        isPromoter={isPromoter}
        lang={lang}
        newClassForm={newClassForm}
        notifyCustomText={notifyCustomText}
        notifyParent={notifyParent}
        notifySelectedPhone={notifySelectedPhone}
        notifyTemplateType={notifyTemplateType}
        openEditModal={openEditModal}
        parentForm={parentForm}
        paymentAmount={paymentAmount}
        paymentDate={paymentDate}
        paymentStudentId={paymentStudentId}
        printStudentFile={printStudentFile}
        productivitySidebarTab={productivitySidebarTab}
        salaryForm={salaryForm}
        salaryPayments={salaryPayments}
        schoolLogo={schoolLogo}
        selectedCalendarDay={selectedCalendarDay}
        selectedStudent={selectedStudent}
        setAiInput={setAiInput}
        setEditClassForm={setEditClassForm}
        setEditingVendorExpense={setEditingVendorExpense}
        setExpenseForm={setExpenseForm}
        setNewClassForm={setNewClassForm}
        setNotifyCustomText={setNotifyCustomText}
        setNotifySelectedPhone={setNotifySelectedPhone}
        setParentForm={setParentForm}
        setPaymentAmount={setPaymentAmount}
        setPaymentDate={setPaymentDate}
        setPaymentStudentId={setPaymentStudentId}
        setPrintStudentFile={setPrintStudentFile}
        setProductivitySidebarTab={setProductivitySidebarTab}
        setSalaryForm={setSalaryForm}
        setSelectedStudent={setSelectedStudent}
        setShowAddClassModal={setShowAddClassModal}
        setShowAuditModal={setShowAuditModal}
        setShowCalendarModal={setShowCalendarModal}
        setShowEditClassModal={setShowEditClassModal}
        setShowExpenseModal={setShowExpenseModal}
        setShowLinkStudentModal={setShowLinkStudentModal}
        setShowNotifyModal={setShowNotifyModal}
        setShowParentModal={setShowParentModal}
        setShowPaymentForm={setShowPaymentForm}
        setShowSalaryModal={setShowSalaryModal}
        setShowStaffModal={setShowStaffModal}
        setShowStudentModal={setShowStudentModal}
        setShowTodoSidebar={setShowTodoSidebar}
        setShowVendorExpenseModal={setShowVendorExpenseModal}
        setStaffForm={setStaffForm}
        setStudentDetailTab={setStudentDetailTab}
        setStudentForm={setStudentForm}
        setStudentToLinkId={setStudentToLinkId}
        setTicketStudent={setTicketStudent}
        setTodoInput={setTodoInput}
        setVendorExpenseForm={setVendorExpenseForm}
        showAddClassModal={showAddClassModal}
        showAuditModal={showAuditModal}
        showCalendarModal={showCalendarModal}
        showEditClassModal={showEditClassModal}
        showExpenseModal={showExpenseModal}
        showLinkStudentModal={showLinkStudentModal}
        showNotifyModal={showNotifyModal}
        showParentModal={showParentModal}
        showPaymentForm={showPaymentForm}
        showSalaryModal={showSalaryModal}
        showStaffModal={showStaffModal}
        showStudentModal={showStudentModal}
        showSuccessToast={showSuccessToast}
        showTodoSidebar={showTodoSidebar}
        showVendorExpenseModal={showVendorExpenseModal}
        staff={staff}
        staffForm={staffForm}
        studentDetailTab={studentDetailTab}
        studentForm={studentForm}
        studentToLinkId={studentToLinkId}
        students={students}
        t={t}
        ticketStudent={ticketStudent}
        todoInput={todoInput}
        todos={todos}
        toggleLanguage={toggleLanguage}
        toggleTodo={toggleTodo}
        vendorExpenseForm={vendorExpenseForm}
        welcomeMessage={welcomeMessage}
        />
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
    </>
  );
}


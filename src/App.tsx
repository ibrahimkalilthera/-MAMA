/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useMemo, FormEvent, ChangeEvent, useEffect, useRef, useCallback, lazy, Suspense } from 'react';
import { useSupabaseData } from './lib/useSupabaseData';
import { useAuth } from './lib/useAuth';
import type { UserProfile } from './lib/useAuth';
import { useToast, ToastContainer, OfflineBanner, EnvBadge } from './components/ToastNotification';
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
import { buildClassCode, getCalendarDays, getStudentStanding } from './lib/classes';
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
import { DEFAULT_SCHOOL_CLASSES } from './app/types';
import type { Language, User, Payment, Parent, Student, Staff, SalaryPayment, Expense, VendorExpense, Todo, SchoolClass } from './app/types';


// --- Components ---


export default function App() {
  const [lang, setLang] = useState<Language>('fr');

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

  // ── Supabase Auth ──────────────────────────────────────────────────────
  const auth = useAuth();
  
  // Derive currentUser from auth profile for backward compatibility
  const currentUser: User | null = auth.profile ? {
    username: auth.profile.fullName,
    role: auth.profile.role,
    name: auth.profile.fullName,
  } : null;
  const isPromoter = auth.isAdmin;

  // Auth loading state (checking session on page load)
  const authLoading = auth.loading;

  // User profiles list (for user & role management in Settings)
  const [userProfiles, setUserProfiles] = useState<UserProfile[]>([]);
  const [showAddUserModal, setShowAddUserModal] = useState(false);
  const [userSearchTerm, setUserSearchTerm] = useState('');
  const [userRoleFilter, setUserRoleFilter] = useState<'all' | 'admin' | 'staff' | 'dev'>('all');
  const [updatingUserId, setUpdatingUserId] = useState<string | null>(null);

  const [welcomeMessage, setWelcomeMessage] = useState<string | null>(null);
  
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
      toast.retrying(t.retryingConnection.replace('{n}', attempt));
    },
  });

  // Parent Directory States
  const [expandedParentId, setExpandedParentId] = useState<string | null>(null);
  const [parentSearchTerm, setParentSearchTerm] = useState('');
  const [showParentModal, setShowParentModal] = useState(false);
  const [confirmAction, setConfirmAction] = useState<{ title: string; message: string; confirmLabel: string; onConfirm: () => void } | null>(null);
  const [editingParent, setEditingParent] = useState<Parent | null>(null);
  const [parentForm, setParentForm] = useState({
    fullName: '',
    primaryPhone: '',
    secondaryPhone: '',
    email: '',
    address: '',
    occupation: '',
    relationship: 'Father',
    notes: '',
    linkedStudentIds: [] as string[]
  });
  const [showLinkStudentModal, setShowLinkStudentModal] = useState(false);
  const [activeLinkingParent, setActiveLinkingParent] = useState<Parent | null>(null);
  const [studentToLinkId, setStudentToLinkId] = useState<string>('');
  const [parentChildrenSortBy, setParentChildrenSortBy] = useState<'highest_balance' | 'alphabetical'>('highest_balance');

  // Notify / Payment Reminder Modal States
  const [showNotifyModal, setShowNotifyModal] = useState(false);
  const [notifyParent, setNotifyParent] = useState<Parent | null>(null);
  const [notifySelectedPhone, setNotifySelectedPhone] = useState<string>('');
  const [notifyTemplateType, setNotifyTemplateType] = useState<'polite' | 'urgent' | 'detailed'>('polite');
  const [notifyCustomText, setNotifyCustomText] = useState<string>('');
  const [copiedToast, setCopiedToast] = useState(false);

  const buildReminderText = (
    parent: Parent,
    children: Student[],
    totalOutstanding: number,
    type: 'polite' | 'urgent' | 'detailed',
    language: 'en' | 'fr'
  ) => {
    const schoolName = 'Complexe Scolaire Mama Thera';
    const overdueChildren = children.filter(c => c.totalDue > c.amountPaid);
    const childrenNames = (overdueChildren.length > 0 ? overdueChildren : children).map(c => c.name).join(', ');

    if (language === 'fr') {
      if (type === 'urgent') {
        return `*RAPPEL URGENT - ${schoolName}*\n\nCher/Chère ${parent.fullName},\n\nNous vous informons que les frais de scolarité pour (${childrenNames}) présentent un solde impayé de *${formatCurrency(totalOutstanding)}*.\n\nMerci de bien vouloir effectuer le règlement sous 48h ou de contacter le service financier de l'établissement.\n\nCordialement,\nLa Direction - ${schoolName}`;
      } else if (type === 'detailed') {
        const breakdown = (overdueChildren.length > 0 ? overdueChildren : children).map(c => `- ${c.name} (${c.grade || 'Classe'}): Reste ${formatCurrency(Math.max(0, c.totalDue - c.amountPaid))}`).join('\n');
        return `*SITUATION FINANCIÈRE DE LA FAMILLE - ${schoolName}*\n\nParent : ${parent.fullName}\n\nDétail des impayés par enfant :\n${breakdown}\n\n*TOTAL Reste à Payer : ${formatCurrency(totalOutstanding)}*\n\nMerci de contacter la comptabilité pour régulariser ces frais.`;
      } else {
        return `*RAPPEL DE SCOLARITÉ - ${schoolName}*\n\nBonjour M/Mme ${parent.fullName},\n\nSauf erreur de notre part, le paiement des frais de scolarité de ${childrenNames} présente un solde restant de *${formatCurrency(totalOutstanding)}*.\n\nNous vous prions de bien vouloir procéder au règlement dès que possible.\n\nMerci de votre confiance,\nService Comptabilité - ${schoolName}`;
      }
    } else {
      if (type === 'urgent') {
        return `*URGENT TUITION NOTICE - ${schoolName}*\n\nDear ${parent.fullName},\n\nPlease be advised that the overdue tuition balance for (${childrenNames}) is *${formatCurrency(totalOutstanding)}*.\n\nKindly complete the payment within 48 hours or contact our finance department.\n\nSincerely,\nManagement - ${schoolName}`;
      } else if (type === 'detailed') {
        const breakdown = (overdueChildren.length > 0 ? overdueChildren : children).map(c => `- ${c.name} (${c.grade || 'Grade'}): Outstanding ${formatCurrency(Math.max(0, c.totalDue - c.amountPaid))}`).join('\n');
        return `*FAMILY TUITION STATEMENT - ${schoolName}*\n\nParent: ${parent.fullName}\n\nOutstanding breakdown per child:\n${breakdown}\n\n*TOTAL OUTSTANDING BALANCE: ${formatCurrency(totalOutstanding)}*\n\nPlease reach out to the school accountant for any questions.`;
      } else {
        return `*TUITION REMINDER - ${schoolName}*\n\nDear ${parent.fullName},\n\nThis is a friendly reminder regarding the tuition balance of *${formatCurrency(totalOutstanding)}* for ${childrenNames}.\n\nWe kindly invite you to settle this balance at your earliest convenience.\n\nBest regards,\nAccounting Office - ${schoolName}`;
      }
    }
  };

  const openNotifyModal = (parent: Parent) => {
    const children = getChildrenForParent(parent);
    const totalOutstanding = getParentOutstandingBalance(parent);
    setNotifyParent(parent);
    setNotifySelectedPhone(parent.phones[0] || '');
    setNotifyTemplateType('polite');
    const text = buildReminderText(parent, children, totalOutstanding, 'polite', lang);
    setNotifyCustomText(text);
    setShowNotifyModal(true);
  };

  const handleNotifyTemplateChange = (newType: 'polite' | 'urgent' | 'detailed') => {
    setNotifyTemplateType(newType);
    if (notifyParent) {
      const children = getChildrenForParent(notifyParent);
      const totalOutstanding = getParentOutstandingBalance(notifyParent);
      const text = buildReminderText(notifyParent, children, totalOutstanding, newType, lang);
      setNotifyCustomText(text);
    }
  };

  const handleSendWhatsApp = () => {
    if (!notifySelectedPhone || !notifyCustomText) return;
    const cleanPhone = notifySelectedPhone.replace(/[^0-9]/g, '');
    const url = `https://wa.me/${cleanPhone}?text=${encodeURIComponent(notifyCustomText)}`;
    window.open(url, '_blank');
  };

  const handleSendSMS = () => {
    if (!notifySelectedPhone || !notifyCustomText) return;
    const cleanPhone = notifySelectedPhone.replace(/[^0-9+]/g, '');
    const url = `sms:${cleanPhone}?body=${encodeURIComponent(notifyCustomText)}`;
    window.location.href = url;
  };

  const handleCopyNotifyMessage = () => {
    navigator.clipboard.writeText(notifyCustomText);
    setCopiedToast(true);
    setTimeout(() => setCopiedToast(false), 3000);
  };

  // Parent Relational Helpers
  const getChildrenForParent = (parent: Parent) => {
    return students.filter(s => 
      s.parentId === parent.id || 
      (!s.parentId && s.parentName.trim().toLowerCase() === parent.fullName.trim().toLowerCase()) ||
      (s.parentEmail && parent.email && s.parentEmail.trim().toLowerCase() === parent.email.trim().toLowerCase())
    );
  };

  const getParentOutstandingBalance = (parent: Parent) => {
    const children = getChildrenForParent(parent);
    return children.reduce((sum, child) => sum + Math.max(0, child.totalDue - child.amountPaid), 0);
  };

  const getParentPaymentHistory = (parent: Parent) => {
    const children = getChildrenForParent(parent);
    const ledger: {
      receiptNumber: string;
      studentName: string;
      studentId: string;
      date: string;
      amount: number;
      academicYear?: string;
    }[] = [];

    children.forEach(child => {
      (child.payments || []).forEach((p, idx) => {
        ledger.push({
          receiptNumber: p.receiptNumber || `REC-${child.id}-${idx + 1}`,
          studentName: child.name,
          studentId: child.studentId || child.id,
          date: p.date,
          amount: p.amount,
          academicYear: p.academicYear
        });
      });
    });

    return ledger.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  };

  const handleExportParentLedgerPdf = async (parent: Parent) => {
    const { jsPDF } = await import('jspdf');
    const children = getChildrenForParent(parent);
    const totalOutstanding = getParentOutstandingBalance(parent);
    const paymentHistory = getParentPaymentHistory(parent);
    const totalPaymentsEver = paymentHistory.reduce((sum, item) => sum + item.amount, 0);

    const doc = new jsPDF({
      orientation: 'portrait',
      unit: 'mm',
      format: 'a4'
    });

    const isFr = lang === 'fr';
    const currencySuffix = ' FCFA';
    const formatPdfAmount = (val: number) => val.toLocaleString('fr-FR') + currencySuffix;

    // Header band
    doc.setFillColor(5, 150, 105); // emerald-600
    doc.rect(0, 0, 210, 28, 'F');

    doc.setTextColor(255, 255, 255);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(15);
    doc.text('COMPLEXE SCOLAIRE MAMA THERA', 14, 12);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10);
    doc.text(t.consolidatedFamilyStatementLedger, 14, 20);

    // Date & Reference
    const todayStr = new Date().toLocaleDateString(isFr ? 'fr-FR' : 'en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    });
    doc.setFontSize(9);
    doc.text(`Date: ${todayStr}`, 196, 12, { align: 'right' });
    doc.text(`REF: LEDGER-${parent.id.toUpperCase()}`, 196, 20, { align: 'right' });

    let y = 36;

    // Parent Info Block
    doc.setFillColor(248, 250, 252);
    doc.setDrawColor(226, 232, 240);
    doc.roundedRect(14, y, 182, 32, 3, 3, 'FD');

    doc.setTextColor(15, 23, 42);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.text(`${t.parentGuardian2}: ${parent.fullName}`, 18, y + 8);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.setTextColor(71, 85, 105);
    doc.text(`${t.relationship2}: ${parent.relationship}`, 18, y + 15);
    doc.text(`${t.phone2}: ${parent.phones.join(' / ')}`, 18, y + 21);
    doc.text(`${t.address}: ${parent.address}`, 18, y + 27);

    doc.text(`${t.occupation}: ${parent.occupation}`, 115, y + 15);
    doc.text(`Email: ${parent.email || 'N/A'}`, 115, y + 21);

    y += 40;

    // Summary Financial Banner Box
    doc.setFillColor(236, 253, 245);
    doc.setDrawColor(167, 243, 208);
    doc.roundedRect(14, y, 182, 18, 3, 3, 'FD');

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.setTextColor(6, 95, 70);
    doc.text(t.cumulativePaymentsMade, 18, y + 8);
    doc.setFontSize(11);
    doc.text(formatPdfAmount(totalPaymentsEver), 18, y + 14);

    doc.setFontSize(9);
    doc.setTextColor(153, 27, 27);
    doc.text(t.outstandingBalance, 115, y + 8);
    doc.setFontSize(11);
    doc.text(formatPdfAmount(totalOutstanding), 115, y + 14);

    y += 24;

    // Section 1: Linked Children Table
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.setTextColor(15, 23, 42);
    doc.text(t.n1LinkedStudents, 14, y);
    y += 5;

    doc.setFillColor(241, 245, 249);
    doc.rect(14, y, 182, 7, 'F');
    doc.setFontSize(8);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(71, 85, 105);
    doc.text(t.studentId, 18, y + 5);
    doc.text(t.fullName, 50, y + 5);
    doc.text(t.grade, 105, y + 5);
    doc.text(t.totalDue2, 135, y + 5);
    doc.text(t.balance2, 165, y + 5);
    y += 7;

    doc.setFont('helvetica', 'normal');
    doc.setTextColor(15, 23, 42);

    if (children.length === 0) {
      doc.text(t.noLinkedStudents, 18, y + 5);
      y += 8;
    } else {
      children.forEach((child) => {
        const remaining = Math.max(0, child.totalDue - child.amountPaid);
        doc.text(child.studentId || child.id, 18, y + 5);
        doc.text(child.name.substring(0, 26), 50, y + 5);
        doc.text(child.grade || '-', 105, y + 5);
        doc.text(formatPdfAmount(child.totalDue), 135, y + 5);
        doc.text(formatPdfAmount(remaining), 165, y + 5);
        y += 6;

        doc.setDrawColor(241, 245, 249);
        doc.line(14, y, 196, y);
      });
      y += 4;
    }

    y += 6;

    if (y > 220) {
      doc.addPage();
      y = 20;
    }

    // Section 2: Payment Receipts History Table
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.setTextColor(15, 23, 42);
    doc.text(t.n2ConsolidatedPaymentReceipts, 14, y);
    y += 5;

    doc.setFillColor(241, 245, 249);
    doc.rect(14, y, 182, 7, 'F');
    doc.setFontSize(8);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(71, 85, 105);
    doc.text(t.receipt, 18, y + 5);
    doc.text('DATE', 48, y + 5);
    doc.text(t.student, 75, y + 5);
    doc.text(t.year, 125, y + 5);
    doc.text(t.amount2, 165, y + 5);
    y += 7;

    doc.setFont('helvetica', 'normal');
    doc.setTextColor(15, 23, 42);

    if (paymentHistory.length === 0) {
      doc.text(t.noPaymentRecordsFound, 18, y + 5);
      y += 8;
    } else {
      paymentHistory.forEach((item) => {
        if (y > 270) {
          doc.addPage();
          y = 20;
          doc.setFillColor(241, 245, 249);
          doc.rect(14, y, 182, 7, 'F');
          doc.setFontSize(8);
          doc.setFont('helvetica', 'bold');
          doc.setTextColor(71, 85, 105);
          doc.text(t.receipt, 18, y + 5);
          doc.text('DATE', 48, y + 5);
          doc.text(t.student, 75, y + 5);
          doc.text(t.year, 125, y + 5);
          doc.text(t.amount2, 165, y + 5);
          y += 7;
          doc.setFont('helvetica', 'normal');
          doc.setTextColor(15, 23, 42);
        }

        doc.text(item.receiptNumber || 'REC', 18, y + 5);
        doc.text(item.date || '', 48, y + 5);
        doc.text((item.studentName || '').substring(0, 24), 75, y + 5);
        doc.text(item.academicYear || '-', 125, y + 5);
        doc.text(formatPdfAmount(item.amount), 165, y + 5);
        y += 6;

        doc.setDrawColor(241, 245, 249);
        doc.line(14, y, 196, y);
      });
    }

    y += 2;
    doc.setFillColor(236, 253, 245);
    doc.rect(14, y, 182, 8, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.setTextColor(6, 95, 70);
    doc.text(t.totalCumulativePaymentsRecorded, 18, y + 5.5);
    doc.text(formatPdfAmount(totalPaymentsEver), 165, y + 5.5);

    y += 18;
    if (y > 275) {
      doc.addPage();
      y = 250;
    }
    doc.setFont('helvetica', 'italic');
    doc.setFontSize(8);
    doc.setTextColor(148, 163, 184);
    doc.text(
      t.officialElectronicDocumentGeneratedByExecutiveFinanceComplexeScolaireMamaThera,
      105,
      y,
      { align: 'center' }
    );

    const safeName = parent.fullName.replace(/[^a-zA-Z0-9_-]/g, '_');
    doc.save(`Releve_Parent_${safeName}_${new Date().toISOString().slice(0, 10)}.pdf`);
  };

  const handleParentSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!parentForm.fullName.trim()) return;

    const parentData = {
      fullName: parentForm.fullName.trim(),
      phones: [parentForm.primaryPhone.trim(), parentForm.secondaryPhone.trim()].filter(Boolean),
      email: parentForm.email.trim() || undefined,
      address: parentForm.address.trim() || 'N/A',
      occupation: parentForm.occupation.trim() || 'N/A',
      relationship: parentForm.relationship || 'Guardian',
      notes: parentForm.notes.trim() || undefined,
    };

    let newParentId: string | null = null;
    let createdParent: Parent | null = null;
    let saved: boolean;
    if (editingParent) {
      saved = await updateParent(editingParent.id, parentData);
    } else {
      createdParent = await addParent(parentData);
      saved = !!createdParent;
      newParentId = createdParent?.id ?? null;
    }
    if (!saved) return;

    // If students were selected in the form, link them all to the newly created parent.
    // Stop on the first failed update so we do not falsely confirm a partial linkage.
    let linkedStudentCount = 0;
    if (!editingParent && newParentId && parentForm.linkedStudentIds.length > 0) {
      for (const studentId of parentForm.linkedStudentIds) {
        const linked = await updateStudent(studentId, {
          parentId: newParentId,
          parentName: parentData.fullName,
          parentPhone: parentData.phones[0] || '',
          parentEmail: parentData.email || '',
        });
        if (!linked) {
          setWelcomeMessage(`Parent créé, mais seulement ${linkedStudentCount}/${parentForm.linkedStudentIds.length} élève(s) lié(s).`);
          setTimeout(() => setWelcomeMessage(null), 6000);
          break;
        }
        linkedStudentCount += 1;
      }
    }

    const resetParentForm = () => setParentForm({
      fullName: '', primaryPhone: '', secondaryPhone: '', email: '', address: '', occupation: '', relationship: 'Father', notes: '', linkedStudentIds: []
    });

    if (editingParent) {
      setStudents(prev => prev.map(s => s.parentId === editingParent.id ? {
        ...s,
        parentName: parentData.fullName,
        parentPhone: parentData.phones[0] || s.parentPhone,
        parentEmail: parentData.email || s.parentEmail
      } : s));
      setShowParentModal(false);
      setEditingParent(null);
      resetParentForm();
    } else if (createdParent && linkedStudentCount > 0) {
      // Keep the modal open in "fiche" view so the user can visually confirm the linked students
      setEditingParent(createdParent);
      setParentForm({
        fullName: createdParent.fullName,
        primaryPhone: createdParent.phones[0] || '',
        secondaryPhone: createdParent.phones[1] || '',
        email: createdParent.email || '',
        address: createdParent.address,
        occupation: createdParent.occupation,
        relationship: createdParent.relationship,
        notes: createdParent.notes || '',
        linkedStudentIds: [],
      });
    } else {
      setShowParentModal(false);
      setEditingParent(null);
      resetParentForm();
    }
  };

  const handleLinkStudentSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!activeLinkingParent || !studentToLinkId) return;

    const updated = await updateStudent(studentToLinkId, {
      parentId: activeLinkingParent.id,
      parentName: activeLinkingParent.fullName,
      parentPhone: activeLinkingParent.phones[0] || '',
      parentEmail: activeLinkingParent.email || '',
    });
    if (!updated) return;

    setShowLinkStudentModal(false);
    setActiveLinkingParent(null);
    setStudentToLinkId('');
  };

  const handleUnlinkStudent = async (studentId: string) => {
    await updateStudent(studentId, { parentId: undefined });
  };

  const handleDeleteParent = async (parentId: string) => {
    setConfirmAction({
      title: t.deleteParent,
      message: t.confirmDeleteParent,
      confirmLabel: t.deleteParent,
      onConfirm: async () => {
        const deleted = await deleteParent(parentId);
        if (deleted) {
          setStudents(prev => prev.map(s => s.parentId === parentId ? { ...s, parentId: undefined } : s));
        }
      },
    });
  };

  const openEditParentModal = (parent: Parent) => {
    setEditingParent(parent);
    setParentForm({
      fullName: parent.fullName,
      primaryPhone: parent.phones[0] || '',
      secondaryPhone: parent.phones[1] || '',
      email: parent.email || '',
      address: parent.address,
      occupation: parent.occupation,
      relationship: parent.relationship,
      notes: parent.notes || '',
      linkedStudentIds: []
    });
    setShowParentModal(true);
  };

  const [searchTerm, setSearchTerm] = useState('');
  const [selectedStudent, setSelectedStudent] = useState<Student | null>(null);
  const [showPaymentForm, setShowPaymentForm] = useState(false);
  const [showStudentModal, setShowStudentModal] = useState(false);
  const [editingStudent, setEditingStudent] = useState<Student | null>(null);
  const [showSuccessToast, setShowSuccessToast] = useState(false);
  const [copied, setCopied] = useState(false);
  const [activeTab, setActiveTab] = useState<'dashboard' | 'students' | 'parents' | 'payroll' | 'expenses' | 'settings' | 'calendar' | 'notes' | 'archives' | 'audit'>('dashboard');
  const [selectedYear, setSelectedYear] = useState<string>('2026-2027');
  const [lockedYears, setLockedYears] = useState<string[]>([]);
  const [showAuditModal, setShowAuditModal] = useState(false);
  const [auditYear, setAuditYear] = useState<string | null>(null);

  const [academicYears, setAcademicYears] = useState<string[]>(['2026-2027', '2027-2028', '2028-2029']);
  const [isPromotionWizardOpen, setIsPromotionWizardOpen] = useState(false);
  const [showExcelImport, setShowExcelImport] = useState(false);

  // Classes & Sections Management (single source of truth: Supabase custom_classes)
  type ManagedClass = SchoolClass & { rowId?: string };
  const availableClasses = useMemo<ManagedClass[]>(() => {
    const seen = new Set(DEFAULT_SCHOOL_CLASSES.map(c => c.id.toLowerCase()));
    return [...DEFAULT_SCHOOL_CLASSES, ...customClasses.filter(c => !seen.has(c.id.toLowerCase()))];
  }, [customClasses]);

  const [showEditClassModal, setShowEditClassModal] = useState(false);
  const [editingClassRowId, setEditingClassRowId] = useState<string | null>(null);
  const [editClassForm, setEditClassForm] = useState<{
    cycle: 'cycle1' | 'cycle2' | 'lycee' | 'maternelle' | 'other';
    year: string;
    section: string;
    customName: string;
  }>({ cycle: 'other', year: '1', section: 'D', customName: '' });

  const [studentGradeFilter, setStudentGradeFilter] = useState<string>('all');
  const [showAddClassModal, setShowAddClassModal] = useState<boolean>(false);
  const [newClassForm, setNewClassForm] = useState<{
    cycle: 'cycle1' | 'cycle2' | 'lycee' | 'maternelle' | 'other';
    year: string;
    section: string;
    customName: string;
  }>({
    cycle: 'cycle1',
    year: '1',
    section: 'D',
    customName: ''
  });

  // Show welcome message when auth profile loads for the first time
  const [hasShownWelcome, setHasShownWelcome] = useState(false);
  useEffect(() => {
    if (auth.profile && !hasShownWelcome) {
      setHasShownWelcome(true);
      setActiveTab('dashboard');
      const displayName = auth.profile.fullName || auth.profile.email;
      setWelcomeMessage(t.welcomeBackName.replace('{name}', displayName));
      setTimeout(() => {
        setWelcomeMessage(null);
      }, 5000);

      // Fetch user profiles for admin
      if (auth.isAdmin) {
        auth.fetchAllProfiles().then(profiles => setUserProfiles(profiles));
      }
    }
    if (!auth.profile) {
      setHasShownWelcome(false);
    }
  }, [auth.profile]);

  // Safety net: keep admin-only tabs (System Settings / Audit Trail) out of reach for non-admin, non-dev accounts
  useEffect(() => {
    if (!auth.isAdmin && (activeTab === 'settings' || activeTab === 'audit')) {
      setActiveTab('dashboard');
    }
  }, [activeTab, auth.isAdmin]);
  const [theme, setTheme] = useState<'navy' | 'cream' | 'slate' | 'emerald' | 'bordeaux' | 'midnight'>('navy');
  const [schoolLogo, setSchoolLogo] = useState<string | null>(null);
  const [logoColor, setLogoColor] = useState<string | null>(null);
  const logoInputRef = useRef<HTMLInputElement>(null);

  // New State for Payroll & Expenses
  // staff, expenses, vendorExpenses, salaryPayments are now provided by useSupabaseData hook above
  
  const [showStaffModal, setShowStaffModal] = useState(false);
  const [showMonthlyDraftModal, setShowMonthlyDraftModal] = useState(false);
  const [selectedDraftMonth, setSelectedDraftMonth] = useState<number>(new Date().getMonth());
  const [selectedDraftYear, setSelectedDraftYear] = useState<number>(new Date().getFullYear());
  const [showExpenseModal, setShowExpenseModal] = useState(false);
  const [showVendorExpenseModal, setShowVendorExpenseModal] = useState(false);
  const [showSalaryModal, setShowSalaryModal] = useState(false);
  const [vendorExpensesTab, setVendorExpensesTab] = useState<'general' | 'vendors'>('general');
  const [generalExpenseCategoryFilter, setGeneralExpenseCategoryFilter] = useState<string>('all');
  const [generalExpenseSearch, setGeneralExpenseSearch] = useState<string>('');
  const [vendorSearch, setVendorSearch] = useState('');
  const [vendorCategoryFilter, setVendorCategoryFilter] = useState<string>('all');
  const [vendorStatusFilter, setVendorStatusFilter] = useState<string>('all');
  
  const [staffForm, setStaffForm] = useState({ name: '', position: '', salary: '', email: '', phone: '', bankDetails: '', emergencyContact: '' });
  const [staffSearchTerm, setStaffSearchTerm] = useState('');
  const [visibleBankDetails, setVisibleBankDetails] = useState<Record<string, boolean>>({});
  const [calendarDate, setCalendarDate] = useState(new Date());
  const [selectedCalendarDay, setSelectedCalendarDay] = useState<Date | null>(null);
  const [showCalendarModal, setShowCalendarModal] = useState(false);
  const [expenseForm, setExpenseForm] = useState({ category: 'Other', description: '', amount: '', date: new Date().toISOString().split('T')[0] });
  const [vendorExpenseForm, setVendorExpenseForm] = useState({ 
    vendorName: '', 
    category: 'stationery' as any, 
    amount: '', 
    dueDate: new Date().toISOString().split('T')[0], 
    paymentStatus: 'unpaid' as any, 
    amountPaid: '', 
    description: '',
    aidType: '' as any,
    beneficiaryStudentName: '',
    beneficiaryStudentGrade: ''
  });
  const [salaryForm, setSalaryForm] = useState({ staffId: '', amount: '', date: new Date().toISOString().split('T')[0] });
  
  const [editingStaff, setEditingStaff] = useState<Staff | null>(null);
  const [editingVendorExpense, setEditingVendorExpense] = useState<VendorExpense | null>(null);

  // todos are now provided by useSupabaseData hook above
  const [todoInput, setTodoInput] = useState('');
  const [showTodoSidebar, setShowTodoSidebar] = useState(false);
  const [productivitySidebarTab, setProductivitySidebarTab] = useState<'tasks' | 'ai'>('tasks');
  const [aiMessages, setAiMessages] = useState<{ sender: 'user' | 'assistant'; text: string }[]>([
    { sender: 'assistant', text: 'Hello! I am your Mama Thera Finance Assistant. How can I assist you with calculations or school statistics today?' }
  ]);
  const [aiInput, setAiInput] = useState('');
  const [isFloatingChatOpen, setIsFloatingChatOpen] = useState(false);
  const [floatingChatMessages, setFloatingChatMessages] = useState<{ sender: 'user' | 'assistant'; text: string }[]>([]);
  const [floatingChatInput, setFloatingChatInput] = useState('');

  useEffect(() => {
    if (floatingChatMessages.length === 0) {
      setFloatingChatMessages([
        {
          sender: 'assistant',
          text: t.helloIAmYourMamaTheraFinanceAssistantHowCanIAssistYouWithSchoolStatisticsTodayYouCanAskMeFinancialQuestionsOrClickOneOfTheQuickOptionsBelow
        }
      ]);
    }
  }, [lang]);

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

  // Payment Form State
  const [paymentStudentId, setPaymentStudentId] = useState('');
  const [paymentAmount, setPaymentAmount] = useState('');
  const [paymentDate, setPaymentDate] = useState(new Date().toISOString().split('T')[0]);

  const t = translations[lang];
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
      .map(key => ({ key, label: (t as any)[key] || key }))
      .sort((a, b) => a.label.localeCompare(b.label, lang === 'en' ? 'en' : 'fr', { sensitivity: 'base' }));
  }, [t, lang]);

  // --- Theme Logic ---
  useEffect(() => {
    const savedTheme = localStorage.getItem('school-finance-theme') as any;
    const savedLogo = localStorage.getItem('school-finance-logo');
    const savedLogoColor = localStorage.getItem('school-finance-logo-color');
    if (savedTheme) {
      if (savedTheme === 'midnight') setTheme('slate');
      else if (savedTheme === 'modern') setTheme('cream');
      else setTheme(savedTheme);
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

  const stats = useMemo(() => {
    const filteredStudents = students.filter(s => !selectedYear || s.academicYear === selectedYear || !s.academicYear);
    const filteredExpenses = expenses.filter(e => !selectedYear || e.academicYear === selectedYear || !e.academicYear);
    const filteredVendorExpenses = vendorExpenses.filter(v => !selectedYear || v.academicYear === selectedYear || !v.academicYear);
    const filteredSalaryPayments = salaryPayments.filter(s => !selectedYear || s.academicYear === selectedYear || !s.academicYear);

    const totalOutstanding = filteredStudents.reduce((acc, s) => {
      const discount = s.scholarshipDiscount || 0;
      const discountedTotal = s.totalDue * (1 - discount / 100);
      return acc + Math.max(0, discountedTotal - s.amountPaid);
    }, 0);
    
    const totalFees = filteredStudents.reduce((acc, s) => acc + s.amountPaid, 0);

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

    const now = new Date();

    const totalArrears = staff.reduce((acc, s) => {
      const paidThisMonth = filteredSalaryPayments
        .filter(p => p.staffId === s.id && new Date(p.date).getMonth() === currentMonth && new Date(p.date).getFullYear() === now.getFullYear())
        .reduce((sum, p) => sum + p.amount, 0);
      return acc + Math.max(0, s.salary - paidThisMonth);
    }, 0);

    const collectedThisMonth = filteredStudents.reduce((acc, s) => {
      const thisMonthPayments = s.payments.filter(p => {
        const payDate = new Date(p.date);
        // Filter by both month AND year so previous years' payments don't leak into this month's KPIs
        return payDate.getMonth() === currentMonth && payDate.getFullYear() === now.getFullYear();
      });
      return acc + thisMonthPayments.reduce((sum, p) => sum + p.amount, 0);
    }, 0);

    const prevMonth = (currentMonth + 11) % 12;
    const prevMonthYear = currentMonth === 0 ? now.getFullYear() - 1 : now.getFullYear();

    const prevMonthCollected = filteredStudents.reduce((acc, s) => {
      const prevMonthPayments = s.payments.filter(p => {
        const payDate = new Date(p.date);
        return payDate.getMonth() === prevMonth && payDate.getFullYear() === prevMonthYear;
      });
      return acc + prevMonthPayments.reduce((sum, p) => sum + p.amount, 0);
    }, 0);

    const lateParentsCount = filteredStudents.filter(s => {
      const discount = s.scholarshipDiscount || 0;
      const discountedTotal = s.totalDue * (1 - discount / 100);
      return (discountedTotal - s.amountPaid) > 0 && s.dueDate < today;
    }).length;

    const vendorExpensesThisMonth = filteredVendorExpenses.reduce((acc, v) => {
      const dueDateObj = new Date(v.dueDate);
      if (dueDateObj.getMonth() === currentMonth && dueDateObj.getFullYear() === now.getFullYear()) {
        if (v.paymentStatus === 'paid') {
          return acc + v.amount;
        } else if (v.paymentStatus === 'partial') {
          return acc + (v.amountPaid || 0);
        }
      }
      return acc;
    }, 0);

    const expensesThisMonth = filteredExpenses.reduce((acc, e) => {
      const expDate = new Date(e.date);
      return expDate.getMonth() === currentMonth && expDate.getFullYear() === now.getFullYear() ? acc + e.amount : acc;
    }, 0) + filteredSalaryPayments.reduce((acc, s) => {
      const salDate = new Date(s.date);
      return salDate.getMonth() === currentMonth && salDate.getFullYear() === now.getFullYear() ? acc + s.amount : acc;
    }, 0) + vendorExpensesThisMonth;

    const enrolledStudentsCount = filteredStudents.length;

    return { 
      totalOutstanding, 
      collectedMonth: collectedThisMonth, 
      prevMonthCollected,
      lateParentsCount,
      totalFees,
      // Alias used by the students print summary (was previously undefined → KPI showed 0)
      totalCollected: totalFees,
      totalExpenses,
      totalArrears,
      expensesThisMonth,
      enrolledStudentsCount
    };
  }, [students, today, currentMonth, expenses, vendorExpenses, salaryPayments, staff, selectedYear]);

  const notifications = useMemo(() => {
    const list: { id: string; type: 'due' | 'note'; message: string; studentId: string }[] = [];
    
    const relevantStudents = students.filter(s => !selectedYear || s.academicYear === selectedYear);

    relevantStudents.forEach(s => {
      const balance = s.totalDue - s.amountPaid;
      if (balance > 0) {
        // Due Date < 2 days
        const due = new Date(s.dueDate);
        const now = new Date(today);
        const diffTime = due.getTime() - now.getTime();
        const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
        
        if (diffDays >= 0 && diffDays < 2) {
          list.push({
            id: `due-${s.id}`,
            type: 'due',
            message: `${s.name}: ${t.dueReminder}`,
            studentId: s.id
          });
        }

        // Late parent + note > 3 days ago + no payment update
        // We check if balance is still > 0 and s.dueDate < today
        if (diffDays < 0 && s.lastNoteDate) {
          const noteDate = new Date(s.lastNoteDate);
          const diffNoteTime = now.getTime() - noteDate.getTime();
          const diffNoteDays = Math.floor(diffNoteTime / (1000 * 60 * 60 * 24));
          
          if (diffNoteDays > 3) {
            list.push({
              id: `note-${s.id}`,
              type: 'note',
              message: `${s.name}: ${t.noteReminder}`,
              studentId: s.id
            });
          }
        }
      }
    });

    return list;
  }, [students, today, t, selectedYear]);

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

        let valueA: any;
        let valueB: any;

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

  const filteredStaff = useMemo(() => {
    return staff.filter(s => 
      s.name.toLowerCase().includes(staffSearchTerm.toLowerCase()) ||
      s.phone.toLowerCase().includes(staffSearchTerm.toLowerCase())
    );
  }, [staff, staffSearchTerm]);

  const lateStudents = useMemo(() => {
    return students.filter(s => {
      const discount = s.scholarshipDiscount || 0;
      const discountedTotal = s.totalDue * (1 - discount / 100);
      return (!selectedYear || s.academicYear === selectedYear || !s.academicYear) &&
             (discountedTotal - s.amountPaid) > 0 && s.dueDate < today;
    });
  }, [students, today, selectedYear]);

  const chartData = useMemo(() => {
    const months = [t.jan, t.feb, t.mar, t.apr, t.may, t.jun, t.jul, t.aug, t.sep, t.oct, t.nov, t.dec];
    return months.map((month, index) => {
      const monthIncome = students.reduce((acc, s) => {
        const thisMonthPayments = s.payments.filter(p => {
          const d = new Date(p.date);
          return d.getMonth() === index && (!selectedYear || s.academicYear === selectedYear || !s.academicYear);
        });
        return acc + thisMonthPayments.reduce((sum, p) => sum + p.amount, 0);
      }, 0);

      const monthExpenses = expenses.filter(e => {
        const d = new Date(e.date);
        return d.getMonth() === index && (!selectedYear || e.academicYear === selectedYear || !e.academicYear);
      }).reduce((acc, e) => acc + e.amount, 0) + 
      salaryPayments.filter(p => {
        const d = new Date(p.date);
        return d.getMonth() === index && (!selectedYear || p.academicYear === selectedYear || !p.academicYear);
      }).reduce((acc, p) => acc + p.amount, 0);

      return {
        name: month.substring(0, 3),
        income: monthIncome,
        expenses: monthExpenses
      };
    });
  }, [students, expenses, salaryPayments, selectedYear, t]);

  const pieData = useMemo(() => {
    const filteredStudents = students.filter(s => !selectedYear || s.academicYear === selectedYear || !s.academicYear);
    const totalPaid = filteredStudents.reduce((acc, s) => acc + s.amountPaid, 0);
    const totalOutstanding = filteredStudents.reduce((acc, s) => {
      const discount = s.scholarshipDiscount || 0;
      const discountedTotal = s.totalDue * (1 - discount / 100);
      return acc + Math.max(0, discountedTotal - s.amountPaid);
    }, 0);

    return [
      { name: t.paid, value: totalPaid },
      { name: t.outstanding, value: totalOutstanding }
    ];
  }, [students, selectedYear, t]);

  const missedMonths = useMemo(() => {
    // If no staff members exist yet, do not trigger false missed-payroll warnings
    if (staff.length === 0) return [];

    const currentCalendarYear = new Date().getFullYear();
    const currentCalendarMonth = new Date().getMonth();
    const missed: number[] = [];
    
    for (let m = 0; m <= currentCalendarMonth; m++) {
      const monthPayments = salaryPayments.filter(p => {
        const payDate = new Date(p.date);
        return payDate.getFullYear() === currentCalendarYear && payDate.getMonth() === m && (!selectedYear || p.academicYear === selectedYear);
      });
      const totalPaid = monthPayments.reduce((sum, p) => sum + p.amount, 0);
      if (totalPaid === 0) {
        missed.push(m);
      }
    }
    return missed;
  }, [salaryPayments, staff.length, selectedYear]);

  const payrollWindowStatus = useMemo(() => {
    const currentDay = new Date().getDate();
    const currentCalendarYear = new Date().getFullYear();
    const currentCalendarMonth = new Date().getMonth();

    // If no staff members exist yet, payroll window alerts are inactive
    if (staff.length === 0) {
      return {
        currentDay,
        currentCalendarYear,
        currentCalendarMonth,
        totalPaidCurrentMonth: 0,
        isOverdue: false,
        isOpen: false
      };
    }

    const currentMonthPayments = salaryPayments.filter(p => {
      const payDate = new Date(p.date);
      return payDate.getFullYear() === currentCalendarYear && payDate.getMonth() === currentCalendarMonth && (!selectedYear || p.academicYear === selectedYear);
    });
    const totalPaidCurrentMonth = currentMonthPayments.reduce((sum, p) => sum + p.amount, 0);

    const isOverdue = currentDay >= 11 && totalPaidCurrentMonth === 0;
    const isOpen = currentDay >= 1 && currentDay <= 10;

    return {
      currentDay,
      currentCalendarYear,
      currentCalendarMonth,
      totalPaidCurrentMonth,
      isOverdue,
      isOpen
    };
  }, [salaryPayments, staff.length, selectedYear]);

  // --- Handlers ---

  const handleExport = async () => {
    const XLSX = await import('xlsx');
    const data = lateStudents.map(s => ({
      [t.studentName]: s.name,
      [t.parentName]: s.parentName,
      [t.parentEmail]: s.parentEmail,
      [t.parentPhone]: s.parentPhone,
      [t.totalDue]: s.totalDue,
      [t.balance]: s.totalDue - s.amountPaid,
      'Due Date': s.dueDate
    }));

    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Late Payments");
    XLSX.writeFile(wb, "Late_Payments_Report.xlsx");
  };

  const handleExportAllData = async () => {
    const XLSX = await import('xlsx');
    const wb = XLSX.utils.book_new();
    
    // Students
    const studentData = students.map(s => ({
      ID: s.id,
      Name: s.name,
      Parent: s.parentName,
      Email: s.parentEmail,
      Phone: s.parentPhone,
      'Total Due': s.totalDue,
      'Scholarship %': s.scholarshipDiscount || 0,
      'Amount Paid': s.amountPaid,
      'Balance': (s.totalDue * (1 - (s.scholarshipDiscount || 0) / 100)) - s.amountPaid,
      'Due Date': s.dueDate,
      'Academic Year': s.academicYear || 'N/A'
    }));
    const wsStudents = XLSX.utils.json_to_sheet(studentData);
    XLSX.utils.book_append_sheet(wb, wsStudents, "Students");

    // Staff
    const staffData = staff.map(s => ({
      ID: s.id,
      Name: s.name,
      Position: s.position,
      Salary: s.salary,
      Email: s.email,
      Phone: s.phone,
      'Academic Year': s.academicYear || 'N/A'
    }));
    const wsStaff = XLSX.utils.json_to_sheet(staffData);
    XLSX.utils.book_append_sheet(wb, wsStaff, "Staff");

    // Expenses
    const expenseData = expenses.map(e => ({
      ID: e.id,
      Category: e.category,
      Description: e.description,
      Amount: e.amount,
      Date: e.date,
      'Academic Year': e.academicYear || 'N/A'
    }));
    const wsExpenses = XLSX.utils.json_to_sheet(expenseData);
    XLSX.utils.book_append_sheet(wb, wsExpenses, "Expenses");

    // Salary Payments
    const salaryData = salaryPayments.map(p => ({
      ID: p.id,
      'Staff ID': p.staffId,
      Amount: p.amount,
      Date: p.date,
      'Academic Year': p.academicYear || 'N/A'
    }));
    const wsSalary = XLSX.utils.json_to_sheet(salaryData);
    XLSX.utils.book_append_sheet(wb, wsSalary, "Salary Payments");

    XLSX.writeFile(wb, "School_Data_Backup.xlsx");
    showToast();
  };

  const handleExportMonthlyPayrollExcel = async (monthIdx: number, yr: number) => {
    const XLSX = await import('xlsx');
    const monthNames = lang === 'fr'
      ? ['Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin', 'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre']
      : ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
    const monthName = monthNames[monthIdx];

    const data = staff.map((s, i) => {
      const payments = salaryPayments.filter(p => {
        const d = new Date(p.date);
        return d.getFullYear() === yr && d.getMonth() === monthIdx && p.staffId === s.id;
      });
      const totalPaid = payments.reduce((sum, p) => sum + (p.amount || 0), 0);
      const balance = Math.max(0, s.salary - totalPaid);
      const lastDate = payments.length > 0 ? payments[payments.length - 1].date : '—';

      return {
        [lang === 'fr' ? 'N°' : 'No.']: i + 1,
        [t.employeeName]: s.name,
        [t.position]: s.position,
        [t.baseSalaryFcfa]: s.salary,
        [t.paidThisMonthFcfa]: totalPaid,
        [t.remainingBalanceFcfa]: balance,
        [t.lastPaymentDate]: lastDate,
        [t.status]: totalPaid >= s.salary && s.salary > 0 ? (t.fullyPaid) : (totalPaid > 0 ? (t.partial2) : (t.unpaid)),
        [t.academicYear2]: selectedYear || '2026-2027',
      };
    });

    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, `Paie_${monthName}`);
    XLSX.writeFile(wb, `MAMA_THERA_Bordereau_Paie_${monthName}_${yr}.xlsx`);
    showToast();
  };

  const handlePaymentSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (lockedYears.includes(selectedYear)) {
      alert(t.thisAcademicYearIsLocked);
      return;
    }
    if (!paymentStudentId || !paymentAmount) return;

    const amount = parseFloat(paymentAmount);
    const targetStudent = students.find(s => s.id === paymentStudentId);
    const receiptNo = `REC-${Date.now().toString().slice(-6)}`;

    const newPayment = {
      date: paymentDate,
      amount,
      academicYear: targetStudent?.academicYear || selectedYear,
      receiptNumber: receiptNo,
    };

    await addPayment(paymentStudentId, newPayment);

    // Auto-generate printable PDF receipt
    if (targetStudent) {
      try {
        await generatePaymentReceiptPdf({
          student: {
            ...targetStudent,
            amountPaid: targetStudent.amountPaid + amount,
          },
          payment: newPayment,
          lang,
          cashierName: currentUser?.name || 'Administration',
        });
      } catch (pdfErr) {
        console.error('PDF receipt generation error:', pdfErr);
      }
    }

    setPaymentStudentId('');
    setPaymentAmount('');
    setShowPaymentForm(false);
  };

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
    };

    const savedStudent = editingStudent
      ? await updateStudent(editingStudent.id, studentData)
      : await addStudent({ ...studentData, amountPaid: 0, payments: [] });
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

  const handleStaffSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (lockedYears.includes(selectedYear)) {
      alert(t.thisAcademicYearIsLocked);
      return;
    }
    const salary = parseFloat(staffForm.salary);
    if (isNaN(salary) || salary < 0) return;

    const staffData = {
      ...staffForm,
      salary,
      email: staffForm.email.trim(),
      phone: staffForm.phone.trim(),
      bankDetails: staffForm.bankDetails.trim(),
      emergencyContact: staffForm.emergencyContact.trim(),
    };
    const saved = editingStaff
      ? await updateStaff(editingStaff.id, staffData)
      : await addStaff(staffData);
    if (!saved) return;
    setShowStaffModal(false);
    setEditingStaff(null);
    setStaffForm({ name: '', position: '', salary: '', email: '', phone: '', bankDetails: '', emergencyContact: '' });
    showToast();
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
      paymentStatus: vendorExpenseForm.paymentStatus,
      amountPaid: vendorExpenseForm.paymentStatus === 'paid' ? amount : (vendorExpenseForm.paymentStatus === 'unpaid' ? 0 : amountPaid),
      description: vendorExpenseForm.description.trim(),
      academicYear: selectedYear,
      aidType: vendorExpenseForm.category === 'social_cases' ? vendorExpenseForm.aidType : undefined,
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
      aidType: '' as any,
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
      aidType: v.aidType || '' as any,
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

  const handleSalarySubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (lockedYears.includes(selectedYear)) {
      alert(t.thisAcademicYearIsLocked);
      return;
    }
    const amount = parseFloat(salaryForm.amount);
    if (isNaN(amount) || amount < 0) return;

    const saved = await addSalaryPayment({
      staffId: salaryForm.staffId,
      amount,
      date: salaryForm.date,
      academicYear: selectedYear || undefined,
    });
    if (!saved) return;
    setShowSalaryModal(false);
    setSalaryForm({ staffId: '', amount: '', date: new Date().toISOString().split('T')[0] });
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

  const openEditStaffModal = (s: Staff) => {
    setEditingStaff(s);
    setStaffForm({ 
      name: s.name, 
      position: s.position, 
      salary: s.salary.toString(),
      email: s.email || '',
      phone: s.phone || '',
      bankDetails: s.bankDetails || '',
      emergencyContact: s.emergencyContact || ''
    });
    setShowStaffModal(true);
  };

  const handleAddTodo = async (e: FormEvent) => {
    e.preventDefault();
    if (!todoInput.trim()) return;
    const saved = await addTodoItem({ text: todoInput.trim(), completed: false });
    if (!saved) return;
    setTodoInput('');
  };

  const handleAiQuery = (queryText: string) => {
    if (!queryText.trim()) return;
    
    const userMsg = { sender: 'user' as const, text: queryText };
    setAiMessages(prev => [...prev, userMsg]);
    setAiInput('');

    const query = queryText.toLowerCase();
    let responseText = '';

    const isFrench = lang === 'fr';

    if (query.includes('balance') || query.includes('solde') || query.includes('caisse') || query.includes('cash') || query.includes('liquidity') || query.includes('liquidit')) {
      const balance = stats.totalFees - stats.totalExpenses;
      const income = stats.collectedMonth;
      const expensesVal = stats.expensesThisMonth;
      const template = isFrench ? translations.fr.aiResponseBalance : translations.en.aiResponseBalance;
      responseText = template
        .replace('{balance}', formatCurrency(balance))
        .replace('{income}', formatCurrency(income))
        .replace('{expenses}', formatCurrency(expensesVal));
    } else if (query.includes('overdue') || query.includes('late') || query.includes('retard') || query.includes('unpaid') || query.includes('debt') || query.includes('impaye') || query.includes('dette') || query.includes('non pay')) {
      const count = stats.lateParentsCount;
      const amount = stats.totalOutstanding;
      const template = isFrench ? translations.fr.aiResponseOverdue : translations.en.aiResponseOverdue;
      responseText = template
        .replace('{count}', count.toString())
        .replace('{amount}', formatCurrency(amount));
    } else if (query.includes('expense') || query.includes('depense') || query.includes('outflow') || query.includes('sorti')) {
      const expensesVal = stats.expensesThisMonth;
      const categories = isFrench 
        ? "papeterie, électricité, eau, cas sociaux et salaires" 
        : "stationery, electricity, water, social cases, and salaries";
      const template = isFrench ? translations.fr.aiResponseExpenses : translations.en.aiResponseExpenses;
      responseText = template
        .replace('{expenses}', formatCurrency(expensesVal))
        .replace('{categories}', categories);
    } else if (query.includes('payroll') || query.includes('salary') || query.includes('salaire') || query.includes('paie') || query.includes('personnel') || query.includes('employee') || query.includes('staff')) {
      const count = staff.length;
      const totalSalaries = staff.reduce((acc, s) => acc + s.salary, 0);
      const unpaidCount = staff.filter(s => {
        const paidThisMonth = salaryPayments
          .filter(p => p.staffId === s.id && new Date(p.date).getMonth() === currentMonth)
          .reduce((sum, p) => sum + p.amount, 0);
        return paidThisMonth < s.salary;
      }).length;
      const template = isFrench ? translations.fr.aiResponsePayroll : translations.en.aiResponsePayroll;
      responseText = template
        .replace('{count}', count.toString())
        .replace('{salary}', formatCurrency(totalSalaries))
        .replace('{unpaidCount}', unpaidCount.toString());
    } else {
      responseText = isFrench ? translations.fr.aiNoData : translations.en.aiNoData;
    }

    setTimeout(() => {
      setAiMessages(prev => [...prev, { sender: 'assistant' as const, text: responseText }]);
    }, 400);
  };

  const handleFloatingAiQuery = (queryText: string) => {
    if (!queryText.trim()) return;

    const userMsg = { sender: 'user' as const, text: queryText };
    setFloatingChatMessages(prev => [...prev, userMsg]);
    setFloatingChatInput('');

    const query = queryText.toLowerCase().trim();
    let responseText = '';
    const isFrench = lang === 'fr';

    // 1. "How much tuition was collected this month?" / "Combien de frais de scolarité ont été collectés ce mois-ci ?"
    const isTuitionQuery = 
      query.includes('tuition') || 
      query.includes('collected') || 
      query.includes('scolarité') || 
      query.includes('scolarite') || 
      query.includes('collecté') || 
      query.includes('collecte');

    // 2. "Which parents still owe school fees?" / "Quels parents doivent encore des frais de scolarité ?"
    const isParentsOweQuery = 
      query.includes('parent') && (query.includes('owe') || query.includes('redevable') || query.includes('doit') || query.includes('doivent') || query.includes('dette') || query.includes('outstanding') || query.includes('impayé') || query.includes('impaye'));

    // 3. "Show all expenses for June." / "Afficher toutes les dépenses pour juin."
    const isExpensesJuneQuery = 
      (query.includes('expense') || query.includes('dépense') || query.includes('depense')) && (query.includes('june') || query.includes('juin') || query.includes('06'));

    // 4. "How much money do we currently have in cash?" / "Combien d'argent avons-nous actuellement en caisse ?"
    const isCashQuery = 
      query.includes('cash') || 
      query.includes('caisse') || 
      query.includes('liquid') || 
      query.includes('argent') || 
      query.includes('money');

    // 5. "Which students haven't paid the second installment?" / "Quels élèves n'ont pas payé la deuxième tranche ?"
    const isSecondInstallmentQuery = 
      query.includes('second') || 
      query.includes('deuxième') || 
      query.includes('deuxieme') || 
      query.includes('installment') || 
      query.includes('tranche') || 
      query.includes('versement');

    // 6. "Generate this month's financial report." / "Générer le rapport financier de ce mois-ci."
    const isReportQuery = 
      query.includes('report') || 
      query.includes('rapport') || 
      query.includes('bilan') || 
      query.includes('generate') || 
      query.includes('générer') || 
      query.includes('generer');

    if (isSecondInstallmentQuery) {
      const partialStudentsList = students.filter(s => {
        const discount = s.scholarshipDiscount || 0;
        const discountedTotal = s.totalDue * (1 - discount / 100);
        return s.amountPaid > 0 && s.amountPaid < discountedTotal;
      });

      if (partialStudentsList.length > 0) {
        if (isFrench) {
          responseText = `Les élèves suivants ont effectué un paiement partiel (premier versement) mais n'ont pas encore réglé leur deuxième versement :\n\n` +
            partialStudentsList.map(s => {
              const discount = s.scholarshipDiscount || 0;
              const discountedTotal = s.totalDue * (1 - discount / 100);
              return `• **${s.name}** (Parent : ${s.parentName}) : Payé ${formatCurrency(s.amountPaid)} sur ${formatCurrency(discountedTotal)} (Reste : ${formatCurrency(discountedTotal - s.amountPaid)})`;
            }).join('\n');
        } else {
          responseText = `The following students have made a partial payment (first installment) but have not yet paid their second installment:\n\n` +
            partialStudentsList.map(s => {
              const discount = s.scholarshipDiscount || 0;
              const discountedTotal = s.totalDue * (1 - discount / 100);
              return `• **${s.name}** (Parent: ${s.parentName}): Paid ${formatCurrency(s.amountPaid)} of ${formatCurrency(discountedTotal)} (Owes: ${formatCurrency(discountedTotal - s.amountPaid)})`;
            }).join('\n');
        }
      } else {
        responseText = isFrench 
          ? "Aucun élève n'est actuellement répertorié avec un statut de paiement partiel (tous sont soit non-payés, soit entièrement payés)."
          : "No students are currently registered with partial payment statuses (all are either unpaid or fully paid).";
      }

    } else if (isParentsOweQuery) {
      const debtors = students.filter(s => {
        const discount = s.scholarshipDiscount || 0;
        const discountedTotal = s.totalDue * (1 - discount / 100);
        return (discountedTotal - s.amountPaid) > 0;
      });

      if (debtors.length > 0) {
        if (isFrench) {
          responseText = `Voici les parents qui doivent encore des frais de scolarité :\n\n` +
            debtors.map(s => {
              const discount = s.scholarshipDiscount || 0;
              const discountedTotal = s.totalDue * (1 - discount / 100);
              const remaining = discountedTotal - s.amountPaid;
              return `• **${s.parentName}** (Élève : ${s.name}) : reste dû **${formatCurrency(remaining)}** (Date limite : ${formatDate(s.dueDate)})`;
            }).join('\n');
        } else {
          responseText = `The following parents still owe school fees:\n\n` +
            debtors.map(s => {
              const discount = s.scholarshipDiscount || 0;
              const discountedTotal = s.totalDue * (1 - discount / 100);
              const remaining = discountedTotal - s.amountPaid;
              return `• **${s.parentName}** (Student: ${s.name}): **${formatCurrency(remaining)}** outstanding (Due date: ${formatDate(s.dueDate)})`;
            }).join('\n');
        }
      } else {
        responseText = isFrench 
          ? "Excellente nouvelle ! Tous les parents sont à jour dans leurs paiements."
          : "Great news! All parents are fully up to date with their school fees.";
      }

    } else if (isExpensesJuneQuery) {
      const juneExpensesList = expenses.filter(e => {
        const d = new Date(e.date);
        return d.getMonth() === 5; // June is 5
      });
      const juneVendorExpensesList = vendorExpenses.filter(v => {
        const d = new Date(v.dueDate);
        return d.getMonth() === 5;
      });

      const totalGeneral = juneExpensesList.reduce((sum, e) => sum + e.amount, 0);
      const totalVendor = juneVendorExpensesList.reduce((sum, v) => sum + v.amount, 0);

      if (juneExpensesList.length > 0 || juneVendorExpensesList.length > 0) {
        if (isFrench) {
          responseText = `Dépenses enregistrées pour le mois de **Juin** :\n\n`;
          if (juneExpensesList.length > 0) {
            responseText += `**Dépenses Générales :**\n` + juneExpensesList.map(e => `• [${formatDate(e.date)}] ${e.category} - ${e.description} : **${formatCurrency(e.amount)}**`).join('\n') + `\n\n`;
          }
          if (juneVendorExpensesList.length > 0) {
            responseText += `**Dépenses Fournisseurs :**\n` + juneVendorExpensesList.map(v => `• [Échéance ${formatDate(v.dueDate)}] ${v.vendorName} (${v.category}) - ${v.description || ''} : **${formatCurrency(v.amount)}** (${v.paymentStatus === 'paid' ? 'Payé' : 'Non Payé'})`).join('\n') + `\n\n`;
          }
          responseText += `**Total Juin :** ${formatCurrency(totalGeneral + totalVendor)}`;
        } else {
          responseText = `Registered expenses for the month of **June**:\n\n`;
          if (juneExpensesList.length > 0) {
            responseText += `**General Expenses:**\n` + juneExpensesList.map(e => `• [${formatDate(e.date)}] ${e.category} - ${e.description}: **${formatCurrency(e.amount)}**`).join('\n') + `\n\n`;
          }
          if (juneVendorExpensesList.length > 0) {
            responseText += `**Vendor Expenses:**\n` + juneVendorExpensesList.map(v => `• [Due ${formatDate(v.dueDate)}] ${v.vendorName} (${v.category}) - ${v.description || ''}: **${formatCurrency(v.amount)}** (${v.paymentStatus})`).join('\n') + `\n\n`;
          }
          responseText += `**Total June Expenses:** ${formatCurrency(totalGeneral + totalVendor)}`;
        }
      } else {
        responseText = isFrench 
          ? "Aucune dépense n'a été enregistrée pour le mois de juin."
          : "No expenses have been recorded for the month of June.";
      }

    } else if (isTuitionQuery) {
      const currentMonth = new Date().getMonth();
      const collectedThisMonth = students.reduce((acc, s) => {
        const thisMonthPayments = s.payments.filter(p => {
          const payDate = new Date(p.date);
          return payDate.getMonth() === currentMonth;
        });
        return acc + thisMonthPayments.reduce((sum, p) => sum + p.amount, 0);
      }, 0);

      responseText = isFrench 
        ? `Le montant total des frais de scolarité collectés ce mois-ci s'élève à **${formatCurrency(collectedThisMonth)}**.`
        : `The total tuition fees collected this month is **${formatCurrency(collectedThisMonth)}**.`;

    } else if (isCashQuery) {
      const cash = stats.totalFees - stats.totalExpenses;
      responseText = isFrench 
        ? `Le solde de caisse disponible en direct est actuellement de **${formatCurrency(cash)}**.`
        : `The live cash balance currently available in our accounts is **${formatCurrency(cash)}**.`;

    } else if (isReportQuery) {
      const cash = stats.totalFees - stats.totalExpenses;
      if (isFrench) {
        responseText = `📊 **RAPPORT SCOLAIRE MENSUEL - COMPLEXE SCOLAIRE MAMA THERA**\n` +
          `--------------------------------------------------\n` +
          `• **Entrées (Frais Collectés ce Mois)** : ${formatCurrency(stats.collectedMonth)}\n` +
          `• **Sorties (Dépenses & Salaires ce Mois)** : ${formatCurrency(stats.expensesThisMonth)}\n` +
          `• **Flux de Trésorerie Net Mensuel** : ${formatCurrency(stats.collectedMonth - stats.expensesThisMonth)}\n` +
          `• **Solde de Caisse Général** : **${formatCurrency(cash)}**\n` +
          `• **Dettes Restantes à Recouvrer** : **${formatCurrency(stats.totalOutstanding)}**\n` +
          `--------------------------------------------------\n` +
          `Rapport généré automatiquement à la demande.`;
      } else {
        responseText = `📊 **MONTHLY SCHOOL FINANCIAL REPORT - MAMA THERA**\n` +
          `--------------------------------------------------\n` +
          `• **Total Inflow (Tuition Collected)**: ${formatCurrency(stats.collectedMonth)}\n` +
          `• **Total Outflow (Expenses & Salaries)**: ${formatCurrency(stats.expensesThisMonth)}\n` +
          `• **Net Monthly Cash Flow**: ${formatCurrency(stats.collectedMonth - stats.expensesThisMonth)}\n` +
          `• **Current Total Cash Balance**: **${formatCurrency(cash)}**\n` +
          `• **Outstanding Debt Receivable**: **${formatCurrency(stats.totalOutstanding)}**\n` +
          `--------------------------------------------------\n` +
          `Report compiled automatically upon query request.`;
      }

    } else {
      if (isFrench) {
        responseText = `Je n'ai pas pu analyser de données financières précises pour votre question : « ${queryText} ».\n\n` +
          `Je suis programmé pour répondre à ces requêtes spécifiques concernant l'administration de l'école :\n` +
          `• « **Combien de scolarités ont été collectées ce mois-ci ?** »\n` +
          `• « **Quels parents doivent encore des frais de scolarité ?** »\n` +
          `• « **Afficher toutes les dépenses pour juin.** »\n` +
          `• « **Combien d'argent avons-nous actuellement en caisse ?** »\n` +
          `• « **Quels élèves n'ont pas payé la deuxième tranche ?** »\n` +
          `• « **Générer le rapport financier de ce mois-ci.** »`;
      } else {
        responseText = `I couldn't find a precise match or analyze financial data for your question: "${queryText}".\n\n` +
          `I am specifically trained to answer the following school finance queries:\n` +
          `• "**How much tuition was collected this month?**"\n` +
          `• "**Which parents still owe school fees?**"\n` +
          `• "**Show all expenses for June.**"\n` +
          `• "**How much money do we currently have in cash?**"\n` +
          `• "**Which students haven't paid the second installment?**"\n` +
          `• "**Generate this month's financial report.**"`;
      }
    }

    setTimeout(() => {
      setFloatingChatMessages(prev => [...prev, { sender: 'assistant' as const, text: responseText }]);
    }, 450);
  };

  const toggleTodo = async (id: string) => {
    const todo = todos.find(t => t.id === id);
    if (!todo) return;
    const newCompleted = !todo.completed;
    const ok = await updateTodoItem(id, { completed: newCompleted });
    if (!ok) return;
    // Automation: if "Call Parent" is checked
    if (newCompleted && (todo.text.toLowerCase().includes('call parent') || todo.text.toLowerCase().includes('appeler parent')) && todo.studentId) {
      await handleSaveNote(todo.studentId, t.followUpCompleted);
    }
  };

  const deleteTodo = async (id: string) => {
    await deleteTodoItem(id);
  };

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

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const formatCurrency = formatCurrencyImpl;

  const formatDate = (dateStr: string) => formatDateLang(dateStr, lang);

  const getGradeDisplay = (grade: string | undefined, currentLang: 'en' | 'fr' = lang) =>
    getGradeDisplayImpl(grade, availableClasses, t, currentLang);

  const handleCreateClassSubmit = async (e?: FormEvent) => {
    if (e) e.preventDefault();
    
    const { code, nameFr, nameEn } = buildClassCode(newClassForm);
    
    // Check if class code already exists
    if (availableClasses.some(c => c.id.toLowerCase() === code.toLowerCase())) {
      toast.warning(t.classAlreadyExists.replace('{code}', code));
      setStudentForm(prev => ({ ...prev, grade: code }));
      setShowAddClassModal(false);
      return;
    }
    
    const result = await addCustomClass({
      code,
      cycle: newClassForm.cycle,
      year: newClassForm.year,
      section: newClassForm.section.toUpperCase(),
      nameFr,
      nameEn,
    });
    if (!result) {
      toast.error(t.failedToAddClass);
      return;
    }
    
    // Auto-select in student form
    setStudentForm(prev => ({ ...prev, grade: code }));
    
    toast.success(t.classAddedSuccessfully.replace('{code}', code));
    
    setShowAddClassModal(false);
    setNewClassForm({
      cycle: 'cycle1',
      year: '1',
      section: 'D',
      customName: ''
    });
  };

  const openEditClass = (c: ManagedClass) => {
    setEditingClassRowId(c.rowId || null);
    setEditClassForm({
      cycle: c.cycle,
      year: String(c.year),
      section: c.section,
      customName: c.cycle === 'other' ? c.id : '',
    });
    setShowEditClassModal(true);
  };

  const handleEditClassSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!editingClassRowId) return;

    const { code, nameFr, nameEn } = buildClassCode(editClassForm);

    // Prevent colliding with another class code
    if (availableClasses.some(c => c.id.toLowerCase() === code.toLowerCase() && c.rowId !== editingClassRowId)) {
      toast.warning(t.classAlreadyExists.replace('{code}', code));
      return;
    }

    const ok = await updateCustomClass(editingClassRowId, {
      code,
      cycle: editClassForm.cycle,
      year: editClassForm.year,
      section: editClassForm.section.toUpperCase(),
      nameFr,
      nameEn,
    });
    if (!ok) return;
    toast.success(t.classUpdated.replace('{code}', code));
    setShowEditClassModal(false);
    setEditingClassRowId(null);
  };

  const handleDeleteClass = async (c: ManagedClass) => {
    if (!c.rowId) return;
    const rowId = c.rowId;
    setConfirmAction({
      title: t.deleteClass,
      message: t.deleteClassConfirm.replace('{id}', c.id),
      confirmLabel: t.deleteClass,
      onConfirm: async () => {
        const ok = await deleteCustomClass(rowId);
        if (ok) {
          toast.success(t.classDeleted.replace('{id}', c.id));
        }
      },
    });
  };

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

  const getEventsForDay = (date: Date) => {
    const dateStr = date.toISOString().split('T')[0];
    const dayEvents = [];
    
    // Student Due Dates
    const dueStudents = students.filter(s => s.dueDate === dateStr);
    if (dueStudents.length > 0) {
      dayEvents.push({ 
        type: 'due', 
        count: dueStudents.length, 
        label: `${dueStudents.length} ${t.navStudents} ${t.totalOutstanding}`,
        details: dueStudents.map(s => ({ name: s.name, amount: s.totalDue - s.amountPaid }))
      });
    }
    
    // Salary Dates (Assuming 25th of each month if not specified, or use a fixed date for demo)
    // For this app, let's say staff are paid on the 25th
    if (date.getDate() === 25) {
      dayEvents.push({ 
        type: 'salary', 
        count: staff.length, 
        label: `${staff.length} ${t.navPayroll}`,
        details: staff.map(s => ({ name: s.name, amount: s.salary }))
      });
    }
    
    // Expenses
    const dayExpenses = expenses.filter(e => e.date === dateStr);
    if (dayExpenses.length > 0) {
      dayEvents.push({ 
        type: 'expense', 
        count: dayExpenses.length, 
        label: `${dayExpenses.length} ${t.navExpenses}`,
        details: dayExpenses.map(e => ({ name: e.description || e.category, amount: e.amount }))
      });
    }
    
    return dayEvents;
  };

  const changeMonth = (offset: number) => {
    const newDate = new Date(calendarDate);
    newDate.setMonth(newDate.getMonth() + offset);
    setCalendarDate(newDate);
  };

  const handlePrint = () => {
    window.print();
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
                setStudentForm({ name: '', parentName: '', parentEmail: '', parentPhone: '', totalDue: '', dueDate: new Date().toISOString().split('T')[0] });
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
                  setStudentForm({ name: '', parentName: '', parentEmail: '', parentPhone: '', totalDue: '', dueDate: new Date().toISOString().split('T')[0] });
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

      {/* --- Floating AI Financial Assistant Widget --- */}
      <div className="fixed bottom-6 right-6 z-50 no-print font-sans">
        <AnimatePresence>
          {isFloatingChatOpen ? (
            <motion.div
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 20 }}
              className={`w-[360px] sm:w-96 h-[500px] rounded-[2.5rem] shadow-2xl border ${currentTheme.border} ${currentTheme.card} flex flex-col overflow-hidden`}
            >
              {/* Header */}
              <div 
                className="px-6 py-4 text-white flex justify-between items-center" 
                style={{ backgroundColor: currentTheme.header }}
              >
                <div className="flex items-center gap-2">
                  <span className="text-xl">🤖</span>
                  <div>
                    <h4 className="font-bold text-sm">Mama Thera AI Assistant</h4>
                    <p className="text-[10px] text-white/75 font-semibold">
                      {t.liveFinancialIntelligence}
                    </p>
                  </div>
                </div>
                <button 
                  onClick={() => setIsFloatingChatOpen(false)}
                  className="p-1.5 hover:bg-white/10 rounded-xl transition-all"
                >
                  <X size={16} />
                </button>
              </div>

              {/* Message History */}
              <div className="flex-1 overflow-y-auto p-4 space-y-3 custom-scrollbar bg-slate-50/50">
                {floatingChatMessages.map((msg, idx) => (
                  <div 
                    key={idx} 
                    className={`flex ${msg.sender === 'user' ? 'justify-end' : 'justify-start'}`}
                  >
                    <div 
                      className={`max-w-[85%] px-4 py-2.5 text-xs font-semibold leading-relaxed shadow-sm ${
                        msg.sender === 'user' 
                          ? `${currentTheme.isDark ? 'bg-emerald-600 text-white' : 'bg-blue-600 text-white'} rounded-t-2xl rounded-bl-2xl`
                          : `${currentTheme.isDark ? 'bg-[#334155] border-[#475569] text-white' : 'bg-white border-slate-100 text-slate-800'} border rounded-t-2xl rounded-br-2xl`
                      }`}
                      style={{ whiteSpace: 'pre-line' }}
                    >
                      {msg.text}
                    </div>
                  </div>
                ))}
              </div>

              {/* Quick Prompt Suggesters */}
              <div className="px-3 py-2 border-t border-slate-100 dark:border-slate-800 flex gap-2 overflow-x-auto whitespace-nowrap bg-white custom-scrollbar">
                {[
                  t.aiPrompt1,
                  t.aiPrompt2,
                  t.aiPrompt3,
                  t.aiPrompt4,
                  t.aiPrompt5,
                  t.aiPrompt6,
                ].map((q, idx) => (
                  <button
                    key={idx}
                    type="button"
                    onClick={() => handleFloatingAiQuery(q)}
                    className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold rounded-full text-[10px] transition-all shrink-0 border border-slate-200/50"
                  >
                    {q.length > 35 ? q.substring(0, 32) + '...' : q}
                  </button>
                ))}
              </div>

              {/* Input Form */}
              <form 
                onSubmit={(e) => {
                  e.preventDefault();
                  handleFloatingAiQuery(floatingChatInput);
                }}
                className="p-4 border-t border-slate-100 dark:border-slate-800 bg-white flex gap-2 items-center"
              >
                <input 
                  type="text"
                  value={floatingChatInput}
                  onChange={(e) => setFloatingChatInput(e.target.value)}
                  placeholder={t.askAFinancialQuestion}
                  className="flex-1 px-4 py-2 border border-slate-200 rounded-xl text-xs font-semibold text-slate-800 bg-slate-50 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
                />
                <button 
                  type="submit"
                  disabled={!floatingChatInput.trim()}
                  className={`px-4 py-2 rounded-xl text-white font-extrabold text-xs transition-all ${
                    floatingChatInput.trim() 
                      ? `${currentTheme.isDark ? 'bg-emerald-600 hover:bg-emerald-700' : 'bg-blue-600 hover:bg-blue-700'} shadow-lg` 
                      : 'bg-slate-300 cursor-not-allowed'
                  }`}
                >
                  {t.send}
                </button>
              </form>
            </motion.div>
          ) : (
            <motion.button
              initial={{ scale: 0.8, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.8, opacity: 0 }}
              onClick={() => setIsFloatingChatOpen(true)}
              className={`px-6 py-4 rounded-full text-white font-extrabold text-sm transition-all flex items-center gap-2 shadow-2xl active:scale-[0.98] ${
                currentTheme.isDark 
                  ? 'bg-emerald-600 hover:bg-emerald-700 shadow-emerald-500/30' 
                  : 'bg-blue-600 hover:bg-blue-700 shadow-blue-500/30'
              }`}
            >
              <span className="text-lg">🤖</span>
              <span>{t.mamaTheraAiAssistant}</span>
            </motion.button>
          )}
        </AnimatePresence>
      </div>
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


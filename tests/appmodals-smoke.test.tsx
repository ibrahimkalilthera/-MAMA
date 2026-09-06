import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import type { LucideIcon } from 'lucide-react';
import { translations } from '../src/i18n/translations';
import { AppModals } from '../src/components/AppModals';
import type { CurrentTheme } from '../src/app/mainViewsProps';

// ─── Smoke: the ported AppModals renders its shell modals (incl. the
// ─── Productivité panel) without crashing — regression net for the
// ─── AppModals decomposition + ProductivityPanel currentTheme port.

const icon = (() => null) as unknown as LucideIcon;
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

function baseProps(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    Bell: icon, Briefcase: icon, Calendar: icon, CheckCircle2: icon, CheckSquare: icon,
    Copy: icon, CreditCard: icon, DollarSign: icon, FileText: icon, Globe: icon,
    Heart: icon, Layers: icon, MessageSquare: icon, Phone: icon, Plus: icon,
    Printer: icon, Receipt: icon, ShieldCheck: icon, Sparkles: icon, StickyNote: icon,
    Trash2: icon, TrendingUp: icon, Users: icon, X: icon,
    t, currentTheme: theme, lang: 'fr' as const,
    currentMonth: 0, currentYear: 2026,
    academicYears: ['2025-2026'], availableClasses: [], students: [], staff: [],
    salaryPayments: [], expenses: [], vendorExpenses: [], todos: [],
    aiMessages: [], aiInput: '', todoInput: '', todoDate: '',
    noteText: '', savingNoteOnDate: false, notifyCustomText: '',
    notifyTemplateType: 'whatsapp', copiedToast: false,
    expenseForm: { category: '', description: '', amount: '', date: '' },
    parentForm: { fullName: '', primaryPhone: '', secondaryPhone: '', email: '', address: '', occupation: '', relationship: '', notes: '', linkedStudentIds: [] },
    salaryForm: { staffId: '', amount: '', date: '' },
    staffForm: { name: '', role: 'staff', phone: '', salary: '', joinedDate: '' },
    vendorExpenseForm: { vendorName: '', category: '', amount: '', amountPaid: '', dueDate: '', paymentStatus: 'unpaid' },
    newClassForm: { name: '', cycle: 'other' },
    editClassForm: { name: '', cycle: 'other' },
    auditYear: null, selectedStudent: null, editingStudent: null, editingStaff: null,
    editingParent: null, editingVendorExpense: null, activeLinkingParent: null,
    studentToLinkId: '', studentDetailTab: 'overview',
    paymentStudentId: '', paymentAmount: '', paymentDate: '',
    studentForm: { name: '', grade: '', parentName: '', parentPhone: '', totalDue: '', amountPaid: '' },
    currentUser: { name: 'Admin', role: 'admin' },
    formatCurrency: (n: number) => `${n} XOF`,
    formatDate: (d: string) => d,
    getDayName: (i: number) => String(i),
    getEventsForDay: () => [], getNotesForDay: () => [], getYearStats: () => ({ revenue: 0, expenses: 0, balance: 0 }),
    generateInstallmentMemo: noop, generatePaymentReceiptPdf: asyncNoop,
    handleStudentSubmit: asyncNoop, handleParentSubmit: asyncNoop, handleStaffSubmit: asyncNoop,
    handleExpenseSubmit: asyncNoop, handleVendorExpenseSubmit: asyncNoop,
    handleSalarySubmit: asyncNoop, handlePaymentSubmit: asyncNoop,
    handleCreateClassSubmit: asyncNoop, handleEditClassSubmit: asyncNoop,
    handleLinkStudentSubmit: asyncNoop, handleNotifyTemplateChange: noop,
    handleCopyNotifyMessage: noop, handleSendSMS: noop, handleSendWhatsApp: noop,
    handleAddTodo: asyncNoop, toggleTodo: asyncNoop, deleteTodo: asyncNoop,
    handleUpdateTodoDate: asyncNoop, handleAiQuery: asyncNoop,
    handleSaveNote: asyncNoop, saveNoteOnDate: asyncNoop,
    deleteStudent: asyncNoop,
    setStudentForm: noop, setStaffForm: noop, setParentForm: noop, setExpenseForm: noop,
    setVendorExpenseForm: noop, setSalaryForm: noop, setPaymentAmount: noop,
    setPaymentDate: noop, setPaymentStudentId: noop, setNewClassForm: noop,
    setEditClassForm: noop, setSelectedStudent: noop, setStudentDetailTab: noop,
    setAuditYear: noop, setAiInput: noop, setTodoInput: noop, setTodoDate: noop,
    setNoteText: noop, setNotifyCustomText: noop, setNotifySelectedPhone: noop,
    setStudentToLinkId: noop, setShowStudentModal: noop, setShowParentModal: noop,
    setShowStaffModal: noop, setShowExpenseModal: noop, setShowVendorExpenseModal: noop,
    setShowSalaryModal: noop, setShowPaymentForm: noop, setShowCalendarModal: noop,
    setShowAddClassModal: noop, setShowEditClassModal: noop, setShowLinkStudentModal: noop,
    setShowNotifyModal: noop, setShowAuditModal: noop, setShowTodoSidebar: noop,
    setPrintStudentFile: noop, setTicketStudent: noop,
    setEditingStaff: noop, setEditingParent: noop,
    setEditingVendorExpense: noop, setEditingStudent: noop,
    setProductivitySidebarTab: noop,
    openEditModal: noop, getParentOutstandingBalance: () => 0,
    ...extra,
  };
}

describe('AppModals porté', () => {
  it('rend le shell avec le panneau Productivité ouvert', () => {
    const props = baseProps({
      showTodoSidebar: true,
      showStudentModal: false, showParentModal: false, showStaffModal: false,
      showExpenseModal: false, showVendorExpenseModal: false, showSalaryModal: false,
      showPaymentForm: false, showCalendarModal: false, showAddClassModal: false,
      showEditClassModal: false, showLinkStudentModal: false, showNotifyModal: false,
      showAuditModal: false, showSuccessToast: false,
    });
    const html = renderToString(createElement(AppModals, props as never));
    assert.ok(html.includes('productivity'), 'le panneau Productivité doit être rendu');
  });

  it('rend sans crash avec toutes les modales fermées', () => {
    const props = baseProps({
      showTodoSidebar: false,
      showStudentModal: false, showParentModal: false, showStaffModal: false,
      showExpenseModal: false, showVendorExpenseModal: false, showSalaryModal: false,
      showPaymentForm: false, showCalendarModal: false, showAddClassModal: false,
      showEditClassModal: false, showLinkStudentModal: false, showNotifyModal: false,
      showAuditModal: false, showSuccessToast: false,
    });
    const html = renderToString(createElement(AppModals, props as never));
    assert.ok(html.length > 0, 'le shell doit rendre quelque chose');
  });
});
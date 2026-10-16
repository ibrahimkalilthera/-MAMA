/**
 * appModalsProps — the AppModalsProps contract.
 *
 * Extracted verbatim from src/components/AppModals.tsx (split campaign, no
 * behavior change): the interface lives here; AppModals re-exports it so
 * existing `import type { AppModalsProps } from './AppModals'` call sites keep
 * working, and the wiring guard (scripts/check-component-props.mjs) resolves
 * it from THIS file.
 */
import type { Dispatch, SetStateAction, FormEvent } from 'react';
import type { LucideIcon } from 'lucide-react';
import type { Student, Staff, Parent, Todo, Expense, SalaryPayment, VendorExpense, Payment } from '../lib/useSupabaseData';
import type { CalendarEvent, CurrentTheme, ExpenseForm, ManagedClass, ParentForm, SalaryForm, StaffForm, StaffModalMode, VendorExpenseForm } from './mainViewsProps';
import type { TranslationDict } from '../i18n/translations';
import type { ReceiptDataOptions } from '../lib/pdfReceipt';
import type { PaymentMotif } from '../lib/paymentMotifs';
import type { StudentForm } from '../components/StudentFormModal';
import type { ClassForm } from '../components/AddClassModal';
export interface AppModalsProps {
  Bell: LucideIcon;
  Briefcase: LucideIcon;
  Calendar: LucideIcon;
  CheckCircle2: LucideIcon;
  CheckSquare: LucideIcon;
  Copy: LucideIcon;
  CreditCard: LucideIcon;
  DollarSign: LucideIcon;
  FileText: LucideIcon;
  Heart: LucideIcon;
  Layers: LucideIcon;
  MessageSquare: LucideIcon;
  Phone: LucideIcon;
  Plus: LucideIcon;
  Printer: LucideIcon;
  Receipt: LucideIcon;
  ShieldCheck: LucideIcon;
  Sparkles: LucideIcon;
  StickyNote: LucideIcon;
  Trash2: LucideIcon;
  TrendingUp: LucideIcon;
  Users: LucideIcon;
  X: LucideIcon;
  academicYears: string[];
  activeLinkingParent: Parent | null;
  aiInput: string;
  aiMessages: { sender: 'user' | 'assistant'; text: string }[];
  auditYear: string | null;
  availableClasses: ManagedClass[];
  copiedToast: boolean;
  copyToClipboard: (text: string) => void;
  currentMonth: number;
  /** Le millésime du MÊME instant que `currentMonth` (App.tsx) — RecordSalaryModal
   *  s'en sert pour ne pas compter un paiement du même mois d'une autre année. */
  currentYear: number;
  currentTheme: CurrentTheme;
  currentUser: { name?: string; role?: string; username?: string } | null;
  deleteStudent: (id: string) => Promise<boolean>;
  /**
   * Fusionne des fiches homonymes dans celle qui est GARDÉE (l'outil de
   * comparaison). Les reçus des fiches fusionnées changent de fiche, le solde
   * s'additionne, leurs notes sont recopiées, puis elles sont supprimées — une
   * seule entrée de journal (`MERGE_STUDENT`) porte les deux fiches. Demande le
   * RÉSEAU et rend `true` seulement si TOUT est passé.
   */
  mergeStudents: (survivorId: string, mergedIds: string[]) => Promise<boolean>;
  /** La fiche dont on compare les homonymes, ou `null` (aucune comparaison ouverte). */
  reviewStudent: Student | null;
  setReviewStudent: Dispatch<SetStateAction<Student | null>>;
  /**
   * Supprime UN paiement saisi par erreur (le seul recours était jusqu'ici de
   * supprimer l'élève entier). Ouvert à `admin`, `dev` ET `econome` par la policy
   * « Payment deleters delete payments » — l'écran gate le bouton sur
   * `canDeletePayment`, pas sur `canDelete` (qui reste réservé aux tables admin).
   */
  deletePayment: (studentId: string, payment: Payment) => Promise<boolean>;
  /**
   * Renseigne les mois qu'un reçu ANTÉRIEUR à la colonne `payments.months`
   * couvrait : sa couverture était inconnue, et ses réimpressions ne nommaient
   * que le mois de sa date. N'écrit QUE `months` — ni montant, ni date, ni reçu
   * (`updatePaymentMonths`, src/lib/dataOps/payments.ts).
   */
  updatePaymentMonths: (studentId: string, payment: Payment, months: string[]) => Promise<boolean>;
  deleteTodo: (id: string) => Promise<boolean>;
  editClassForm: ClassForm;
  editingParent: Parent | null;
  editingStaff: Staff | null;
  editingStudent: Student | null;
  editingVendorExpense: VendorExpense | null;
  expenseCategoryList: { key: string; label: string }[];
  expenseForm: ExpenseForm;
  formatCurrency: (amount: number) => string;
  formatDate: (dateStr: string) => string;
  generateInstallmentMemo: (staffId: string, amount: number) => void;
  generatePaymentReceiptPdf: (opts: ReceiptDataOptions) => Promise<void>;
  getDayName: (dayIndex: number) => string;
  getEventsForDay: (date: Date) => CalendarEvent[];
  /** Notes ⇄ Calendar bridge: dated notes for a day + the entry form state. */
  getNotesForDay: (date: Date) => { id: string; studentName?: string; text: string }[];
  noteText: string;
  savingNoteOnDate: boolean;
  saveNoteOnDate: (date: Date) => Promise<boolean>;
  setNoteText: Dispatch<SetStateAction<string>>;
  getGradeDisplay: (grade: string | undefined, currentLang?: 'en' | 'fr') => string;
  getParentOutstandingBalance: (parent: Parent) => number;
  getYearStats: (year: string) => { revenue: number; expenses: number; balance: number };
  handleAddTodo: (e: FormEvent) => Promise<void>;
  handleAiQuery: (queryText: string) => void;
  handleCopyNotifyMessage: () => void;
  handleCreateClassSubmit: (e?: FormEvent) => Promise<void>;
  handleEditClassSubmit: (e: FormEvent) => Promise<void>;
  handleExpenseSubmit: (e: FormEvent) => Promise<void>;
  handleLinkStudentSubmit: (e: FormEvent) => Promise<void>;
  handleNotifyTemplateChange: (newType: 'polite' | 'urgent' | 'detailed') => void;
  handleParentSubmit: (e: FormEvent) => Promise<void>;
  handlePaymentSubmit: (e: FormEvent) => Promise<void>;
  handleSalarySubmit: (e: FormEvent) => Promise<void>;
  handleSaveNote: (studentId: string, note: string, noteDate?: string) => Promise<void>;
  handleSendSMS: () => void;
  handleSendWhatsApp: () => void;
  handleStaffSubmit: (e: FormEvent) => Promise<void>;
  handleStudentSubmit: (e: FormEvent) => Promise<void>;
  handleVendorExpenseSubmit: (e: FormEvent) => Promise<void>;
  isPromoter: boolean;
  /** Même règle que les vues : la suppression demandée à la base est réservée
   *  aux administrateurs (`src/lib/deleteRights.ts`). */
  canDelete: boolean;
  /** Le droit de supprimer UN PAIEMENT a sa propre liste — `admin`, `dev` et
   *  `econome` (`src/lib/paymentRights.ts`), pas la même que `canDelete`. */
  canDeletePayment: boolean;
  /**
   * Le droit de RENSEIGNER les mois d'un reçu déjà enregistré — la policy
   * « Admin update payments » (`public.is_admin()`), donc `admin` et `dev`
   * (`src/lib/paymentRights.ts`). Plus ÉTROIT que `canDeletePayment` :
   * l'économe supprime un paiement sans pouvoir réécrire ses mois. C'est la
   * base, pas l'écran, qui tranche.
   */
  canEditPaymentMonths: boolean;
  /**
   * Le rôle peut-il REMETTRE une remise sur frais de scolarité ? — la surface
   * `scholarship-edit` (`src/app/sectionRights.ts`), décidée par
   * `public.is_finance_admin()` (`FINANCE_ADMIN_ROLES`, `src/lib/payrollRights.ts`).
   * La modale d'élève DEMANDE ce booléen : elle composait
   * `isPromoter || isGeneralManager`, sa propre copie de la liste des rôles.
   */
  canEditScholarship: boolean;
  lang: 'en' | 'fr';
  newClassForm: ClassForm;
  notifyCustomText: string;
  notifyParent: Parent | null;
  notifySelectedPhone: string;
  notifyTemplateType: 'polite' | 'urgent' | 'detailed';
  openEditModal: (student: Student) => void;
  parentForm: ParentForm;
  paymentAmount: string;
  paymentDate: string;
  /** Mois proposés au guichet — ceux de l'année scolaire de la date (`YYYY-MM`). */
  paymentMonthOptions: string[];
  /**
   * Ce que le paiement saisi RÈGLE (`scolarite` / `inscription`, voir
   * src/lib/paymentMotifs.ts) : c'est le mot que la ligne « Motif » du reçu
   * officiel imprime, et il part en base avec le geste — une réimpression doit
   * pouvoir le redire. L'inscription dispense de cocher un mois (droit d'entrée).
   */
  paymentMotif: PaymentMotif;
  setPaymentMotif: Dispatch<SetStateAction<PaymentMotif>>;
  /** Mois cochés pour ce paiement. */
  paymentMonths: string[];
  paymentStudentId: string;
  printStudentFile: Student | null;
  productivitySidebarTab: 'tasks' | 'ai';
  salaryForm: SalaryForm;
  salaryPayments: SalaryPayment[];
  schoolLogo: string | null;
  selectedCalendarDay: Date | null;
  /**
   * L'année scolaire ACTIVE (celle que l'en-tête montre) — la fiche élève s'en
   * sert comme recours quand l'élève n'en porte pas, pour afficher sa bande de
   * mois. Lue et non recalculée : deux « année courante » dans la même app
   * finiraient par diverger.
   */
  selectedYear: string;
  selectedStudent: Student | null;
  /**
   * Le reçu MUET sur lequel la fiche ouverte doit s'ouvrir, ou `null`. Posé par
   * l'écran École des reçus muets (`SilentReceiptsView`), il descend tel quel dans
   * `StudentDetailsModal.focusPaymentId` ; la fermeture de la fiche le remet à
   * zéro, pour qu'une ouverture ordinaire n'active rien.
   */
  studentFileFocus: string | null;
  setAiInput: Dispatch<SetStateAction<string>>;
  setEditClassForm: Dispatch<SetStateAction<ClassForm>>;
  setEditingVendorExpense: Dispatch<SetStateAction<VendorExpense | null>>;
  setExpenseForm: Dispatch<SetStateAction<ExpenseForm>>;
  setNewClassForm: Dispatch<SetStateAction<ClassForm>>;
  setNotifyCustomText: Dispatch<SetStateAction<string>>;
  setNotifySelectedPhone: Dispatch<SetStateAction<string>>;
  setParentForm: Dispatch<SetStateAction<ParentForm>>;
  setPaymentAmount: Dispatch<SetStateAction<string>>;
  setPaymentDate: Dispatch<SetStateAction<string>>;
  setPaymentStudentId: Dispatch<SetStateAction<string>>;
  setPrintStudentFile: Dispatch<SetStateAction<Student | null>>;
  setProductivitySidebarTab: Dispatch<SetStateAction<'tasks' | 'ai'>>;
  setSalaryForm: Dispatch<SetStateAction<SalaryForm>>;
  setSelectedStudent: Dispatch<SetStateAction<Student | null>>;
  /** Remet le focus de la fiche à zéro — la fermeture s'en sert (voir `close`). */
  setStudentFileFocus: Dispatch<SetStateAction<string | null>>;
  setShowAddClassModal: Dispatch<SetStateAction<boolean>>;
  setShowAuditModal: Dispatch<SetStateAction<boolean>>;
  setShowCalendarModal: Dispatch<SetStateAction<boolean>>;
  setShowEditClassModal: Dispatch<SetStateAction<boolean>>;
  setShowExpenseModal: Dispatch<SetStateAction<boolean>>;
  setShowLinkStudentModal: Dispatch<SetStateAction<boolean>>;
  setShowNotifyModal: Dispatch<SetStateAction<boolean>>;
  setShowParentModal: Dispatch<SetStateAction<boolean>>;
  setShowPaymentForm: Dispatch<SetStateAction<boolean>>;
  setShowSalaryModal: Dispatch<SetStateAction<boolean>>;
  setShowStaffModal: Dispatch<SetStateAction<boolean>>;
  setShowStudentModal: Dispatch<SetStateAction<boolean>>;
  setShowTodoSidebar: Dispatch<SetStateAction<boolean>>;
  setShowVendorExpenseModal: Dispatch<SetStateAction<boolean>>;
  setStaffForm: Dispatch<SetStateAction<StaffForm>>;
  setStudentDetailTab: Dispatch<SetStateAction<'general' | 'parent' | 'medical'>>;
  setStudentForm: Dispatch<SetStateAction<StudentForm>>;
  setStudentToLinkId: Dispatch<SetStateAction<string>>;
  setTicketStudent: Dispatch<SetStateAction<Student | null>>;
  setTodoInput: Dispatch<SetStateAction<string>>;
  setVendorExpenseForm: Dispatch<SetStateAction<VendorExpenseForm>>;
  showAddClassModal: boolean;
  showAuditModal: boolean;
  showCalendarModal: boolean;
  showEditClassModal: boolean;
  showExpenseModal: boolean;
  showLinkStudentModal: boolean;
  showNotifyModal: boolean;
  showParentModal: boolean;
  showPaymentForm: boolean;
  showSalaryModal: boolean;
  showStaffModal: boolean;
  showStudentModal: boolean;
  showSuccessToast: boolean;
  showTodoSidebar: boolean;
  showVendorExpenseModal: boolean;
  staff: Staff[];
  staffForm: StaffForm;
  staffModalMode: StaffModalMode;
  studentDetailTab: 'general' | 'parent' | 'medical';
  studentForm: StudentForm;
  studentToLinkId: string;
  students: Student[];
  t: TranslationDict;
  ticketStudent: Student | null;
  todoInput: string;
  todoDate: string;
  setTodoDate: Dispatch<SetStateAction<string>>;
  todos: Todo[];
  toggleTodo: (id: string) => Promise<void>;
  /** Coche/décoche un mois payé (voir src/lib/paymentMonths.ts). */
  togglePaymentMonth: (month: string) => void;
  handleUpdateTodoDate: (id: string, date: string) => Promise<boolean>;
  vendorExpenseForm: VendorExpenseForm;
  welcomeMessage: string | null;
}

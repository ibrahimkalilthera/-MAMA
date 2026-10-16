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
import type { ArchivedSalaryPayment } from '../lib/salaryUndo';
import type { AuthState, UserProfile } from '../lib/useAuth';
import type { SchoolNameSaveResult } from '../lib/schoolName';
import type { AuditLogEntry } from '../lib/auditLogger';
import type { TranslationDict } from '../i18n/translations';
import type { SchoolClass } from './types';
import type { CalendarDay } from '../lib/classes';
import type { PayslipDataOptions } from '../lib/pdfPayroll';
import type { ExpensesReportOptions } from '../lib/pdfExpensesReport';
import type { AppRole } from '../lib/useAuth';

/**
 * Les thèmes que l'application sait peindre.
 *
 * L'union est écrite à la main, et la LISTE qui va avec vit dans le module qui
 * peint les thèmes (`THEME_IDS`, src/app/useTheme.ts) : ce fichier-ci est
 * TYPES-ONLY — un `import` n'y a aucun effet d'exécution, et c'est une règle du
 * dépôt (tests/mainviews-props.test.ts la verrouille). Les deux ne peuvent pas
 * diverger : la liste est une carte totale sur ce type.
 */
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
   * L'ÉCHELLE DE SURVOL D'ÉTAT — les crans et leurs valeurs vivent dans
   * `src/themes/state-hover.css`, la garde qui interdit d'écrire la recette
   * soi-même est `scripts/check-state-hover.mjs`.
   *
   * Un survol de surface était une recette recopiée dans chaque composant :
   * `hover:bg-slate-50 dark:hover:bg-white/10`, `hover:bg-slate-100
   * dark:hover:bg-slate-800`, `hover:bg-rose-100 dark:hover:bg-rose-950/60`.
   * Aucun remap de thème ne les corrige (un remap ne connaît que ses propres
   * classes), donc un thème chaud avait des survols froids, et l'accent d'une
   * école — la couleur de son logo, décidée à l'exécution — n'atteignait aucun
   * d'eux. Ces jetons sont ces recettes, une fois.
   *
   *   · `hoverSurface`      — cran NEUTRE sur une surface de page (carte
   *                           cliquable, bouton fantôme, icône au repos
   *                           transparent) ; une RANGÉE de tableau prend
   *                           `rowHover`, le même cran sous son nom ;
   *   · `hoverSurfaceSolid` — le même pas sur un contrôle dont le REPOS est déjà
   *                           un remplissage neutre doux (`bg-slate-100
   *                           dark:bg-slate-800`) ;
   *   · `hoverSurfaceStrong`— le même pas sur un remplissage neutre FORT (le
   *                           bouton `bg-slate-800 dark:bg-slate-700`) ;
   *   · `hoverSurfaceDark`  — sur une surface TOUJOURS sombre ou COLORÉE (le
   *                           rail, un bandeau, un en-tête teinté) : un voile
   *                           blanc qui s'ajoute au repos ;
   *   · `hoverSurfaceClear` — sur un contrôle au repos BLANC OPAQUE posé sur un
   *                           APLAT COLORÉ (le bandeau de paie, la fiche
   *                           parent) : le seul pas lisible est que l'aplat
   *                           reparaisse sous lui (90 % d'opacité — un voile
   *                           blanc y serait invisible) ;
   *   · `hoverAccent`       — ACCENT : surface atténuée + encre d'accent ;
   *   · `hoverAccentGroupInk` — l'encre d'accent SEULE, quand l'ancêtre `.group`
   *                           est survolé (le chevron d'une carte) ;
   *   · `hoverAlert`        — ALERTE (geste destructif) : surface rose + encre
   *                           rose ;
   *   · `hoverAlertTint`    — la surface d'alerte seule (une rangée en retard se
   *                           teint sans repeindre l'encre de ses cellules) ;
   *   · `hoverAlertSolid`   — l'ombre d'un CTA destructif déjà plein (rose-500,
   *                           -600 ou -700) : elle assombrit SA teinte ;
   *   · `hoverAlertDark`    — ALERTE sur un chrome TOUJOURS sombre (la
   *                           déconnexion du rail) : un voile rose + l'encre
   *                           LEVÉE, les deux ensemble — le cran de page
   *                           poserait là une pastille pâle OPAQUE sous une
   *                           encre PROFONDE ;
   *   · `hoverAlertPlate`   — l'alerte SUR un aplat coloré (la corbeille du
   *                           bandeau payé), qui porte déjà son encre : la
   *                           surface seule, en voile.
   */
  hoverSurface: string;
  hoverSurfaceSolid: string;
  hoverSurfaceStrong: string;
  hoverSurfaceDark: string;
  hoverSurfaceClear: string;
  hoverAccent: string;
  hoverAccentGroupInk: string;
  hoverAlert: string;
  hoverAlertTint: string;
  hoverAlertSolid: string;
  hoverAlertDark: string;
  hoverAlertPlate: string;

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
  activeTab: 'dashboard' | 'students' | 'parents' | 'payroll' | 'expenses' | 'settings' | 'calendar' | 'notes' | 'archives' | 'silentReceipts' | 'audit' | 'paymentHistory';
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
  /**
   * Ouvre la comparaison des fiches qui partagent un nom ET une classe (voir
   * `src/lib/duplicateStudents.ts`) — l'écran où l'école tranche, avec ses deux
   * gestes : fusionner (`mergeStudents`) ou supprimer une fiche. On passe la
   * FICHE, pas le groupe : le groupe est recalculé à l'affichage.
   */
  openDuplicateReview: (student: Student) => void;
  deleteTodo: (id: string) => Promise<boolean>;
  /**
   * Retire le SEUL reçu fautif (montant saisi deux fois, mauvais élève), écrit
   * une entrée `DELETE_PAYMENT` au journal et redescend `students.amount_paid`.
   * L'Historique des paiements l'offre là où une caisse relit son geste.
   */
  deletePayment: (studentId: string, payment: Payment) => Promise<boolean>;
  /**
   * Retire un PAIEMENT DE SALAIRE fautif (mauvais membre, montant doublé, mois
   * payé deux fois) sans supprimer le membre — dont la clé étrangère est
   * `ON DELETE CASCADE`, ce qui emportait toute sa paie. Écrit une entrée
   * `DELETE_SALARY_PAYMENT` au journal, avec l'instantané qui rend le geste
   * annulable (`src/lib/salaryUndo.ts`). Le droit est celui de la base
   * (`canDeleteSalaryPayment`, « Finance admins delete salary_payments »).
   */
  deleteSalaryPayment: (payment: SalaryPayment) => Promise<boolean>;
  /**
   * Annule la suppression d'un salaire à partir de son instantané (le `metadata`
   * de l'entrée `DELETE_SALARY_PAYMENT`, relu par l'Historique des paiements).
   * Réinsère la ligne avec son id d'origine et écrit `RESTORE_SALARY_PAYMENT`.
   * Demande le réseau, comme la restauration d'un reçu.
   */
  restoreSalaryPayment: (archived: ArchivedSalaryPayment) => Promise<boolean>;
  /**
   * Retire le salaire choisi, en refusant un exercice CLOS et un rôle que la base
   * n'autorise pas — la même double garde que les dépenses. L'appelant reçoit le
   * geste fait (toast) ou rien du tout (refus annoncé), jamais un faux succès.
   */
  handleDeleteSalaryPayment: (payment: SalaryPayment) => Promise<void>;
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
  /**
   * Le rôle peut-il RENSEIGNER les mois d'un reçu déjà enregistré ? Décidé par la
   * BASE (`public.is_payment_month_editor()`, `src/lib/paymentRights.ts`), pas
   * par l'écran. C'est ce droit qui garde l'éditeur des mois et le parcours de
   * rattrapage — et l'écran École des reçus muets, qui ne fait que les MONTRER,
   * le lit pour DIRE qu'il manque au lieu de laisser croire qu'un clic ouvrira un
   * éditeur que la base refuserait.
   */
  canEditPaymentMonths: boolean;
  /**
   * Le rôle peut-il RETIRER un paiement de salaire fautif ? Décidé par la BASE
   * (`public.is_finance_admin()` : admin, dev, Gestionnaire Principal — la policy
   * « Finance admins delete salary_payments », voir `canDeleteSalaryPayments`
   * dans `src/lib/payrollRights.ts`). L'économe ENREGISTRE la paie sans pouvoir
   * la détruire : écrire et détruire ne sont pas le même droit.
   */
  canDeleteSalaryPayment: boolean;
  /**
   * Renseigne les mois qu'un reçu MUET couvrait — la fonction
   * `public.set_payment_months(uuid, text[])` de la base (un reçu par appel,
   * `months` seule colonne nommée) ou la file hors ligne. Rend `true` seulement
   * si le geste a abouti.
   *
   * La fiche l'utilise pour un reçu, et l'écran École des reçus muets pour une
   * PASSE groupée : plusieurs élèves d'une même classe, un seul choix de mois,
   * mais toujours **un appel par reçu** — il n'existe aucune écriture de masse de
   * `months`, et chaque appel laisse sa propre entrée au journal.
   */
  updatePaymentMonths: (studentId: string, payment: Payment, months: string[]) => Promise<boolean>;
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
  /**
   * Le nom de l'école — un FAIT de l'établissement, écrit une fois pour tout le
   * parc (`school.name` dans `app_settings`, voir `src/lib/schoolName.ts`).
   *
   * Il voyage avec chaque remontée de poste, à côté du nom de la machine : le
   * relevé de parc ne peut pas nommer l'école — l'identité d'un poste est
   * aléatoire et rangée sur le disque de ce poste —, donc le nom emprunte le
   * canal des incidents, celui qui nomme déjà les machines.
   *
   * `null` veut dire « rien de lu » : soit aucune école n'a encore déclaré son
   * nom, soit la lecture a échoué. C'est `schoolNameReadFailed` qui sépare les
   * deux — sans quoi un champ vide devant une lecture ratée inviterait à
   * réécrire un nom que l'école avait déjà publié.
   */
  schoolName: string | null;
  /** vrai quand la LECTURE du nom a échoué : `schoolName === null` ne dit alors rien. */
  schoolNameReadFailed: boolean;
  searchTerm: string;
  selectedYear: string;
  setActiveLinkingParent: Dispatch<SetStateAction<Parent | null>>;
  /**
   * L'onglet actif — le shell le porte déjà (`AppShell`, via `AppShellExtras`),
   * et le contrat le redéclare ici pour qu'une VUE puisse y RENVOYER : le tableau
   * de bord publie le compte des reçus muets et ouvre l'écran École d'un clic —
   * sans quoi le chiffre se lirait sans suite. Le type est celui du shell (une
   * fonction d'onglet, pas un `Dispatch<SetStateAction<…>>`) : la valeur vient de
   * `ShellDeps`, où le setter est déjà réduit à `(tab) => void`.
   */
  setActiveTab: (tab: 'dashboard' | 'students' | 'parents' | 'payroll' | 'expenses' | 'settings' | 'calendar' | 'notes' | 'archives' | 'silentReceipts' | 'audit' | 'paymentHistory') => void;
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
  /**
   * Nommer l'école (l'administration seule — `isAdminRole`). Rend `saved`,
   * `queued` (le poste est hors ligne : l'écriture attend son tour) ou `refused`
   * (rien n'a été écrit) : le bloc de réglage le DIT, il ne devine pas.
   */
  setSchoolName: (name: string) => Promise<SchoolNameSaveResult>;
  setSelectedCalendarDay: Dispatch<SetStateAction<Date | null>>;
  setSelectedDraftMonth: Dispatch<SetStateAction<number>>;
  setSelectedDraftYear: Dispatch<SetStateAction<number>>;
  setSelectedStudent: Dispatch<SetStateAction<Student | null>>;
  /**
   * Le reçu MUET sur lequel la fiche doit s'ouvrir — posé par l'écran École des
   * reçus muets juste AVANT `setSelectedStudent`, pour que la fiche naisse avec
   * son focus et ouvre son éditeur des mois au premier rendu. `null` = ouverture
   * ordinaire (liste des élèves, cloche, doublons). Toute fermeture de la fiche
   * le remet à zéro (AppModals) : rien ne se rejoue d'une ouverture à l'autre.
   */
  setStudentFileFocus: Dispatch<SetStateAction<string | null>>;
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
  /**
   * Poser un thème DONNÉ.
   *
   * Le type est volontairement étroit, et non `Dispatch<SetStateAction<ThemeId>>` :
   * depuis le 2026-10-19 ce poseur est aussi le point où un changement de thème
   * est PUBLIÉ en base (la copie qui voyage avec la sauvegarde, voir
   * src/app/useDisplayPreferences.ts), et une forme fonctionnelle
   * (`setTheme(prev => …)`) n'aurait aucune valeur concrète à publier. Aucun
   * appelant ne s'en servait ainsi — le sélecteur des Réglages passe un id.
   */
  setTheme: (theme: ThemeId) => void;
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

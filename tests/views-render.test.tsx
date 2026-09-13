import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { act, createElement, createRef, Suspense } from 'react';
import type { ReactNode } from 'react';
import { renderToString } from 'react-dom/server';
import { createRoot } from 'react-dom/client';
import { installDomGlobals } from './harness';
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
import { CalendarView } from '../src/components/CalendarView';
import { NotesView } from '../src/components/NotesView';
import { AuditView } from '../src/components/AuditView';
import { blockedAuditEntry } from '../src/lib/desktopUpdateReport';
import { SettingsView } from '../src/components/SettingsView';

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
    { name: 'CalendarView', node: createElement(CalendarView), expectedText: 'today' },
    { name: 'NotesView', node: createElement(NotesView), expectedText: 'notes' },
    { name: 'AuditView', node: createElement(AuditView), expectedText: 'refreshLogs' },
    { name: 'SettingsView', node: createElement(SettingsView), expectedText: 'systemLanguage' },
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

  it('PayrollView affiche le compteur de membres de l\'administration à côté de la recherche', () => {
    const staff = [
      { id: 's1', name: 'Mariam Coulibaly', position: 'Proviseur', salary: 250000, email: '', phone: '', bankDetails: '', emergencyContact: '' },
      { id: 's2', name: 'Awa Traoré', position: 'Enseignante', salary: 75000, email: '', phone: '', bankDetails: '', emergencyContact: '' },
    ];
    const html = renderWithContext(createElement(PayrollView), { staff, filteredStaff: staff, adminStaffCount: 1 });
    const singular = translations.en.adminMembersSingular.replace('{count}', '1');
    assert.ok(html.includes(singular), `chip singulier attendu : "${singular}"`);
    assert.ok(!html.includes(translations.en.adminMembersPlural.replace('{count}', '1')), 'pas de forme plurielle pour 1');

    const htmlZero = renderWithContext(createElement(PayrollView));
    const pluralZero = translations.en.adminMembersPlural.replace('{count}', '0');
    assert.ok(htmlZero.includes(pluralZero), `chip zéro attendu : "${pluralZero}"`);
  });

  it('PayrollView affiche le filtre de poste avec les quatre options', () => {
    const html = renderWithContext(createElement(PayrollView));
    assert.ok(html.includes(translations.en.staffFilterAll), 'option tout le personnel');
    assert.ok(html.includes(translations.en.staffFilterAdmin), 'option administration');
    assert.ok(html.includes(translations.en.staffFilterEmployees), 'option employés');
    assert.ok(html.includes(translations.en.staffFilterTechnique), 'option centre technique');
    assert.ok(html.includes(translations.en.staffPositionFilterLabel), 'aria-label du filtre');
  });

  it('PayrollView affiche le badge admin uniquement pour les postes ADMIN_POSITIONS', () => {
    const staff = [
      { id: 's1', name: 'Mariam Coulibaly', position: 'Proviseur', salary: 250000, email: '', phone: '', bankDetails: '', emergencyContact: '' },
      { id: 's2', name: 'Awa Traoré', position: 'Enseignante', salary: 75000, email: '', phone: '', bankDetails: '', emergencyContact: '' },
    ];
    const html = renderWithContext(createElement(PayrollView), { staff, filteredStaff: staff });
    assert.ok(html.includes('Mariam Coulibaly') && html.includes('Awa Traoré'), 'both members rendered');
    const badgeLabel = translations.en.admin; // "Admin"
    const badgeCount = html.split(`>${badgeLabel}</span>`).length - 1;
    assert.equal(badgeCount, 1, 'un seul badge admin — Proviseur, pas Enseignante');
  });

  it('ExpensesView affiche le bouton « Ajouter une dépense » pour un rôle finance et le masque pour les autres', () => {
    const visible = renderWithContext(createElement(ExpensesView)); // makeProps: isPromoter=true
    assert.ok(visible.includes(translations.en.addExpense), 'bouton visible pour le promoteur/admin');

    const hidden = renderWithContext(createElement(ExpensesView), { isPromoter: false, isGeneralManager: false });
    assert.ok(!hidden.includes(translations.en.addExpense), 'bouton masqué pour un rôle non finance');
  });

  it('ExpensesView : cliquer « Ajouter une dépense » ouvre ExpenseFormModal avec le formulaire pré-rempli', async () => {
    const win = installDomGlobals();
    const container = win.document.createElement('div');
    win.document.body.appendChild(container);
    const root = createRoot(container as unknown as Element);

    const opened: boolean[] = [];
    const prefilled: unknown[] = [];
    try {
      await act(async () => {
        root.render(
          createElement(
            MainViewsContext.Provider,
            {
              value: makeProps({
                setShowExpenseModal: (v: boolean | ((prev: boolean) => boolean)) => opened.push(v as boolean),
                setExpenseForm: (f) => prefilled.push(f),
              }),
            },
            createElement(ExpensesView)
          )
        );
      });

      const buttons = [...container.querySelectorAll('button')];
      const addBtn = buttons.find((b) => b.textContent?.includes(translations.en.addExpense));
      assert.ok(addBtn, 'le bouton « Ajouter une dépense » est rendu');

      await act(async () => {
        addBtn.click();
      });

      assert.deepEqual(opened, [true], 'setShowExpenseModal(true) appelé au clic');
      assert.equal(prefilled.length, 1, 'setExpenseForm appelé pour pré-remplir');
      const form = prefilled[0] as { category: string; description: string; amount: string; date: string };
      assert.equal(form.category, 'Other');
      assert.equal(form.description, '');
      assert.equal(form.amount, '');
      assert.equal(form.date, new Date().toISOString().split('T')[0], 'date du jour pré-remplie');
    } finally {
      await act(async () => root.unmount());
      container.remove();
    }
  });

  // ─── Le regroupement par incident, exercé SUR LA VUE ──────────────────────
  //
  // Ces trois cas remplacent des assertions par expression régulière sur le
  // source d'AuditView.tsx (`useState(true)`, `incident.reports.map`,
  // `viewRows.map((row) => row.kind === 'incident'`), qui ne prouvaient rien :
  // elles restaient vertes même si la vue n'affichait plus rien. Ici on rend la
  // vue avec de VRAIS rapports produits par le module de remontée, on déplie, on
  // exporte — et on lit ce qui sort. « Rien ne suit » n'est donc plus vert.
  const blockedReport = (station: string, at: string): AuditLogEntry => {
    const entry = blockedAuditEntry(
      {
        blocked: {
          code: 'download',
          detail: 'Cannot download "MamaTheraFinance-2.0.0-setup.exe", status 404',
          station,
          journal: 'C:/Users/x/update-journal.jsonl',
          recorded: true,
        },
        version: '2.0.0',
        currentVersion: '1.0.5',
      },
      { station }
    );
    assert.ok(entry, 'le producteur doit rendre un rapport pour un poste bloqué');
    return {
      id: `live-${station}-${at}`,
      action: entry.action,
      targetType: entry.targetType,
      targetId: entry.targetId ?? undefined,
      details: entry.details,
      createdAt: at,
    };
  };

  const blockedLogs = () => [
    blockedReport('POSTE-A', '2026-09-13T08:00:00.000Z'),
    blockedReport('POSTE-B', '2026-09-13T09:00:00.000Z'),
  ];

  /** Monte AuditView dans happy-dom. `fn` voit le conteneur, le root est démonté. */
  const withAuditDom = async (
    logs: AuditLogEntry[],
    fn: (ctx: { container: HTMLElement; win: ReturnType<typeof installDomGlobals> }) => Promise<void> | void
  ) => {
    const win = installDomGlobals();
    const container = win.document.createElement('div');
    win.document.body.appendChild(container);
    const root = createRoot(container as unknown as Element);
    try {
      await act(async () => {
        root.render(
          createElement(
            MainViewsContext.Provider,
            { value: makeProps({ auditLogs: logs }) },
            createElement(AuditView)
          )
        );
      });
      // happy-dom's HTMLElement n'est pas celui de lib.dom : le conteneur est
      // rendu au cas sous le type du DOM standard (mêmes méthodes utilisées).
      await fn({ container: container as unknown as HTMLElement, win });
    } finally {
      await act(async () => root.unmount());
      container.remove();
    }
  };

  it('AuditView : deux postes, une panne → UN incident, remontées brutes repliées puis dépliées', async () => {
    await withAuditDom(blockedLogs(), async ({ container }) => {
      const rows = container.querySelectorAll('tbody tr');
      assert.equal(rows.length, 1, 'deux postes bloqués par la même panne → une seule ligne affichée');
      assert.ok(container.innerHTML.includes(translations.en.auditIncidentAction.replace('{code}', 'download')));
      assert.ok(container.innerHTML.includes(translations.en.auditIncidentStations), 'le compte est étiqueté');
      assert.match(container.innerHTML, />2</, 'les deux postes sont comptés sur la ligne');
      assert.ok(
        container.innerHTML.includes('POSTE-A') && container.innerHTML.includes('POSTE-B'),
        'les postes touchés sont nommés'
      );
      assert.ok(
        !container.innerHTML.includes('update-journal.jsonl'),
        'les remontées brutes restent repliées tant qu’on ne demande rien'
      );

      const toggle = [...container.querySelectorAll('button')].find(
        (b) => b.getAttribute('aria-label') === translations.en.auditIncidentShow
      );
      assert.ok(toggle, 'le dépliage est nommé (donc annoncé aux lecteurs d’écran)');
      assert.equal(toggle.getAttribute('aria-expanded'), 'false');

      await act(async () => {
        toggle.click();
      });
      assert.ok(
        container.innerHTML.includes('update-journal.jsonl'),
        'déplié, l’incident rend les remontées brutes — rien n’est caché à l’administrateur'
      );
      assert.ok(
        [...container.querySelectorAll('button')].some(
          (b) => b.getAttribute('aria-label') === translations.en.auditIncidentHide
        ),
        'l’état déplié est annoncé'
      );
    });
  });

  it('l’export CSV suit la vue : regroupé, une ligne par incident ; dégroupé, une par poste', async () => {
    const blobs: Blob[] = [];
    const url = globalThis.URL as unknown as Record<string, unknown>;
    const realCreate = url.createObjectURL;
    const realRevoke = url.revokeObjectURL;
    url.createObjectURL = (blob: Blob) => {
      blobs.push(blob);
      return 'blob:probe';
    };
    url.revokeObjectURL = () => {};
    try {
      await withAuditDom(blockedLogs(), async ({ container, win }) => {
        // Le clic du lien de téléchargement est neutralisé : on ne teste pas la
        // navigation, on teste les OCTETS que la vue produit.
        const realAnchorClick = win.HTMLAnchorElement.prototype.click;
        win.HTMLAnchorElement.prototype.click = () => {};
        try {
          const buttons = [...container.querySelectorAll('button')];
          const exportBtn = buttons.find((b) => b.textContent?.includes(translations.en.exportCsv));
          assert.ok(exportBtn, 'le bouton d’export existe');

          await act(async () => {
            exportBtn.click();
          });
          const grouped = await blobs[0].text();
          assert.equal(grouped.split('\r\n').length, 2, 'en-tête + UNE ligne : le CSV ne redonne pas les postes regroupés');
          assert.equal((grouped.match(/POSTE-A/g) ?? []).length, 1, 'le poste n’apparaît qu’une fois, dans le résumé');

          const groupToggle = buttons.find((b) =>
            b.textContent?.includes(translations.en.auditFilterGroupIncidents)
          );
          assert.ok(groupToggle, 'le regroupement se désactive depuis la vue');
          await act(async () => {
            groupToggle.click();
          });
          await act(async () => {
            exportBtn.click();
          });
          const ungrouped = await blobs[1].text();
          assert.equal(ungrouped.split('\r\n').length, 3, 'dégroupé : en-tête + deux postes');
        } finally {
          win.HTMLAnchorElement.prototype.click = realAnchorClick;
        }
      });
    } finally {
      url.createObjectURL = realCreate;
      url.revokeObjectURL = realRevoke;
    }
  });

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

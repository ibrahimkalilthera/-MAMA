// Regression test for the AppShell extraction: the shell must mount
// EnvBadge, OfflineBanner and ToastContainer EXACTLY ONCE. The original
// extraction left a duplicated overlay block (top + bottom of the shell),
// which made every toast/badge render twice — fixed by removing the stale
// trio, locked here so it can never come back.
//
// Each overlay has a unique z-index marker (z-[9997] EnvBadge, z-[9998]
// OfflineBanner, z-[9999] ToastContainer) — counting those markers in the
// real mounted DOM is the assertion. Content is forced visible (env 'dev',
// pendingQueueCount > 0, one toast) so an absent component cannot pass
// vacuously, and the toast message is also counted to catch double cards.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { act, createElement, useState } from 'react';
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';
import type { LucideIcon } from 'lucide-react';
import { translations } from '../src/i18n/translations';
import { AppShell } from '../src/components/AppShell';
import { DensityContext } from '../src/app/densityContext';
import { IconGlassContext } from '../src/app/iconGlassContext';
import type { CurrentTheme } from '../src/app/mainViewsProps';
import { installDomGlobals } from './harness';
import {
  APPSHELL_SLOTS,
  APPSHELL_SLOT_PREFIX,
  APPSHELL_ENV_BADGE_SLOT,
  APPSHELL_OFFLINE_BANNER_SLOT,
  APPSHELL_TOASTS_SLOT,
} from '../scripts/lib/appshell-slots.mjs';
import { slotSelector, slotPrefixSelector } from '../scripts/lib/slot-selector.mjs';

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
  accentText: 'text-white',
  accentHover: 'hover:bg-emerald-100',
  accentGroupHover: 'accent-group-hover',
  accentShadow: 'shadow-emerald-200',
  accentSoft: 'bg-emerald-50',
  accentSoftText: 'text-emerald-600',
  accentSoftHover: 'hover:bg-emerald-100', accentSoftTextHover: 'hover:text-emerald-700',
  accentHex: '#059669',
  accentHexDeep: '#047857',
  
  accentRing: 'focus:ring-emerald-500/20',
  accentBorder: 'border-slate-300',
  accentBorderHover: 'hover:border-slate-400',
  surfaceInset: 'bg-slate-50',
  
  inkStrong: 'text-slate-800',
  accentSoftDark: 'bg-blue-500/15',
  accentSoftDarkHover: 'hover:bg-blue-500/25',
  accentSoftDarkText: 'text-blue-300',
  tableHeader: 'bg-slate-100',
  rowHover: 'hover:bg-slate-50',
  hoverSurface: 'state-hover',
  hoverSurfaceSolid: 'state-hover-solid',
  hoverSurfaceStrong: 'state-hover-strong',
  hoverSurfaceDark: 'state-hover-dark',
  hoverSurfaceClear: 'state-hover-clear',
  hoverAccent: 'state-accent-hover',
  hoverAccentGroupInk: 'state-accent-group-ink',
  hoverAlert: 'state-alert-hover',
  hoverAlertTint: 'state-alert-tint',
  hoverAlertSolid: 'state-alert-solid',
  hoverAlertDark: 'state-alert-dark',
  hoverAlertPlate: 'state-alert-plate',
  input: 'bg-white',
  isDark: false,
};

const noop = () => {};
const asyncNoop = async () => {};
const icon = (() => null) as unknown as LucideIcon;

const TOAST_MESSAGE = 'Toast de test — rendu unique';

// Les régions et panneaux que le shell DOIT monter, dans l'ordre du DOM, vivent
// dans la table partagée `scripts/lib/appshell-slots.mjs` (`APPSHELL_SLOTS`) : le
// test les LIT, il ne les recopie pas — un nom qui divergerait du composant est
// impossible à écrire ici. La preuve croisée (table ↔ composants déclarants) vit
// dans `scripts/check-data-slots.mjs`.

/** Props du shell : union MainViewsProps & AppModalsProps & AppShellExtras. */
function shellProps(): Record<string, unknown> {
  return {
    // ── AppShellExtras ──
    authLoading: false,
    supabaseLoading: false,
    supabaseError: null,
    fetchAll: asyncNoop,
    appEnv: 'dev', // force le badge DEV visible
    toast: {
      toasts: [{ id: 't1', type: 'error', message: TOAST_MESSAGE }],
      removeToast: noop,
    },
    setActiveTab: noop,
    openAddStudentModal: noop,
    setSelectedYear: noop,
    setSearchTerm: noop,
    studentGradeFilter: '',
    setStudentGradeFilter: noop,
    setIsPromotionWizardOpen: noop,
    setShowExcelImport: noop,
    generateMultiYearReportPdf: asyncNoop,
    lockedYears: [],
    vendorExpensesTab: 'general',
    handleExport: noop,
    generateFinancialReportPdf: asyncNoop,
    notifications: [],
    readNotificationIds: [],
    deletedNotificationIds: [],
    markNotificationRead: noop,
    markAllNotificationsRead: noop,
    markNotificationUnread: noop,
    deleteNotification: noop,
    clearAllNotifications: noop,
    restoreDeletedNotifications: noop,
    openCalendarOnDate: noop,
    handleCloseCurrentYear: asyncNoop,
    setAuditYear: noop,
    isFloatingChatOpen: false,
    setIsFloatingChatOpen: noop,
    floatingChatMessages: [],
    floatingChatInput: '',
    setFloatingChatInput: noop,
    handleFloatingAiQuery: noop,
    isPromotionWizardOpen: false,
    batchPromoteStudents: asyncNoop,
    showAddUserModal: false,
    showExcelImport: false,
    batchImportData: asyncNoop,
    showMonthlyDraftModal: false,
    selectedDraftMonth: 0,
    selectedDraftYear: 2026,
    handleExportMonthlyPayrollExcel: asyncNoop,
    pendingQueueCount: 2, // force la bannière offline visible (ligne en attente)
    isSyncing: false,
    syncOfflineQueue: asyncNoop,
    confirmAction: null,
    setConfirmAction: noop,
    inactivity: { warningOpen: false, remainingSeconds: 0, reset: noop },

    // ── champs lus par le shell et ses enfants directs ──
    t,
    lang: 'fr' as const,
    toggleLanguage: noop,
    currentTheme: theme,
    theme: 'emerald',
    ticketStudent: null,
    // L'état de rapprochement : fermé par défaut (aucun papier monté), et la
    // fonction de classe sans laquelle le papier ne peut pas s'écrire.
    reconcileStudent: null,
    setReconcileStudent: noop,
    getGradeDisplay: (grade: string | undefined) => (grade ? `Classe ${grade}` : '—'),
    formatDate: (d: string) => d,
    schoolLogo: null,
    currentUser: { name: 'Admin', role: 'admin' },
    auth: { signIn: asyncNoop, signOut: noop, createStaffUser: asyncNoop, fetchAllProfiles: asyncNoop },
    activeTab: 'dashboard',
    payrollWindowStatus: { isOpen: false, label: '' },
    fetchAuditLogs: asyncNoop,
    showTodoSidebar: false,
    setShowTodoSidebar: noop,
    setShowPaymentForm: noop,
    selectedYear: '2026-2027',
    academicYears: ['2026-2027'],
    availableClasses: [],
    searchTerm: '',
    students: [],
    expenses: [],
    vendorExpenses: [],
    salaryPayments: [],
    staff: [],
    handlePrint: noop,
    setSelectedStudent: noop,
    getYearStats: () => ({ revenue: 0, expenses: 0, balance: 0 }),
    formatCurrency: (n: unknown) => `${n} XOF`,
    setSalaryForm: noop,
    setShowSalaryModal: noop,
    setUserProfiles: noop,
    setSelectedDraftMonth: noop,
    setSelectedDraftYear: noop,
    setShowMonthlyDraftModal: noop,
    generateExpensesReportPdf: asyncNoop,

    // ── icônes (contrat MainViews/AppModals) ──
    Bell: icon, Briefcase: icon, Calendar: icon, CheckCircle2: icon, CheckSquare: icon,
    Copy: icon, CreditCard: icon, DollarSign: icon, FileText: icon, Globe: icon,
    Heart: icon, Layers: icon, MessageSquare: icon, Phone: icon, Plus: icon,
    Printer: icon, Receipt: icon, ShieldCheck: icon, Sparkles: icon, StickyNote: icon,
    Trash2: icon, TrendingUp: icon, Users: icon, X: icon,

    // ── viewsProps (MainViews & AppModals — lazy, rendu en fallback ici) ──
    viewsProps: {
      Bell: icon, Briefcase: icon, Calendar: icon, CheckCircle2: icon, CheckSquare: icon,
      Copy: icon, CreditCard: icon, DollarSign: icon, FileText: icon, Globe: icon,
      Heart: icon, Layers: icon, MessageSquare: icon, Phone: icon, Plus: icon,
      Printer: icon, Receipt: icon, ShieldCheck: icon, Sparkles: icon, StickyNote: icon,
      Trash2: icon, TrendingUp: icon, Users: icon, X: icon,
      t,
      currentTheme: theme,
      lang: 'fr' as const,
      currentMonth: 0,
      currentYear: 2026,
      academicYears: ['2026-2027'],
      availableClasses: [],
      students: [],
      staff: [],
      salaryPayments: [],
      expenses: [],
      vendorExpenses: [],
      todos: [],
      aiMessages: [],
      aiInput: '',
      todoInput: '',
      todoDate: '',
      noteText: '',
      savingNoteOnDate: false,
      notifyCustomText: '',
      notifyTemplateType: 'whatsapp',
      copiedToast: false,
      expenseForm: { category: '', description: '', amount: '', date: '' },
      parentForm: { fullName: '', primaryPhone: '', secondaryPhone: '', email: '', address: '', occupation: '', relationship: '', notes: '', linkedStudentIds: [] },
      salaryForm: { staffId: '', amount: '', date: '' },
      staffForm: { name: '', role: 'staff', phone: '', salary: '', joinedDate: '' },
      vendorExpenseForm: { vendorName: '', category: '', amount: '', amountPaid: '', dueDate: '', paymentStatus: 'unpaid' },
      newClassForm: { name: '', cycle: 'other' },
      editClassForm: { name: '', cycle: 'other' },
      auditYear: null,
      selectedStudent: null,
      editingStudent: null,
      editingStaff: null,
      editingParent: null,
      editingVendorExpense: null,
      activeLinkingParent: null,
      studentToLinkId: '',
      studentDetailTab: 'overview',
      paymentStudentId: '',
      paymentAmount: '',
      paymentDate: '',
      studentForm: { name: '', grade: '', parentName: '', parentPhone: '', totalDue: '', amountPaid: '' },
      currentUser: { name: 'Admin', role: 'admin' },
      formatCurrency: (n: number) => `${n} XOF`,
      formatDate: (d: string) => d,
      // Les fenêtres montées par AppModals lisent la classe ici : sans elle, la
      // fiche élève ne peut pas s'écrire et tombe dans le garde-fou.
      getGradeDisplay: (grade: string | undefined) => (grade ? `Classe ${grade}` : '—'),
      getDayName: (i: number) => String(i),
      getEventsForDay: () => [],
      getNotesForDay: () => [],
      getYearStats: () => ({ revenue: 0, expenses: 0, balance: 0 }),
      generateInstallmentMemo: noop,
      generatePaymentReceiptPdf: asyncNoop,
      handleStudentSubmit: asyncNoop,
      handleParentSubmit: asyncNoop,
      handleStaffSubmit: asyncNoop,
      handleExpenseSubmit: asyncNoop,
      handleVendorExpenseSubmit: asyncNoop,
      handleSalarySubmit: asyncNoop,
      handlePaymentSubmit: asyncNoop,
      handleCreateClassSubmit: asyncNoop,
      handleEditClassSubmit: asyncNoop,
      handleLinkStudentSubmit: asyncNoop,
      handleNotifyTemplateChange: noop,
      handleCopyNotifyMessage: noop,
      handleSendSMS: noop,
      handleSendWhatsApp: noop,
      handleAddTodo: asyncNoop,
      toggleTodo: asyncNoop,
      deleteTodo: asyncNoop,
      handleUpdateTodoDate: asyncNoop,
      handleAiQuery: asyncNoop,
      handleSaveNote: asyncNoop,
      saveNoteOnDate: asyncNoop,
      deleteStudent: asyncNoop,
      setStudentForm: noop,
      setStaffForm: noop,
      setParentForm: noop,
      setExpenseForm: noop,
      setVendorExpenseForm: noop,
      setSalaryForm: noop,
      setPaymentAmount: noop,
      setPaymentDate: noop,
      setPaymentStudentId: noop,
      setNewClassForm: noop,
      setEditClassForm: noop,
      setSelectedStudent: noop,
      setStudentDetailTab: noop,
      setAuditYear: noop,
      setAiInput: noop,
      setTodoInput: noop,
      setTodoDate: noop,
      setNoteText: noop,
      setNotifyCustomText: noop,
      setNotifySelectedPhone: noop,
      setStudentToLinkId: noop,
      setShowStudentModal: noop,
      setShowParentModal: noop,
      setShowStaffModal: noop,
      setStaffModalMode: noop,
      setShowExpenseModal: noop,
      setShowVendorExpenseModal: noop,
      setShowSalaryModal: noop,
      setShowPaymentForm: noop,
      setShowCalendarModal: noop,
      setShowAddClassModal: noop,
      setShowEditClassModal: noop,
      setShowLinkStudentModal: noop,
      setShowNotifyModal: noop,
      setShowAuditModal: noop,
      setShowTodoSidebar: noop,
      setPrintStudentFile: noop,
      setTicketStudent: noop,
      setEditingStaff: noop,
      setEditingParent: noop,
      setEditingVendorExpense: noop,
      setEditingStudent: noop,
      setProductivitySidebarTab: noop,
      openEditModal: noop,
      getParentOutstandingBalance: () => 0,
      fetchAuditLogs: asyncNoop,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      Suspense: ({ children }: any) => children,
    },
  };
}

describe('AppShell — overlays rendus une seule fois', () => {
  const win = installDomGlobals({
    extra: {
      requestAnimationFrame: (cb: FrameRequestCallback): number =>
        setTimeout(() => cb(performance.now()), 16) as unknown as number,
      cancelAnimationFrame: (id: number): void => clearTimeout(id),
    },
  });
  // WAAPI : le ticker de happy-dom n'avance jamais — animations instantanées.
  const finishedAnimation = {
    finished: Promise.resolve(),
    currentTime: 0,
    playState: 'finished',
    effect: null,
    onfinish: null,
    oncancel: null,
    play: () => {},
    pause: () => {},
    cancel: () => {},
    finish: () => {},
    reverse: () => {},
    commitStyles: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
  };
  win.Element.prototype.animate = (() => finishedAnimation) as unknown as typeof win.Element.prototype.animate;
  win.Element.prototype.getAnimations = (() => []) as unknown as typeof win.Element.prototype.getAnimations;
  (win.HTMLElement.prototype as { animate?: unknown }).animate = finishedAnimation;

  it('En vBadge, OfflineBanner et ToastContainer apparaissent chacun exactement une fois', async () => {
    const container = win.document.createElement('div');
    win.document.body.appendChild(container);
    const root: Root = createRoot(container as unknown as Element);

    await act(async () => {
      root.render(createElement(AppShell, shellProps() as never));
    });

    // Chaque overlay porte un MARQUEUR STABLE (`data-slot`) — on compte SES
    // occurrences, jamais un z-index ni une classe de mise en page : le test ne
    // doit ni casser ni rester vert parce qu'un z-index a bougé.
    const envBadges = container.querySelectorAll(slotSelector(APPSHELL_ENV_BADGE_SLOT));
    const offlineBanners = container.querySelectorAll(slotSelector(APPSHELL_OFFLINE_BANNER_SLOT));
    const toastContainers = container.querySelectorAll(slotSelector(APPSHELL_TOASTS_SLOT));

    assert.equal(envBadges.length, 1, `EnvBadge rendu ${envBadges.length} fois (attendu 1)`);
    assert.equal(offlineBanners.length, 1, `OfflineBanner rendu ${offlineBanners.length} fois (attendu 1)`);
    assert.equal(toastContainers.length, 1, `ToastContainer rendu ${toastContainers.length} fois (attendu 1)`);

    // Contenu réellement visible (pas de rendu vide qui passerait à vide) :
    assert.ok(envBadges[0].textContent?.includes('DEV'), 'EnvBadge doit afficher DEV');
    assert.ok(offlineBanners[0].textContent?.includes(String(2)), 'OfflineBanner doit afficher le nombre de lignes en attente');
    assert.ok(toastContainers[0].textContent?.includes(TOAST_MESSAGE), 'ToastContainer doit afficher le message du toast');

    // Un double ToastContainer produirait DEUX cartes avec le même message :
    const messageCount = container.textContent?.split(TOAST_MESSAGE).length ?? 1;
    assert.equal(messageCount, 2, `le message du toast apparaît ${messageCount - 1} fois (attendu 1)`);

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  it('la composition du shell est verrouillée : chaque panneau monté, dans l’ordre (data-slot)', async () => {
    const container = win.document.createElement('div');
    win.document.body.appendChild(container);
    const root: Root = createRoot(container as unknown as Element);

    // On force l'année sélectionnée à être VERROUILLÉE : sans cela le bandeau
    // « année clôturée » rend `null` et le cas passerait sur un panneau absent.
    // Les autres panneaux conditionnels (bannière hors ligne, badge d'env,
    // toasts) sont déjà rendus visibles par shellProps().
    const props = { ...shellProps(), lockedYears: ['2026-2027'] };
    await act(async () => {
      root.render(createElement(AppShell, props as never));
    });

    const slots = Array.from(container.querySelectorAll(slotPrefixSelector(APPSHELL_SLOT_PREFIX))).map(
      (el) => el.getAttribute('data-slot'),
    );
    assert.deepEqual(
      slots,
      APPSHELL_SLOTS,
      'le shell monte chaque région et chaque panneau, dans l’ordre du DOM — un retrait ou une inversion tombe ici',
    );
    assert.equal(
      new Set(slots).size,
      slots.length,
      'chaque marqueur est UNIQUE : deux panneaux ne peuvent pas se confondre',
    );

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  it('la densité des tableaux choisie est portée par la racine (density-compact)', async () => {
    const container = win.document.createElement('div');
    win.document.body.appendChild(container);
    const root: Root = createRoot(container as unknown as Element);

    await act(async () => {
      root.render(
        createElement(
          DensityContext.Provider,
          { value: { density: 'compact', setDensity: noop } },
          createElement(AppShell, shellProps() as never),
        ),
      );
    });

    const shell = container.querySelector('[data-slot="app-shell"]');
    assert.ok(shell, 'la racine du shell est rendue');
    assert.ok(
      shell.classList.contains('density-compact'),
      'la classe que le CSS `.density-compact` cible est posée sur la racine',
    );

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  it('la dose de verre des icônes choisie est portée par la racine (icon-glass-*)', async () => {
    // La couche `src/themes/icons.css` ne connaît pas les doses : elle dose ses
    // VARIABLES depuis une seule classe, celle-ci. Si la racine cessait de la
    // porter, les trois doses redeviendraient « animé » — et le réglage des
    // Préférences mentirait sans qu'aucun test ne rougisse.
    const container = win.document.createElement('div');
    win.document.body.appendChild(container);
    const root: Root = createRoot(container as unknown as Element);

    await act(async () => {
      root.render(
        createElement(
          IconGlassContext.Provider,
          { value: { iconGlass: 'crisp', setIconGlass: noop } },
          createElement(AppShell, shellProps() as never),
        ),
      );
    });

    const shell = container.querySelector('[data-slot="app-shell"]');
    assert.ok(shell, 'la racine du shell est rendue');
    assert.ok(
      shell.classList.contains('icon-glass-crisp'),
      'la classe que la couche `.icon-glass-*` cible est posée sur la racine',
    );
    assert.equal(
      [...shell.classList].filter((name) => name.startsWith('icon-glass-')).length,
      1,
      'et UNE seule : deux doses à la fois n’en doseraient aucune',
    );

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  it('la pastille des reçus muets est DÉRIVÉE une fois et remise AUX DEUX navigations', async () => {
    // Le chiffre de la pastille est celui de l'ÉCOLE : il se calcule dans le shell
    // sur la brique pure de l'onglet École, et se remet au rail (bureau) comme à
    // la barre du bas (terrain). Ce cas mesure les deux MOITIÉS de la règle déjà
    // écrite pour l'archive en attente : le nombre est le bon, et en rater une
    // des deux surfaces tombe ici.
    const label = (count: number) => t.silentReceiptsBadge.replace('{count}', String(count));
    const silentReceipt = (id: string, date: string) => ({ id, date, amount: 25000 });
    const declaredReceipt = (id: string, date: string) => ({ id, date, amount: 25000, months: ['2026-09'] });
    const student = (id: string, payments: unknown[]) => ({
      id, name: `Élève ${id}`, parentName: `Parent ${id}`, parentEmail: '', parentPhone: '',
      totalDue: 150000, amountPaid: 25000, dueDate: '2027-06-30', notes: '',
      payments, grade: '3A', academicYear: '2026-2027',
    });
    const withWork = [
      student('st-1', [silentReceipt('p1', '2026-09-15'), silentReceipt('p2', '2026-10-12')]),
      // Ce reçu déclare ses mois : il ne compte PAS dans les reçus muets.
      student('st-2', [declaredReceipt('p3', '2026-09-20')]),
    ];

    const mount = async (students: unknown[]) => {
      const container = win.document.createElement('div');
      win.document.body.appendChild(container);
      const root: Root = createRoot(container as unknown as Element);
      await act(async () => {
        root.render(createElement(AppShell, {
          ...shellProps(), students, selectedYear: '2026-2027', today: '2026-10-20',
        } as never));
      });
      return {
        container,
        badges: () => container.querySelectorAll(`[aria-label="${label(2)}"]`),
        unmount: async () => { await act(async () => { root.unmount(); }); container.remove(); },
      };
    };

    const withBadges = await mount(withWork);
    try {
      const badges = withBadges.badges();
      assert.equal(badges.length, 2,
        `les DEUX navigations portent la pastille (rendues ${badges.length} fois) — en rater une, c'est rater l'autre`);
      for (const badge of badges) assert.equal(badge.textContent?.trim(), '2', 'elle porte le nombre de reçus muets');
    } finally {
      await withBadges.unmount();
    }

    const empty = await mount([]);
    try {
      assert.equal(empty.badges().length, 0, 'sans reçu muet, aucune des deux navigations n’annonce un chiffre');
    } finally {
      await empty.unmount();
    }
  });

  it('l’état de rapprochement s’ouvre depuis la fiche élève — la fenêtre ET son papier', async () => {
    // Le geste entier, par la vraie chaîne : la fiche (`StudentDetailsModal`,
    // montée par AppModals dans le shell) → son bouton → l'état ouvert AU-DESSUS
    // d'elle → le papier hors coquille. Chaque moitié porte sa preuve : le bouton
    // d'impression n'existe QUE dans la fenêtre, le conteneur papier que dans le
    // jumeau — un câblage oublié fait tomber la moitié qu'il manque, et l'état
    // fermé ne doit rien avoir montré.
    const reconciled = {
      id: 'st-1', name: 'Ali Diallo', grade: '9A', studentId: 'MT-2026-101',
      parentName: 'Papa Diallo', parentEmail: '', parentPhone: '',
      totalDue: 150000, amountPaid: 50000, dueDate: '2026-12-31', notes: '',
      academicYear: '2026-2027',
      payments: [{ id: 'p1', date: '2026-09-04', amount: 50000, receiptNumber: 'REC-111111', months: ['2026-09'] }],
    };

    // La fiche est OUVERTE, l'état FERMÉ : c'est le clic qui doit l'ouvrir.
    function Host() {
      const [reconcileStudent, setReconcileStudent] = useState<unknown>(null);
      const props = shellProps();
      // L'état est lu aux DEUX niveaux, comme dans l'app (viewsWiring le remet à
      // chacun) : le shell s'en sert pour monter le papier, AppModals pour savoir
      // si la fenêtre est ouverte — et le même setter les tient d'accord.
      return createElement(AppShell, {
        ...props,
        reconcileStudent,
        setReconcileStudent,
        viewsProps: {
          ...(props.viewsProps as Record<string, unknown>),
          selectedStudent: reconciled,
          reconcileStudent,
          setReconcileStudent,
        },
      } as never);
    }

    const container = win.document.createElement('div');
    win.document.body.appendChild(container);
    const root: Root = createRoot(container as unknown as Element);
    await act(async () => {
      root.render(createElement(Host));
    });

    // `AppModals` est monté à la demande (`lazy`) : le shell l'affiche une fois
    // son module chargé. On laisse donc l'import se résoudre avant de mesurer —
    // et on mesure, plutôt que d'attendre un temps fixe et de deviner.
    let openButton = container.querySelector('[data-slot="student-reconciliation-open"]');
    for (let i = 0; i < 50 && !openButton; i += 1) {
      await act(async () => { await new Promise((resolve) => setTimeout(resolve, 2)); });
      openButton = container.querySelector('[data-slot="student-reconciliation-open"]');
    }

    const shell = container.querySelector('[data-slot="app-shell"]');
    assert.ok(shell, 'la coquille est rendue');
    assert.ok(openButton, 'la fiche élève offre l’état de rapprochement');
    assert.equal(container.querySelector('.print-reconciliation-container') !== null, false, 'fermé, rien à imprimer');
    assert.equal(shell.classList.contains('no-print-sheet'), false, 'fermé, la coquille reste imprimable');

    await act(async () => {
      // Un vrai événement souris qui remonte : React écoute à la racine.
      openButton.dispatchEvent(new win.MouseEvent('click', { bubbles: true, cancelable: true }));
    });

    assert.ok(container.querySelector('[data-slot="reconciliation-print"]'), 'le clic ouvre la fenêtre de l’état, au-dessus de la fiche');
    const paper = container.querySelector('.print-reconciliation-container');
    assert.ok(paper, 'et le papier s’ouvre avec elle');
    assert.equal(shell.contains(paper), false, 'le papier vit hors de la coquille, sinon il sortirait blanc');
    assert.ok(shell.classList.contains('no-print-sheet'), 'et la coquille se retire de l’impression');

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  it('l’état de rapprochement masque la coquille, et son papier vit HORS d’elle', async () => {
    // Un seul papier s'imprime : la coquille reçoit `no-print-sheet` et
    // disparaît (règle @media print d'index.css). Un papier monté DEDANS sortirait
    // donc blanc, masqué avec elle — ce cas mesure les deux moitiés de la règle :
    // la classe posée sur la coquille, ET un papier qui n'est pas son descendant.
    // Fermé, l'inverse : aucune classe, aucun papier.
    const reconciled = {
      id: 'st-1', name: 'Ali Diallo', grade: '9A', studentId: 'MT-2026-101',
      parentName: 'Papa Diallo', parentEmail: '', parentPhone: '',
      totalDue: 150000, amountPaid: 50000, dueDate: '2026-12-31', notes: '',
      academicYear: '2026-2027',
      payments: [{ id: 'p1', date: '2026-09-04', amount: 50000, receiptNumber: 'REC-111111', months: ['2026-09'] }],
    };

    const mount = async (reconcileStudent: unknown) => {
      const container = win.document.createElement('div');
      win.document.body.appendChild(container);
      const root: Root = createRoot(container as unknown as Element);
      await act(async () => {
        root.render(createElement(AppShell, { ...shellProps(), reconcileStudent } as never));
      });
      return {
        container,
        shell: () => container.querySelector('[data-slot="app-shell"]'),
        paper: () => container.querySelector('.print-reconciliation-container'),
        unmount: async () => { await act(async () => { root.unmount(); }); container.remove(); },
      };
    };

    const closed = await mount(null);
    try {
      const shell = closed.shell();
      assert.ok(shell, 'la coquille est rendue');
      assert.equal(shell.classList.contains('no-print-sheet'), false, 'fermé, la coquille reste imprimable');
      // Le nœud est PROJETÉ en booléen avant d'être affirmé : une assertion qui
      // reçoit un élément happy-dom fait exploser le tas au lieu de dire son verdict.
      assert.equal(closed.paper() !== null, false, 'fermé, aucun papier n’est monté — rien à imprimer');
    } finally {
      await closed.unmount();
    }

    const open = await mount(reconciled);
    try {
      const shell = open.shell();
      assert.ok(shell, 'la coquille est rendue');
      assert.ok(shell.classList.contains('no-print-sheet'), 'ouvert, la coquille se retire de l’impression');
      assert.equal(
        shell.classList.contains('no-print-ticket'),
        false,
        'la classe du ticket de retard reste celle du ticket : les deux papiers partagent la règle, pas la classe',
      );
      const paper = open.paper();
      assert.ok(paper, 'le papier est monté');
      assert.equal(shell.contains(paper), false, 'il vit HORS de la coquille masquée — dedans, il sortirait blanc');
      assert.ok(paper.textContent?.includes('REC-111111'), 'et c’est bien l’état de CET élève qui sortirait');
    } finally {
      await open.unmount();
    }
  });
});
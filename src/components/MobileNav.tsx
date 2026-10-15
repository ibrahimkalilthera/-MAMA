/**
 * Mobile bottom navigation — visible only below the lg breakpoint, where the
 * sidebar is hidden. Mirrors the sidebar's tabs (plus the payroll window
 * badge) so every page stays reachable on small screens, and carries the
 * language toggle (the old floating language FAB was folded in here so mobile
 * users get one dock instead of two floating buttons).
 *
 * The audit & settings tabs are admin/dev-only, exactly like the sidebar. The
 * payment history tab is NOT: since 2026-10-15 the accountant (econome) reads it
 * too, because the base hands that role the rows of that one screen and nothing
 * else of the journal (see src/lib/paymentHistoryRights.ts). Opening audit (or
 * the payment history, which reads the same journal) also refreshes the audit log
 * first (fetchAuditLogs).
 */
import {
  LayoutDashboard,
  Users,
  MessageSquare,
  Briefcase,
  Receipt,
  Calendar,
  CalendarClock,
  StickyNote,
  TrendingUp,
  ShieldCheck,
  History,
  Settings as SettingsIcon,
  Globe,
} from 'lucide-react';
import type { TranslationDict } from '../i18n/translations';
import type { AppTab } from './Sidebar';
import type { User } from '../app/types';
import type { PayrollWindowStatus } from '../app/mainViewsProps';
import { canViewPaymentHistory } from '../lib/paymentHistoryRights';

export interface MobileNavProps {
  t: TranslationDict;
  activeTab: AppTab;
  setActiveTab: (tab: AppTab) => void;
  payrollWindowStatus: PayrollWindowStatus;
  onToggleLanguage: () => void;
  /** Role gate for the audit/settings tabs (mirrors the sidebar). */
  currentUser?: Pick<User, 'role'> | null;
  /** Refresh the audit log before navigating to the audit tab. */
  fetchAuditLogs?: () => void;
  /** Une semaine du journal attend son archive — pastille sur l'onglet Réglages. */
  auditArchivePending?: boolean;
  /**
   * Combien de reçus muets restent à documenter — la pastille de l'onglet École,
   * la même valeur qu'au rail (voir `SidebarProps.silentReceiptsCount`).
   *
   * Ici la pastille porte le CHIFFRE et non le mot : la barre du bas n'a pas la
   * largeur d'un rail, donc « reçus muets à rattraper » ne peut pas s'y écrire —
   * c'est le nom accessible (`aria-label`, la phrase traduite) qui dit ce qui est
   * compté. Zéro (ou absent) rend l'icône nue.
   */
  silentReceiptsCount?: number;
}

export function MobileNav(props: MobileNavProps) {
  const { t, activeTab, setActiveTab, payrollWindowStatus, onToggleLanguage, currentUser, fetchAuditLogs, auditArchivePending = false, silentReceiptsCount = 0 } = props;
  const isAdminDev = currentUser?.role === 'admin' || currentUser?.role === 'dev';
  // L'historique des paiements n'est plus dans le bloc admin/dev : l'économe lit
  // cet écran depuis le 2026-10-15 (la base lui rend les lignes de la caisse, et
  // elle seule). Le journal d'audit et les Réglages, eux, gardent leur garde.
  const canSeePaymentHistory = canViewPaymentHistory(currentUser?.role);
  const silentReceiptsBadge = t.silentReceiptsBadge.replace('{count}', String(silentReceiptsCount));

  const items: { tab: AppTab; label: string; icon: React.ReactNode }[] = [
    { tab: 'dashboard', label: t.navDashboard, icon: <LayoutDashboard size={20} /> },
    { tab: 'students', label: t.navStudents, icon: <Users size={20} /> },
    { tab: 'parents', label: t.navParents, icon: <MessageSquare size={20} /> },
    { tab: 'payroll', label: t.payroll, icon: <Briefcase size={20} /> },
    { tab: 'expenses', label: t.expenses, icon: <Receipt size={20} /> },
    { tab: 'calendar', label: t.navCalendar, icon: <Calendar size={20} /> },
    { tab: 'notes', label: t.notes, icon: <StickyNote size={20} /> },
    { tab: 'archives', label: t.navArchives, icon: <TrendingUp size={20} /> },
    // Reçus muets : hors du bloc admin/dev — l'écran ne lit que les élèves déjà
    // chargés, donc tout compte connecté peut voir ce qui reste à documenter.
    { tab: 'silentReceipts', label: t.navSilentReceipts, icon: <CalendarClock size={20} /> },
    // Trois gates, et pas un seul : l'historique des paiements s'adresse à
    // l'économe (il tient la caisse), le journal d'audit et les Réglages non.
    // L'ordre reste celui du rail — journal, historique, réglages.
    ...(isAdminDev
      ? [{ tab: 'audit' as const, label: t.auditTrail, icon: <ShieldCheck size={20} /> }]
      : []),
    ...(canSeePaymentHistory
      ? [{ tab: 'paymentHistory' as const, label: t.paymentHistory, icon: <History size={20} /> }]
      : []),
    ...(isAdminDev
      ? [{ tab: 'settings' as const, label: t.navSettings, icon: <SettingsIcon size={20} /> }]
      : []),
  ];

  const go = (tab: AppTab) => {
    // Les deux écrans qui lisent le journal le RECHARGENT en s'ouvrant : arriver
    // sur une lecture périmée ferait croire à un geste qui n'y est pas encore.
    if (tab === 'audit' || tab === 'paymentHistory') fetchAuditLogs?.();
    setActiveTab(tab);
  };

  return (
    <nav
      data-slot="app-mobile-nav"
      className="lg:hidden fixed bottom-0 inset-x-0 z-40 no-print"
      style={{ background: 'linear-gradient(180deg, #0C1222 0%, #111827 50%, #0F172A 100%)', paddingBottom: 'env(safe-area-inset-bottom)' }}
    >
      {/* Every tab must fit on the bar: the row used to overflow, so the last
          items (Calendrier) were cut off and unreachable. A grid of equal
          columns guarantees the whole set stays visible at any phone width. */}
      <div
        className="grid items-stretch border-t border-white/[0.06]"
        style={{ gridTemplateColumns: `repeat(${items.length}, minmax(0, 1fr)) 2.5rem` }}
      >
        {items.map(({ tab, label, icon }) => {
          const active = activeTab === tab;
          return (
            <button
              key={tab}
              onClick={() => go(tab)}
              aria-current={active ? 'page' : undefined}
              title={label}
              className={`flex min-w-0 flex-col items-center justify-center gap-1 py-2 px-0.5 transition-colors ${active ? 'text-white' : 'text-white/45 hover:text-white/75'}`}
            >
              <span className="relative">
                {icon}
                {tab === 'payroll' && payrollWindowStatus.isOverdue && (
                  <span
                    className="absolute -top-1 -right-1.5 w-2 h-2 rounded-full bg-rose-500 animate-badge-pulse"
                    aria-label={t.overdue}
                  />
                )}
                {tab === 'settings' && auditArchivePending && (
                  <span
                    className="absolute -top-1 -right-1.5 w-2 h-2 rounded-full accent-surface animate-badge-pulse"
                    aria-label={t.auditArchiveBadge}
                  />
                )}
                {/* Les deux autres pastilles de cette barre sont des POINTS (un
                    état : en retard, une archive en attente). Celle-ci porte un
                    NOMBRE : sa largeur suit donc le chiffre, et son nom accessible
                    dit ce qu'elle compte. */}
                {tab === 'silentReceipts' && silentReceiptsCount > 0 && (
                  <span
                    className="absolute -top-1.5 -right-2 min-w-[0.875rem] h-3.5 px-1 rounded-full bg-amber-500 text-amber-950 text-3xs font-black flex items-center justify-center animate-badge-pulse"
                    aria-label={silentReceiptsBadge}
                  >
                    {silentReceiptsCount}
                  </span>
                )}
              </span>
              <span className="w-full truncate text-center text-2xs font-bold leading-tight">{label}</span>
              {active && <span className="w-6 h-0.5 rounded-full accent-surface" />}
            </button>
          );
        })}

        <button
          onClick={onToggleLanguage}
          aria-label={t.langToggle}
          title={t.langToggle}
          className="flex flex-col items-center justify-center gap-1 border-l border-white/10 text-white/45 hover:text-white transition-colors"
        >
          <Globe size={18} />
          <span className="text-2xs font-bold">{t.langToggle}</span>
        </button>
      </div>
    </nav>
  );
}
/**
 * Mobile bottom navigation — visible only below the lg breakpoint, where the
 * sidebar is hidden. Mirrors the sidebar's tabs (plus the payroll window
 * badge) so every page stays reachable on small screens, and carries the
 * language toggle (the old floating language FAB was folded in here so mobile
 * users get one dock instead of two floating buttons).
 *
 * The audit & settings tabs are admin/dev-only, exactly like the sidebar;
 * opening audit also refreshes the audit log first (fetchAuditLogs).
 */
import {
  LayoutDashboard,
  Users,
  MessageSquare,
  Briefcase,
  Receipt,
  Calendar,
  StickyNote,
  TrendingUp,
  ShieldCheck,
  Settings as SettingsIcon,
  Globe,
} from 'lucide-react';
import type { TranslationDict } from '../i18n/translations';
import type { AppTab } from './Sidebar';
import type { User } from '../app/types';
import type { PayrollWindowStatus } from '../app/mainViewsProps';

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
}

export function MobileNav(props: MobileNavProps) {
  const { t, activeTab, setActiveTab, payrollWindowStatus, onToggleLanguage, currentUser, fetchAuditLogs } = props;
  const isAdminDev = currentUser?.role === 'admin' || currentUser?.role === 'dev';

  const items: { tab: AppTab; label: string; icon: React.ReactNode }[] = [
    { tab: 'dashboard', label: t.navDashboard, icon: <LayoutDashboard size={20} /> },
    { tab: 'students', label: t.navStudents, icon: <Users size={20} /> },
    { tab: 'parents', label: t.navParents, icon: <MessageSquare size={20} /> },
    { tab: 'payroll', label: t.payroll, icon: <Briefcase size={20} /> },
    { tab: 'expenses', label: t.expenses, icon: <Receipt size={20} /> },
    { tab: 'calendar', label: t.navCalendar, icon: <Calendar size={20} /> },
    { tab: 'notes', label: t.notes, icon: <StickyNote size={20} /> },
    { tab: 'archives', label: t.navArchives, icon: <TrendingUp size={20} /> },
    ...(isAdminDev
      ? [
          { tab: 'audit' as const, label: t.auditTrail, icon: <ShieldCheck size={20} /> },
          { tab: 'settings' as const, label: t.navSettings, icon: <SettingsIcon size={20} /> },
        ]
      : []),
  ];

  const go = (tab: AppTab) => {
    if (tab === 'audit') fetchAuditLogs?.();
    setActiveTab(tab);
  };

  return (
    <nav
      className="lg:hidden fixed bottom-0 inset-x-0 z-40 no-print"
      style={{ background: 'linear-gradient(180deg, #0C1222 0%, #111827 50%, #0F172A 100%)', paddingBottom: 'env(safe-area-inset-bottom)' }}
    >
      <div
        className="flex items-stretch border-t border-white/[0.06] overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {items.map(({ tab, label, icon }) => {
          const active = activeTab === tab;
          return (
            <button
              key={tab}
              onClick={() => go(tab)}
              aria-current={active ? 'page' : undefined}
              className={`flex flex-col items-center justify-center gap-1 py-2.5 px-1.5 flex-1 min-w-[64px] shrink-0 transition-colors ${active ? 'text-white' : 'text-white/45 hover:text-white/75'}`}
            >
              <span className="relative">
                {icon}
                {tab === 'payroll' && payrollWindowStatus.isOverdue && (
                  <span
                    className="absolute -top-1 -right-1.5 w-2 h-2 rounded-full bg-rose-500 animate-badge-pulse"
                    aria-label={t.overdue}
                  />
                )}
              </span>
              <span className={`text-[9px] font-bold text-center leading-tight ${active ? '' : 'font-semibold'}`}>{label}</span>
              {active && <span className="w-8 h-0.5 rounded-full bg-blue-500" />}
            </button>
          );
        })}

        <div className="w-px bg-white/10 my-2 flex-shrink-0" />

        <button
          onClick={onToggleLanguage}
          aria-label={t.langToggle}
          title={t.langToggle}
          className="flex flex-col items-center justify-center gap-1 px-3 flex-shrink-0 text-white/45 hover:text-white transition-colors"
        >
          <Globe size={18} />
          <span className="text-[9px] font-bold">{t.langToggle}</span>
        </button>
      </div>
    </nav>
  );
}
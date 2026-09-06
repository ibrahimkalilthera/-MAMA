/**
 * Mobile bottom navigation — visible only below the lg breakpoint, where the
 * sidebar is hidden. Mirrors the sidebar's main tabs (plus the payroll window
 * badge) so every page stays reachable on small screens.
 */
import {
  LayoutDashboard,
  Users,
  MessageSquare,
  Briefcase,
  Receipt,
  TrendingUp,
} from 'lucide-react';
import type { TranslationDict } from '../i18n/translations';
import type { AppTab } from './Sidebar';
import type { PayrollWindowStatus } from '../app/mainViewsProps';

export interface MobileNavProps {
  t: TranslationDict;
  activeTab: AppTab;
  setActiveTab: (tab: AppTab) => void;
  payrollWindowStatus: PayrollWindowStatus;
}

export function MobileNav(props: MobileNavProps) {
  const { t, activeTab, setActiveTab, payrollWindowStatus } = props;

  const items: { tab: AppTab; label: string; icon: React.ReactNode }[] = [
    { tab: 'dashboard', label: t.navDashboard, icon: <LayoutDashboard size={20} /> },
    { tab: 'students', label: t.navStudents, icon: <Users size={20} /> },
    { tab: 'parents', label: t.navParents, icon: <MessageSquare size={20} /> },
    { tab: 'payroll', label: t.payroll, icon: <Briefcase size={20} /> },
    { tab: 'expenses', label: t.expenses, icon: <Receipt size={20} /> },
    { tab: 'archives', label: t.navArchives, icon: <TrendingUp size={20} /> },
  ];

  return (
    <nav
      className="lg:hidden fixed bottom-0 inset-x-0 z-40 no-print"
      style={{ background: 'linear-gradient(180deg, #0C1222 0%, #111827 50%, #0F172A 100%)', paddingBottom: 'env(safe-area-inset-bottom)' }}
    >
      <div className="flex items-stretch justify-around border-t border-white/[0.06]">
        {items.map(({ tab, label, icon }) => {
          const active = activeTab === tab;
          return (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              aria-current={active ? 'page' : undefined}
              className={`flex flex-col items-center gap-1 flex-1 py-2.5 transition-colors ${active ? 'text-white' : 'text-white/45 hover:text-white/75'}`}
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
              <span className={`text-[9px] font-bold ${active ? '' : 'font-semibold'}`}>{label}</span>
              {active && <span className="w-8 h-0.5 rounded-full bg-blue-500" />}
            </button>
          );
        })}
      </div>
    </nav>
  );
}
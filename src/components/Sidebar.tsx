/**
 * App sidebar/navigation — extracted verbatim from App.tsx.
 *
 * Logo + school name, the tab navigation (with the payroll window badges and
 * the admin/dev-only tabs), the productivity toggle, sign-out, the quick
 * add-student / record-payment actions and the language toggle. The add/edit
 * modal reset lives in App (passed as `onAddStudent`), keeping this
 * component presentational.
 */
import {
  ShieldCheck,
  History,
  LayoutDashboard,
  Users,
  MessageSquare,
  Briefcase,
  Receipt,
  Calendar,
  StickyNote,
  TrendingUp,
  Globe,
  CheckSquare,
  LogOut,
  Plus,
  Baby,
  DollarSign,
  Lock,
} from 'lucide-react';
import type { TranslationDict } from '../i18n/translations';
import type { User } from '../app/types';
import type { CurrentTheme, PayrollWindowStatus } from '../app/mainViewsProps';

export type AppTab = 'dashboard' | 'students' | 'parents' | 'payroll' | 'expenses' | 'settings' | 'calendar' | 'notes' | 'archives' | 'audit' | 'paymentHistory';

export interface SidebarProps {
  t: TranslationDict;
  schoolLogo: string | null;
  /**
   * The sidebar is a fixed dark rail in every theme, so it cannot inherit the
   * theme background — but its two ACTION buttons are brand accents and must
   * still follow the active theme (they stayed blue/emerald in Cyber Minuit).
   */
  currentTheme: CurrentTheme;
  activeTab: AppTab;
  setActiveTab: (tab: AppTab) => void;
  payrollWindowStatus: PayrollWindowStatus;
  currentUser: User | null;
  fetchAuditLogs: () => void;
  showTodoSidebar: boolean;
  setShowTodoSidebar: (open: boolean) => void;
  onSignOut: () => void;
  onToggleLanguage: () => void;
  onAddStudent: () => void;
  /** « Ajouter CR » : le MÊME formulaire, ouvert sur les seules classes CR. */
  onAddCr: () => void;
  onRecordPayment: () => void;
  /**
   * Une semaine du journal attend son archive en PDF (voir `useAuditArchiveReminder`).
   * Le badge vit sur l'onglet Réglages, où le geste se fait : c'est le seul
   * endroit de l'écran visible depuis N'IMPORTE quelle page.
   */
  auditArchivePending?: boolean;
}

export function Sidebar(props: SidebarProps) {
  const {
    t, schoolLogo, currentTheme, activeTab, setActiveTab, payrollWindowStatus, currentUser,
    fetchAuditLogs, showTodoSidebar, setShowTodoSidebar,
    onSignOut, onToggleLanguage, onAddStudent, onAddCr, onRecordPayment,
    auditArchivePending = false,
  } = props;

  const navBtn = (tab: AppTab) =>
    `nav-item w-full flex items-center gap-3 px-4 py-2.5 rounded-lg transition-all ${activeTab === tab ? 'nav-item-active bg-white/[0.08] text-white shadow-sm' : 'text-white/50 hover:text-white/80 hover:bg-white/[0.04]'}`;

  return (
    <aside data-slot="app-sidebar" className="app-sidebar w-64 text-white fixed h-full z-40 hidden lg:flex flex-col transition-colors duration-300" style={{ background: 'linear-gradient(180deg, #0C1222 0%, #111827 50%, #0F172A 100%)' }}>
      <div className="p-6 pb-4" style={{ backgroundColor: 'transparent' }}>
        <div className="flex items-center gap-3 mb-1">
          {schoolLogo ? (
            <img src={schoolLogo} alt="Logo" className="w-9 h-9 rounded-lg object-cover ring-2 ring-white/10" referrerPolicy="no-referrer" />
          ) : (
            <div className={`p-2 rounded-lg shadow-lg ${currentTheme.accentShadow}`} style={{ backgroundColor: currentTheme.accentHex }}>
              <ShieldCheck size={24} />
            </div>
          )}
          <div>
            <h1 className="font-bold text-base leading-tight tracking-tight" style={{ color: '#FFFFFF' }}>{t.title}</h1>
            <p className="text-3xs uppercase tracking-[0.12em] font-semibold mt-0.5" style={{ color: 'rgba(255, 255, 255, 0.65)' }}>{t.subtitle}</p>
          </div>
        </div>
      </div>

      <div className="mx-4 mb-3 border-t border-white/[0.06]"></div>

      <nav className="flex-1 px-3 space-y-0.5 mt-1 custom-scrollbar overflow-y-auto">
        <button onClick={() => setActiveTab('dashboard')} className={navBtn('dashboard')}>
          <LayoutDashboard size={20} />
          <span className="font-semibold text-sm" data-i18n="navDashboard">{t.navDashboard}</span>
        </button>

        <button onClick={() => setActiveTab('students')} className={navBtn('students')}>
          <Users size={20} />
          <span className="font-semibold text-sm" data-i18n="navStudents">{t.navStudents}</span>
        </button>

        <button onClick={() => setActiveTab('parents')} className={navBtn('parents')}>
          <MessageSquare size={20} />
          <span className="font-semibold text-sm" data-i18n="navParents">{t.navParents}</span>
        </button>

        <button onClick={() => setActiveTab('payroll')} className={navBtn('payroll')}>
          <div className="flex items-center justify-between w-full gap-2">
            <div className="flex items-center gap-3 min-w-0">
              <Briefcase size={20} className="flex-shrink-0" />
              <span className="font-semibold text-sm truncate" data-i18n="payroll">{t.payroll}</span>
            </div>
            {payrollWindowStatus.isOverdue ? (
              <span className="bg-rose-700 text-white text-3xs font-black px-1.5 py-0.5 rounded uppercase tracking-wider whitespace-nowrap shadow-sm animate-badge-pulse flex-shrink-0" data-i18n="overdue">
                {t.overdue}
              </span>
            ) : payrollWindowStatus.isOpen ? (
              <span className={`${currentTheme.accentBg} ${currentTheme.accentText} text-3xs font-black px-1.5 py-0.5 rounded uppercase tracking-wider whitespace-nowrap shadow-sm flex-shrink-0`}>
                {t.open}
              </span>
            ) : (
              <Lock size={14} className="text-white/40 flex-shrink-0" />
            )}
          </div>
        </button>

        <button onClick={() => setActiveTab('expenses')} className={navBtn('expenses')}>
          <Receipt size={20} />
          <span className="font-semibold text-sm" data-i18n="expenses">{t.expenses}</span>
        </button>

        <button onClick={() => setActiveTab('calendar')} className={navBtn('calendar')}>
          <Calendar size={20} />
          <span className="font-semibold text-sm" data-i18n="navCalendar">{t.navCalendar}</span>
        </button>

        <button onClick={() => setActiveTab('notes')} className={navBtn('notes')}>
          <StickyNote size={20} />
          <span className="font-semibold text-sm" data-i18n="notes">{t.notes}</span>
        </button>

        <button onClick={() => setActiveTab('archives')} className={navBtn('archives')}>
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
              className={navBtn('audit')}
            >
              <ShieldCheck size={20} />
              <span className="font-semibold text-sm">{t.auditTrail}</span>
            </button>

            {/* L'historique des paiements se lit DANS le journal (c'est le seul
                endroit qui nomme l'encaisseur) : il vit donc ici, à côté de lui,
                et ouvre la même lecture (`fetchAuditLogs`). */}
            <button
              onClick={() => {
                setActiveTab('paymentHistory');
                fetchAuditLogs();
              }}
              className={navBtn('paymentHistory')}
            >
              <History size={20} />
              <span className="font-semibold text-sm">{t.paymentHistory}</span>
            </button>

            <button onClick={() => setActiveTab('settings')} className={navBtn('settings')}>
              <Globe size={20} className="flex-shrink-0" />
              <span className="font-semibold text-sm" data-i18n="navSettings">{t.navSettings}</span>
              {auditArchivePending && (
                <span
                  className={`ml-auto ${currentTheme.accentBg} ${currentTheme.accentText} text-3xs font-black px-1.5 py-0.5 rounded uppercase tracking-wider whitespace-nowrap shadow-sm animate-badge-pulse flex-shrink-0`}
                  data-i18n="auditArchiveBadge"
                >
                  {t.auditArchiveBadge}
                </span>
              )}
            </button>
          </>
        )}

        <button
          onClick={() => setShowTodoSidebar(!showTodoSidebar)}
          className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all ${showTodoSidebar ? 'bg-amber-500 text-amber-950 shadow-lg shadow-amber-500/20' : 'text-white/40 hover:text-white hover:bg-white/5'}`}
        >
          <CheckSquare size={20} />
          <span className="font-semibold text-sm" data-i18n="productivity">{t.productivity}</span>
        </button>

        <div className="pt-4 pb-2 px-4">
          {/* white/20 was near-invisible on the dark panel; this is a section
              label, so it should be quiet but readable. */}
          <p className="text-2xs font-black text-white/65 uppercase tracking-widest" data-i18n="actions">{t.actions}</p>
        </div>

        <button onClick={onSignOut} className="w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all text-rose-400 hover:text-rose-300 hover:bg-rose-500/10 mt-auto">
          <LogOut size={20} />
          <span className="font-semibold text-sm" data-i18n="signOut">{t.signOut}</span>
        </button>

        <div className="space-y-2 pt-2">
          <button
            onClick={onAddStudent}
            className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl ${currentTheme.accentSoftDark} ${currentTheme.accentSoftDarkHover} ${currentTheme.accentSoftDarkText} border border-white/10 transition-all font-bold text-xs`}
          >
            <Plus size={18} />
            <span>{t.addStudent}</span>
          </button>

          <button
            onClick={onAddCr}
            className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl ${currentTheme.accentBg} ${currentTheme.accentHover} ${currentTheme.accentText} shadow-lg ${currentTheme.accentShadow} transition-all font-bold text-xs`}
          >
            <Baby size={18} />
            <span>{t.addCrStudent}</span>
          </button>

          <button
            onClick={onRecordPayment}
            className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl ${currentTheme.accentBg} ${currentTheme.accentHover} ${currentTheme.accentText} shadow-lg ${currentTheme.accentShadow} transition-all font-bold text-xs`}
          >
            <DollarSign size={18} />
            <span>{t.recordPayment}</span>
          </button>
        </div>
      </nav>

      <div className="p-6 border-t border-white/5">
        <button
          onClick={onToggleLanguage}
          className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-xl border border-white/10 hover:bg-white/5 transition-all text-sm font-bold"
        >
          <Globe size={18} />
          {t.langToggle}
        </button>
      </div>
    </aside>
  );
}

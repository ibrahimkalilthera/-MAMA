/**
 * App sidebar/navigation — extracted verbatim from App.tsx.
 *
 * Logo + school name, the tab navigation (with the payroll window badge, the
 * silent-receipts count and the admin/dev-only tabs), the productivity toggle,
 * sign-out, the quick add-student / record-payment actions and the language
 * toggle. The add/edit modal reset lives in App (passed as `onAddStudent`),
 * keeping this component presentational.
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
  CalendarClock,
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
import { canViewPaymentHistory } from '../lib/paymentHistoryRights';

export type AppTab = 'dashboard' | 'students' | 'parents' | 'payroll' | 'expenses' | 'settings' | 'calendar' | 'notes' | 'archives' | 'silentReceipts' | 'audit' | 'paymentHistory';

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
  /**
   * Combien de reçus muets restent à documenter sur l'année affichée — la
   * pastille de l'onglet École.
   *
   * Le chiffre VIENT DU SHELL (`AppShell`), qui le lit sur la même brique pure
   * que l'écran École et le tableau de bord (`silentReceiptsRows` /
   * `silentReceiptsCatchUp`) : la pastille, la liste et la carte publient donc le
   * MÊME nombre, au lieu de trois comptages qui s'accordent aujourd'hui et
   * divergent demain. Zéro (ou absent) rend une ligne SANS pastille : un onglet
   * qui n'annonce rien ne se décore pas d'un « 0 ».
   */
  silentReceiptsCount?: number;
}

export function Sidebar(props: SidebarProps) {
  const {
    t, schoolLogo, currentTheme, activeTab, setActiveTab, payrollWindowStatus, currentUser,
    fetchAuditLogs, showTodoSidebar, setShowTodoSidebar,
    onSignOut, onToggleLanguage, onAddStudent, onAddCr, onRecordPayment,
    auditArchivePending = false, silentReceiptsCount = 0,
  } = props;

  /**
   * Le nom ACCESSIBLE de la pastille des reçus muets.
   *
   * Un chiffre nu ne dit rien : « 4 » à côté d'un onglet se lirait aussi bien
   * comme quatre élèves, quatre reçus ou quatre messages. C'est cette phrase
   * traduite qui nomme ce qui est compté — et c'est elle, pas le chiffre, que
   * lisent les tests (`aria-label`) et les lecteurs d'écran.
   */
  const silentReceiptsBadge = t.silentReceiptsBadge.replace('{count}', String(silentReceiptsCount));

  /**
   * Les deux familles de lignes qui ne s'adressent pas à tout le monde.
   *
   * `isAdminDev` garde le JOURNAL d'audit et les Réglages ; `canSeePaymentHistory`
   * garde l'historique des paiements, et la liste des rôles vient de la base
   * (`public.is_payment_history_viewer()`, `src/lib/paymentHistoryRights.ts`) :
   * l'économe y est depuis le 2026-10-15 — c'est lui qui tient la caisse. Les deux
   * ne se confondent pas : ouvrir l'historique des paiements ne lui ouvre pas le
   * journal, dont la base ne lui rend que les lignes de caisse.
   */
  const isAdminDev = currentUser?.role === 'admin' || currentUser?.role === 'dev';
  const canSeePaymentHistory = canViewPaymentHistory(currentUser?.role);

  /**
   * Une ligne du rail.
   *
   * Le rembourrage GAUCHE est écrit ici, une fois, et jamais négocié ailleurs
   * (`pl-4`) : c'est lui qui met toutes les icônes dans une colonne et tous les
   * libellés dans une autre. Une ligne qui s'en écarterait se lirait de travers.
   *
   * Le rembourrage DROIT, lui, n'est que la place réservée APRÈS le libellé — le
   * seul bord de la ligne où rien d'autre ne vit — donc la seule chose qu'une
   * ligne peut resserrer pour tenir. Il se règle donc ligne par ligne, et
   * « Historique des Paiements » en a besoin : c'est le libellé le plus long du
   * menu (171 px au Geist 600/14 px, mesuré), le rail n'en offre que 163, et
   * sans ces quelques pixels il passait à la ligne — la ligne grandissait de
   * 20 px et décollait toutes ses voisines d'un cran.
   */
  const navBtn = (tab: AppTab, tailPadding = 'pr-4') =>
    `nav-item w-full flex items-center gap-3 pl-4 ${tailPadding} py-2.5 rounded-lg transition-all ${activeTab === tab ? 'nav-item-active bg-white/[0.08] text-white shadow-sm' : `text-white/50 hover:text-white/80 ${currentTheme.hoverSurfaceDark}`}`;

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

        {/* Reçus muets — le travail de l'école sur les reçus qui ne déclarent
            aucun mois. La ligne vit HORS du bloc admin/dev ci-dessous, et c'est
            voulu : cet écran ne lit que les élèves déjà chargés (`students`),
            donc il n'ouvre aucun accès en base — n'importe quel compte connecté
            peut voir ce qui reste à documenter. Ce qui n'est pas ouvert pour
            autant, c'est l'ÉCRITURE : renseigner les mois reste décidé par la
            base (`canEditPaymentMonths`, src/lib/paymentRights.ts), et l'écran
            le dit au lieu de le promettre. */}
        <button onClick={() => setActiveTab('silentReceipts')} className={navBtn('silentReceipts')}>
          <CalendarClock size={20} className="flex-shrink-0" />
          <span className="font-semibold text-sm" data-i18n="navSilentReceipts">{t.navSilentReceipts}</span>
          {/* Le NOMBRE qui reste, dans la même forme que la pastille de retard de
              la Paie (pilule du rail, poussée à droite, cadence de pulsation) —
              mais dans la famille ambre du sujet : le dépôt peint le rattrapage
              des reçus muets en ambre partout ailleurs (la carte du tableau de
              bord, le pied de liste de l'écran École), et le rose y dit une
              échéance qui bloque. Un chiffre ne se met pas en majuscules pour
              autant : la pastille de la Paie porte un MOT. */}
          {silentReceiptsCount > 0 && (
            <span
              className="ml-auto bg-amber-500 text-amber-950 text-3xs font-black px-1.5 py-0.5 rounded whitespace-nowrap shadow-sm animate-badge-pulse flex-shrink-0"
              aria-label={silentReceiptsBadge}
              title={silentReceiptsBadge}
            >
              {silentReceiptsCount}
            </span>
          )}
        </button>

        {isAdminDev && (
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
        )}

        {/* L'historique des paiements se lit DANS le journal (c'est le seul endroit
            qui nomme l'encaisseur) : il vit donc ici, à côté de lui, et ouvre la
            même lecture (`fetchAuditLogs`).

            Sa garde est la seule de ce rail à ne pas être « admin/dev » : le
            2026-10-15, l'économe y est entré (demande du propriétaire : « il doit
            avoir accès à l'historique des paiements »), parce que la base lui rend
            désormais les lignes de cet écran et rien d'autre du journal. La ligne
            est donc sortie du bloc admin/dev pour son propre gate — l'y laisser
            l'aurait cachée, et l'en sortir SANS gate l'aurait montrée à tout le
            monde, y compris au personnel pour qui la base refuse ces lignes.

            C'est aussi la seule ligne dont le libellé ne tient pas dans le rail
            tel quel : il prend le rembourrage droit resserré (voir `navBtn`), son
            icône ne se laisse pas comprimer par le texte, et `truncate` garantit
            qu'il se coupe au pire au lieu de casser la ligne — même règle que la
            barre mobile, qui porte le même libellé. Le libellé entier reste lu au
            survol (`title`). */}
        {canSeePaymentHistory && (
          <button
            onClick={() => {
              setActiveTab('paymentHistory');
              fetchAuditLogs();
            }}
            className={navBtn('paymentHistory', 'pr-1.5')}
            title={t.paymentHistory}
          >
            <History size={20} className="flex-shrink-0" />
            <span className="font-semibold text-sm truncate">{t.paymentHistory}</span>
          </button>
        )}

        {isAdminDev && (
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
        )}

        <button
          onClick={() => setShowTodoSidebar(!showTodoSidebar)}
          className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all ${showTodoSidebar ? 'bg-amber-500 text-amber-950 shadow-lg shadow-amber-500/20' : `text-white/40 hover:text-white ${currentTheme.hoverSurfaceDark}`}`}
        >
          <CheckSquare size={20} />
          <span className="font-semibold text-sm" data-i18n="productivity">{t.productivity}</span>
        </button>

        <div className="pt-4 pb-2 px-4">
          {/* white/20 was near-invisible on the dark panel; this is a section
              label, so it should be quiet but readable. */}
          <p className="text-2xs font-black text-white/65 uppercase tracking-widest" data-i18n="actions">{t.actions}</p>
        </div>

        <button onClick={onSignOut} className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all text-rose-400 ${currentTheme.hoverAlertDark} mt-auto`}>
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
          className={`w-full flex items-center justify-center gap-2 px-4 py-3 rounded-xl border border-white/10 ${currentTheme.hoverSurfaceDark} transition-all text-sm font-bold`}
        >
          <Globe size={18} />
          {t.langToggle}
        </button>
      </div>
    </aside>
  );
}

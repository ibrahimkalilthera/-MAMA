/**
 * App header — extracted verbatim from App.tsx.
 *
 * Tab title + date, the year selector, and the contextual action bar
 * (promote class, Excel import, monthly payroll draft, print/PDF report,
 * search, class filter, financial report, late export, add student). The
 * heavier actions (PDF generation, print dispatch) are passed as callbacks so
 * this component stays presentational.
 */
import {
  Calendar,
  GraduationCap,
  FileSpreadsheet,
  FileText,
  Printer,
  Search,
  Layers,
  Download,
  Plus,
  Baby,
} from 'lucide-react';
import type { TranslationDict } from '../i18n/translations';
import { NURSERY_CYCLE } from '../app/types';
import type { User } from '../app/types';
import type { CurrentTheme, ManagedClass } from '../app/mainViewsProps';
import type { AppTab } from './Sidebar';
import type { DashboardNotification } from '../app/useDashboard';
import { NotificationsPanel } from './NotificationsPanel';

export interface AppHeaderProps {
  t: TranslationDict;
  lang: 'en' | 'fr';
  currentTheme: CurrentTheme;
  activeTab: AppTab;
  currentUser: User | null;
  selectedYear: string;
  setSelectedYear: (year: string) => void;
  academicYears: string[];
  availableClasses: ManagedClass[];
  searchTerm: string;
  setSearchTerm: (term: string) => void;
  studentGradeFilter: string;
  setStudentGradeFilter: (filter: string) => void;
  onPromoteClass: () => void;
  onImportExcel: () => void;
  onOpenMonthlyDraft: () => void;
  onAddStudent: () => void;
  /** « Ajouter CR » : le MÊME formulaire, ouvert sur les seules classes CR. */
  onAddCr: () => void;
  onPrintReport: () => void;
  onExportLate: () => void;
  onFinancialReportPdf: () => void;
  notifications: DashboardNotification[];
  onOpenStudent: (studentId: string) => void;
  readNotificationIds: string[];
  deletedNotificationIds: string[];
  onMarkNotificationRead: (id: string) => void;
  onMarkAllNotificationsRead: () => void;
  onMarkNotificationUnread: (id: string) => void;
  /** Retire la notification de la liste (masquage réversible, aucune écriture). */
  onDeleteNotification: (id: string) => void;
  /** Nettoie la liste entière d'un coup. */
  onClearAllNotifications: () => void;
  onRestoreDeletedNotifications: () => void;
  onOpenCalendarDate: (date: string) => void;
  onOpenPayroll: () => void;
  /** Le rappel d'archive mène aux Réglages → Sauvegarde. */
  onOpenSettings: () => void;
}

export function AppHeader(props: AppHeaderProps) {
  const {
    t, lang, currentTheme, activeTab, currentUser,
    selectedYear, setSelectedYear, academicYears, availableClasses,
    searchTerm, setSearchTerm, studentGradeFilter, setStudentGradeFilter,
    onPromoteClass, onImportExcel, onOpenMonthlyDraft, onAddStudent, onAddCr,
    onPrintReport, onExportLate, onFinancialReportPdf,
    notifications, onOpenStudent, readNotificationIds, deletedNotificationIds,
    onMarkNotificationRead, onMarkAllNotificationsRead, onMarkNotificationUnread,
    onDeleteNotification, onClearAllNotifications, onRestoreDeletedNotifications,
    onOpenCalendarDate, onOpenPayroll, onOpenSettings,
  } = props;

  // The action bar is wide: below xl the title used to get squeezed into a
  // three-line "Gestion / des / Élèves". Stack the two blocks until there is
  // genuinely room for them side by side.
  return (
    <header data-slot="app-header" className="flex flex-col xl:flex-row justify-between items-start xl:items-center gap-6 mb-8">
      <div className="min-w-0">
        <h2 className={`text-2xl sm:text-3xl font-bold ${currentTheme.isDark ? currentTheme.accentSoftText : 'text-slate-800'} tracking-tight whitespace-nowrap`}>
          {activeTab === 'dashboard' ? t.dashboard : 
           activeTab === 'students' ? t.students :
           activeTab === 'parents' ? t.parents :
           activeTab === 'payroll' ? t.payroll :
           activeTab === 'expenses' ? t.expenses : 
           activeTab === 'calendar' ? t.calendar : 
           activeTab === 'archives' ? t.yearlyArchives : 
           activeTab === 'audit' ? (t.auditTrail) : 
           activeTab === 'paymentHistory' ? (t.paymentHistory) : t.settings}
        </h2>
        <div className="flex items-center gap-4 mt-1 min-w-0">
          <p className={`${currentTheme.muted} text-sm flex items-center gap-2 whitespace-nowrap`}>
            <Calendar size={14} className="flex-shrink-0" />
            {new Date().toLocaleDateString(lang === 'en' ? 'en-US' : 'fr-FR', { month: 'long', day: 'numeric', year: 'numeric' })}
          </p>
          <NotificationsPanel
            notifications={notifications}
            currentTheme={currentTheme}
            onOpenStudent={onOpenStudent}
            t={t}
            lang={lang}
            readIds={readNotificationIds}
            deletedIds={deletedNotificationIds}
            onMarkRead={onMarkNotificationRead}
            onMarkAllRead={onMarkAllNotificationsRead}
            onMarkUnread={onMarkNotificationUnread}
            onDelete={onDeleteNotification}
            onClearAll={onClearAllNotifications}
            onRestoreAll={onRestoreDeletedNotifications}
            onOpenCalendarDate={onOpenCalendarDate}
            onOpenPayroll={onOpenPayroll}
            onOpenSettings={onOpenSettings}
          />
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3 w-full xl:w-auto xl:min-w-0 no-print">
        <div className="relative flex-1 min-w-[10rem] sm:flex-none">
          {/* `focus:ring-${currentTheme.accent}/5` used to live here: Tailwind
              never sees an interpolated class, so nothing was generated. The
              focus ring now comes from the one global `:focus-visible` rule in
              index.css, which follows the active theme's accent token. */}
          <select 
            value={selectedYear}
            onChange={(e) => setSelectedYear(e.target.value)}
            className={`w-full pl-10 pr-4 py-3 ${currentTheme.card} ${currentTheme.border} border rounded-2xl shadow-sm transition-all text-sm font-bold ${currentTheme.text} appearance-none cursor-pointer`}
          >
            <option value="">{t.allYears}</option>
            {academicYears.map(year => (
              <option key={year} value={year}>{year}</option>
            ))}
          </select>
          <Calendar className={`absolute left-4 top-1/2 -translate-y-1/2 ${currentTheme.muted}`} size={16} />
        </div>

        {activeTab === 'students' && (
          <button 
            onClick={onPromoteClass}
            className={`px-4 py-3 ${currentTheme.accentBg} ${currentTheme.accentHover} ${currentTheme.accentText} font-bold text-xs rounded-2xl shadow-lg ${currentTheme.accentShadow} transition-all flex items-center gap-2`}
          >
            <GraduationCap size={18} />
            <span className="hidden sm:inline uppercase tracking-widest">{t.promoteClass}</span>
          </button>
        )}

        {/* Import Excel Button — visible on data tabs */}
        {(activeTab === 'students' || activeTab === 'parents' || activeTab === 'payroll' || activeTab === 'expenses') && (currentUser?.role === 'admin' || currentUser?.role === 'dev' || currentUser?.role === 'general_manager') && (
          <button 
            onClick={onImportExcel}
            className={`px-4 py-3 ${currentTheme.accentBg} ${currentTheme.accentHover} ${currentTheme.accentText} font-bold text-xs rounded-2xl shadow-lg ${currentTheme.accentShadow} transition-all flex items-center gap-2 active:scale-[0.97]`}
          >
            <FileSpreadsheet size={18} />
            <span className="hidden sm:inline uppercase tracking-widest">{t.importExcel}</span>
          </button>
        )}

        {activeTab === 'payroll' && (
          <button 
            onClick={onOpenMonthlyDraft}
            className={`px-4 py-3 ${currentTheme.accentBg} ${currentTheme.accentHover} ${currentTheme.accentText} font-bold text-xs rounded-2xl shadow-lg ${currentTheme.accentShadow} transition-all flex items-center gap-2 active:scale-[0.97]`}
            title={t.monthlyPayrollDraft}
          >
            <FileText size={18} />
            <span className="hidden sm:inline uppercase tracking-widest">{t.monthlyDraft}</span>
          </button>
        )}

        {(activeTab === 'students' || activeTab === 'payroll' || activeTab === 'archives' || activeTab === 'expenses') && (
          <button 
            onClick={onPrintReport}
            className={`p-3 rounded-2xl ${currentTheme.accentSoft} ${currentTheme.accentSoftText} ${currentTheme.accentSoftHover} transition-all shadow-sm flex items-center gap-2`}
            title={activeTab === 'archives' ? (t.downloadMultiYearPdf) : activeTab === 'expenses' ? (t.downloadExpensesPdf) : t.printReport}
          >
            {(activeTab === 'archives' || activeTab === 'expenses') ? <FileText size={20} /> : <Printer size={20} />}
            <span className="hidden sm:inline font-bold text-xs uppercase tracking-widest">
              {activeTab === 'archives' ? (t.multiYearPdf) : activeTab === 'expenses' ? (t.expensesPdf) : t.printReport}
            </span>
          </button>
        )}
        {(activeTab === 'students' || activeTab === 'parents') && (
          <div className="relative flex-1 basis-64 min-w-[15rem]">
            <Search className={`absolute left-4 top-1/2 -translate-y-1/2 ${currentTheme.muted}`} size={18} />
            <input 
              type="text"
              placeholder={t.searchPlaceholder}
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className={`w-full min-w-0 pl-12 pr-4 py-3 ${currentTheme.card} ${currentTheme.border} border rounded-2xl shadow-sm transition-all text-sm ${currentTheme.text}`}
            />
          </div>
        )}
        {activeTab === 'students' && (
          <div className="relative min-w-[170px]">
            <select
              value={studentGradeFilter}
              onChange={(e) => setStudentGradeFilter(e.target.value)}
              className={`w-full pl-10 pr-4 py-3 ${currentTheme.card} ${currentTheme.border} border rounded-2xl shadow-sm focus:outline-none ${currentTheme.accentRing} transition-all text-xs font-bold ${currentTheme.text} appearance-none cursor-pointer`}
            >
              <option value="all">{t.allClasses}</option>
              <optgroup label={t.firstCycle1stTo6th}>
                {availableClasses.filter(c => c.cycle === 'cycle1').map(c => (
                  <option key={c.id} value={c.id}>{lang === 'en' ? c.nameEn : c.nameFr}</option>
                ))}
              </optgroup>
              <optgroup label={t.secondCycle7thTo9th}>
                {availableClasses.filter(c => c.cycle === 'cycle2').map(c => (
                  <option key={c.id} value={c.id}>{lang === 'en' ? c.nameEn : c.nameFr}</option>
                ))}
              </optgroup>
              {availableClasses.some(c => c.cycle === NURSERY_CYCLE) && (
                <optgroup label={t.crClasses}>
                  {availableClasses.filter(c => c.cycle === NURSERY_CYCLE).map(c => (
                    <option key={c.id} value={c.id}>{lang === 'en' ? c.nameEn : c.nameFr}</option>
                  ))}
                </optgroup>
              )}
              {availableClasses.some(c => c.cycle !== 'cycle1' && c.cycle !== 'cycle2' && c.cycle !== NURSERY_CYCLE) && (
                <optgroup label={t.otherClasses}>
                  {availableClasses.filter(c => c.cycle !== 'cycle1' && c.cycle !== 'cycle2' && c.cycle !== NURSERY_CYCLE).map(c => (
                    <option key={c.id} value={c.id}>{lang === 'en' ? c.nameEn : c.nameFr}</option>
                  ))}
                </optgroup>
              )}
            </select>
            <Layers className={`absolute left-3.5 top-1/2 -translate-y-1/2 ${currentTheme.muted}`} size={16} />
          </div>
        )}
        {activeTab === 'dashboard' && (
          <div className="flex items-center gap-3">
            <button 
              onClick={onFinancialReportPdf}
              className={`${currentTheme.accentBg} ${currentTheme.accentHover} ${currentTheme.accentText} px-5 py-3 rounded-2xl text-sm font-bold transition-all flex items-center gap-2 shadow-lg ${currentTheme.accentShadow} active:scale-[0.98]`}
              title={t.exportFinancialReportPdf}
            >
              <FileText size={18} />
              <span className="hidden sm:inline">{t.financialReportPdf}</span>
            </button>
            <button 
              onClick={onExportLate}
              className={`${currentTheme.card} border ${currentTheme.border} ${currentTheme.text} px-5 py-3 rounded-2xl text-sm font-bold hover:bg-slate-50 transition-all flex items-center gap-2 shadow-sm`}
            >
              <Download size={18} />
              <span className="hidden sm:inline">{t.exportLate}</span>
            </button>
          </div>
        )}
        {activeTab === 'students' && (
          <button 
            onClick={onAddStudent}
            className={`${currentTheme.accentBg} ${currentTheme.accentText} px-5 py-3 rounded-2xl text-sm font-bold ${currentTheme.accentHover} transition-all flex items-center gap-2 shadow-lg ${currentTheme.accentShadow}`}
          >
            <Plus size={18} />
            <span className="hidden sm:inline">{t.addStudent}</span>
          </button>
        )}
        {/* Le bouton CR est le MÊME formulaire : seule la liste de classes
            change (Petit / Moyen / Grand). Il vit ici, à côté de « Ajouter un
            Élève », parce que c'est là que l'école enrôle un enfant. */}
        {activeTab === 'students' && (
          <button 
            onClick={onAddCr}
            className={`${currentTheme.card} border ${currentTheme.border} ${currentTheme.text} px-5 py-3 rounded-2xl text-sm font-bold hover:bg-slate-50 dark:hover:bg-white/5 transition-all flex items-center gap-2 shadow-sm active:scale-[0.98]`}
            title={t.crClasses}
          >
            <Baby size={18} />
            {/* Libellé TOUJOURS visible (contrairement aux autres actions de la
                barre) : c'est la seule entrée qui ne s'improvise pas — sur un
                écran étroit, une icône seule ne se distingue pas de « + ». */}
            <span>{t.addCrStudent}</span>
          </button>
        )}
      </div>
    </header>
  );
}

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
} from 'lucide-react';
import type { TranslationDict } from '../i18n/translations';
import type { User } from '../app/types';
import type { CurrentTheme, ManagedClass } from '../app/mainViewsProps';
import type { AppTab } from './Sidebar';

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
  onPrintReport: () => void;
  onExportLate: () => void;
  onFinancialReportPdf: () => void;
}

export function AppHeader(props: AppHeaderProps) {
  const {
    t, lang, currentTheme, activeTab, currentUser,
    selectedYear, setSelectedYear, academicYears, availableClasses,
    searchTerm, setSearchTerm, studentGradeFilter, setStudentGradeFilter,
    onPromoteClass, onImportExcel, onOpenMonthlyDraft, onAddStudent,
    onPrintReport, onExportLate, onFinancialReportPdf,
  } = props;

  return (
    <header className="flex flex-col md:flex-row justify-between items-start md:items-center gap-6 mb-12">
      <div>
        <h2 className={`text-3xl font-bold ${currentTheme.isDark ? 'text-emerald-400' : 'text-slate-800'} tracking-tight`}>
          {activeTab === 'dashboard' ? t.dashboard : 
           activeTab === 'students' ? t.students :
           activeTab === 'parents' ? t.parents :
           activeTab === 'payroll' ? t.payroll :
           activeTab === 'expenses' ? t.expenses : 
           activeTab === 'calendar' ? t.calendar : 
           activeTab === 'archives' ? t.yearlyArchives : 
           activeTab === 'audit' ? (t.auditTrail) : t.settings}
        </h2>
        <p className={`${currentTheme.muted} text-sm mt-1 flex items-center gap-2`}>
          <Calendar size={14} />
          {new Date().toLocaleDateString(lang === 'en' ? 'en-US' : 'fr-FR', { month: 'long', day: 'numeric', year: 'numeric' })}
        </p>
      </div>

      <div className="flex items-center gap-4 w-full md:w-auto no-print">
        <div className="relative">
          <select 
            value={selectedYear}
            onChange={(e) => setSelectedYear(e.target.value)}
            className={`pl-10 pr-4 py-3 ${currentTheme.card} ${currentTheme.border} border rounded-2xl shadow-sm focus:outline-none focus:ring-4 focus:ring-${currentTheme.accent}/5 focus:border-${currentTheme.accent} transition-all text-sm font-bold ${currentTheme.text} appearance-none cursor-pointer`}
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
            className="px-4 py-3 bg-emerald-700 hover:bg-emerald-800 text-white font-bold text-xs rounded-2xl shadow-lg shadow-emerald-700/20 transition-all flex items-center gap-2"
          >
            <GraduationCap size={18} />
            <span className="hidden sm:inline uppercase tracking-widest">{t.promoteClass}</span>
          </button>
        )}

        {/* Import Excel Button — visible on data tabs */}
        {(activeTab === 'students' || activeTab === 'parents' || activeTab === 'payroll' || activeTab === 'expenses') && (currentUser?.role === 'admin' || currentUser?.role === 'dev' || currentUser?.role === 'general_manager') && (
          <button 
            onClick={onImportExcel}
            className="px-4 py-3 bg-violet-600 hover:bg-violet-700 text-white font-bold text-xs rounded-2xl shadow-lg shadow-violet-600/20 transition-all flex items-center gap-2 active:scale-[0.97]"
          >
            <FileSpreadsheet size={18} />
            <span className="hidden sm:inline uppercase tracking-widest">{t.importExcel}</span>
          </button>
        )}

        {activeTab === 'payroll' && (
          <button 
            onClick={onOpenMonthlyDraft}
            className="px-4 py-3 bg-emerald-700 hover:bg-emerald-800 text-white font-bold text-xs rounded-2xl shadow-lg shadow-emerald-700/20 transition-all flex items-center gap-2 active:scale-[0.97]"
            title={t.monthlyPayrollDraft}
          >
            <FileText size={18} />
            <span className="hidden sm:inline uppercase tracking-widest">{t.monthlyDraft}</span>
          </button>
        )}

        {(activeTab === 'students' || activeTab === 'payroll' || activeTab === 'archives' || activeTab === 'expenses') && (
          <button 
            onClick={onPrintReport}
            className={`p-3 rounded-2xl ${currentTheme.isDark ? 'bg-emerald-900/20 text-emerald-500' : 'bg-slate-100 text-slate-600'} hover:bg-emerald-600 hover:text-white transition-all shadow-sm flex items-center gap-2`}
            title={activeTab === 'archives' ? (t.downloadMultiYearPdf) : activeTab === 'expenses' ? (t.downloadExpensesPdf) : t.printReport}
          >
            {(activeTab === 'archives' || activeTab === 'expenses') ? <FileText size={20} /> : <Printer size={20} />}
            <span className="hidden sm:inline font-bold text-xs uppercase tracking-widest">
              {activeTab === 'archives' ? (t.multiYearPdf) : activeTab === 'expenses' ? (t.expensesPdf) : t.printReport}
            </span>
          </button>
        )}
        {(activeTab === 'students' || activeTab === 'parents') && (
          <div className="relative flex-1 md:w-80">
            <Search className={`absolute left-4 top-1/2 -translate-y-1/2 ${currentTheme.muted}`} size={18} />
            <input 
              type="text" 
              placeholder={t.searchPlaceholder}
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className={`w-full pl-12 pr-4 py-3 ${currentTheme.card} ${currentTheme.border} border rounded-2xl shadow-sm focus:outline-none focus:ring-4 focus:ring-${currentTheme.accent}/5 focus:border-${currentTheme.accent} transition-all text-sm ${currentTheme.text}`}
            />
          </div>
        )}
        {activeTab === 'students' && (
          <div className="relative min-w-[170px]">
            <select
              value={studentGradeFilter}
              onChange={(e) => setStudentGradeFilter(e.target.value)}
              className={`w-full pl-10 pr-4 py-3 ${currentTheme.card} ${currentTheme.border} border rounded-2xl shadow-sm focus:outline-none focus:ring-4 focus:ring-blue-500/5 focus:border-blue-500 transition-all text-xs font-bold ${currentTheme.text} appearance-none cursor-pointer`}
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
              {availableClasses.some(c => c.cycle !== 'cycle1' && c.cycle !== 'cycle2') && (
                <optgroup label={t.otherClasses}>
                  {availableClasses.filter(c => c.cycle !== 'cycle1' && c.cycle !== 'cycle2').map(c => (
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
              className="bg-emerald-600 hover:bg-emerald-700 text-white px-5 py-3 rounded-2xl text-sm font-bold transition-all flex items-center gap-2 shadow-lg shadow-emerald-500/20 active:scale-[0.98]"
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
            className={`${currentTheme.accentBg} text-white px-5 py-3 rounded-2xl text-sm font-bold ${currentTheme.accentHover} transition-all flex items-center gap-2 shadow-lg ${currentTheme.accentShadow}`}
          >
            <Plus size={18} />
            <span className="hidden sm:inline">{t.addStudent}</span>
          </button>
        )}
      </div>
    </header>
  );
}

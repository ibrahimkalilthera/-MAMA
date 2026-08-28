import { Suspense } from 'react';
import { FileText, Printer, Lock, CheckCircle2 } from 'lucide-react';
import type { Student, Expense, VendorExpense, SalaryPayment } from '../lib/useSupabaseData';
import type { MultiYearReportOptions } from '../lib/pdfMultiYearReport';
import { MultiYearChart } from './MultiYearChart';

export interface ArchivesViewProps {
  lang: 'en' | 'fr';
  t: Record<string, string> & { revenueVsExpenses: string };
  currentTheme: { card: string; border: string; isDark: boolean; muted: string; text: string };
  academicYears: string[];
  lockedYears: string[];
  students: Student[];
  expenses: Expense[];
  vendorExpenses: VendorExpense[];
  salaryPayments: SalaryPayment[];
  selectedYear: string;
  currentUser: { role?: string } | null;
  getYearStats: (year: string) => { revenue: number; expenses: number; balance: number };
  formatCurrency: (value: number) => string;
  generateMultiYearReportPdf: (options: MultiYearReportOptions) => Promise<void>;
  handlePrint: () => void;
  handleCloseCurrentYear: () => Promise<void>;
  setAuditYear: (year: string | null) => void;
  setShowAuditModal: (open: boolean) => void;
}

export function ArchivesView(props: ArchivesViewProps) {
  const { lang, t, currentTheme, academicYears, lockedYears, students, expenses, vendorExpenses, salaryPayments, selectedYear, currentUser, getYearStats, formatCurrency, generateMultiYearReportPdf, handlePrint, handleCloseCurrentYear, setAuditYear, setShowAuditModal } = props;
  return (
          <div className="space-y-12 animate-fade-in">
            {/* Print-Only Official Header */}
            <div className="hidden print:block mb-6 p-6 bg-emerald-700 text-white rounded-2xl">
              <div className="flex justify-between items-center">
                <div>
                  <h1 className="text-2xl font-black">COMPLEXE SCOLAIRE MAMA THERA</h1>
                  <p className="text-sm opacity-90">{lang === 'en' ? 'MULTI-YEAR FINANCIAL COMPARISON & ARCHIVES' : 'BILAN MULTI-ANNUEL & ARCHIVES FINANCIÈRES'}</p>
                </div>
                <div className="text-right text-xs opacity-90">
                  <p>Bamako, Mali</p>
                  <p>{new Date().toLocaleDateString(lang === 'en' ? 'en-US' : 'fr-FR', { year: 'numeric', month: 'long', day: 'numeric' })}</p>
                </div>
              </div>
            </div>

            {/* Grid for annual aggregates & multi-year chart */}
            <div className="grid grid-cols-1 xl:grid-cols-2 gap-12">
              {/* Aggregation Table Card */}
              <div className={`${currentTheme.card} p-8 rounded-[2.5rem] border ${currentTheme.border} shadow-xl shadow-slate-200/50`}>
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-8">
                  <div>
                    <h3 className={`text-xl font-bold ${currentTheme.isDark ? 'text-emerald-400' : 'text-slate-800'}`}>
                      {t.annualAggregation}
                    </h3>
                    <p className={`text-xs ${currentTheme.muted} mt-1`}>
                      {lang === 'en' ? 'Summary of all recorded financial years' : 'Résumé de toutes les années financières enregistrées'}
                    </p>
                  </div>
                  <div className="flex items-center gap-3 no-print">
                    <button
                      onClick={() => generateMultiYearReportPdf({
                        academicYears,
                        lockedYears,
                        students,
                        expenses,
                        vendorExpenses,
                        salaryPayments,
                        lang,
                      })}
                      className="px-4 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold transition-all shadow-md shadow-emerald-600/20 flex items-center gap-2 active:scale-95"
                      title={lang === 'en' ? 'Download Multi-Year PDF Report' : 'Télécharger le Bilan Multi-Annuel en PDF'}
                    >
                      <FileText size={16} />
                      <span>{lang === 'en' ? 'Export PDF Report' : 'Exporter Bilan PDF'}</span>
                    </button>
                    <button
                      onClick={handlePrint}
                      className={`p-2.5 rounded-xl border ${currentTheme.border} ${currentTheme.card} ${currentTheme.text} hover:bg-slate-50 transition-all flex items-center gap-1.5 text-xs font-bold shadow-sm active:scale-95`}
                      title={t.printReport}
                    >
                      <Printer size={16} />
                      <span className="hidden sm:inline">{lang === 'en' ? 'Print' : 'Imprimer'}</span>
                    </button>
                  </div>
                </div>

                <div className="overflow-x-auto rounded-3xl border border-slate-100 dark:border-slate-800">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className={`${currentTheme.isDark ? 'bg-slate-800/50 text-slate-300' : 'bg-slate-50 text-slate-600'} text-xs font-black uppercase tracking-wider`}>
                        <th className="px-6 py-4">{t.schoolYear}</th>
                        <th className="px-6 py-4 text-right">{t.totalRevenueArchive}</th>
                        <th className="px-6 py-4 text-right">{t.totalExpensesArchive}</th>
                        <th className="px-6 py-4 text-right">{t.netBalanceArchive}</th>
                        <th className="px-6 py-4 text-center">{lang === 'en' ? 'Status' : 'Statut'}</th>
                      </tr>
                    </thead>
                    <tbody className={`divide-y ${currentTheme.isDark ? 'divide-slate-800' : 'divide-slate-100'} text-sm`}>
                      {academicYears.map(year => {
                        const { revenue, expenses, balance } = getYearStats(year);
                        const isLocked = lockedYears.includes(year);
                        return (
                          <tr key={year} className={`${currentTheme.isDark ? 'hover:bg-slate-800/30' : 'hover:bg-slate-50/50'} transition-all`}>
                            <td className="px-6 py-4 font-bold">{year}</td>
                            <td className="px-6 py-4 text-right font-semibold text-emerald-600">
                              {formatCurrency(revenue)}
                            </td>
                            <td className="px-6 py-4 text-right font-semibold text-rose-600">
                              {formatCurrency(expenses)}
                            </td>
                            <td className={`px-6 py-4 text-right font-black ${balance >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
                              {formatCurrency(balance)}
                            </td>
                            <td className="px-6 py-4 text-center">
                              {isLocked ? (
                                <span className="inline-flex items-center gap-1.5 px-3 py-1 bg-rose-50 text-rose-700 text-xs font-black rounded-full uppercase tracking-wider border border-rose-200">
                                  <Lock size={10} />
                                  {t.lockedTag}
                                </span>
                              ) : (
                                <span className="inline-flex items-center gap-1.5 px-3 py-1 bg-emerald-50 text-emerald-700 text-xs font-black rounded-full uppercase tracking-wider border border-emerald-200">
                                  <span className="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-pulse" />
                                  {lang === 'en' ? 'Active' : 'Actuelle'}
                                </span>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Multi-Year Comparative Chart Card */}
              <Suspense fallback={
                <div className={`${currentTheme.card} p-8 rounded-[2.5rem] border ${currentTheme.border} shadow-xl shadow-slate-200/50 animate-pulse`}>
                  <div className="h-6 w-72 bg-slate-300 dark:bg-slate-700 rounded-lg mb-8" />
                  <div className="h-[320px] w-full bg-slate-200 dark:bg-slate-800 rounded-2xl" />
                </div>
              }>
                <MultiYearChart
                  academicYears={academicYears}
                  getYearStats={getYearStats}
                  lang={lang}
                  t={t}
                  currentTheme={currentTheme}
                  formatCurrency={formatCurrency}
                />
              </Suspense>
            </div>

            {/* Ibrahim / Admin - Close Out Current Year Section */}
            {(currentUser?.role === 'admin' || currentUser?.role === 'dev') && (
              <div className={`${currentTheme.card} p-10 rounded-[2.5rem] border-2 border-rose-100 dark:border-rose-950/50 bg-rose-50/20 shadow-xl shadow-rose-100/10 no-print`}>
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-8">
                  <div className="space-y-3 max-w-2xl">
                    <div className="inline-flex items-center gap-2 px-4 py-1.5 bg-rose-50 text-rose-700 text-xs font-black rounded-full uppercase tracking-wider border border-rose-200">
                      <Lock size={12} />
                      {lang === 'en' ? 'Admin Controller' : 'Contrôleur Admin'}
                    </div>
                    <h3 className={`text-2xl font-black text-rose-950 dark:text-rose-400`}>
                      {lang === 'en' ? 'Close Active School Year' : "Clôturer l'Année Scolaire Active"}
                    </h3>
                    <p className={`text-sm text-rose-800 dark:text-rose-300`}>
                      {lang === 'en' 
                        ? `Locking the year '${selectedYear}' will freeze all transactions, payroll, expenses, and student fees for this period. Outstanding parent balances (reliquats) will carry over as opening balances into the next year.`
                        : `Le verrouillage de l'année '${selectedYear}' gèlera toutes les transactions, salaires, dépenses et frais scolaires pour cette période. Les arriérés de paiement des parents (reliquats) seront automatiquement reportés comme soldes d'ouverture dans l'année suivante.`}
                    </p>
                    <ul className="text-xs text-rose-700 space-y-1 list-disc pl-5">
                      <li>
                        {lang === 'en' 
                          ? 'Lock all records for the current year, making them read-only.'
                          : 'Verrouiller tous les enregistrements de l\'année en cours (lecture seule).'}
                      </li>
                      <li>
                        {lang === 'en'
                          ? 'Carry over debts (outstanding parent balances) to the next academic year.'
                          : 'Reporter les dettes impayées des parents en solde d\'ouverture pour l\'année suivante.'}
                      </li>
                      <li>
                        {lang === 'en'
                          ? 'Generate a final, downloadable certified accounting audit report.'
                          : 'Générer un bilan comptable annuel certifié téléchargeable et imprimable.'}
                      </li>
                    </ul>
                  </div>

                  <div className="flex-shrink-0">
                    {lockedYears.includes(selectedYear) ? (
                      <div className="flex flex-col items-center gap-3">
                        <span className="px-6 py-4 bg-rose-100 text-rose-800 font-extrabold rounded-3xl text-sm flex items-center gap-2 border border-rose-200">
                          <CheckCircle2 size={18} />
                          {lang === 'en' ? 'Year is Closed & Archived' : 'Cette Année est Clôturée & Archivée'}
                        </span>
                        <button
                          onClick={() => {
                            setAuditYear(selectedYear);
                            setShowAuditModal(true);
                          }}
                          className={`text-xs font-bold text-slate-600 hover:text-slate-800 hover:underline flex items-center gap-1.5`}
                        >
                          <Printer size={12} />
                          {lang === 'en' ? 'View/Print Final Audit' : 'Voir/Imprimer le Bilan Final'}
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={() => {
                          if (confirm(lang === 'en' 
                            ? `Are you sure you want to CLOSE the active year ${selectedYear}? This action locks the year's data and carries over parent debts.` 
                            : `Êtes-vous sûr de vouloir CLÔTURER l'année active ${selectedYear} ? Cette action verrouille les données de l'année et reporte les arriérés de paiement des parents.`)) {
                            handleCloseCurrentYear();
                          }
                        }}
                        className="bg-rose-600 hover:bg-rose-700 text-white font-extrabold px-8 py-5 rounded-3xl text-sm transition-all flex items-center gap-3 shadow-xl shadow-rose-600/30 active:scale-[0.98]"
                      >
                        <Lock size={18} />
                        {t.closeYear}
                      </button>
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>
  );
}

/**
 * Yearly final audit sheet modal — extracted verbatim from AppModals.
 *
 * The certified on-screen preview of the end-of-year audit: school letterhead,
 * the revenue/expenses/balance aggregation for the audited year (getYearStats),
 * the parent debts carried over (derived from the closed-year students) and
 * the signature block. Printing is window.print() — the hidden printable audit
 * report stays a separate always-mounted surface in AppModals.
 *
 * AppModals keeps the AnimatePresence mount gate ({showAuditModal &&
 * auditYear}) and registers the dialog root through overlayRef (focus trap +
 * escape stack slot 7); every other dependency arrives as narrow props, so the
 * component stays presentational. Backdrop, ✕ and the close-preview button all
 * call onClose.
 */
import { motion } from 'motion/react';
import { Printer, TrendingUp, X } from 'lucide-react';
import type { Student } from '../lib/useSupabaseData';
import type { CurrentTheme } from '../app/mainViewsProps';
import type { TranslationDict } from '../i18n/translations';

export interface YearlyAuditSheetModalProps {
  t: TranslationDict;
  lang: 'en' | 'fr';
  currentTheme: CurrentTheme;
  /** Audited year — the caller keeps the {showAuditModal && auditYear} gate,
   *  which narrows the value to string at the call site (non-null while mounted). */
  auditYear: string;
  schoolLogo: string | null;
  students: Student[];
  getYearStats: (year: string) => { revenue: number; expenses: number; balance: number };
  formatCurrency: (amount: number) => string;
  /** The dialog root — registered in AppModals' overlay refs (slot 7). */
  overlayRef: (el: HTMLElement | null) => void;
  /** Backdrop / ✕ / close-preview. */
  onClose: () => void;
}

export function YearlyAuditSheetModal(props: YearlyAuditSheetModalProps) {
  const {
    t,
    lang,
    currentTheme,
    auditYear,
    schoolLogo,
    students,
    getYearStats,
    formatCurrency,
    overlayRef,
    onClose,
  } = props;

  return (
          <div ref={overlayRef} role="dialog" aria-modal="true" aria-label={t.auditSheet} aria-labelledby="modal-title-audit-sheet" className="fixed inset-0 z-50 flex items-center justify-center p-4 no-print">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={onClose}
              className="absolute inset-0 bg-slate-900/60 backdrop-blur-md"
            />
            <motion.div 
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className={`relative ${currentTheme.card} w-full max-w-4xl max-h-[85vh] overflow-y-auto rounded-[2.5rem] shadow-2xl border ${currentTheme.border} p-8 md:p-12 custom-scrollbar`}
            >
              {/* Modal header */}
              <div className="flex justify-between items-start mb-8 pb-6 border-b border-slate-100 dark:border-slate-800">
                <div className="flex items-center gap-4">
                  <div className="p-3 bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600 dark:text-emerald-300 rounded-2xl">
                    <TrendingUp size={24} />
                  </div>
                  <div>
                    <h3 id="modal-title-audit-sheet" className={`text-2xl font-black ${currentTheme.text}`}>
                      {t.finalAcademicAuditSheet}
                    </h3>
                    <p className={`text-sm ${currentTheme.muted} mt-0.5`}>
                      {t.certifiedFinancialReview.replace('{year}', auditYear)}
                    </p>
                  </div>
                </div>
                <button 
                  onClick={onClose}
                  className={`p-2 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-xl transition-all ${currentTheme.muted}`}
                >
                  <X size={20} />
                </button>
              </div>

              {/* Certified Document Content Preview */}
              <div className="p-8 border-2 border-slate-100 dark:border-slate-800 rounded-3xl bg-slate-50/50 dark:bg-slate-800/10 space-y-8 font-sans">
                {/* School Letterhead */}
                <div className="flex justify-between items-start border-b-2 border-slate-200 dark:border-slate-700 pb-6">
                  <div>
                    <h4 className="text-xl font-black text-slate-800 dark:text-slate-200 tracking-tight flex items-center gap-2">
                      {schoolLogo && (
                        <img src={schoolLogo} alt="Logo" className="w-8 h-8 rounded-lg object-cover" referrerPolicy="no-referrer" />
                      )}
                      {t.title}
                    </h4>
                    <p className="text-xs text-slate-500 mt-1 uppercase tracking-wider font-bold">{t.subtitle}</p>
                    <p className="text-[10px] text-slate-400">Ségou, Mali</p>
                  </div>
                  <div className="text-right">
                    <span className="px-3 py-1 bg-emerald-100 dark:bg-emerald-950/60 text-emerald-800 dark:text-emerald-300 text-[10px] font-black rounded-full uppercase tracking-wider">
                      {t.archivedCertified}
                    </span>
                    <p className="text-xs text-slate-500 mt-2 font-bold">{t.date2} {new Date().toLocaleDateString(lang === 'en' ? 'en-US' : 'fr-FR')}</p>
                    <p className="text-[10px] text-slate-400">{t.auditId} AUD-{auditYear}-{Math.floor(1000 + Math.random() * 9000)}</p>
                  </div>
                </div>

                {/* Main Metrics Aggregation */}
                {(() => {
                  const { revenue, expenses, balance } = getYearStats(auditYear);
                  return (
                    <div className="space-y-6">
                      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                        <div className="p-6 bg-emerald-50/50 dark:bg-emerald-950/10 rounded-2xl border border-emerald-100 dark:border-emerald-950">
                          <span className="text-xs font-bold text-emerald-700 dark:text-emerald-400 uppercase tracking-wider">{t.totalRevenueA}</span>
                          <p className="text-2xl font-black text-emerald-600 mt-1">{formatCurrency(revenue)}</p>
                          <p className="text-[10px] text-slate-400 mt-1">{t.actualStudentFeesPaid}</p>
                        </div>

                        <div className="p-6 bg-rose-50/50 dark:bg-rose-950/10 rounded-2xl border border-rose-100 dark:border-rose-950">
                          <span className="text-xs font-bold text-rose-700 dark:text-rose-400 uppercase tracking-wider">{t.totalExpensesB}</span>
                          <p className="text-2xl font-black text-rose-600 mt-1">{formatCurrency(expenses)}</p>
                          <p className="text-[10px] text-slate-400 mt-1">{t.salariesVendorsUtilityPayments}</p>
                        </div>

                        <div className={`p-6 ${balance >= 0 ? 'bg-teal-50/50 dark:bg-teal-950/10 border-teal-100 dark:border-teal-950' : 'bg-red-50/50 dark:bg-red-950/10 border-red-100 dark:border-red-950'} rounded-2xl border`}>
                          <span className={`text-xs font-bold ${balance >= 0 ? 'text-teal-700 dark:text-teal-400' : 'text-red-700 dark:text-red-400'} uppercase tracking-wider`}>{t.netBalanceAB}</span>
                          <p className={`text-2xl font-black ${balance >= 0 ? 'text-teal-600' : 'text-red-600'} mt-1`}>{formatCurrency(balance)}</p>
                          <p className="text-[10px] text-slate-400 mt-1">{t.finalCashLedgerBalance}</p>
                        </div>
                      </div>

                      {/* Debts Carried Over (Reliquats) */}
                      {(() => {
                        const closedYearStudents = students.filter(s => s.academicYear === auditYear || (!s.academicYear && auditYear === '2024-2025'));
                        const studentsWithDebt = closedYearStudents.filter(s => {
                          const discount = s.scholarshipDiscount || 0;
                          const discountedTotal = s.totalDue * (1 - discount / 100);
                          return (discountedTotal - s.amountPaid) > 0;
                        });

                        return (
                          <div className="space-y-3 pt-4 border-t border-slate-200 dark:border-slate-700">
                            <h5 className="font-extrabold text-sm text-slate-700 dark:text-slate-300 uppercase tracking-wider">
                              {t.outstandingParentDebtsCarriedForward}
                            </h5>
                            {studentsWithDebt.length > 0 ? (
                              <div className="max-h-[200px] overflow-y-auto rounded-2xl border border-slate-100 dark:border-slate-800">
                                <table className="w-full text-left text-xs">
                                  <thead>
                                    <tr className="bg-slate-100 dark:bg-slate-800 border-b border-slate-200 dark:border-slate-700 font-bold text-slate-600 dark:text-slate-300">
                                      <th className="px-4 py-2.5">{t.studentName2}</th>
                                      <th className="px-4 py-2.5">{t.parentContact2}</th>
                                      <th className="px-4 py-2.5 text-right">{t.unpaidBalance}</th>
                                    </tr>
                                  </thead>
                                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                                    {studentsWithDebt.map(student => {
                                      const discount = student.scholarshipDiscount || 0;
                                      const discountedTotal = student.totalDue * (1 - discount / 100);
                                      const debt = discountedTotal - student.amountPaid;
                                      return (
                                        <tr key={student.id} className="text-slate-700 dark:text-slate-300">
                                          <td className="px-4 py-2 font-bold">{student.name}</td>
                                          <td className="px-4 py-2">{student.parentName} ({student.parentPhone})</td>
                                          <td className="px-4 py-2 text-right font-semibold text-rose-600">{formatCurrency(debt)}</td>
                                        </tr>
                                      );
                                    })}
                                  </tbody>
                                </table>
                              </div>
                            ) : (
                              <p className="text-xs text-slate-400 italic">
                                {t.noOutstandingStudentDebtsRecordedForCarryforward}
                              </p>
                            )}
                          </div>
                        );
                      })()}
                    </div>
                  );
                })()}

                {/* Audit Signature Block */}
                <div className="flex justify-between items-center pt-8 border-t-2 border-slate-200 dark:border-slate-700 text-xs">
                  <div>
                    <p className="font-bold text-slate-500">{t.certifiedBy}</p>
                    <p className="font-black text-slate-800 dark:text-slate-200 mt-1">Ibrahim Thera, Portal Admin</p>
                    <p className="text-slate-400 text-[10px]">{t.financeController}</p>
                  </div>
                  <div className="text-right">
                    <p className="font-bold text-slate-500">{t.sealSignature}</p>
                    <div className="h-10 w-40 border-b border-dashed border-slate-300 dark:border-slate-600 mt-2 ml-auto" />
                    <p className="text-[9px] text-slate-400 mt-1">Ibrahim Thera / Executive Signature</p>
                  </div>
                </div>
              </div>

              {/* Modal Actions */}
              <div className="flex justify-end gap-4 mt-8 pt-6 border-t border-slate-100 dark:border-slate-800">
                <button 
                  onClick={onClose}
                  className={`h-11 px-4 rounded-2xl border ${currentTheme.border} ${currentTheme.text} hover:bg-slate-50 text-xs font-black transition-all whitespace-nowrap`}
                >
                  {t.closePreview}
                </button>
                <button 
                  onClick={() => {
                    setTimeout(() => window.print(), 100);
                  }}
                  className="bg-emerald-600 hover:bg-emerald-700 text-white font-extrabold h-11 px-4 rounded-2xl text-xs transition-all flex items-center gap-2 shadow-lg shadow-emerald-600/20 whitespace-nowrap"
                >
                  <Printer size={16} className="flex-shrink-0" />
                  {t.printAudit}
                </button>
              </div>
            </motion.div>
          </div>
  );
}

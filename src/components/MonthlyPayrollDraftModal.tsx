import React, { useRef } from 'react';
import { useEscapeToClose } from '../lib/useEscapeToClose';
import { useFocusTrap } from '../lib/focusStack';
import { motion, AnimatePresence } from 'motion/react';
import {
  X,
  FileText,
  Download,
  Printer,
  Calendar,
  DollarSign,
  CheckCircle2,
  AlertCircle,
  Clock,
  Plus,
  Users
} from 'lucide-react';
import type { Staff, SalaryPayment } from '../lib/useSupabaseData';
import { generateMonthlyPayrollDraftPdf } from '../lib/pdfPayrollDraft';

interface MonthlyPayrollDraftModalProps {
  isOpen: boolean;
  onClose: () => void;
  lang?: 'en' | 'fr';
  staff: Staff[];
  salaryPayments: SalaryPayment[];
  selectedAcademicYear: string;
  monthIndex: number;
  year: number;
  onMonthChange: (monthIndex: number) => void;
  onYearChange: (year: number) => void;
  onExportExcel: (monthIndex: number, year: number) => void;
  onRecordPayment: (staffId: string, balance: number) => void;
  formatCurrency: (amount: number) => string;
  themeCard: string;
  themeBorder: string;
  themeMuted: string;
  themeIsDark: boolean;
  t: Record<string, string>;
}

const MONTHS_FR = [
  'Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin',
  'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre'
];

const MONTHS_EN = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'
];

export function MonthlyPayrollDraftModal({
  isOpen,
  onClose,
  lang = 'fr',
  staff,
  salaryPayments,
  selectedAcademicYear,
  monthIndex,
  year,
  onMonthChange,
  onYearChange,
  onExportExcel,
  onRecordPayment,
  formatCurrency,
  themeCard,
  themeBorder,
  themeMuted,
  themeIsDark,
  t,
}: MonthlyPayrollDraftModalProps) {
  // Escape behaves like the cancel button (mounted only while open).
  useEscapeToClose(isOpen, onClose);
  // Tab is confined to the draft sheet; focus returns to the trigger on close.
  const rootRef = useRef<HTMLDivElement | null>(null);
  useFocusTrap(isOpen, () => rootRef.current);

  if (!isOpen) return null;

  const isFr = lang === 'fr';
  const monthNames = isFr ? MONTHS_FR : MONTHS_EN;
  const currentMonthName = monthNames[monthIndex];

  // Calculate monthly stats
  const staffPayrollList = staff.map((s, index) => {
    const paymentsThisMonth = salaryPayments.filter(p => {
      const payDate = new Date(p.date);
      return payDate.getFullYear() === year && payDate.getMonth() === monthIndex && p.staffId === s.id;
    });

    const totalPaid = paymentsThisMonth.reduce((sum, p) => sum + (p.amount || 0), 0);
    const balance = Math.max(0, s.salary - totalPaid);
    const lastPayDate = paymentsThisMonth.length > 0 ? paymentsThisMonth[paymentsThisMonth.length - 1].date : '—';

    let statusType: 'paid' | 'partial' | 'unpaid' = 'unpaid';
    if (totalPaid >= s.salary && s.salary > 0) {
      statusType = 'paid';
    } else if (totalPaid > 0) {
      statusType = 'partial';
    }

    return {
      index: index + 1,
      id: s.id,
      name: s.name,
      position: s.position,
      salary: s.salary,
      totalPaid,
      balance,
      lastPayDate,
      statusType,
      paymentsCount: paymentsThisMonth.length,
    };
  });

  const grandTotalExpected = staffPayrollList.reduce((sum, s) => sum + s.salary, 0);
  const grandTotalPaid = staffPayrollList.reduce((sum, s) => sum + s.totalPaid, 0);
  const grandTotalRemaining = staffPayrollList.reduce((sum, s) => sum + s.balance, 0);
  const paidCount = staffPayrollList.filter(s => s.statusType === 'paid').length;

  const handleExportPdf = () => {
    generateMonthlyPayrollDraftPdf({
      monthIndex,
      year,
      staff,
      salaryPayments,
      selectedAcademicYear,
      lang,
    });
  };

  return (
    <AnimatePresence>
      <div ref={rootRef} role="dialog" aria-modal="true" aria-label={t.monthlyPayrollDisbursementDraft} className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-md animate-fade-in no-print">
        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: 20 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 20 }}
          className={`w-full max-w-5xl ${themeCard} rounded-[2.5rem] border ${themeBorder} shadow-2xl overflow-hidden flex flex-col max-h-[90vh]`}
        >
          {/* Modal Header */}
          <div className={`p-6 sm:p-8 border-b ${themeBorder} flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-slate-900 text-white`}>
            <div className="flex items-center gap-3.5">
              <div className="p-3 bg-emerald-600/90 rounded-2xl text-white shadow-lg shadow-emerald-500/20">
                <FileText size={24} />
              </div>
              <div>
                <h3 className="font-extrabold text-lg sm:text-xl tracking-tight">
                  {t.monthlyPayrollDisbursementDraft}
                </h3>
                <p className="text-xs text-white/60 font-medium mt-0.5">
                  {t.disbursementSummary.replace('{month}', currentMonthName).replace('{year}', String(year))}
                </p>
              </div>
            </div>

            {/* Month & Year Selectors */}
            <div className="flex items-center gap-3">
              <select
                value={monthIndex}
                onChange={(e) => onMonthChange(parseInt(e.target.value, 10))}
                className="bg-slate-800 text-white text-xs font-bold px-3 py-2 rounded-xl border border-white/10 focus:outline-none cursor-pointer"
              >
                {monthNames.map((m, idx) => (
                  <option key={idx} value={idx}>{m}</option>
                ))}
              </select>

              <select
                value={year}
                onChange={(e) => onYearChange(parseInt(e.target.value, 10))}
                className="bg-slate-800 text-white text-xs font-bold px-3 py-2 rounded-xl border border-white/10 focus:outline-none cursor-pointer"
              >
                {[2024, 2025, 2026, 2027, 2028].map(y => (
                  <option key={y} value={y}>{y}</option>
                ))}
              </select>

              <button
                onClick={onClose}
                className="p-2 text-white/60 hover:text-white hover:bg-white/10 rounded-xl transition-all ml-1"
              >
                <X size={20} />
              </button>
            </div>
          </div>

          {/* Modal Body */}
          <div className="p-6 sm:p-8 space-y-6 overflow-y-auto flex-1 custom-scrollbar">
            {/* KPI Summary Cards */}
            <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
              <div className={`p-5 rounded-2xl border ${themeBorder} ${themeIsDark ? 'bg-slate-800/60' : 'bg-slate-50'}`}>
                <p className={`text-[10px] font-bold uppercase tracking-widest ${themeMuted} mb-1`}>
                  {t.totalBudget}
                </p>
                <h4 className={`text-xl font-black ${themeIsDark ? 'text-white' : 'text-slate-900'}`}>
                  {formatCurrency(grandTotalExpected)}
                </h4>
              </div>

              <div className="p-5 rounded-2xl border border-emerald-200 bg-emerald-50/60 dark:bg-emerald-950/20 dark:border-emerald-900/30">
                <p className="text-[10px] font-bold uppercase tracking-widest text-emerald-700 dark:text-emerald-400 mb-1">
                  {t.paidThisMonth}
                </p>
                <h4 className="text-xl font-black text-emerald-700 dark:text-emerald-400">
                  {formatCurrency(grandTotalPaid)}
                </h4>
              </div>

              <div className="p-5 rounded-2xl border border-rose-200 bg-rose-50/60 dark:bg-rose-950/20 dark:border-rose-900/30">
                <p className="text-[10px] font-bold uppercase tracking-widest text-rose-700 dark:text-rose-400 mb-1">
                  {t.remainingArrears}
                </p>
                <h4 className="text-xl font-black text-rose-700 dark:text-rose-400">
                  {formatCurrency(grandTotalRemaining)}
                </h4>
              </div>

              <div className={`p-5 rounded-2xl border ${themeBorder} ${themeIsDark ? 'bg-slate-800/60' : 'bg-slate-50'}`}>
                <p className={`text-[10px] font-bold uppercase tracking-widest ${themeMuted} mb-1`}>
                  {t.employeesSettled}
                </p>
                <h4 className={`text-xl font-black ${themeIsDark ? 'text-white' : 'text-slate-900'}`}>
                  {paidCount} / {staff.length}
                </h4>
              </div>
            </div>

            {/* Staff Breakdown Table */}
            <div className={`rounded-2xl border ${themeBorder} overflow-hidden`}>
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className={`text-[10px] font-black uppercase tracking-wider ${themeIsDark ? 'bg-slate-800/80 text-slate-300' : 'bg-slate-100 text-slate-600'}`}>
                      <th className="px-6 py-4">{t.employeeRole}</th>
                      <th className="px-6 py-4 text-right">{t.baseSalary}</th>
                      <th className="px-6 py-4 text-right">{t.paidThisMonth2}</th>
                      <th className="px-6 py-4 text-right">{t.balanceDue}</th>
                      <th className="px-6 py-4">{t.lastPaymentDate}</th>
                      <th className="px-6 py-4 text-center">{t.status}</th>
                      <th className="px-6 py-4 text-right">{t.actions}</th>
                    </tr>
                  </thead>
                  <tbody className={`divide-y ${themeBorder} text-xs`}>
                    {staffPayrollList.length > 0 ? (
                      staffPayrollList.map(st => (
                        <tr key={st.id} className={`${themeIsDark ? 'hover:bg-slate-800/40' : 'hover:bg-slate-50'} transition-all`}>
                          <td className="px-6 py-4">
                            <p className="font-bold">{st.name}</p>
                            <p className={`text-[10px] ${themeMuted} uppercase font-semibold`}>{st.position}</p>
                          </td>
                          <td className="px-6 py-4 text-right font-semibold">
                            {formatCurrency(st.salary)}
                          </td>
                          <td className="px-6 py-4 text-right font-bold text-emerald-600">
                            {formatCurrency(st.totalPaid)}
                          </td>
                          <td className={`px-6 py-4 text-right font-black ${st.balance > 0 ? 'text-rose-600' : 'text-slate-400'}`}>
                            {formatCurrency(st.balance)}
                          </td>
                          <td className="px-6 py-4 text-slate-500 font-mono text-[11px]">
                            {st.lastPayDate}
                          </td>
                          <td className="px-6 py-4 text-center">
                            {st.statusType === 'paid' ? (
                              <span className="px-2.5 py-1 bg-emerald-100 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-400 rounded-full text-[10px] font-black uppercase tracking-wider">
                                {t.paid2}
                              </span>
                            ) : st.statusType === 'partial' ? (
                              <span className="px-2.5 py-1 bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-400 rounded-full text-[10px] font-black uppercase tracking-wider">
                                {t.partial2}
                              </span>
                            ) : (
                              <span className="px-2.5 py-1 bg-rose-100 text-rose-800 dark:bg-rose-950/40 dark:text-rose-400 rounded-full text-[10px] font-black uppercase tracking-wider">
                                {t.unpaid}
                              </span>
                            )}
                          </td>
                          <td className="px-6 py-4 text-right">
                            {st.balance > 0 && (
                              <button
                                onClick={() => {
                                  onRecordPayment(st.id, st.balance);
                                  onClose();
                                }}
                                className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg font-bold text-[11px] transition-all flex items-center gap-1 ml-auto shadow-sm"
                              >
                                <Plus size={12} />
                                <span>{t.pay}</span>
                              </button>
                            )}
                          </td>
                        </tr>
                      ))
                    ) : (
                      <tr>
                        <td colSpan={7} className="px-6 py-12 text-center text-slate-400 italic">
                          {t.noStaffMembersRegistered}
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          {/* Modal Footer / Action Toolbar */}
          <div className={`p-6 border-t ${themeBorder} flex flex-col sm:flex-row items-center justify-between gap-4 bg-slate-50/50 dark:bg-slate-900/40`}>
            <p className={`text-xs ${themeMuted}`}>
              {t.officialDraftFor.replace('{month}', currentMonthName).replace('{year}', String(year))}
            </p>

            <div className="flex items-center gap-3 w-full sm:w-auto justify-end flex-wrap">
              <button
                onClick={handleExportPdf}
                className="px-5 py-2.5 bg-rose-600 hover:bg-rose-700 text-white rounded-xl text-xs font-black transition-all shadow-md shadow-rose-600/20 flex items-center gap-2 active:scale-95"
              >
                <FileText size={16} />
                <span>{t.exportDraftPdf}</span>
              </button>

              <button
                onClick={() => onExportExcel(monthIndex, year)}
                className="px-5 py-2.5 bg-emerald-700 hover:bg-emerald-800 text-white rounded-xl text-xs font-black transition-all shadow-md shadow-emerald-700/20 flex items-center gap-2 active:scale-95"
              >
                <Download size={16} />
                <span>{t.exportExcel}</span>
              </button>

              <button
                onClick={onClose}
                className={`px-5 py-2.5 rounded-xl border ${themeBorder} text-xs font-bold ${themeIsDark ? 'text-slate-400 hover:text-white' : 'text-slate-600 hover:text-slate-900'} transition-all`}
              >
                {t.close}
              </button>
            </div>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
}

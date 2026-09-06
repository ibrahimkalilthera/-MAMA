/**
 * RecordSalaryModal — Salary payment form — extracted verbatim from AppModals. Picks a staff
 * member, shows the remaining balance for the current month, records the
 * payment and offers the installment memo. Presentational; overlayRef injected.
 */
import { DollarSign, Copy } from 'lucide-react';
import type { Dispatch, SetStateAction, FormEvent } from 'react';
import type { Staff, SalaryPayment } from '../lib/useSupabaseData';
import type { SalaryForm, CurrentTheme } from '../app/mainViewsProps';
import type { TranslationDict } from '../i18n/translations';
import { ModalShell } from './ModalShell';

export interface RecordSalaryModalProps {
  t: TranslationDict;
  currentTheme: CurrentTheme;
  staff: Staff[];
  salaryPayments: SalaryPayment[];
  currentMonth: number;
  salaryForm: SalaryForm;
  setSalaryForm: Dispatch<SetStateAction<SalaryForm>>;
  formatCurrency: (amount: number) => string;
  generateInstallmentMemo: (staffId: string, amount: number) => void;
  handleSalarySubmit: (e: FormEvent) => Promise<void>;
  /** The dialog root — registered in AppModals' overlay refs (focus trap). */
  overlayRef: (el: HTMLElement | null) => void;
  onClose: () => void;
}

export function RecordSalaryModal(props: RecordSalaryModalProps) {
  const { t, currentTheme, staff, salaryPayments, currentMonth, salaryForm, setSalaryForm, formatCurrency, generateInstallmentMemo, handleSalarySubmit, overlayRef, onClose } = props;

  // Remaining balance for the CURRENT calendar month (year AND month): a
  // payment dated the same month of a previous year must not count against
  // this month's salary. Single derivation feeding the select labels, the
  // auto-fill amount and the summary — they can never disagree.
  const currentYear = new Date().getFullYear();
  const remainingFor = (staffId: string): number => {
    const member = staff.find((s) => s.id === staffId);
    if (!member) return 0;
    const paidThisMonth = salaryPayments
      .filter((p) => {
        const d = new Date(p.date);
        return p.staffId === staffId && d.getFullYear() === currentYear && d.getMonth() === currentMonth;
      })
      .reduce((sum, p) => sum + p.amount, 0);
    return member.salary - paidThisMonth;
  };
  return (
    <ModalShell
      overlayRef={overlayRef}
      onClose={onClose}
      currentTheme={currentTheme}
      titleId="modal-title-record-salary"
      ariaLabel={t.recordSalary}
      icon={<DollarSign size={24} className="text-emerald-400" />}
      title={t.recordSalaryPayment}
    >

              <form onSubmit={handleSalarySubmit} className="p-10 space-y-6">
                <div className="space-y-2">
                  <label className={`text-[10px] font-black ${currentTheme.muted} uppercase tracking-widest`}>{t.staffName}</label>
                  <select 
                    required
                    value={salaryForm.staffId}
                    onChange={(e) => {
                      const sId = e.target.value;
                      setSalaryForm(
                        staff.some((st) => st.id === sId)
                          ? { ...salaryForm, staffId: sId, amount: remainingFor(sId).toString() }
                          : { ...salaryForm, staffId: sId },
                      );
                    }}
                    className={`w-full px-6 py-4 ${currentTheme.isDark ? 'bg-emerald-900/10' : 'bg-slate-50'} border ${currentTheme.border} rounded-2xl focus:outline-none focus:ring-4 focus:ring-blue-500/5 focus:border-blue-500 transition-all text-sm font-semibold ${currentTheme.isDark ? 'text-emerald-500' : 'text-slate-800'}`}
                  >
                    <option value="">{t.selectStaff}</option>
                    {staff.map(s => (
                      <option key={s.id} value={s.id}>{s.name} ({formatCurrency(remainingFor(s.id))} {t.remainingBalance})</option>
                    ))}
                  </select>
                </div>
                {salaryForm.staffId && (
                  <div className={`p-4 rounded-2xl ${currentTheme.isDark ? 'bg-emerald-900/20' : 'bg-slate-50'} border ${currentTheme.border}`}>
                    <div className="flex justify-between items-center text-xs">
                      <span className={currentTheme.muted}>{t.remainingBalance}</span>
                      <span className="font-black text-rose-600">
                        {formatCurrency(remainingFor(salaryForm.staffId))}
                      </span>
                    </div>
                  </div>
                )}
                <div className="grid grid-cols-2 gap-6">
                  <div className="space-y-2">
                    <label className={`text-[10px] font-black ${currentTheme.muted} uppercase tracking-widest`}>{t.amount} ({t.currency})</label>
                    <input 
                      required
                      type="number" 
                      min="0"
                      max={(() => { const member = staff.find((s) => s.id === salaryForm.staffId); return member ? member.salary : undefined; })()}
                      value={salaryForm.amount}
                      onChange={(e) => setSalaryForm({ ...salaryForm, amount: e.target.value })}
                      className={`w-full px-6 py-4 ${currentTheme.isDark ? 'bg-emerald-900/10' : 'bg-slate-50'} border ${currentTheme.border} rounded-2xl focus:outline-none focus:ring-4 focus:ring-blue-500/5 focus:border-blue-500 transition-all text-sm font-semibold ${currentTheme.isDark ? 'text-emerald-500' : 'text-slate-800'}`}
                    />
                  </div>
                  <div className="space-y-2">
                    <label className={`text-[10px] font-black ${currentTheme.muted} uppercase tracking-widest`}>{t.date}</label>
                    <input 
                      required
                      type="date" 
                      value={salaryForm.date}
                      onChange={(e) => setSalaryForm({ ...salaryForm, date: e.target.value })}
                      className={`w-full px-6 py-4 ${currentTheme.isDark ? 'bg-emerald-900/10' : 'bg-slate-50'} border ${currentTheme.border} rounded-2xl focus:outline-none focus:ring-4 focus:ring-blue-500/5 focus:border-blue-500 transition-all text-sm font-semibold ${currentTheme.isDark ? 'text-emerald-500' : 'text-slate-800'}`}
                    />
                  </div>
                </div>

                {salaryForm.staffId && salaryForm.amount && (
                  <button 
                    type="button"
                    onClick={() => generateInstallmentMemo(salaryForm.staffId, parseFloat(salaryForm.amount))}
                    className={`w-full py-4 rounded-2xl border ${currentTheme.isDark ? 'border-emerald-900/30 text-emerald-500 hover:bg-emerald-900/10' : 'border-slate-100 text-slate-600 hover:bg-slate-50'} text-xs font-bold transition-all flex items-center justify-center gap-2`}
                  >
                    <Copy size={16} />
                    {t.generateMemo}
                  </button>
                )}

                <button type="submit" className="w-full bg-emerald-600 hover:bg-emerald-700 text-white py-5 rounded-2xl font-black text-sm transition-all shadow-xl shadow-emerald-500/20">
                  {t.submit}
                </button>
              </form>
    </ModalShell>
  );
}

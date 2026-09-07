/**
 * PaymentEntryModal — Payment entry form — extracted verbatim from AppModals. Cashier picks
 * the student (live outstanding balance) + amount + date and submits;
 * pure presentational, narrow props + overlayRef.
 */
import { CreditCard } from 'lucide-react';
import type { Dispatch, SetStateAction, FormEvent } from 'react';
import type { Student } from '../lib/useSupabaseData';
import type { CurrentTheme } from '../app/mainViewsProps';
import type { TranslationDict } from '../i18n/translations';
import { ModalShell } from './ModalShell';

export interface PaymentEntryModalProps {
  t: TranslationDict;
  currentTheme: CurrentTheme;
  students: Student[];
  paymentStudentId: string;
  setPaymentStudentId: Dispatch<SetStateAction<string>>;
  paymentAmount: string;
  setPaymentAmount: Dispatch<SetStateAction<string>>;
  paymentDate: string;
  setPaymentDate: Dispatch<SetStateAction<string>>;
  formatCurrency: (amount: number) => string;
  handlePaymentSubmit: (e: FormEvent) => Promise<void>;
  /** The dialog root — registered in AppModals' overlay refs (focus trap). */
  overlayRef: (el: HTMLElement | null) => void;
  onClose: () => void;
}

export function PaymentEntryModal(props: PaymentEntryModalProps) {
  const { t, currentTheme, students, paymentStudentId, setPaymentStudentId, paymentAmount, setPaymentAmount, paymentDate, setPaymentDate, formatCurrency, handlePaymentSubmit, overlayRef, onClose } = props;
  return (
    <ModalShell
      overlayRef={overlayRef}
      onClose={onClose}
      currentTheme={currentTheme}
      titleId="modal-title-payment-entry"
      ariaLabel={t.paymentEntry}
      maxWidth="max-w-md"
      icon={<CreditCard size={24} className="text-blue-400" />}
      title={t.paymentEntry}
    >

              <form onSubmit={handlePaymentSubmit} className="p-10 space-y-8">
                <div className="space-y-2">
                  <label className={`text-[10px] font-black ${currentTheme.muted} uppercase tracking-widest`}>{t.selectStudent}</label>
                  <select 
                    required
                    value={paymentStudentId}
                    onChange={(e) => setPaymentStudentId(e.target.value)}
                    className={`w-full px-6 py-4 ${currentTheme.isDark ? 'bg-emerald-900/10' : 'bg-slate-50'} border ${currentTheme.border} rounded-2xl focus:outline-none focus:ring-4 focus:ring-blue-500/5 focus:border-blue-500 transition-all text-sm font-semibold ${currentTheme.isDark ? 'text-emerald-500' : 'text-slate-800'}`}
                  >
                    <option value="" className={currentTheme.isDark ? 'bg-[#121212]' : 'bg-white'}>{t.selectStudent}...</option>
                    {students.map(s => (
                      <option key={s.id} value={s.id} className={currentTheme.isDark ? 'bg-[#121212]' : 'bg-white'}>{s.name} ({formatCurrency(s.totalDue * (1 - (s.scholarshipDiscount || 0) / 100) - s.amountPaid)} {t.balance})</option>
                    ))}
                  </select>
                </div>

                <div className="grid grid-cols-2 gap-6">
                  <div className="space-y-2">
                    <label className={`text-[10px] font-black ${currentTheme.muted} uppercase tracking-widest`}>{t.amount} ({t.currency})</label>
                    <div className="relative">
                      <input 
                        required
                        type="number" 
                        min="0"
                        step="1"
                        value={paymentAmount}
                        onChange={(e) => setPaymentAmount(e.target.value)}
                        className={`w-full px-6 py-4 ${currentTheme.isDark ? 'bg-emerald-900/10' : 'bg-slate-50'} border ${currentTheme.border} rounded-2xl focus:outline-none focus:ring-4 focus:ring-blue-500/5 focus:border-blue-500 transition-all text-sm font-semibold ${currentTheme.isDark ? 'text-emerald-500' : 'text-slate-800'}`}
                        placeholder="10 000"
                      />
                    </div>
                  </div>
                  <div className="space-y-2">
                    <label className={`text-[10px] font-black ${currentTheme.muted} uppercase tracking-widest`}>{t.paymentDate}</label>
                    <input 
                      required
                      type="date" 
                      value={paymentDate}
                      onChange={(e) => setPaymentDate(e.target.value)}
                      className={`w-full px-6 py-4 ${currentTheme.isDark ? 'bg-emerald-900/10' : 'bg-slate-50'} border ${currentTheme.border} rounded-2xl focus:outline-none focus:ring-4 focus:ring-blue-500/5 focus:border-blue-500 transition-all text-sm font-semibold ${currentTheme.isDark ? 'text-emerald-500' : 'text-slate-800'}`}
                    />
                  </div>
                </div>

                <button 
                  type="submit"
                  className="w-full bg-blue-600 hover:bg-blue-700 text-white py-5 rounded-2xl font-black text-sm transition-all shadow-xl shadow-blue-500/20 active:scale-[0.98]"
                >
                  {t.submit}
                </button>
              </form>
    </ModalShell>
  );
}

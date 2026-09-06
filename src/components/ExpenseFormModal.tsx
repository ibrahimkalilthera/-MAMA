/**
 * ExpenseFormModal — General expense add/edit form — extracted verbatim from AppModals.
 * Pure presentational form (category/description/amount/date) driven by
 * narrow props; overlay root ref injected as overlayRef.
 */
import { Receipt } from 'lucide-react';
import type { Dispatch, SetStateAction, FormEvent } from 'react';
import type { CurrentTheme, ExpenseForm } from '../app/mainViewsProps';
import type { TranslationDict } from '../i18n/translations';
import { ModalShell } from './ModalShell';

export interface ExpenseFormModalProps {
  t: TranslationDict;
  currentTheme: CurrentTheme;
  expenseForm: ExpenseForm;
  setExpenseForm: Dispatch<SetStateAction<ExpenseForm>>;
  handleExpenseSubmit: (e: FormEvent) => Promise<void>;
  /** The dialog root — registered in AppModals' overlay refs (focus trap). */
  overlayRef: (el: HTMLElement | null) => void;
  onClose: () => void;
}

export function ExpenseFormModal(props: ExpenseFormModalProps) {
  const { t, currentTheme, expenseForm, setExpenseForm, handleExpenseSubmit, overlayRef, onClose } = props;
  return (
    <ModalShell
      overlayRef={overlayRef}
      onClose={onClose}
      currentTheme={currentTheme}
      titleId="modal-title-add-expense"
      ariaLabel={t.addExpense}
      headerClassName="p-8 border-b border-rose-100 flex justify-between items-center bg-rose-600 text-white"
      icon={<Receipt size={24} />}
      title={t.addExpense}
    >

              <form onSubmit={handleExpenseSubmit} className="p-10 space-y-6">
                <div className="space-y-2">
                  <label className={`text-[10px] font-black ${currentTheme.muted} uppercase tracking-widest`}>{t.category}</label>
                  <select 
                    value={expenseForm.category}
                    onChange={(e) => setExpenseForm({ ...expenseForm, category: e.target.value })}
                    className={`w-full px-6 py-4 ${currentTheme.isDark ? 'bg-emerald-900/10' : 'bg-slate-50'} border ${currentTheme.border} rounded-2xl focus:outline-none focus:ring-4 focus:ring-rose-500/5 focus:border-rose-500 transition-all text-sm font-semibold ${currentTheme.isDark ? 'text-emerald-500' : 'text-slate-800'}`}
                  >
                    <option value="Supplies">{t.supplies}</option>
                    <option value="Utilities">{t.utilities}</option>
                    <option value="Maintenance">{t.maintenance}</option>
                    <option value="Other">{t.other}</option>
                  </select>
                </div>
                <div className="space-y-2">
                  <label className={`text-[10px] font-black ${currentTheme.muted} uppercase tracking-widest`}>{t.description}</label>
                  <input 
                    required
                    type="text" 
                    value={expenseForm.description}
                    onChange={(e) => setExpenseForm({ ...expenseForm, description: e.target.value })}
                    className={`w-full px-6 py-4 ${currentTheme.isDark ? 'bg-emerald-900/10' : 'bg-slate-50'} border ${currentTheme.border} rounded-2xl focus:outline-none focus:ring-4 focus:ring-rose-500/5 focus:border-rose-500 transition-all text-sm font-semibold ${currentTheme.isDark ? 'text-emerald-500' : 'text-slate-800'}`}
                    placeholder={t.electricityBill}
                  />
                </div>
                <div className="grid grid-cols-2 gap-6">
                  <div className="space-y-2">
                    <label className={`text-[10px] font-black ${currentTheme.muted} uppercase tracking-widest`}>{t.amount} ({t.currency})</label>
                    <input 
                      required
                      type="number" 
                      value={expenseForm.amount}
                      onChange={(e) => setExpenseForm({ ...expenseForm, amount: e.target.value })}
                      className={`w-full px-6 py-4 ${currentTheme.isDark ? 'bg-emerald-900/10' : 'bg-slate-50'} border ${currentTheme.border} rounded-2xl focus:outline-none focus:ring-4 focus:ring-rose-500/5 focus:border-rose-500 transition-all text-sm font-semibold ${currentTheme.isDark ? 'text-emerald-500' : 'text-slate-800'}`}
                      placeholder="25 000"
                    />
                  </div>
                  <div className="space-y-2">
                    <label className={`text-[10px] font-black ${currentTheme.muted} uppercase tracking-widest`}>{t.date}</label>
                    <input 
                      required
                      type="date" 
                      value={expenseForm.date}
                      onChange={(e) => setExpenseForm({ ...expenseForm, date: e.target.value })}
                      className={`w-full px-6 py-4 ${currentTheme.isDark ? 'bg-emerald-900/10' : 'bg-slate-50'} border ${currentTheme.border} rounded-2xl focus:outline-none focus:ring-4 focus:ring-rose-500/5 focus:border-rose-500 transition-all text-sm font-semibold ${currentTheme.isDark ? 'text-emerald-500' : 'text-slate-800'}`}
                    />
                  </div>
                </div>
                <button type="submit" className="w-full bg-rose-500 hover:bg-rose-600 text-white py-5 rounded-2xl font-black text-sm transition-all shadow-xl shadow-rose-500/20">
                  {t.submit}
                </button>
              </form>
    </ModalShell>
  );
}

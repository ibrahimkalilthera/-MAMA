/**
 * LatePaymentTicketModal — Late-payment ticket: on-screen slip preview with print button plus its hidden printable twin (print:block). Presentational — the student and display helpers arrive as props; the shared balance derivation is computed once here.
 */
import { Printer } from 'lucide-react';
import type { Student } from '../lib/useSupabaseData';
import type { CurrentTheme } from '../app/mainViewsProps';
import type { TranslationDict } from '../i18n/translations';
import { modalTokens } from '../lib/modalTokens';
import { ModalShell } from './ModalShell';

export interface LatePaymentTicketModalProps {
  t: TranslationDict;
  currentTheme: CurrentTheme;
  student: Student;
  getGradeDisplay: (grade: string | undefined, currentLang?: 'en' | 'fr') => string;
  formatDate: (dateStr: string) => string;
  formatCurrency: (amount: number) => string;
  /** The dialog root — registered in AppModals' overlay refs (focus trap). */
  overlayRef: (el: HTMLElement | null) => void;
  onClose: () => void;
}

export function LatePaymentTicketModal(props: LatePaymentTicketModalProps) {
  const { t, currentTheme, student: ticketStudent, getGradeDisplay, formatDate, formatCurrency, overlayRef, onClose } = props;
  const discount = ticketStudent.scholarshipDiscount || 0;
  const discountedTotal = ticketStudent.totalDue * (1 - discount / 100);
  const balance = discountedTotal - ticketStudent.amountPaid;
  const tokens = modalTokens(currentTheme);
  return (
    <>
    <ModalShell
      overlayRef={overlayRef}
      onClose={onClose}
      currentTheme={currentTheme}
      titleId="modal-title-late-payment-ticket"
      ariaLabel={t.latePaymentTicket}
      rootClassName="no-print"
      icon={<Printer size={24} className="text-rose-400" />}
      title={t.latePaymentTicket}
    >

                <div className="p-10 space-y-6 max-h-[60vh] overflow-y-auto custom-scrollbar">
                  {/* Visual Slip Preview on Screen */}
                  <div className={`border border-slate-200 rounded-2xl p-6 ${tokens.paperFillLight} font-mono text-xs text-slate-800 space-y-4 shadow-inner`}>
                    <div className="text-center border-b border-dashed border-slate-300 pb-4">
                      <h3 className="font-bold text-base uppercase tracking-wider">{t.title}</h3>
                      <p className="text-[10px] text-slate-500">{t.subtitle}</p>
                      <h4 className="font-black text-rose-600 mt-2 text-sm uppercase tracking-widest">
                        {t.latePaymentTicket2}
                      </h4>
                    </div>

                    <div className="space-y-2 py-2">
                      <div className="flex justify-between">
                        <span className="font-bold">{t.student}:</span>
                        <span>{ticketStudent.name}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="font-bold">{t.grade}:</span>
                        <span>Classe : {getGradeDisplay(ticketStudent.grade, 'fr')} / Grade: {getGradeDisplay(ticketStudent.grade, 'en')}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="font-bold">{t.parentLabel}:</span>
                        <span>{ticketStudent.parentName}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="font-bold">{t.dueDate}:</span>
                        <span>{formatDate(ticketStudent.dueDate)}</span>
                      </div>
                      <div className="flex justify-between border-t border-dashed border-slate-300 pt-2 text-rose-600 font-bold">
                        <span>{t.totalOwed}:</span>
                        <span>{formatCurrency(balance)}</span>
                      </div>
                    </div>

                    <div className="border-t border-dashed border-slate-300 pt-4 text-center text-[10px] text-slate-600 leading-relaxed italic">
                      {t.overdueNotice}
                    </div>
                  </div>

                  <div className="flex gap-4">
                    <button 
                      onClick={() => {
                        setTimeout(() => window.print(), 100);
                      }}
                      className="flex-1 bg-rose-600 hover:bg-rose-700 text-white py-4 rounded-2xl font-black text-sm transition-all shadow-xl shadow-rose-500/20 flex items-center justify-center gap-2"
                    >
                      <Printer size={18} />
                      {t.printTicket}
                    </button>
                    <button 
                      onClick={() => onClose()}
                      className={`px-8 py-4 border ${currentTheme.border} ${currentTheme.muted} hover:text-slate-600 hover:bg-slate-50 rounded-2xl font-bold text-sm transition-all`}
                    >
                      {t.close}
                    </button>
                  </div>
                </div>
    </ModalShell>
          <div className="hidden print:block ticket-print-container font-mono text-sm text-black space-y-6">
            <div className="text-center border-b border-black pb-4">
              <h1 className="font-bold text-xl uppercase tracking-wider">{t.title}</h1>
              <p className="text-xs text-black/70">{t.subtitle}</p>
              <h2 className="font-bold text-lg mt-3 uppercase tracking-widest border border-black px-2 py-1 inline-block">
                {t.latePaymentTicket2}
              </h2>
            </div>

            <div className="space-y-3 py-2 text-base">
              <div className="flex justify-between">
                <span className="font-bold">{t.student}:</span>
                <span>{ticketStudent.name}</span>
              </div>
              <div className="flex justify-between">
                <span className="font-bold">{t.grade}:</span>
                <span>Classe : {getGradeDisplay(ticketStudent.grade, 'fr')} / Grade: {getGradeDisplay(ticketStudent.grade, 'en')}</span>
              </div>
              <div className="flex justify-between">
                <span className="font-bold">{t.parentLabel}:</span>
                <span>{ticketStudent.parentName}</span>
              </div>
              <div className="flex justify-between">
                <span className="font-bold">{t.dueDate}:</span>
                <span>{formatDate(ticketStudent.dueDate)}</span>
              </div>
              <div className="flex justify-between border-t border-black pt-2 font-bold text-lg">
                <span>{t.totalOwed}:</span>
                <span>{formatCurrency(balance)}</span>
              </div>
            </div>

            <div className="border-t border-black pt-4 text-center text-xs leading-relaxed font-bold italic">
              {t.overdueNotice}
            </div>

            <div className="text-center text-[10px] pt-8 border-t border-black/10">
              <p>{t.generatedOn} {formatDate(new Date().toISOString())}</p>
              <p className="mt-2 text-[8px] tracking-widest uppercase">{t.officialFinancialReceipt}</p>
            </div>
          </div>
    </>
  );
}

/**
 * Late-payment reminder modal — the WhatsApp / SMS message generator shown
 * from the parents list ("notify" action). Extracted verbatim from AppModals.
 *
 * AppModals keeps the {showNotifyModal && notifyParent && …} mount gate and
 * registers the dialog root through overlayRef (focus-trap/escape slot 11);
 * every dependency arrives as narrow props or callbacks (template building,
 * clipboard copy, sms: and wa.me: dispatch all stay in the caller), so the
 * component stays presentational. The X button calls onClose.
 */
import type { Dispatch, SetStateAction } from 'react';
import { Bell, CheckCircle2, Copy, MessageSquare, Phone, X } from 'lucide-react';
import type { Parent } from '../lib/useSupabaseData';
import type { CurrentTheme } from '../app/mainViewsProps';
import type { TranslationDict } from '../i18n/translations';
import { ModalShell } from './ModalShell';

export interface NotifyParentModalProps {
  t: TranslationDict;
  currentTheme: CurrentTheme;
  /** The parent the reminder targets (gate guarantees non-null while mounted). */
  notifyParent: Parent;
  notifySelectedPhone: string;
  setNotifySelectedPhone: Dispatch<SetStateAction<string>>;
  notifyCustomText: string;
  setNotifyCustomText: Dispatch<SetStateAction<string>>;
  notifyTemplateType: 'polite' | 'urgent' | 'detailed';
  handleNotifyTemplateChange: (newType: 'polite' | 'urgent' | 'detailed') => void;
  handleCopyNotifyMessage: () => void;
  handleSendSMS: () => void;
  handleSendWhatsApp: () => void;
  /** True briefly after the copy action, showing the in-line confirmation chip. */
  copiedToast: boolean;
  formatCurrency: (amount: number) => string;
  getParentOutstandingBalance: (parent: Parent) => number;
  /** The dialog root — registered in AppModals' overlay refs (slot 11). */
  overlayRef: (el: HTMLElement | null) => void;
  /** X button — the caller clears showNotifyModal. */
  onClose: () => void;
}

export function NotifyParentModal(props: NotifyParentModalProps) {
  const { t, currentTheme, notifyParent, notifySelectedPhone, setNotifySelectedPhone, notifyCustomText, setNotifyCustomText, notifyTemplateType, handleNotifyTemplateChange, handleCopyNotifyMessage, handleSendSMS, handleSendWhatsApp, copiedToast, formatCurrency, getParentOutstandingBalance, overlayRef, onClose } = props;

  return (
    <ModalShell
      overlayRef={overlayRef}
      onClose={onClose}
      currentTheme={currentTheme}
      titleId="modal-title-reminder"
      ariaLabel={t.reminderModalTitle}
      maxWidth="max-w-xl"
      panelRadius="rounded-[2rem]"
      rootClassName="animate-fade-in no-print"
      header={
        <div className="flex items-start justify-between px-6 sm:px-8 pt-6 sm:pt-8 pb-4 border-b border-slate-100 dark:border-slate-800">
          <div className="flex items-center gap-3">
            <div className="p-3 rounded-2xl bg-amber-500/10 text-amber-800 dark:text-amber-300 border border-amber-500/20">
              <Bell size={24} />
            </div>
            <div>
              <h3 id="modal-title-reminder" className={`text-lg font-black ${currentTheme.isDark ? 'text-white' : 'text-slate-900'}`}>
                {t.reminderModalTitle}
              </h3>
              <p className="text-xs text-slate-400 font-medium">
                {t.reminderModalSubtitle}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 text-slate-400 hover:text-slate-600 rounded-xl"
          >
            <X size={20} />
          </button>
        </div>
      }
    >
      <div className="p-6 sm:p-8 space-y-6 max-h-[90vh] overflow-y-auto">

            {/* Parent Summary Card */}
            <div className="p-4 rounded-2xl bg-rose-500/5 border border-rose-500/20 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <span className="text-[10px] font-black uppercase tracking-widest text-slate-400 block">{t.parentName}</span>
                <span className="text-sm font-black text-slate-900 dark:text-white">{notifyParent.fullName}</span>
                <span className="text-xs text-slate-500 block">({t[notifyParent.relationship.toLowerCase() as keyof typeof t] || notifyParent.relationship})</span>
              </div>
              <div className="text-left sm:text-right">
                <span className="text-[10px] font-black uppercase tracking-widest text-rose-500 dark:text-rose-300 block">{t.totalOutstandingBalance}</span>
                <span className="text-lg font-black text-rose-600 dark:text-rose-400 font-mono">
                  {formatCurrency(getParentOutstandingBalance(notifyParent))}
                </span>
              </div>
            </div>

            <div className="space-y-4">
              {/* Recipient Phone Selection */}
              <div className="space-y-1">
                <label className="text-[10px] font-black uppercase tracking-widest text-slate-400">{t.selectPhone} *</label>
                <div className="flex items-center gap-2">
                  <Phone size={16} className="text-slate-400" />
                  <select
                    value={notifySelectedPhone}
                    onChange={(e) => setNotifySelectedPhone(e.target.value)}
                    className={`w-full p-3 text-xs font-bold rounded-xl border ${currentTheme.border} ${currentTheme.isDark ? 'bg-slate-900 text-white' : 'bg-slate-50 text-slate-800'}`}
                  >
                    {notifyParent.phones.map((ph, idx) => (
                      <option key={idx} value={ph}>
                        {ph} {idx === 0 ? `(${t.primaryPhone})` : `(${t.secondaryPhone})`}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Template Selection Radio Buttons / Pills */}
              <div className="space-y-1">
                <label className="text-[10px] font-black uppercase tracking-widest text-slate-400">{t.selectTemplate}</label>
                <div className="grid grid-cols-3 gap-2">
                  <button
                    type="button"
                    onClick={() => handleNotifyTemplateChange('polite')}
                    className={`p-2.5 rounded-xl border text-xs font-bold transition-all ${
                      notifyTemplateType === 'polite'
                        ? 'bg-emerald-600 text-white border-emerald-600 shadow-md shadow-emerald-600/20'
                        : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 border-transparent hover:bg-slate-200'
                    }`}
                  >
                    {t.templatePolite}
                  </button>
                  <button
                    type="button"
                    onClick={() => handleNotifyTemplateChange('urgent')}
                    className={`p-2.5 rounded-xl border text-xs font-bold transition-all ${
                      notifyTemplateType === 'urgent'
                        ? 'bg-rose-600 text-white border-rose-600 shadow-md shadow-rose-600/20'
                        : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 border-transparent hover:bg-slate-200'
                    }`}
                  >
                    {t.templateUrgent}
                  </button>
                  <button
                    type="button"
                    onClick={() => handleNotifyTemplateChange('detailed')}
                    className={`p-2.5 rounded-xl border text-xs font-bold transition-all ${
                      notifyTemplateType === 'detailed'
                        ? 'bg-amber-600 text-white border-amber-600 shadow-md shadow-amber-600/20'
                        : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 border-transparent hover:bg-slate-200'
                    }`}
                  >
                    {t.templateDetailed}
                  </button>
                </div>
              </div>

              {/* Editable Message Text Box */}
              <div className="space-y-1">
                <div className="flex items-center justify-between">
                  <label className="text-[10px] font-black uppercase tracking-widest text-slate-400">{t.customMessage}</label>
                  {copiedToast && (
                    <span className="text-[10px] font-bold text-emerald-600 flex items-center gap-1 animate-pulse">
                      <CheckCircle2 size={12} />
                      {t.copiedToClipboard}
                    </span>
                  )}
                </div>
                <textarea
                  rows={6}
                  value={notifyCustomText}
                  onChange={(e) => setNotifyCustomText(e.target.value)}
                  className={`w-full p-3.5 text-xs font-mono font-medium rounded-xl border ${currentTheme.border} ${currentTheme.isDark ? 'bg-slate-900 text-white' : 'bg-slate-50 text-slate-800'} leading-relaxed`}
                />
              </div>
            </div>

            {/* One-Click Action Buttons */}
            <div className="pt-4 border-t border-slate-100 dark:border-slate-800 flex flex-col sm:flex-row items-center justify-between gap-3">
              <button
                type="button"
                onClick={handleCopyNotifyMessage}                  className="w-full sm:w-auto h-11 px-4 rounded-2xl border border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-300 font-bold text-xs hover:bg-slate-100 dark:hover:bg-slate-800 flex items-center justify-center gap-2 transition-all whitespace-nowrap"
                >
                  <Copy size={16} className="flex-shrink-0" />
                <span>{t.copyMessage}</span>
              </button>

              <div className="w-full sm:w-auto flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleSendSMS}
                  className="flex-1 sm:flex-initial h-11 px-4 rounded-2xl bg-slate-800 hover:bg-slate-900 dark:bg-slate-700 dark:hover:bg-slate-600 text-white font-bold text-xs shadow-md flex items-center justify-center gap-2 transition-all whitespace-nowrap"
                >
                  <MessageSquare size={16} className="flex-shrink-0" />
                  <span>{t.sendSMS}</span>
                </button>

                <button
                  type="button"
                  onClick={handleSendWhatsApp}
                  className="flex-1 sm:flex-initial h-11 px-4 rounded-2xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs shadow-lg shadow-emerald-600/30 flex items-center justify-center gap-2 transition-all whitespace-nowrap"
                >
                  <MessageSquare size={16} className="text-emerald-200 flex-shrink-0" />
                  <span>{t.openWhatsApp}</span>
                </button>
              </div>
            </div>
      </div>
    </ModalShell>
  );
}

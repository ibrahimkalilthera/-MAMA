/**
 * Add / edit vendor-expense modal — extracted verbatim from AppModals.
 *
 * The social-case-aware expense form behind the vendor expenses list: vendor
 * name/amount are promoter-only fields (others see them read-only), the
 * category + payment-status selects, the conditional welfare-aid sub-fields
 * (social_cases only), the partial-payment amount and the description.
 *
 * AppModals keeps the AnimatePresence mount gate and registers the dialog
 * root through overlayRef (focus trap + escape stack slot 3); every other
 * dependency arrives as narrow props or callbacks, so the component stays
 * presentational. Escaping or clicking the backdrop calls onClose, which the
 * caller wires to also clear editingVendorExpense.
 */
import type { Dispatch, FormEvent, SetStateAction } from 'react';
import { Heart, Receipt } from 'lucide-react';
import type { VendorExpense } from '../lib/useSupabaseData';
import type { CurrentTheme, ManagedClass, VendorExpenseForm } from '../app/mainViewsProps';
import type { TranslationDict } from '../i18n/translations';
import { modalTokens } from '../lib/modalTokens';
import { ModalShell } from './ModalShell';

export interface VendorExpenseModalProps {
  t: TranslationDict;
  lang: 'en' | 'fr';
  currentTheme: CurrentTheme;
  /** Title switch (add vs edit). The modal also stays mounted while the
   *  exit animation plays — AppModals keeps the mount gate. */
  editingVendorExpense: VendorExpense | null;
  vendorExpenseForm: VendorExpenseForm;
  setVendorExpenseForm: Dispatch<SetStateAction<VendorExpenseForm>>;
  handleVendorExpenseSubmit: (e: FormEvent) => Promise<void>;
  /** Promoter-only fields: vendor name + amount stay locked for everyone else. */
  isPromoter: boolean;
  expenseCategoryList: { key: string; label: string }[];
  availableClasses: ManagedClass[];
  /** The dialog root — registered in AppModals' overlay refs (slot 3). */
  overlayRef: (el: HTMLElement | null) => void;
  /** Backdrop / ✕ — the caller also clears editingVendorExpense. */
  onClose: () => void;
}

export function VendorExpenseModal(props: VendorExpenseModalProps) {
  const {
    t,
    lang,
    currentTheme,
    editingVendorExpense,
    vendorExpenseForm,
    setVendorExpenseForm,
    handleVendorExpenseSubmit,
    isPromoter,
    expenseCategoryList,
    availableClasses,
    overlayRef,
    onClose,
  } = props;
  const tokens = modalTokens(currentTheme);

  return (
          <ModalShell
            overlayRef={overlayRef}
            onClose={onClose}
            currentTheme={currentTheme}
            titleId="modal-title-vendor-expense-form"
            ariaLabel={editingVendorExpense ? t.editVendorExpense : t.addVendorExpense}
            headerClassName={`p-8 border-b ${currentTheme.border} flex justify-between items-center ${currentTheme.isDark ? 'bg-emerald-800' : 'bg-blue-600'} text-white`}
            icon={<Receipt size={24} />}
            title={editingVendorExpense ? t.editVendorExpense : t.addVendorExpense}
          >

              <form onSubmit={handleVendorExpenseSubmit} className="p-10 space-y-6">
                {/* Vendor Name */}
                <div className="space-y-2">
                  <label className={`text-[10px] font-black ${currentTheme.muted} uppercase tracking-widest flex items-center justify-between`}>
                    <span>{t.vendorName}</span>
                    {!isPromoter && <span className="text-[9px] text-rose-500 font-bold">({t.promoterOnly})</span>}
                  </label>
                  <input 
                    required
                    type="text" 
                    value={vendorExpenseForm.vendorName}
                    disabled={!isPromoter}
                    onChange={(e) => setVendorExpenseForm({ ...vendorExpenseForm, vendorName: e.target.value })}
                    className={`w-full px-6 py-4 border rounded-2xl focus:outline-none transition-all text-sm font-semibold ${!isPromoter ? tokens.fieldDisabled : currentTheme.input}`}
                    placeholder={t.eGSenelec}
                  />
                </div>

                <div className="grid grid-cols-2 gap-6">
                  {/* Category */}
                  <div className="space-y-2">
                    <label className={`text-[10px] font-black ${currentTheme.muted} uppercase tracking-widest`}>{t.category}</label>
                    <select 
                      value={vendorExpenseForm.category}
                      onChange={(e) => setVendorExpenseForm({ ...vendorExpenseForm, category: e.target.value })}
                      className={`w-full px-6 py-4 border rounded-2xl focus:outline-none transition-all text-sm font-semibold ${currentTheme.input}`}
                    >
                      {expenseCategoryList.map(item => (
                        <option key={item.key} value={item.key}>{item.label}</option>
                      ))}
                    </select>
                  </div>

                  {/* Payment Status */}
                  <div className="space-y-2">
                    <label className={`text-[10px] font-black ${currentTheme.muted} uppercase tracking-widest`}>{t.paymentStatus}</label>
                    <select 
                      value={vendorExpenseForm.paymentStatus}
                      onChange={(e) => setVendorExpenseForm({ ...vendorExpenseForm, paymentStatus: e.target.value })}
                      className={`w-full px-6 py-4 border rounded-2xl focus:outline-none transition-all text-sm font-semibold ${currentTheme.input}`}
                    >
                      <option value="unpaid">{t.unpaid}</option>
                      <option value="partial">{t.partialPaid}</option>
                      <option value="paid">{t.fullyPaid}</option>
                    </select>
                  </div>
                </div>

                {/* Conditional Welfare Aid / Social Cases sub-fields */}
                {vendorExpenseForm.category === 'social_cases' && (
                  <div className={`p-6 ${currentTheme.isDark ? 'bg-rose-950/10' : 'bg-rose-50/40'} border ${currentTheme.isDark ? 'border-rose-950/30' : 'border-rose-100'} rounded-3xl space-y-4`}>
                    <p className="text-xs font-black uppercase tracking-widest text-rose-500 flex items-center gap-2">
                      <Heart size={14} className="text-rose-500 fill-rose-500/10" />
                      {t.studentWelfareSocialAidDetails}
                    </p>
                    
                    {/* Aid Type Dropdown */}
                    <div className="space-y-2">
                      <label className={`text-[10px] font-black ${currentTheme.muted} uppercase tracking-widest`}>
                        {t.typeOfAid}
                      </label>
                      <select 
                        required={vendorExpenseForm.category === 'social_cases'}
                        value={vendorExpenseForm.aidType}
                        onChange={(e) => setVendorExpenseForm({ ...vendorExpenseForm, aidType: e.target.value })}
                        className={`w-full px-6 py-4 border rounded-2xl focus:outline-none transition-all text-sm font-semibold ${currentTheme.input}`}
                      >
                        <option value="">{t.selectTypeOfAid}</option>
                        <option value="prise_en_charge">{t.tuitionWaiverPriseEnChargeScolarit}</option>
                        <option value="kits_fournitures">{t.suppliesSupportKitsScolairesFournitures}</option>
                        <option value="aide_urgence">{t.emergencyAidAideDUrgence}</option>
                      </select>
                    </div>

                    {/* Student Link Fields */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <label className={`text-[10px] font-black ${currentTheme.muted} uppercase tracking-widest`}>
                          {t.beneficiaryStudentNameOptional}
                        </label>
                        <input 
                          type="text" 
                          value={vendorExpenseForm.beneficiaryStudentName}
                          onChange={(e) => setVendorExpenseForm({ ...vendorExpenseForm, beneficiaryStudentName: e.target.value })}
                          className={`w-full px-6 py-4 border rounded-2xl focus:outline-none transition-all text-sm font-semibold ${currentTheme.input}`}
                          placeholder={t.eGIbrahimThera}
                        />
                      </div>
                      <div className="space-y-2">
                        <label className={`text-[10px] font-black ${currentTheme.muted} uppercase tracking-widest`}>
                          {t.studentGradeOptional}
                        </label>
                        <select 
                          value={vendorExpenseForm.beneficiaryStudentGrade}
                          onChange={(e) => setVendorExpenseForm({ ...vendorExpenseForm, beneficiaryStudentGrade: e.target.value })}
                          className={`w-full px-6 py-4 border rounded-2xl focus:outline-none transition-all text-sm font-semibold ${currentTheme.input}`}
                        >
                          <option value="">{t.selectGrade}</option>
                          <optgroup label={t.firstCyclePremierCycle}>
                            {availableClasses.filter(c => c.cycle === 'cycle1').map(c => (
                              <option key={c.id} value={c.id}>{lang === 'en' ? c.nameEn : c.nameFr}</option>
                            ))}
                          </optgroup>
                          <optgroup label={t.secondCycleShort}>
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
                      </div>
                    </div>
                  </div>
                )}

                <div className="grid grid-cols-2 gap-6">
                  {/* Total Amount */}
                  <div className="space-y-2">
                    <label className={`text-[10px] font-black ${currentTheme.muted} uppercase tracking-widest flex items-center justify-between`}>
                      <span>{t.amount} ({t.currency})</span>
                      {!isPromoter && <span className="text-[9px] text-rose-500 font-bold">({t.promoterOnly})</span>}
                    </label>
                    <input 
                      required
                      type="number" 
                      value={vendorExpenseForm.amount}
                      disabled={!isPromoter}
                      onChange={(e) => setVendorExpenseForm({ ...vendorExpenseForm, amount: e.target.value })}
                      className={`w-full px-6 py-4 border rounded-2xl focus:outline-none transition-all text-sm font-semibold ${!isPromoter ? tokens.fieldDisabled : currentTheme.input}`}
                      placeholder="50000"
                    />
                  </div>

                  {/* Due Date */}
                  <div className="space-y-2">
                    <label className={`text-[10px] font-black ${currentTheme.muted} uppercase tracking-widest`}>{t.dueDate2}</label>
                    <input 
                      required
                      type="date" 
                      value={vendorExpenseForm.dueDate}
                      onChange={(e) => setVendorExpenseForm({ ...vendorExpenseForm, dueDate: e.target.value })}
                      className={`w-full px-6 py-4 border rounded-2xl focus:outline-none transition-all text-sm font-semibold ${currentTheme.input}`}
                    />
                  </div>
                </div>

                {/* Amount Paid - Only visible if Partially Paid */}
                {vendorExpenseForm.paymentStatus === 'partial' && (
                  <div className="space-y-2">
                    <label className={`text-[10px] font-black ${currentTheme.muted} uppercase tracking-widest`}>{t.amountPaid} ({t.currency})</label>
                    <input 
                      required
                      type="number" 
                      value={vendorExpenseForm.amountPaid}
                      onChange={(e) => setVendorExpenseForm({ ...vendorExpenseForm, amountPaid: e.target.value })}
                      className={`w-full px-6 py-4 border rounded-2xl focus:outline-none transition-all text-sm font-semibold ${currentTheme.input}`}
                      placeholder="20000"
                    />
                  </div>
                )}

                {/* Description */}
                <div className="space-y-2">
                  <label className={`text-[10px] font-black ${currentTheme.muted} uppercase tracking-widest`}>{t.description}</label>
                  <input 
                    type="text" 
                    value={vendorExpenseForm.description}
                    onChange={(e) => setVendorExpenseForm({ ...vendorExpenseForm, description: e.target.value })}
                    className={`w-full px-6 py-4 border rounded-2xl focus:outline-none transition-all text-sm font-semibold ${currentTheme.input}`}
                    placeholder={t.optionalNotes}
                  />
                </div>

                <button 
                  type="submit" 
                  className={`w-full ${currentTheme.isDark ? 'bg-emerald-600 hover:bg-emerald-700' : 'bg-blue-600 hover:bg-blue-700'} text-white py-5 rounded-2xl font-black text-sm transition-all shadow-xl`}
                >
                  {t.submit}
                </button>
              </form>
          </ModalShell>
  );
}

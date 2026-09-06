/**
 * StaffFormModal — Staff add/edit form — extracted verbatim from AppModals. Pure
 * presentational form (name/position/phone/email/salary/bank/emergency
 * contact) driven by narrow props; overlay root ref injected as overlayRef.
 */
import { Briefcase, ChevronDown, ShieldCheck } from 'lucide-react';
import type { Dispatch, SetStateAction, FormEvent } from 'react';
import type { Staff } from '../lib/useSupabaseData';
import type { StaffForm, CurrentTheme } from '../app/mainViewsProps';
import type { TranslationDict } from '../i18n/translations';
import { isAdminPosition } from '../lib/adminPositions';
import { ModalShell } from './ModalShell';

export interface StaffFormModalProps {
  t: TranslationDict;
  currentTheme: CurrentTheme;
  editingStaff: Staff | null;
  staffForm: StaffForm;
  setStaffForm: Dispatch<SetStateAction<StaffForm>>;
  handleStaffSubmit: (e: FormEvent) => Promise<void>;
  /** The dialog root — registered in AppModals' overlay refs (focus trap). */
  overlayRef: (el: HTMLElement | null) => void;
  onClose: () => void;
  /** Admin-member flow: position becomes a curated dropdown instead of free text. */
  adminMode?: boolean;
  /** The position choices shown when adminMode — undefined keeps the free-text input. */
  positionOptions?: readonly string[];
}

export function StaffFormModal(props: StaffFormModalProps) {
  const { t, currentTheme, editingStaff, staffForm, setStaffForm, handleStaffSubmit, overlayRef, onClose, adminMode = false, positionOptions } = props;
  const title = editingStaff ? t.editStaff : adminMode ? t.addAdminMember : t.addStaff;
  /** Editing a member whose stored position is a curated admin role — the
   *  header and the POSTE label get a small violet shield to flag it. */
  const isEditingAdmin = Boolean(editingStaff && isAdminPosition(editingStaff.position));
  return (
    <ModalShell
      overlayRef={overlayRef}
      onClose={onClose}
      currentTheme={currentTheme}
      titleId="modal-title-staff-form"
      ariaLabel={title}
      icon={adminMode ? <ShieldCheck size={24} className="text-violet-400" /> : <Briefcase size={24} className="text-blue-400" />}
      title={isEditingAdmin ? (
        <span className="inline-flex items-center gap-2">
          {title}
          <ShieldCheck size={16} className="text-violet-400" />
        </span>
      ) : title}
    >

              <form onSubmit={handleStaffSubmit} className="p-10 space-y-6 max-h-[70vh] overflow-y-auto custom-scrollbar">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="space-y-2">
                    <label className={`text-[10px] font-black ${currentTheme.muted} uppercase tracking-widest`}>{t.staffName}</label>
                    <input 
                      required
                      type="text" 
                      value={staffForm.name}
                      onChange={(e) => setStaffForm({ ...staffForm, name: e.target.value })}
                      className={`w-full px-6 py-4 ${currentTheme.isDark ? 'bg-emerald-900/10' : 'bg-slate-50'} border ${currentTheme.border} rounded-2xl focus:outline-none focus:ring-4 focus:ring-blue-500/5 focus:border-blue-500 transition-all text-sm font-semibold ${currentTheme.isDark ? 'text-emerald-500' : 'text-slate-800'}`}
                      placeholder="Jane Doe"
                    />
                  </div>
                  <div className="space-y-2">
                    <label className={`text-[10px] font-black ${currentTheme.muted} uppercase tracking-widest inline-flex items-center gap-1.5`}>
                      {t.position}
                      {isEditingAdmin && <ShieldCheck size={12} className="text-violet-500" />}
                    </label>
                    {positionOptions ? (
                      <div className="relative">
                        <select
                          required
                          value={staffForm.position}
                          onChange={(e) => setStaffForm({ ...staffForm, position: e.target.value })}
                          className={`w-full px-6 py-4 pr-12 appearance-none cursor-pointer ${currentTheme.isDark ? 'bg-emerald-900/10' : 'bg-slate-50'} border ${currentTheme.border} rounded-2xl focus:outline-none focus:ring-4 focus:ring-blue-500/5 focus:border-blue-500 transition-all text-sm font-semibold ${currentTheme.isDark ? 'text-emerald-500' : 'text-slate-800'}`}
                        >
                          <option value="" disabled>{t.position}</option>
                          {positionOptions.map((p) => (
                            <option key={p} value={p}>{p}</option>
                          ))}
                        </select>
                        <ChevronDown size={16} className={`absolute right-4 top-1/2 -translate-y-1/2 pointer-events-none ${currentTheme.muted}`} />
                      </div>
                    ) : (
                      <input 
                        required
                        type="text" 
                        value={staffForm.position}
                        onChange={(e) => setStaffForm({ ...staffForm, position: e.target.value })}
                        className={`w-full px-6 py-4 ${currentTheme.isDark ? 'bg-emerald-900/10' : 'bg-slate-50'} border ${currentTheme.border} rounded-2xl focus:outline-none focus:ring-4 focus:ring-blue-500/5 focus:border-blue-500 transition-all text-sm font-semibold ${currentTheme.isDark ? 'text-emerald-500' : 'text-slate-800'}`}
                        placeholder="Teacher"
                      />
                    )}
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="space-y-2">
                    <label className={`text-[10px] font-black ${currentTheme.muted} uppercase tracking-widest`}>{t.phone}</label>
                    <input 
                      required
                      type="text" 
                      value={staffForm.phone}
                      onChange={(e) => setStaffForm({ ...staffForm, phone: e.target.value })}
                      className={`w-full px-6 py-4 ${currentTheme.isDark ? 'bg-emerald-900/10' : 'bg-slate-50'} border ${currentTheme.border} rounded-2xl focus:outline-none focus:ring-4 focus:ring-blue-500/5 focus:border-blue-500 transition-all text-sm font-semibold ${currentTheme.isDark ? 'text-emerald-500' : 'text-slate-800'}`}
                      placeholder="+223 70 00 00 00"
                    />
                  </div>
                  <div className="space-y-2">
                    <label className={`text-[10px] font-black ${currentTheme.muted} uppercase tracking-widest`}>{t.email}</label>
                    <input 
                      required
                      type="email" 
                      value={staffForm.email}
                      onChange={(e) => setStaffForm({ ...staffForm, email: e.target.value })}
                      className={`w-full px-6 py-4 ${currentTheme.isDark ? 'bg-emerald-900/10' : 'bg-slate-50'} border ${currentTheme.border} rounded-2xl focus:outline-none focus:ring-4 focus:ring-blue-500/5 focus:border-blue-500 transition-all text-sm font-semibold ${currentTheme.isDark ? 'text-emerald-500' : 'text-slate-800'}`}
                      placeholder="jane.doe@school.com"
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <label className={`text-[10px] font-black ${currentTheme.muted} uppercase tracking-widest`}>{t.monthlySalary} ({t.currency})</label>
                  <input 
                    required
                    type="number" 
                    value={staffForm.salary}
                    onChange={(e) => setStaffForm({ ...staffForm, salary: e.target.value })}
                    className={`w-full px-6 py-4 ${currentTheme.isDark ? 'bg-emerald-900/10' : 'bg-slate-50'} border ${currentTheme.border} rounded-2xl focus:outline-none focus:ring-4 focus:ring-blue-500/5 focus:border-blue-500 transition-all text-sm font-semibold ${currentTheme.isDark ? 'text-emerald-500' : 'text-slate-800'}`}
                    placeholder="150 000"
                  />
                </div>

                <div className="space-y-2">
                  <label className={`text-[10px] font-black ${currentTheme.muted} uppercase tracking-widest`}>{t.bankDetails}</label>
                  <input
                    type="text"
                    value={staffForm.bankDetails}
                    onChange={(e) => setStaffForm({ ...staffForm, bankDetails: e.target.value })}
                    className={`w-full px-6 py-4 ${currentTheme.isDark ? 'bg-emerald-900/10' : 'bg-slate-50'} border ${currentTheme.border} rounded-2xl focus:outline-none focus:ring-4 focus:ring-blue-500/5 focus:border-blue-500 transition-all text-sm font-semibold ${currentTheme.isDark ? 'text-emerald-500' : 'text-slate-800'}`}
                    placeholder="RIB: ML01 00001 ..."
                  />
                </div>

                <div className="space-y-2">
                  <label className={`text-[10px] font-black ${currentTheme.muted} uppercase tracking-widest`}>{t.emergencyContact}</label>
                  <input
                    type="text"
                    value={staffForm.emergencyContact}
                    onChange={(e) => setStaffForm({ ...staffForm, emergencyContact: e.target.value })}
                    className={`w-full px-6 py-4 ${currentTheme.isDark ? 'bg-emerald-900/10' : 'bg-slate-50'} border ${currentTheme.border} rounded-2xl focus:outline-none focus:ring-4 focus:ring-blue-500/5 focus:border-blue-500 transition-all text-sm font-semibold ${currentTheme.isDark ? 'text-emerald-500' : 'text-slate-800'}`}
                    placeholder="Spouse: +223 60 00 00 00"
                  />
                </div>

                <button type="submit" className="w-full bg-blue-600 hover:bg-blue-700 text-white py-5 rounded-2xl font-black text-sm transition-all shadow-xl shadow-blue-500/20">
                  {editingStaff ? t.saveChanges : t.submit}
                </button>
              </form>
    </ModalShell>
  );
}

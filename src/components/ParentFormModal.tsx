import { useState } from 'react';
import type { Dispatch, FormEvent, SetStateAction } from 'react';
import { DollarSign, ExternalLink, Plus, Search, Users, X } from 'lucide-react';
import type { Student } from '../lib/useSupabaseData';
import type { CurrentTheme, ManagedClass, ParentForm } from '../app/mainViewsProps';
import type { TranslationDict } from '../i18n/translations';
import { visibleStudentIdentifier } from '../lib/studentIdentifiers';
import { ModalShell } from './ModalShell';

/**
 * Add/Edit parent modal — extracted verbatim from AppModals.
 *
 * The 400-line form behind the parent directory: the linked-students panel
 * (edit mode, with per-student payment/record shortcuts), the student picker
 * (create mode: search + class filter + checkbox list, with the empty-system
 * shortcut into the student form) and the parent fields themselves.
 *
 * Local UI state (student search text + class filter) moves in here — they
 * were module-local to this form only. Setters arrive as narrow callbacks
 * (onClose/onOpenStudentForm/onRecordPayment/onViewStudent) so this component
 * stays presentational; the overlay root ref (focus trap + escape stack) is
 * injected as overlayRef, following the StudentDetailsModal pattern.
 */
export interface ParentFormModalProps {
  t: TranslationDict;
  lang: 'en' | 'fr';
  currentTheme: CurrentTheme;
  /** Mount gate — AppModals keeps the conditional render (no exit animation). */
  editingParent: { id: string } | null;
  students: Student[];
  availableClasses: ManagedClass[];
  parentForm: ParentForm;
  setParentForm: Dispatch<SetStateAction<ParentForm>>;
  handleParentSubmit: (e: FormEvent) => Promise<void>;
  formatCurrency: (amount: number) => string;
  /** The dialog root — registered in AppModals' overlay refs for the focus trap. */
  overlayRef: (el: HTMLElement | null) => void;
  onClose: () => void;
  /** Create-mode shortcut when the system has no students yet. */
  onOpenStudentForm: () => void;
  /** Edit-mode per-student quick action: prefill + open the payment form. */
  onRecordPayment: (studentId: string) => void;
  /** Edit-mode per-student quick action: open the student fiche. */
  onViewStudent: (student: Student) => void;
}

export function ParentFormModal(props: ParentFormModalProps) {
  const {
    t, lang, currentTheme, editingParent, students, availableClasses,
    parentForm, setParentForm, handleParentSubmit, formatCurrency, overlayRef,
    onClose, onOpenStudentForm, onRecordPayment, onViewStudent,
  } = props;
  // Student-picker local state (search text + class filter) — only this form
  // ever reads it, so it moved here with the block.
  const [parentStudentSearch, setParentStudentSearch] = useState('');
  const [parentClassFilter, setParentClassFilter] = useState('all');

  return (
    <ModalShell
      overlayRef={overlayRef}
      onClose={onClose}
      currentTheme={currentTheme}
      titleId="modal-title-parent-form"
      ariaLabel={editingParent ? t.editParent : t.addParent}
      maxWidth="max-w-xl"
      panelRadius="rounded-[2rem]"
      rootClassName="no-print"
      header={
        <div className="flex items-center justify-between px-8 pt-8 pb-4 border-b border-slate-100 dark:border-slate-800">
          <h3 id="modal-title-parent-form" className={`text-xl font-black ${currentTheme.isDark ? 'text-white' : 'text-slate-900'}`}>
            {editingParent ? t.editParent : t.addParent}
          </h3>
          <button
            onClick={onClose}
            className="p-2 text-slate-400 hover:text-slate-600 rounded-xl"
          >
            <X size={20} />
          </button>
        </div>
      }
    >
      <div className="p-8 space-y-6 max-h-[90vh] overflow-y-auto">
        <form onSubmit={handleParentSubmit} className="space-y-4">
          {editingParent && (() => {
            const linkedStudents = students.filter(s => s.parentId === editingParent.id);
            if (linkedStudents.length === 0) return null;
            return (
              <div className={`p-4 rounded-2xl border ${currentTheme.border} ${currentTheme.isDark ? 'bg-slate-900/50' : 'bg-slate-50'}`}>
                <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-2.5">{t.linkedStudents}</p>
                <div className="space-y-2">
                  {linkedStudents.map(s => {
                    const discount = s.scholarshipDiscount || 0;
                    const discountedTotal = s.totalDue * (1 - discount / 100);
                    const balance = Math.max(0, discountedTotal - s.amountPaid);
                    return (
                      <div
                        key={s.id}
                        className={`flex items-center gap-2.5 px-3 py-2.5 rounded-xl border ${currentTheme.border} ${currentTheme.isDark ? 'bg-white/5' : 'bg-white'}`}
                      >
                        <div className="flex-1 min-w-0">
                          <p className={`text-xs font-bold truncate ${currentTheme.isDark ? 'text-white' : 'text-slate-800'}`}>
                            {s.name}
                          </p>
                          <p className={`mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 font-mono text-[10px] ${currentTheme.muted}`}>
                            {visibleStudentIdentifier(s.grade, s.studentId) && (
                              <span className="flex items-center gap-1">
                                <span className="font-black uppercase tracking-wide text-slate-400">{t.studentId}:</span>
                                <span>{visibleStudentIdentifier(s.grade, s.studentId)}</span>
                              </span>
                            )}
                            <span className="flex items-center gap-1">
                              <span className="font-black uppercase tracking-wide text-slate-400">{t.grade}:</span>
                              <span>{s.grade || '—'}</span>
                            </span>
                            <span className={`flex items-center gap-1 font-black ${balance > 0 ? 'text-rose-500' : 'text-emerald-600'}`}>
                              {t.balance}: {formatCurrency(balance)}
                            </span>
                          </p>
                        </div>
                        <button
                          type="button"
                          title={t.recordPayment}
                          onClick={() => onRecordPayment(s.id)}
                          className="p-2 rounded-lg bg-emerald-600 text-white hover:bg-emerald-700 transition-all shadow-sm flex-shrink-0"
                        >
                          <DollarSign size={14} />
                        </button>
                        <button
                          type="button"
                          title={t.viewStudentRecord}
                          onClick={() => onViewStudent(s)}
                          className={`p-2 rounded-lg border ${currentTheme.border} text-blue-500 hover:bg-blue-50 dark:hover:bg-white/10 transition-all flex-shrink-0`}
                        >
                          <ExternalLink size={14} />
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })()}

          {!editingParent && (() => {
            const search = parentStudentSearch.toLowerCase().trim();
            const selectedClass = availableClasses.find(c => c.id === parentClassFilter);
            const filteredStudents = students.filter(s => {
              const matchesSearch = !search ||
                s.name.toLowerCase().includes(search) ||
                (visibleStudentIdentifier(s.grade, s.studentId)?.toLowerCase().includes(search) ?? false) ||
                (s.grade || '').toLowerCase().includes(search);
              const gradeNorm = (s.grade || '').toLowerCase();
              const matchesClass = parentClassFilter === 'all' || (
                gradeNorm !== '' && (
                  gradeNorm === parentClassFilter.toLowerCase() ||
                  (selectedClass && (
                    gradeNorm === selectedClass.nameFr.toLowerCase() ||
                    gradeNorm === selectedClass.nameEn.toLowerCase()
                  ))
                )
              );
              return matchesSearch && matchesClass;
            });
            return (
              <div className="space-y-1">
                <label className="text-[10px] font-black uppercase tracking-widest text-slate-400">{t.selectStudent}</label>
                {parentForm.linkedStudentIds.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {parentForm.linkedStudentIds.map(id => {
                      const st = students.find(s => s.id === id);
                      if (!st) return null;
                      return (
                        <span
                          key={id}
                          className="inline-flex items-center gap-1.5 pl-2.5 pr-1.5 py-1 rounded-full bg-emerald-600/10 border border-emerald-500/30 text-emerald-700 dark:text-emerald-300 text-[10px] font-black max-w-full"
                        >
                          <span className="truncate">{st.name}</span>
                          <button
                            type="button"
                            onClick={() => setParentForm({
                              ...parentForm,
                              linkedStudentIds: parentForm.linkedStudentIds.filter(sid => sid !== id),
                            })}
                            className="p-0.5 rounded-full text-emerald-600 dark:text-emerald-300 hover:bg-emerald-600/20 transition-all flex-shrink-0"
                            title="×"
                          >
                            <X size={12} />
                          </button>
                        </span>
                      );
                    })}
                  </div>
                )}
                {students.length === 0 ? (
                  <div className={`rounded-xl border ${currentTheme.border} ${currentTheme.isDark ? 'bg-slate-900' : 'bg-slate-50'} px-4 py-6 text-center space-y-3`}>
                    <div className="mx-auto w-10 h-10 rounded-full bg-slate-100 dark:bg-white/5 flex items-center justify-center">
                      <Users size={18} className="text-slate-400" />
                    </div>
                    <div className="space-y-1">
                      <p className={`text-xs font-black ${currentTheme.isDark ? 'text-white' : 'text-slate-700'}`}>{t.noStudentsInSystemTitle}</p>
                      <p className="text-[10px] font-semibold text-slate-400 leading-relaxed max-w-[250px] mx-auto">{t.noStudentsInSystemHint}</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => { onClose(); onOpenStudentForm(); }}
                      className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-emerald-600 text-white text-[10px] font-black hover:bg-emerald-700 transition-all shadow-sm shadow-emerald-600/20"
                    >
                      <Plus size={12} />
                      {t.addStudent}
                    </button>
                  </div>
                ) : (
                  <div className={`rounded-xl border ${currentTheme.border} ${currentTheme.isDark ? 'bg-slate-900' : 'bg-slate-50'} overflow-hidden`}>
                    <div className={`flex items-center gap-2 px-3 py-2 border-b ${currentTheme.border}`}>
                      <Search size={14} className="text-slate-400 flex-shrink-0" />
                      <input
                        type="text"
                        value={parentStudentSearch}
                        onChange={(e) => setParentStudentSearch(e.target.value)}
                        placeholder={t.searchStudents}
                        className="w-full bg-transparent text-xs font-semibold outline-none placeholder:text-slate-400"
                      />
                      {parentStudentSearch && (
                        <button
                          type="button"
                          onClick={() => setParentStudentSearch('')}
                          title={t.clearSearch}
                          className="p-1 rounded-full text-slate-400 hover:text-slate-600 hover:bg-slate-200/60 dark:hover:bg-white/10 transition-all flex-shrink-0"
                        >
                          <X size={12} />
                        </button>
                      )}
                      <select
                        value={parentClassFilter}
                        onChange={(e) => setParentClassFilter(e.target.value)}
                        className={`text-[10px] font-black rounded-lg border ${currentTheme.border} ${currentTheme.isDark ? 'bg-slate-900 text-white' : 'bg-slate-50 text-slate-700'} px-2 py-1.5 flex-shrink-0 outline-none cursor-pointer`}
                      >
                        <option value="all" className="bg-slate-800 text-white">{t.allClasses}</option>
                        {availableClasses.map(c => (
                          <option key={c.id} value={c.id} className="bg-slate-800 text-white">
                            {lang === 'en' ? c.nameEn : c.nameFr}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="max-h-48 overflow-y-auto p-1.5 space-y-0.5 custom-scrollbar">
                      {filteredStudents.length === 0 && (
                        <div className="px-3 py-5 text-center space-y-2.5">
                          <p className="text-xs font-semibold text-slate-400">
                            {search
                              ? t.noStudentsFound.replace('{query}', search)
                              : t.noStudentsInClass}
                          </p>
                          {(search || parentClassFilter !== 'all') && (
                            <button
                              type="button"
                              onClick={() => {
                                setParentStudentSearch('');
                                setParentClassFilter('all');
                              }}
                              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-[10px] font-black text-slate-500 hover:bg-slate-100 dark:hover:bg-white/10 transition-all"
                            >
                              <X size={12} />
                              {t.clearSearch}
                            </button>
                          )}
                        </div>
                      )}
                      {filteredStudents.map((s) => {
                        const checked = parentForm.linkedStudentIds.includes(s.id);
                        return (
                          <label
                            key={s.id}
                            className={`flex items-center gap-2.5 px-2.5 py-2 rounded-lg cursor-pointer transition-all ${checked ? (currentTheme.isDark ? 'bg-emerald-900/30' : 'bg-emerald-50') : 'hover:bg-white/10'}`}
                          >
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={(e) => {
                                const isChecked = e.target.checked;
                                setParentForm({
                                  ...parentForm,
                                  linkedStudentIds: isChecked
                                    ? [...parentForm.linkedStudentIds, s.id]
                                    : parentForm.linkedStudentIds.filter(id => id !== s.id),
                                });
                              }}
                              className="accent-emerald-600 w-4 h-4 flex-shrink-0"
                            />
                            <span className="flex-1 min-w-0">
                              <span className={`block text-xs font-bold truncate ${currentTheme.isDark ? 'text-white' : 'text-slate-800'}`}>
                                {s.name}
                              </span>
                              <span className={`mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 font-mono text-[10px] ${currentTheme.muted}`}>
                                {visibleStudentIdentifier(s.grade, s.studentId) && (
                                  <span className="flex items-center gap-1">
                                    <span className="font-black uppercase tracking-wide text-slate-400">{t.studentId}:</span>
                                    <span>{visibleStudentIdentifier(s.grade, s.studentId)}</span>
                                  </span>
                                )}
                                {s.grade ? (
                                  <span className="flex items-center gap-1">
                                    <span className="font-black uppercase tracking-wide text-slate-400">{t.grade}:</span>
                                    <span>{s.grade}</span>
                                  </span>
                                ) : null}
                              </span>
                            </span>
                            {s.parentId && (
                              <span className="text-[9px] font-black uppercase tracking-wider text-amber-500 flex-shrink-0">{t.alreadyLinked}</span>
                            )}
                          </label>
                        );
                      })}
                    </div>
                  </div>
                )}
                {parentForm.linkedStudentIds.length > 0 && (
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-[10px] font-black text-emerald-600">
                      {t.studentsSelected.replace('{n}', String(parentForm.linkedStudentIds.length))}
                    </p>
                    <button
                      type="button"
                      onClick={() => setParentForm({ ...parentForm, linkedStudentIds: [] })}
                      className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[10px] font-black text-rose-500 hover:bg-rose-500/10 transition-all"
                    >
                      <X size={12} />
                      {t.deselectAll}
                    </button>
                  </div>
                )}
              </div>
            );
          })()}

          <div className="space-y-1">
            <label className="text-[10px] font-black uppercase tracking-widest text-slate-400">{t.parentName} *</label>
            <input
              type="text"
              required
              value={parentForm.fullName}
              onChange={(e) => setParentForm({ ...parentForm, fullName: e.target.value })}
              placeholder={t.eGMamadouTraor}
              className={`w-full p-3 text-xs font-bold rounded-xl border ${currentTheme.border} ${currentTheme.isDark ? 'bg-slate-900 text-white' : 'bg-slate-50 text-slate-800'}`}
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1">
              <label className="text-[10px] font-black uppercase tracking-widest text-slate-400">{t.primaryPhone} *</label>
              <input
                type="text"
                required
                value={parentForm.primaryPhone}
                onChange={(e) => setParentForm({ ...parentForm, primaryPhone: e.target.value })}
                placeholder="+223 70 00 00 00"
                className={`w-full p-3 text-xs font-bold rounded-xl border ${currentTheme.border} ${currentTheme.isDark ? 'bg-slate-900 text-white' : 'bg-slate-50 text-slate-800'}`}
              />
            </div>

            <div className="space-y-1">
              <label className="text-[10px] font-black uppercase tracking-widest text-slate-400">{t.secondaryPhone}</label>
              <input
                type="text"
                value={parentForm.secondaryPhone}
                onChange={(e) => setParentForm({ ...parentForm, secondaryPhone: e.target.value })}
                placeholder="+223 66 00 00 00"
                className={`w-full p-3 text-xs font-bold rounded-xl border ${currentTheme.border} ${currentTheme.isDark ? 'bg-slate-900 text-white' : 'bg-slate-50 text-slate-800'}`}
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1">
              <label className="text-[10px] font-black uppercase tracking-widest text-slate-400">{t.email}</label>
              <input
                type="email"
                value={parentForm.email}
                onChange={(e) => setParentForm({ ...parentForm, email: e.target.value })}
                placeholder="parent@example.com"
                className={`w-full p-3 text-xs font-bold rounded-xl border ${currentTheme.border} ${currentTheme.isDark ? 'bg-slate-900 text-white' : 'bg-slate-50 text-slate-800'}`}
              />
            </div>

            <div className="space-y-1">
              <label className="text-[10px] font-black uppercase tracking-widest text-slate-400">{t.relationship} *</label>
              <select
                value={parentForm.relationship}
                onChange={(e) => setParentForm({ ...parentForm, relationship: e.target.value })}
                className={`w-full p-3 text-xs font-bold rounded-xl border ${currentTheme.border} ${currentTheme.isDark ? 'bg-slate-900 text-white' : 'bg-slate-50 text-slate-800'}`}
              >
                <option value="Father">{t.father}</option>
                <option value="Mother">{t.mother}</option>
                <option value="Guardian">{t.guardian}</option>
                <option value="Uncle">{t.uncle}</option>
                <option value="Aunt">{t.aunt}</option>
                <option value="Other">{t.other}</option>
              </select>
            </div>
          </div>

          <div className="space-y-1">
            <label className="text-[10px] font-black uppercase tracking-widest text-slate-400">{t.occupation}</label>
            <input
              type="text"
              value={parentForm.occupation}
              onChange={(e) => setParentForm({ ...parentForm, occupation: e.target.value })}
              placeholder={t.eGCivilEngineerBankerMerchant}
              className={`w-full p-3 text-xs font-bold rounded-xl border ${currentTheme.border} ${currentTheme.isDark ? 'bg-slate-900 text-white' : 'bg-slate-50 text-slate-800'}`}
            />
          </div>

          <div className="space-y-1">
            <label className="text-[10px] font-black uppercase tracking-widest text-slate-400">{t.address} *</label>
            <input
              type="text"
              required
              value={parentForm.address}
              onChange={(e) => setParentForm({ ...parentForm, address: e.target.value })}
              placeholder={t.eGQuartierHippodromeBamako}
              className={`w-full p-3 text-xs font-bold rounded-xl border ${currentTheme.border} ${currentTheme.isDark ? 'bg-slate-900 text-white' : 'bg-slate-50 text-slate-800'}`}
            />
          </div>

          <div className="space-y-1">
            <label className="text-[10px] font-black uppercase tracking-widest text-slate-400">{t.accountingNotes}</label>
            <textarea
              rows={3}
              value={parentForm.notes}
              onChange={(e) => setParentForm({ ...parentForm, notes: e.target.value })}
              placeholder={t.eGFamilyContactPreferencesOrSpecialNotes}
              className={`w-full p-3 text-xs font-bold rounded-xl border ${currentTheme.border} ${currentTheme.isDark ? 'bg-slate-900 text-white' : 'bg-slate-50 text-slate-800'}`}
            />
          </div>

          <div className="pt-4 flex justify-end gap-3">
            <button
              type="button"
              onClick={onClose}
              className="h-11 px-4 rounded-2xl border border-slate-200 dark:border-slate-800 text-xs font-bold text-slate-600 dark:text-slate-400 whitespace-nowrap"
            >
              {t.close}
            </button>
            <button
              type="submit"
              className="h-11 px-4 rounded-2xl bg-emerald-600 text-white font-black text-xs hover:bg-emerald-700 shadow-lg shadow-emerald-600/20 whitespace-nowrap"
            >
              {t.saveChanges}
            </button>
          </div>
        </form>
      </div>
    </ModalShell>
  );
}

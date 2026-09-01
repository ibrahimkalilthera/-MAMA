/**
 * Student add/edit modal — extracted verbatim from AppModals.tsx as its own
 * typed component (same treatment as the Productivité panel and the floating
 * chat).
 *
 * Self-manages the two keyboard overlay behaviours AppModals used to wire by
 * index: the focus trap (Tab confined to the modal while open, focus
 * restored on close — first focusable is the ✕) and Escape-to-close (stacked
 * with every other overlay through the shared escape stack). AppModals keeps
 * the AnimatePresence mount gate (the app's exit animations need the parent
 * present to play out) and passes the state + handlers as props.
 *
 * Carries the form's type definition (matches App.tsx's local form state):
 * exported here so AppModals only re-imports it.
 */
import { useRef } from 'react';
import type { Dispatch, FormEvent, SetStateAction } from 'react';
import { motion } from 'motion/react';
import { Plus, Trash2, Users, X } from 'lucide-react';
import { useFocusTrap } from '../lib/focusStack';
import { useEscapeToClose } from '../lib/useEscapeToClose';
import type { TranslationDict } from '../i18n/translations';
import type { Student } from '../lib/useSupabaseData';
import type { ManagedClass } from '../app/mainViewsProps';

/** Student add/edit form state (matches App.tsx). */
export interface StudentForm {
  name: string;
  parentName: string;
  parentEmail: string;
  parentPhone: string;
  totalDue: string;
  scholarshipDiscount: string;
  dueDate: string;
  academicYear: string;
  grade: string;
  studentId: string;
  photo: string;
  emergencyContactName: string;
  emergencyContactRelation: string;
  emergencyContactPhone: string;
  medicalNotes: string;
  enrollmentDate: string;
  previousSchool: string;
  status: 'Active' | 'Graduated' | 'Left';
}

export interface StudentFormModalProps {
  t: TranslationDict;
  lang: 'en' | 'fr';
  /** Mount gate — also drives trap/escape while the exit animation plays. */
  open: boolean;
  editingStudent: Student | null;
  studentForm: StudentForm;
  setStudentForm: Dispatch<SetStateAction<StudentForm>>;
  handleStudentSubmit: (e: FormEvent) => Promise<void>;
  onClose: () => void;
  /** "New class" quick action (opens the add-class modal from the grade select). */
  onOpenAddClass: () => void;
  /** Delete request — AppModals owns the confirm dialog behind this modal. */
  onDeleteRequest: (student: Student) => void;
  availableClasses: ManagedClass[];
  academicYears: string[];
  isPromoter: boolean;
  /** Theme tokens from the app theme engine. */
  themeCard: string;
  themeBorder: string;
  themeHeader: string;
  themeMuted: string;
  themeIsDark: boolean;
}

export function StudentFormModal(props: StudentFormModalProps) {
  const {
    t,
    lang,
    open,
    editingStudent,
    studentForm,
    setStudentForm,
    handleStudentSubmit,
    onClose,
    onOpenAddClass,
    onDeleteRequest,
    availableClasses,
    academicYears,
    isPromoter,
    themeCard,
    themeBorder,
    themeHeader,
    themeMuted,
    themeIsDark,
  } = props;

  // Tab is confined to the modal while open; focus returns to the trigger on
  // close. Escape closes it (stacked with every other overlay).
  const rootRef = useRef<HTMLDivElement | null>(null);
  useFocusTrap(open, () => rootRef.current);
  useEscapeToClose(open, onClose);

  return (
    <div ref={rootRef} role="dialog" aria-modal="true" aria-label={editingStudent ? t.editStudent : t.addStudent} aria-labelledby="modal-title-student-form" className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={onClose}
        className="absolute inset-0 bg-slate-900/60 backdrop-blur-md"
      />
      <motion.div
        initial={{ opacity: 0, scale: 0.9, y: 40 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.9, y: 40 }}
        className={`relative ${themeCard} w-full max-w-lg rounded-[3rem] shadow-2xl border ${themeBorder} overflow-hidden`}
      >
        <div className="p-8 border-b border-slate-50 flex justify-between items-center bg-[#0F172A] text-white" style={{ backgroundColor: themeHeader }}>
          <h2 id="modal-title-student-form" className="text-xl font-bold flex items-center gap-3">
            <Users size={24} className="text-blue-400" />
            {editingStudent ? t.editStudent : t.addStudent}
          </h2>
          <button
            onClick={onClose}
            className="p-2 hover:bg-white/10 rounded-xl transition-all"
          >
            <X size={20} />
          </button>
        </div>

        <form onSubmit={handleStudentSubmit} className="p-10 space-y-6 max-h-[70vh] overflow-y-auto custom-scrollbar">
          {/* --- Student Profiles & Enrollment Core Fields --- */}
          <div className="grid grid-cols-2 gap-6">
            <div className="space-y-2">
              <label className={`text-[10px] font-black ${themeMuted} uppercase tracking-widest`}>{t.studentName}</label>
              <input
                required
                type="text"
                value={studentForm.name}
                onChange={(e) => setStudentForm({ ...studentForm, name: e.target.value })}
                className={`w-full px-6 py-4 ${themeIsDark ? 'bg-emerald-900/10' : 'bg-slate-50'} border ${themeBorder} rounded-2xl focus:outline-none focus:ring-4 focus:ring-blue-500/5 focus:border-blue-500 transition-all text-sm font-semibold ${themeIsDark ? 'text-emerald-500' : 'text-slate-800'}`}
                placeholder="Ibrahim"
              />
            </div>
            <div className="space-y-2">
              <label className={`text-[10px] font-black ${themeMuted} uppercase tracking-widest`}>{t.studentIdUnique}</label>
              <input
                type="text"
                value={studentForm.studentId}
                onChange={(e) => setStudentForm({ ...studentForm, studentId: e.target.value })}
                className={`w-full px-6 py-4 ${themeIsDark ? 'bg-emerald-900/10' : 'bg-slate-50'} border ${themeBorder} rounded-2xl focus:outline-none focus:ring-4 focus:ring-blue-500/5 focus:border-blue-500 transition-all text-sm font-semibold ${themeIsDark ? 'text-emerald-500' : 'text-slate-800'}`}
                placeholder="MT-2026-001 (Optional)"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-6">
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label className={`text-[10px] font-black ${themeMuted} uppercase tracking-widest`}>
                  {t.gradeClass}
                </label>
                <button
                  type="button"
                  onClick={onOpenAddClass}
                  className="text-[10px] font-black text-blue-500 hover:text-blue-600 hover:underline flex items-center gap-1"
                >
                  <Plus size={12} />
                  <span>{t.newClass}</span>
                </button>
              </div>
              <select
                required
                value={studentForm.grade}
                onChange={(e) => {
                  if (e.target.value === '__ADD_NEW_CLASS__') {
                    onOpenAddClass();
                  } else {
                    setStudentForm({ ...studentForm, grade: e.target.value });
                  }
                }}
                className={`w-full px-6 py-4 ${themeIsDark ? 'bg-slate-800 text-emerald-500' : 'bg-slate-50 text-slate-800'} border ${themeBorder} rounded-2xl focus:outline-none focus:ring-4 focus:ring-blue-500/5 focus:border-blue-500 transition-all text-sm font-semibold`}
              >
                <option value="">{t.selectGradeClass}</option>
                <optgroup label={t.firstCycle1stTo6thYear}>
                  {availableClasses.filter(c => c.cycle === 'cycle1').map(c => (
                    <option key={c.id} value={c.id}>{lang === 'en' ? c.nameEn : c.nameFr}</option>
                  ))}
                </optgroup>
                <optgroup label={t.secondCycle7thTo9thYear}>
                  {availableClasses.filter(c => c.cycle === 'cycle2').map(c => (
                    <option key={c.id} value={c.id}>{lang === 'en' ? c.nameEn : c.nameFr}</option>
                  ))}
                </optgroup>
                {availableClasses.some(c => c.cycle !== 'cycle1' && c.cycle !== 'cycle2') && (
                  <optgroup label={t.otherCustomClasses}>
                    {availableClasses.filter(c => c.cycle !== 'cycle1' && c.cycle !== 'cycle2').map(c => (
                      <option key={c.id} value={c.id}>{lang === 'en' ? c.nameEn : c.nameFr}</option>
                    ))}
                  </optgroup>
                )}
                <option value="__ADD_NEW_CLASS__" className="text-blue-600 font-bold">
                  {t.addAnotherClassSection}
                </option>
              </select>
              <p className={`text-[10px] ${themeMuted}`}>
                {t.staffCanAddSectionsSuchAs1stYearBOrC}
              </p>
            </div>
            <div className="space-y-2">
              <label className={`text-[10px] font-black ${themeMuted} uppercase tracking-widest`}>{t.enrollmentStatus}</label>
              <select
                value={studentForm.status}
                onChange={(e) => setStudentForm({ ...studentForm, status: e.target.value as StudentForm['status'] })}
                className={`w-full px-6 py-4 ${themeIsDark ? 'bg-emerald-900/10' : 'bg-slate-50'} border ${themeBorder} rounded-2xl focus:outline-none focus:ring-4 focus:ring-blue-500/5 focus:border-blue-500 transition-all text-sm font-semibold ${themeIsDark ? 'text-emerald-500' : 'text-slate-800'}`}
              >
                <option value="Active">{t.activeStatus}</option>
                <option value="Graduated">{t.graduatedStatus}</option>
                <option value="Left">{t.left}</option>
              </select>
            </div>
          </div>

          <div className="space-y-2">
            <label className={`text-[10px] font-black ${themeMuted} uppercase tracking-widest`}>{t.passportPhotoLink}</label>
            <input
              type="text"
              value={studentForm.photo}
              onChange={(e) => setStudentForm({ ...studentForm, photo: e.target.value })}
              className={`w-full px-6 py-4 ${themeIsDark ? 'bg-emerald-900/10' : 'bg-slate-50'} border ${themeBorder} rounded-2xl focus:outline-none focus:ring-4 focus:ring-blue-500/5 focus:border-blue-500 transition-all text-sm font-semibold ${themeIsDark ? 'text-emerald-500' : 'text-slate-800'}`}
              placeholder="https://images.unsplash.com/photo-..."
            />
          </div>

          {/* --- Parents Contact & Details --- */}
          <div className="grid grid-cols-2 gap-6">
            <div className="space-y-2">
              <label className={`text-[10px] font-black ${themeMuted} uppercase tracking-widest`}>{t.parentName}</label>
              <input
                required
                type="text"
                value={studentForm.parentName}
                onChange={(e) => setStudentForm({ ...studentForm, parentName: e.target.value })}
                className={`w-full px-6 py-4 ${themeIsDark ? 'bg-emerald-900/10' : 'bg-slate-50'} border ${themeBorder} rounded-2xl focus:outline-none focus:ring-4 focus:ring-blue-500/5 focus:border-blue-500 transition-all text-sm font-semibold ${themeIsDark ? 'text-emerald-500' : 'text-slate-800'}`}
                placeholder="Djeneba"
              />
            </div>
            <div className="space-y-2">
              <label className={`text-[10px] font-black ${themeMuted} uppercase tracking-widest`}>
                {t.parentEmailOptional}
              </label>
              <input
                type="email"
                value={studentForm.parentEmail}
                onChange={(e) => setStudentForm({ ...studentForm, parentEmail: e.target.value })}
                className={`w-full px-6 py-4 ${themeIsDark ? 'bg-emerald-900/10' : 'bg-slate-50'} border ${themeBorder} rounded-2xl focus:outline-none focus:ring-4 focus:ring-blue-500/5 focus:border-blue-500 transition-all text-sm font-semibold ${themeIsDark ? 'text-emerald-500' : 'text-slate-800'}`}
                placeholder={t.parentExampleComOptional}
              />
            </div>
          </div>

          <div className="space-y-2">
            <label className={`text-[10px] font-black ${themeMuted} uppercase tracking-widest`}>{t.phone}</label>
            <input
              required
              type="tel"
              value={studentForm.parentPhone}
              onChange={(e) => setStudentForm({ ...studentForm, parentPhone: e.target.value })}
              className={`w-full px-6 py-4 ${themeIsDark ? 'bg-emerald-900/10' : 'bg-slate-50'} border ${themeBorder} rounded-2xl focus:outline-none focus:ring-4 focus:ring-blue-500/5 focus:border-blue-500 transition-all text-sm font-semibold ${themeIsDark ? 'text-emerald-500' : 'text-slate-800'}`}
              placeholder="+223 70 00 00 00"
            />
          </div>

          {/* --- Emergency Contact Fields --- */}
          <div className={`p-6 ${themeIsDark ? 'bg-slate-900/50' : 'bg-slate-50'} rounded-3xl border ${themeBorder} space-y-4`}>
            <h4 className={`text-[10px] font-black ${themeMuted} uppercase tracking-widest`}>
              {t.emergencyContact2}
            </h4>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <label className={`text-[10px] font-black ${themeMuted} uppercase tracking-widest`}>
                  {t.contactName}
                </label>
                <input
                  type="text"
                  value={studentForm.emergencyContactName}
                  onChange={(e) => setStudentForm({ ...studentForm, emergencyContactName: e.target.value })}
                  className={`w-full px-4 py-3 bg-white ${themeIsDark ? 'bg-slate-800 text-emerald-500 border-emerald-900/20' : 'border-slate-200 text-slate-850'} border rounded-xl text-xs font-semibold`}
                  placeholder={t.emergencyContactName}
                />
              </div>
              <div className="space-y-2">
                <label className={`text-[10px] font-black ${themeMuted} uppercase tracking-widest`}>
                  {t.relation}
                </label>
                <input
                  type="text"
                  value={studentForm.emergencyContactRelation}
                  onChange={(e) => setStudentForm({ ...studentForm, emergencyContactRelation: e.target.value })}
                  className={`w-full px-4 py-3 bg-white ${themeIsDark ? 'bg-slate-800 text-emerald-500 border-emerald-900/20' : 'border-slate-200 text-slate-850'} border rounded-xl text-xs font-semibold`}
                  placeholder={t.uncleAuntParentEtc}
                />
              </div>
            </div>
            <div className="space-y-2">
              <label className={`text-[10px] font-black ${themeMuted} uppercase tracking-widest`}>
                {t.emergencyPhone}
              </label>
              <input
                type="tel"
                value={studentForm.emergencyContactPhone}
                onChange={(e) => setStudentForm({ ...studentForm, emergencyContactPhone: e.target.value })}
                className={`w-full px-4 py-3 bg-white ${themeIsDark ? 'bg-slate-800 text-emerald-500 border-emerald-900/20' : 'border-slate-200 text-slate-850'} border rounded-xl text-xs font-semibold`}
                placeholder={t.emergencyContactPhone}
              />
            </div>
          </div>

          {/* --- History & Medical notes --- */}
          <div className="grid grid-cols-2 gap-6">
            <div className="space-y-2">
              <label className={`text-[10px] font-black ${themeMuted} uppercase tracking-widest`}>
                {t.enrollmentDate2}
              </label>
              <input
                type="date"
                value={studentForm.enrollmentDate}
                onChange={(e) => setStudentForm({ ...studentForm, enrollmentDate: e.target.value })}
                className={`w-full px-6 py-4 ${themeIsDark ? 'bg-emerald-900/10' : 'bg-slate-50'} border ${themeBorder} rounded-2xl focus:outline-none focus:ring-4 focus:ring-blue-500/5 focus:border-blue-500 transition-all text-sm font-semibold ${themeIsDark ? 'text-emerald-500' : 'text-slate-800'}`}
              />
            </div>
            <div className="space-y-2">
              <label className={`text-[10px] font-black ${themeMuted} uppercase tracking-widest`}>
                {t.previousSchool}
              </label>
              <input
                type="text"
                value={studentForm.previousSchool}
                onChange={(e) => setStudentForm({ ...studentForm, previousSchool: e.target.value })}
                className={`w-full px-6 py-4 ${themeIsDark ? 'bg-emerald-900/10' : 'bg-slate-50'} border ${themeBorder} rounded-2xl focus:outline-none focus:ring-4 focus:ring-blue-500/5 focus:border-blue-500 transition-all text-sm font-semibold ${themeIsDark ? 'text-emerald-500' : 'text-slate-800'}`}
                placeholder={t.transferHistorySchoolName}
              />
            </div>
          </div>

          <div className="space-y-2">
            <label className={`text-[10px] font-black ${themeMuted} uppercase tracking-widest`}>
              {t.medicalNotesAllergiesConditions}
            </label>
            <textarea
              value={studentForm.medicalNotes}
              onChange={(e) => setStudentForm({ ...studentForm, medicalNotes: e.target.value })}
              className={`w-full px-6 py-4 ${themeIsDark ? 'bg-emerald-900/10' : 'bg-slate-50'} border ${themeBorder} rounded-2xl focus:outline-none focus:ring-4 focus:ring-blue-500/5 focus:border-blue-500 transition-all text-sm font-semibold ${themeIsDark ? 'text-emerald-500' : 'text-slate-800'} min-h-[100px]`}
              placeholder={t.allergiesConditionsOrNone}
            />
          </div>

          {/* --- Financial Controls --- */}
          <div className="grid grid-cols-2 gap-6">
            <div className="space-y-2">
              <label className={`text-[10px] font-black ${themeMuted} uppercase tracking-widest flex items-center justify-between`}>
                <span>{t.totalDue} ({t.currency})</span>
                <span className="text-[9px] text-emerald-600 font-bold">
                  ({t.staffAuthorized})
                </span>
              </label>
              <div className="relative">
                <input
                  required
                  type="number"
                  min="0"
                  step="1"
                  value={studentForm.totalDue}
                  onChange={(e) => setStudentForm({ ...studentForm, totalDue: e.target.value })}
                  className={`w-full px-6 py-4 ${themeIsDark ? 'bg-emerald-900/10' : 'bg-slate-50'} border ${themeBorder} rounded-2xl focus:outline-none focus:ring-4 focus:ring-blue-500/5 focus:border-blue-500 transition-all text-sm font-semibold ${themeIsDark ? 'text-emerald-500' : 'text-slate-800'}`}
                  placeholder="120000"
                />
              </div>
            </div>
            <div className="space-y-2">
              <label className={`text-[10px] font-black ${themeMuted} uppercase tracking-widest flex items-center justify-between`}>
                <span>{t.scholarship}</span>
                {!isPromoter && (
                  <span className="text-[9px] text-rose-500 font-bold">
                    ({t.promoterOnly})
                  </span>
                )}
              </label>
              <input
                type="number"
                min="0"
                max="100"
                step="1"
                value={studentForm.scholarshipDiscount}
                onChange={(e) => setStudentForm({ ...studentForm, scholarshipDiscount: e.target.value })}
                disabled={!isPromoter}
                className={`w-full px-6 py-4 ${!isPromoter ? 'bg-slate-150 cursor-not-allowed opacity-70' : (themeIsDark ? 'bg-emerald-900/10' : 'bg-slate-50')} border ${themeBorder} rounded-2xl focus:outline-none focus:ring-4 focus:ring-blue-500/5 focus:border-blue-500 transition-all text-sm font-semibold ${themeIsDark ? 'text-emerald-500' : 'text-slate-800'}`}
                placeholder="0"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-6">
            <div className="space-y-2">
              <label className={`text-[10px] font-black ${themeMuted} uppercase tracking-widest`}>{t.academicYear}</label>
              <select
                value={studentForm.academicYear}
                onChange={(e) => setStudentForm({ ...studentForm, academicYear: e.target.value })}
                className={`w-full px-6 py-4 ${themeIsDark ? 'bg-emerald-900/10' : 'bg-slate-50'} border ${themeBorder} rounded-2xl focus:outline-none focus:ring-4 focus:ring-blue-500/5 focus:border-blue-500 transition-all text-sm font-semibold ${themeIsDark ? 'text-emerald-500' : 'text-slate-800'}`}
              >
                {academicYears.map(year => (
                  <option key={year} value={year}>{year}</option>
                ))}
              </select>
            </div>
            <div className="space-y-2">
              <label className={`text-[10px] font-black ${themeMuted} uppercase tracking-widest`}>{t.dueDate}</label>
              <input
                required
                type="date"
                value={studentForm.dueDate}
                onChange={(e) => setStudentForm({ ...studentForm, dueDate: e.target.value })}
                className={`w-full px-6 py-4 ${themeIsDark ? 'bg-emerald-900/10' : 'bg-slate-50'} border ${themeBorder} rounded-2xl focus:outline-none focus:ring-4 focus:ring-blue-500/5 focus:border-blue-500 transition-all text-sm font-semibold ${themeIsDark ? 'text-emerald-500' : 'text-slate-800'}`}
              />
            </div>
          </div>

          <button
            type="submit"
            className="w-full bg-blue-600 hover:bg-blue-700 text-white py-5 rounded-2xl font-black text-sm transition-all shadow-xl shadow-blue-500/20 active:scale-[0.98]"
          >
            {editingStudent ? t.saveChanges : t.submit}
          </button>

          {editingStudent && (
            <button
              type="button"
              onClick={() => onDeleteRequest(editingStudent)}
              className="w-full bg-rose-600 hover:bg-rose-700 text-white py-4 rounded-2xl font-black text-sm transition-all shadow-xl shadow-rose-500/20 active:scale-[0.98] flex items-center justify-center gap-2"
            >
              <Trash2 size={16} />
              {t.deleteStudent}
            </button>
          )}
        </form>
      </motion.div>
    </div>
  );
}
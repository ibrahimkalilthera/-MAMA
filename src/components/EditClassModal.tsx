/**
 * Edit-custom-class/section modal — extracted verbatim from AppModals.tsx as
 * its own typed component (same treatment as the Productivité panel, the
 * floating chat, the student form modal and the add-class modal).
 *
 * Self-manages the two keyboard overlay behaviours AppModals used to wire by
 * index: the focus trap (Tab confined to the modal while open, focus
 * restored on close — first focusable is the ✕) and Escape-to-close (stacked
 * with every other overlay through the shared escape stack). AppModals keeps
 * the AnimatePresence mount gate and passes the state + handler as props.
 */
import { useRef } from 'react';
import type { Dispatch, FormEvent, SetStateAction } from 'react';
import { motion } from 'motion/react';
import { CheckCircle2, Layers, X } from 'lucide-react';
import { useFocusTrap } from '../lib/focusStack';
import { useEscapeToClose } from '../lib/useEscapeToClose';
import type { TranslationDict } from '../i18n/translations';
import type { ClassForm } from './AddClassModal';

export interface EditClassModalProps {
  t: TranslationDict;
  /** Mount gate — also drives trap/escape while the exit animation plays. */
  open: boolean;
  editClassForm: ClassForm;
  setEditClassForm: Dispatch<SetStateAction<ClassForm>>;
  handleEditClassSubmit: (e: FormEvent) => Promise<void>;
  onClose: () => void;
  /** Theme tokens from the app theme engine. */
  themeCard: string;
  themeBorder: string;
  themeHeader: string;
  themeMuted: string;
  themeIsDark: boolean;
}

export function EditClassModal(props: EditClassModalProps) {
  const {
    t,
    open,
    editClassForm,
    setEditClassForm,
    handleEditClassSubmit,
    onClose,
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
    <div ref={rootRef} role="dialog" aria-modal="true" aria-label={t.editClassSection} aria-labelledby="modal-title-edit-class" className="fixed inset-0 z-50 flex items-center justify-center p-4">
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
        className={`relative ${themeCard} w-full max-w-md rounded-[2.5rem] shadow-2xl border ${themeBorder} overflow-hidden`}
      >
        <div className="p-6 border-b border-white/10 flex justify-between items-center bg-[#0F172A] text-white" style={{ backgroundColor: themeHeader }}>
          <h3 id="modal-title-edit-class" className="text-lg font-bold flex items-center gap-2.5">
            <Layers size={20} className="text-blue-400" />
            <span>{t.editClassSection}</span>
          </h3>
          <button
            onClick={onClose}
            className="p-2 hover:bg-white/10 rounded-xl transition-all"
          >
            <X size={18} />
          </button>
        </div>

        <form onSubmit={handleEditClassSubmit} className="p-6 space-y-5">
          <div className="space-y-1.5">
            <label className={`text-[10px] font-black ${themeMuted} uppercase tracking-widest`}>
              {t.schoolCycle}
            </label>
            <select
              value={editClassForm.cycle}
              onChange={(e) => {
                const c = e.target.value as ClassForm['cycle'];
                const defYear = c === 'cycle2' ? '7' : c === 'lycee' ? '10' : c === 'maternelle' ? 'PS' : '1';
                setEditClassForm({ ...editClassForm, cycle: c, year: defYear });
              }}
              className={`w-full p-3.5 text-xs font-bold rounded-xl border ${themeBorder} ${themeIsDark ? 'bg-slate-800 text-white' : 'bg-slate-50 text-slate-800'}`}
            >
              <option value="cycle1">{t.firstCycle1stTo6thYear}</option>
              <option value="cycle2">{t.secondCycle7thTo9thYear}</option>
              <option value="lycee">{t.lycEHighSchool}</option>
              <option value="maternelle">{t.maternelleKindergarten}</option>
              <option value="other">{t.otherFullyCustomName}</option>
            </select>
          </div>

          {editClassForm.cycle !== 'other' ? (
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <label className={`text-[10px] font-black ${themeMuted} uppercase tracking-widest`}>
                  {t.gradeLevel2}
                </label>
                <select
                  value={editClassForm.year}
                  onChange={(e) => setEditClassForm({ ...editClassForm, year: e.target.value })}
                  className={`w-full p-3.5 text-xs font-bold rounded-xl border ${themeBorder} ${themeIsDark ? 'bg-slate-800 text-white' : 'bg-slate-50 text-slate-800'}`}
                >
                  {editClassForm.cycle === 'cycle1' && (
                    <>
                      <option value="1">{t.n1stYear1Re}</option>
                      <option value="2">{t.n2ndYear2Me}</option>
                      <option value="3">{t.n3rdYear3Me}</option>
                      <option value="4">{t.n4thYear4Me}</option>
                      <option value="5">{t.n5thYear5Me}</option>
                      <option value="6">{t.n6thYear6Me}</option>
                    </>
                  )}
                  {editClassForm.cycle === 'cycle2' && (
                    <>
                      <option value="7">{t.n7thYear7Me}</option>
                      <option value="8">{t.n8thYear8Me}</option>
                      <option value="9">{t.n9thYear9Me}</option>
                    </>
                  )}
                  {editClassForm.cycle === 'lycee' && (
                    <>
                      <option value="10">{t.n10thYear10Me}</option>
                      <option value="11">{t.n11thYear11Me}</option>
                      <option value="12">{t.n12thYear12Me}</option>
                    </>
                  )}
                  {editClassForm.cycle === 'maternelle' && (
                    <>
                      <option value="PS">{t.petiteSection}</option>
                      <option value="MS">{t.moyenneSection}</option>
                      <option value="GS">{t.grandeSection}</option>
                    </>
                  )}
                </select>
              </div>

              <div className="space-y-1.5">
                <label className={`text-[10px] font-black ${themeMuted} uppercase tracking-widest`}>
                  {t.sectionEGDE}
                </label>
                <input
                  type="text"
                  required
                  maxLength={5}
                  placeholder="D, E, F..."
                  value={editClassForm.section}
                  onChange={(e) => setEditClassForm({ ...editClassForm, section: e.target.value.toUpperCase() })}
                  className={`w-full p-3.5 text-xs font-bold uppercase rounded-xl border ${themeBorder} ${themeIsDark ? 'bg-slate-800 text-white' : 'bg-slate-50 text-slate-800'}`}
                />
              </div>
            </div>
          ) : (
            <div className="space-y-1.5">
              <label className={`text-[10px] font-black ${themeMuted} uppercase tracking-widest`}>
                {t.customClassName}
              </label>
              <input
                type="text"
                required
                placeholder={t.eG1ReDOrGarderie}
                value={editClassForm.customName}
                onChange={(e) => setEditClassForm({ ...editClassForm, customName: e.target.value })}
                className={`w-full p-3.5 text-xs font-bold rounded-xl border ${themeBorder} ${themeIsDark ? 'bg-slate-800 text-white' : 'bg-slate-50 text-slate-800'}`}
              />
            </div>
          )}

          {/* Preview Badge */}
          <div className={`p-4 rounded-xl border ${themeBorder} ${themeIsDark ? 'bg-slate-900/40' : 'bg-slate-50'}`}>
            <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-1">
              {t.generatedClassCode}
            </p>
            <div className="flex items-center gap-2">
              <span className="px-2.5 py-1 bg-blue-50 dark:bg-blue-950/40 text-blue-600 dark:text-blue-300 border border-blue-200 dark:border-blue-900/60 rounded-lg text-xs font-black">
                {editClassForm.cycle === 'other' ? (editClassForm.customName || 'CUSTOM') : `${editClassForm.year}${editClassForm.section || 'A'}`}
              </span>
              <span className="text-xs text-slate-600 dark:text-slate-300 font-semibold">
                {editClassForm.cycle === 'other'
                  ? (editClassForm.customName || 'Classe personnalisée')
                  : `${editClassForm.year === '1' ? '1ère Année' : editClassForm.year + 'ème Année'} ${editClassForm.section || 'A'}`}
              </span>
            </div>
          </div>

          <div className="pt-2 flex justify-end gap-3 border-t border-slate-100 dark:border-slate-800">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2.5 rounded-xl border border-slate-200 dark:border-slate-800 text-xs font-bold text-slate-600 dark:text-slate-400 hover:bg-slate-50"
            >
              {t.cancel}
            </button>
            <button
              type="submit"
              className="px-5 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs shadow-lg shadow-blue-600/20 active:scale-95 transition-all flex items-center gap-1.5"
            >
              <CheckCircle2 size={14} />
              <span>{t.saveChanges}</span>
            </button>
          </div>
        </form>
      </motion.div>
    </div>
  );
}
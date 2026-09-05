/**
 * LinkStudentModal — Attach an existing student to a parent (Students ⇄ Parents). Not wrapped in AnimatePresence (verbatim — fade-in via CSS). Presentational: parent, candidates and form state arrive as narrow props.
 */
import { motion } from 'motion/react';
import { X } from 'lucide-react';
import type { Dispatch, SetStateAction, FormEvent } from 'react';
import type { Student, Parent } from '../lib/useSupabaseData';
import type { CurrentTheme } from '../app/mainViewsProps';
import type { TranslationDict } from '../i18n/translations';
import { visibleStudentIdentifier } from '../lib/studentIdentifiers';

export interface LinkStudentModalProps {
  t: TranslationDict;
  currentTheme: CurrentTheme;
  activeLinkingParent: Parent;
  students: Student[];
  studentToLinkId: string;
  setStudentToLinkId: Dispatch<SetStateAction<string>>;
  handleLinkStudentSubmit: (e: FormEvent) => Promise<void>;
  /** The dialog root — registered in AppModals' overlay refs (focus trap). */
  overlayRef: (el: HTMLElement | null) => void;
  onClose: () => void;
}

export function LinkStudentModal(props: LinkStudentModalProps) {
  const { t, currentTheme, activeLinkingParent, students, studentToLinkId, setStudentToLinkId, handleLinkStudentSubmit, overlayRef, onClose } = props;
  return (
        <div ref={overlayRef} role="dialog" aria-modal="true" aria-label={t.linkStudent} aria-labelledby="modal-title-link-student" className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-fade-in no-print">
          <motion.div
            initial={{ scale: 0.95, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            className={`w-full max-w-md ${currentTheme.card} p-8 rounded-[2rem] border ${currentTheme.border} shadow-2xl space-y-6`}
          >
            <div className="flex items-center justify-between pb-4 border-b border-slate-100 dark:border-slate-800">
              <div>
                <h3 id="modal-title-link-student" className={`text-lg font-black ${currentTheme.isDark ? 'text-white' : 'text-slate-900'}`}>
                  {t.linkStudent}
                </h3>
                <p className="text-xs text-slate-400">
                  {t.attachChildTo.replace('{name}', activeLinkingParent.fullName)}
                </p>
              </div>
              <button
                onClick={() => onClose()}
                className="p-2 text-slate-400 hover:text-slate-600 rounded-xl"
              >
                <X size={20} />
              </button>
            </div>

            <form onSubmit={handleLinkStudentSubmit} className="space-y-4">
              <div className="space-y-1">
                <label className="text-[10px] font-black uppercase tracking-widest text-slate-400">{t.selectStudent}</label>
                <select
                  required
                  value={studentToLinkId}
                  onChange={(e) => setStudentToLinkId(e.target.value)}
                  className={`w-full p-3 text-xs font-bold rounded-xl border ${currentTheme.border} ${currentTheme.isDark ? 'bg-slate-900 text-white' : 'bg-slate-50 text-slate-800'}`}
                >
                  <option value="">-- {t.selectStudentToLink} --</option>
                  {students.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}{visibleStudentIdentifier(s.grade, s.studentId) ? ` — ${t.studentId}: ${visibleStudentIdentifier(s.grade, s.studentId)}` : ''} · {t.grade}: {s.grade || '—'}
                    </option>
                  ))}
                </select>
              </div>

              <div className="pt-4 flex justify-end gap-3">
                <button
                  type="button"
                  onClick={() => onClose()}
                  className="h-11 px-4 rounded-2xl border border-slate-200 dark:border-slate-800 text-xs font-bold text-slate-600 dark:text-slate-400 whitespace-nowrap"
                >
                  {t.close}
                </button>
                <button
                  type="submit"
                  disabled={!studentToLinkId}
                  className="h-11 px-4 rounded-2xl bg-emerald-600 text-white font-black text-xs hover:bg-emerald-700 disabled:opacity-50 shadow-lg shadow-emerald-600/20 whitespace-nowrap"
                >
                  {t.linkStudent}
                </button>
              </div>
            </form>
          </motion.div>
        </div>
  );
}

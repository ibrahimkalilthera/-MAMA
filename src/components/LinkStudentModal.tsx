/**
 * LinkStudentModal — Attach an existing student to a parent (Students ⇄ Parents). Not wrapped in AnimatePresence (verbatim — fade-in via CSS). Presentational: parent, candidates and form state arrive as narrow props.
 *
 * La liste déroulante portait TOUS les élèves de l'école : dans un établissement
 * de plusieurs centaines de pensionnaires, retrouver l'enfant d'un parent
 * demandait de dérouler la liste en entier. Une RECHERCHE par nom ou matricule
 * (voir `src/lib/studentSearch.ts` — même règle que les autres écrans qui
 * parcourent une liste d'élèves) réduit donc ce qui est proposé, et chaque ligne
 * porte déjà le matricule, pour que le rattachement se vérifie des yeux.
 *
 * Le filtre est LOCAL (état du modal) : il ne change ni la classe d'un élève ni
 * aucun autre écran. Il repart vide à chaque ouverture — c'est un geste de
 * consultation, pas un état durable.
 */
import { useMemo, useState } from 'react';
import { Search, X } from 'lucide-react';
import type { Dispatch, SetStateAction, FormEvent } from 'react';
import type { Student, Parent } from '../lib/useSupabaseData';
import type { CurrentTheme } from '../app/mainViewsProps';
import type { TranslationDict } from '../i18n/translations';
import { studentMatricule } from '../lib/studentIdentifiers';
import { matchesStudentQuery } from '../lib/studentSearch';
import { ModalShell } from './ModalShell';

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

  const [search, setSearch] = useState('');

  const visibleStudents = useMemo(
    () => students.filter((s) => matchesStudentQuery(s, search)),
    [students, search],
  );

  // Après un changement de recherche, efface la sélection si l'élève choisi
  // n'est plus proposé : aucun rattachement ne doit partir vers un élève absent
  // de la liste affichée.
  const keepSelectionOnlyIfVisible = (nextSearch: string) => {
    const selected = students.find((s) => s.id === studentToLinkId);
    if (selected && !matchesStudentQuery(selected, nextSearch)) setStudentToLinkId('');
  };

  return (
    <ModalShell
      overlayRef={overlayRef}
      onClose={onClose}
      currentTheme={currentTheme}
      titleId="modal-title-link-student"
      ariaLabel={t.linkStudent}
      maxWidth="max-w-md"
      panelRadius="rounded-3xl"
      rootClassName="animate-fade-in no-print"
      header={
        <div className="flex items-center justify-between px-8 pt-8 pb-4 border-b border-slate-100 dark:border-slate-800">
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
      }
    >
      <div className="p-8 space-y-6">
        <form onSubmit={handleLinkStudentSubmit} className="space-y-4">
              <div className="space-y-1">
                <div className="text-2xs font-black uppercase tracking-widest text-slate-400">{t.selectStudent}</div>
                <div className="relative">
                  <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                  <input
                    id="link-student-search"
                    data-slot="link-student-search"
                    type="text"
                    value={search}
                    onChange={(e) => {
                      const nextSearch = e.target.value;
                      setSearch(nextSearch);
                      keepSelectionOnlyIfVisible(nextSearch);
                    }}
                    aria-label={t.searchNameOrId}
                    placeholder={t.searchNameOrId}
                    className={`w-full pl-9 pr-9 p-3 text-xs font-bold rounded-xl border ${currentTheme.border} ${currentTheme.isDark ? 'bg-slate-900 text-white' : 'bg-slate-50 text-slate-800'} outline-none`}
                  />
                  {search && (
                    <button
                      type="button"
                      onClick={() => setSearch('')}
                      title={t.clearSearch}
                      aria-label={t.clearSearch}
                      className="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded-full text-slate-400 hover:text-slate-600 hover:bg-slate-200/60 dark:hover:bg-white/10 transition-all"
                    >
                      <X size={12} />
                    </button>
                  )}
                </div>
                <select
                  required
                  value={studentToLinkId}
                  onChange={(e) => setStudentToLinkId(e.target.value)}
                  className={`w-full p-3 text-xs font-bold rounded-xl border ${currentTheme.border} ${currentTheme.isDark ? 'bg-slate-900 text-white' : 'bg-slate-50 text-slate-800'}`}
                >
                  <option value="">-- {t.selectStudentToLink} --</option>
                  {visibleStudents.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}{studentMatricule(s.studentId) ? ` — ${t.studentId}: ${studentMatricule(s.studentId)}` : ''} · {t.grade}: {s.grade || '—'}
                    </option>
                  ))}
                </select>
                {visibleStudents.length === 0 && (
                  <p className="text-2xs font-bold text-slate-400 pt-1">
                    {students.length === 0
                      ? t.noStudentsInSystem
                      : t.noStudentsFound.replace('{query}', search.trim())}
                  </p>
                )}
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
                  className={`h-11 px-4 rounded-2xl ${currentTheme.accentBg} ${currentTheme.accentText} font-black text-xs ${currentTheme.accentHover} disabled:opacity-50 shadow-lg ${currentTheme.accentShadow} whitespace-nowrap`}
                >
                  {t.linkStudent}
                </button>
              </div>
        </form>
      </div>
    </ModalShell>
  );
}

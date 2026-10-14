/**
 * DuplicateReviewModal — comparer deux fiches homonymes, puis trancher.
 *
 * L'écran existe parce que le REGISTRE peut porter deux fiches du même nom dans
 * la même classe (le contrôle le signale, voir `lib/duplicateStudents.ts`), et
 * que la décision ne se prend pas sur un nom : elle se prend sur ce qui
 * DIFFÈRE — matricule, parent, téléphone, montants, reçus, dates. Deux fiches
 * côte à côte ne suffisent donc pas : les lignes dont les valeurs divergent
 * sont surlignées, parce que c'est là, et nulle part ailleurs, que se trouve la
 * réponse.
 *
 * Les deux gestes sont DESTRUCTIFS et passent tous les deux par la confirmation
 * à recopier (`ConfirmDialog`, mode `type`) : on tape le MATRICULE de la fiche
 * qui disparaît — un identifiant unique, ce que le nom partagé ne peut pas être.
 *
 * Ce que ce composant ne fait PAS, et c'est volontaire : il ne décide pas à la
 * place de l'école, il n'écrit aucune donnée lui-même (les gestes viennent du
 * domaine, `mergeStudents` / `deleteStudent`), et il ne propose rien quand le
 * rôle n'en a pas le droit — fusionner déplace des lignes `payments` et supprime
 * une fiche, deux gestes que la base réserve aux administrateurs (`is_admin()`).
 */
import { useEffect, useState } from 'react';
import { Check, Copy, Trash2, Users } from 'lucide-react';
import type { Student } from '../lib/useSupabaseData';
import type { CurrentTheme } from '../app/mainViewsProps';
import type { TranslationDict } from '../i18n/translations';
import { studentMatricule } from '../lib/studentIdentifiers';
import { mergedLedger, studentLabel } from '../lib/studentMerge';
import { ConfirmDialog } from './ConfirmDialog';
import { ModalShell } from './ModalShell';

export interface DuplicateReviewModalProps {
  /** Les fiches qui partagent le nom replié et la classe — deux, en général. */
  group: Student[];
  t: TranslationDict;
  lang: 'en' | 'fr';
  currentTheme: CurrentTheme;
  formatCurrency: (amount: number) => string;
  formatDate: (dateStr: string) => string;
  getGradeDisplay: (grade: string | undefined, currentLang?: 'en' | 'fr') => string;
  /** Le rôle peut-il écrire ? Fusionner ET supprimer sont réservés aux admins. */
  canDelete: boolean;
  /** Fusionne les autres fiches dans celle qui est gardée. Voir `lib/studentMerge.ts`. */
  mergeStudents: (survivorId: string, mergedIds: string[]) => Promise<boolean>;
  deleteStudent: (id: string) => Promise<boolean>;
  /** Le dialogue racine — enregistré par l'hôte (AppModals) pour le piège au clavier. */
  overlayRef: (el: HTMLElement | null) => void;
  onClose: () => void;
}

/** Une ligne de comparaison : son libellé traduit, et sa valeur par fiche. */
interface CompareRow {
  key: string;
  label: string;
  value: (student: Student) => string;
}

/**
 * Le texte à recopier pour confirmer la disparition d'une fiche : son MATRICULE
 * quand elle en a un (il est unique), son nom sinon. Confirmer en tapant un nom
 * partagé par deux fiches ne prouverait rien — c'est justement le nom qui les
 * confond.
 */
function confirmationText(student: Student): string {
  return studentMatricule(student.studentId) || student.name;
}

/**
 * Le texte à recopier pour confirmer une fusion : UN identifiant par fiche qui
 * disparaît, dans l'ordre où elles sont comparées. Un seul matricule ne suffit
 * donc pas quand trois fiches portent le même nom — la confirmation à recopier
 * couvre exactement l'ensemble de ce qui s'en va, comme la phrase au-dessus les
 * nomme toutes. Pour deux fiches, le cas courant, cela reste un seul matricule.
 */
function mergeConfirmationText(others: Student[], survivor: Student): string {
  if (others.length === 0) return confirmationText(survivor);
  return others.map((student) => confirmationText(student)).join(', ');
}

export function DuplicateReviewModal(props: DuplicateReviewModalProps) {
  const {
    group, t, lang, currentTheme, formatCurrency, formatDate, getGradeDisplay,
    canDelete, mergeStudents, deleteStudent, overlayRef, onClose,
  } = props;

  // La fiche à garder. Par défaut la première, et si la liste change sous nos
  // pieds (rafraîchissement des données) on retombe sur une fiche qui existe
  // encore : un id disparu laisserait le bouton « Fusionner » viser le vide.
  const [keepId, setKeepId] = useState<string>(() => group[0]?.id ?? '');
  const [busy, setBusy] = useState(false);
  const [mergeOpen, setMergeOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Student | null>(null);

  useEffect(() => {
    if (!group.some((student) => student.id === keepId)) setKeepId(group[0]?.id ?? '');
  }, [group, keepId]);

  const survivor = group.find((student) => student.id === keepId) ?? group[0];
  if (!survivor) return null;
  const others = group.filter((student) => student.id !== survivor.id);
  // Aperçu du RÉSULTAT, calculé par la fonction qui servira réellement à la
  // fusion : ce que la ligne annonce est ce que le geste produira.
  const ledger = mergedLedger(survivor, others);

  const rows: CompareRow[] = [
    { key: 'matricule', label: t.studentId, value: (s) => studentMatricule(s.studentId) || '—' },
    { key: 'grade', label: t.grade, value: (s) => getGradeDisplay(s.grade, lang) || '—' },
    { key: 'parent', label: t.parentName, value: (s) => s.parentName || '—' },
    { key: 'phone', label: t.phone, value: (s) => s.parentPhone || '—' },
    { key: 'email', label: t.email, value: (s) => s.parentEmail || '—' },
    { key: 'totalDue', label: t.totalDue, value: (s) => formatCurrency(s.totalDue) },
    { key: 'paid', label: t.paid, value: (s) => formatCurrency(s.amountPaid) },
    {
      key: 'balance',
      label: t.balance,
      value: (s) => formatCurrency(s.totalDue * (1 - (s.scholarshipDiscount || 0) / 100) - s.amountPaid),
    },
    { key: 'status', label: t.status, value: (s) => s.status || 'Active' },
    { key: 'year', label: t.academicYear, value: (s) => s.academicYear || '—' },
    { key: 'enrolled', label: t.enrollmentDate, value: (s) => (s.enrollmentDate ? formatDate(s.enrollmentDate) : '—') },
    { key: 'due', label: t.dueDate, value: (s) => (s.dueDate ? formatDate(s.dueDate) : '—') },
    { key: 'receipts', label: t.duplicateReviewReceipts, value: (s) => String(s.payments.length) },
  ];

  const columnCount = group.length;

  const handleMerge = async () => {
    if (busy) return;
    setBusy(true);
    const done = await mergeStudents(survivor.id, others.map((student) => student.id));
    setBusy(false);
    setMergeOpen(false);
    if (done) onClose();
  };

  const handleDelete = async () => {
    if (busy || !deleteTarget) return;
    setBusy(true);
    const done = await deleteStudent(deleteTarget.id);
    setBusy(false);
    setDeleteTarget(null);
    if (done) onClose();
  };

  const loserText = mergeConfirmationText(others, survivor);

  return (
    <>
      <ModalShell
        overlayRef={overlayRef}
        onClose={onClose}
        currentTheme={currentTheme}
        titleId="modal-title-duplicate-review"
        ariaLabel={t.duplicateReviewTitle}
        maxWidth="max-w-5xl"
        icon={<Users size={20} />}
        title={t.duplicateReviewTitle}
      >
        <div className="px-8 pb-8 pt-4 space-y-6 max-h-[80vh] overflow-y-auto custom-scrollbar">
          <p className={`text-xs font-semibold leading-relaxed ${currentTheme.muted}`}>
            {t.duplicateReviewIntro}
          </p>

          <div className="overflow-x-auto">
            <div
              className="grid gap-x-4 gap-y-3 min-w-[36rem]"
              style={{ gridTemplateColumns: `11rem repeat(${columnCount}, minmax(0, 1fr))` }}
            >
              {/* En-tête : qui garde-t-on, et la sortie de secours de chaque fiche. */}
              <div />
              {group.map((student) => (
                <div
                  key={`head-${student.id}`}
                  className={`rounded-2xl border p-4 space-y-3 ${
                    student.id === survivor.id
                      ? 'border-amber-300 dark:border-amber-800/70 bg-amber-50/60 dark:bg-amber-950/20'
                      : `${currentTheme.border} ${currentTheme.surfaceInset}`
                  }`}
                >
                  <p className={`text-sm font-black ${currentTheme.inkStrong}`}>{student.name}</p>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="radio"
                      name="duplicate-survivor"
                      checked={student.id === survivor.id}
                      onChange={() => setKeepId(student.id)}
                      className="accent-amber-600"
                    />
                    <span
                      className={`text-2xs font-black uppercase tracking-widest ${
                        student.id === survivor.id ? 'text-amber-700 dark:text-amber-300' : currentTheme.muted
                      }`}
                    >
                      {student.id === survivor.id ? t.duplicateReviewKept : t.duplicateReviewKeep}
                    </span>
                    {student.id === survivor.id && <Check size={12} className="text-amber-600 dark:text-amber-300" />}
                  </label>
                  {canDelete && (
                    <button
                      onClick={() => setDeleteTarget(student)}
                      className={`w-full px-3 py-2 text-rose-600 dark:text-rose-300 bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900/60 ${currentTheme.hoverAlert} rounded-xl text-2xs font-bold transition-all flex items-center justify-center gap-1.5 whitespace-nowrap`}
                      title={t.duplicateReviewDelete}
                    >
                      <Trash2 size={14} /> {t.duplicateReviewDelete}
                    </button>
                  )}
                </div>
              ))}

              {/* Les lignes de comparaison, une valeur par fiche, dans le même ordre. */}
              {rows.map((row) => {
                const values = group.map((student) => row.value(student));
                // Une ligne où toutes les fiches disent la même chose n'apprend
                // rien : seul ce qui DIVERGE est surligné.
                const differs = new Set(values).size > 1;
                return (
                  <div key={`row-${row.key}`} className="contents">
                    <div className={`flex items-center text-2xs font-black uppercase tracking-widest ${currentTheme.muted}`}>
                      {row.label}
                    </div>
                    {group.map((student, index) => (
                      <div
                        key={`${row.key}-${student.id}`}
                        title={differs ? t.duplicateReviewDiffers : undefined}
                        className={`px-3 py-2 rounded-xl text-xs font-bold ${currentTheme.inkStrong} ${
                          differs
                            ? 'bg-amber-50 dark:bg-amber-950/30 border-l-2 border-amber-300 dark:border-amber-800'
                            : ''
                        }`}
                      >
                        {values[index]}
                      </div>
                    ))}
                  </div>
                );
              })}
            </div>
          </div>

          <p className={`text-2xs font-semibold ${currentTheme.muted}`}>{t.duplicateReviewLegend}</p>

          {group.length > 1 && (
            <div className={`rounded-2xl border ${currentTheme.border} ${currentTheme.surfaceInset} px-4 py-3 flex flex-wrap items-center gap-x-6 gap-y-1`}>
              <span className={`text-2xs font-black uppercase tracking-widest ${currentTheme.muted}`}>
                {t.duplicateReviewKept}
              </span>
              <span className={`text-xs font-bold ${currentTheme.inkStrong}`}>{studentLabel(survivor)}</span>
              <span className={`text-2xs font-black uppercase tracking-widest ${currentTheme.muted}`}>
                {t.duplicateReviewReceipts}
              </span>
              <span className={`text-xs font-bold ${currentTheme.inkStrong}`}>{ledger.payments.length}</span>
              <span className={`text-2xs font-black uppercase tracking-widest ${currentTheme.muted}`}>{t.paid}</span>
              <span className="text-xs font-black text-emerald-600 dark:text-emerald-400">
                {formatCurrency(ledger.amountPaid)}
              </span>
            </div>
          )}

          {!canDelete ? (
            <p className="text-xs font-bold text-amber-700 dark:text-amber-300">{t.duplicateReviewAdminOnly}</p>
          ) : (
            <div className="flex flex-wrap justify-end gap-3 pt-2 border-t border-slate-100 dark:border-white/[0.06]">
              <button
                onClick={onClose}
                className={`h-11 px-4 border ${currentTheme.border} ${currentTheme.muted} hover:text-slate-600 dark:hover:text-slate-200 ${currentTheme.hoverSurface} rounded-2xl font-bold text-xs transition-all whitespace-nowrap`}
              >
                {t.close}
              </button>
              <button
                onClick={() => setMergeOpen(true)}
                disabled={group.length < 2 || busy}
                className={`h-11 px-4 ${currentTheme.accentBg} ${currentTheme.accentHover} ${currentTheme.accentText} rounded-2xl font-black text-xs transition-all shadow-md flex items-center gap-2 whitespace-nowrap disabled:opacity-40 disabled:cursor-not-allowed`}
              >
                <Copy size={16} className="flex-shrink-0" />
                {t.duplicateReviewMerge}
              </button>
            </div>
          )}
        </div>
      </ModalShell>

      <ConfirmDialog
        open={mergeOpen}
        title={t.duplicateReviewMerge}
        message={t.duplicateReviewMergeConfirm
          .replace('{survivor}', studentLabel(survivor))
          .replace('{loser}', others.map((student) => studentLabel(student)).join(', '))}
        confirmLabel={t.duplicateReviewMergeAction}
        cancelLabel={t.cancel}
        danger={{
          mode: 'type',
          text: loserText,
          hint: t.typeToConfirm.replace('{text}', loserText),
        }}
        onConfirm={() => { void handleMerge(); }}
        onCancel={() => setMergeOpen(false)}
        currentTheme={currentTheme}
      />

      <ConfirmDialog
        open={deleteTarget !== null}
        title={t.duplicateReviewDelete}
        message={deleteTarget
          ? t.duplicateReviewDeleteConfirm.replace('{name}', studentLabel(deleteTarget))
          : ''}
        confirmLabel={t.deleteStudent}
        cancelLabel={t.cancel}
        danger={
          deleteTarget
            ? {
                mode: 'type',
                text: confirmationText(deleteTarget),
                hint: t.typeToConfirm.replace('{text}', confirmationText(deleteTarget)),
              }
            : undefined
        }
        onConfirm={() => { void handleDelete(); }}
        onCancel={() => setDeleteTarget(null)}
        currentTheme={currentTheme}
      />
    </>
  );
}

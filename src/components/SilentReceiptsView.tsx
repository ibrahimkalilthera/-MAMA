/**
 * SilentReceiptsView — l'écran ÉCOLE des reçus muets.
 *
 * ─── Pourquoi cet écran ─────────────────────────────────────────────────────
 * Un reçu saisi avant la colonne `payments.months` (ou envoyé sans cocher) ne
 * déclare AUCUN mois : sa couverture est inconnue, et sa réimpression ne nomme
 * que le mois de sa date. La famille repart donc avec un papier qui ne dit pas ce
 * qu'elle a payé. La fiche d'un élève le compte (la phrase ambre), le carnet en
 * renseigne un, et le parcours de rattrapage les enchaîne — mais tout cela vit
 * DANS une fiche. À l'échelle de l'école, personne ne savait combien de reçus
 * attendent, ni par quel élève commencer.
 *
 * Cet écran répond aux deux questions : QUI en porte, et DANS QUEL ORDRE s'y
 * mettre. Il ne calcule rien lui-même : l'agrégat (fenêtre de l'année, critère du
 * reçu muet, tri par montant) vit dans `src/lib/silentReceipts.ts`, testé à part.
 *
 * ─── Ce qu'il n'est pas ─────────────────────────────────────────────────────
 *   • **Pas un second calcul.** Les trois gestes qui écrivent des mois vivent
 *     dans des panneaux : la PASSE groupée (`SilentReceiptsPass` : une classe,
 *     un choix de mois commun) et le PARCOURS élève par élève
 *     (`SilentReceiptsWalk` : la liste dans son ordre, du plus gros montant au
 *     plus petit, un reçu à la fois). Aucune règle de mois, aucun tri de
 *     pastilles, aucune écriture ne sont réimplémentés ici ; la ligne, elle,
 *     CHERCHE — elle ouvre la fiche de l'élève sur son reçu muet le plus ancien,
 *     l'éditeur déjà ouvert (`focusPaymentId`), et c'est la fiche qui décide de
 *     la suite ;
 *   • **Pas un écran à droit.** Il ne lit que les élèves que l'application tient
 *     déjà (`students`), donc il n'ouvre AUCUN accès en base : tout compte
 *     connecté peut voir le travail qui reste. Renseigner les mois, lui, reste
 *     décidé par la base (`canEditPaymentMonths`, `src/lib/paymentRights.ts`) —
 *     et quand ce droit manque, l'écran le DIT au lieu de laisser croire que le
 *     clic ouvrira un éditeur ;
 *   • **Pas un tableau vide.** Sans reçu muet, l'écran affiche une phrase, pas un
 *     en-tête de colonnes qui laisserait croire à une lecture ratée.
 *
 * ─── L'ARBITRAGE DE L'ÉDITEUR DES MOIS, et pourquoi il vit ICI ─────────────
 * L'application n'a qu'UNE UI de mois (`PaymentMonthsEditor`), et cet écran lui
 * ouvre DEUX portes : la passe groupée et le parcours élève par élève. Si les deux
 * rendaient l'éditeur de leur côté, l'écran afficherait deux jeux de pastilles
 * pour le même reçu — vingt-quatre au lieu de douze — et le `waitForSelector` du
 * pixel-check ne saurait plus lequel il juge. L'ensemble des hôtes vit donc ICI
 * (`editorHost : 'pass' | 'walk' | null`), il est REMIS à chaque porte
 * (`editorHost={editorHost}`), et chaque porte ne rend l'éditeur que lorsqu'elle
 * le détient. Un jeton neuf oblige à étendre cette déclaration-là : le verrou
 * `tests/months-editor-hosts.ts` refuse toute porte non déclarée.
 *
 * ─── Les marqueurs ─────────────────────────────────────────────────────────
 * `data-slot="silent-receipts"` (la racine), `silent-receipts-empty`,
 * `silent-receipts-read-only`, `silent-receipts-total` (le pied de liste),
 * `silent-receipts-row` (une ligne) — avec `data-student` (l'id de l'élève) et
 * `data-receipt` (l'id du reçu muet LE PLUS ANCIEN, celui que le clic ouvre).
 * Tout se lit par ces marqueurs, jamais par les mots : une phrase traduite change,
 * un marqueur non. Les marqueurs des deux panneaux appartiennent à leurs fichiers.
 */
import { useState } from 'react';
import { CalendarClock, ChevronRight } from 'lucide-react';
import { useMainViews } from '../app/mainViewsContext';
import { academicYearMonths } from '../lib/paymentMonths';
import { silentReceiptClasses, silentReceiptRows, silentReceiptsTotal } from '../lib/silentReceipts';
import type { Student } from '../lib/domainTypes';
import { SilentReceiptsPass } from './SilentReceiptsPass';
import { SilentReceiptsWalk } from './SilentReceiptsWalk';

export function SilentReceiptsView() {
  const {
    t, currentTheme, students, selectedYear, canEditPaymentMonths,
    formatCurrency, formatDate, getGradeDisplay, updatePaymentMonths,
    setSelectedStudent, setStudentFileFocus,
  } = useMainViews();

  /**
   * Qui héberge l'éditeur des mois — UN SEUL à la fois.
   *
   * Prendre l'éditeur est un geste EXPLICITE de chaque porte (`onTakeEditor`), et
   * le rendre aussi : le parcours le rend quand son plan est fini, la passe quand
   * elle passe à la confirmation. Une porte qui oublierait de le rendre se verrait
   * refuser l'éditeur par l'autre, ce qui est exactement le comportement voulu.
   */
  const [editorHost, setEditorHost] = useState<'pass' | 'walk' | null>(null);

  const rows = silentReceiptRows(students, selectedYear);
  // Les classes qui portent du travail : la matière de la passe groupée, calculée
  // par la même brique pure que la liste (elle ne redécide rien).
  const classes = silentReceiptClasses(rows);
  // Les douze mois de l'année JUGÉE — celle de la liste, donc la même pour tout
  // le monde : une année illisible ne descend jamais ici, puisqu'elle ne produit
  // aucune ligne.
  const total = silentReceiptsTotal(rows);
  const summary = t.silentReceiptsSummary
    .replace('{students}', String(rows.length))
    .replace('{amount}', formatCurrency(total));

  /**
   * Ouvrir la fiche sur un reçu muet PRÉCIS.
   *
   * Le focus est posé AVANT la fiche : la fiche naît avec lui et ouvre son
   * éditeur au premier rendu. Une ouverture ordinaire (liste des élèves, cloche)
   * passe par `setSelectedStudent` seul et n'active donc rien — et toute
   * fermeture remet le focus à zéro (AppModals), pour qu'un clic de cet écran ne
   * se rejoue jamais sur une fiche ouverte plus tard.
   */
  const openFile = (student: Student, focusPaymentId?: string) => {
    setStudentFileFocus(focusPaymentId ?? null);
    setSelectedStudent(student);
  };

  return (
    <div data-slot="silent-receipts" className="space-y-4">
      <div className={`${currentTheme.card} p-6 rounded-2xl border ${currentTheme.border}`}>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <h3 className={`text-lg font-bold flex items-center gap-2 ${currentTheme.inkStrong}`}>
              <CalendarClock size={20} className="flex-shrink-0" />
              {t.silentReceiptsTitle}
            </h3>
            {/* L'année est DITE : la liste ne juge que les reçus dont la DATE tombe
                dans l'année scolaire affichée (`inAcademicYear`), et une école qui
                chercherait un reçu d'une autre année doit lire pourquoi il n'est
                pas là — et qu'il suffit de changer d'année pour le juger. */}
            <p className={`text-xs font-semibold mt-1 max-w-2xl ${currentTheme.muted}`}>
              {t.silentReceiptsHint.replace('{year}', selectedYear)}
            </p>
          </div>
          {rows.length > 0 && (
            <span
              data-slot="silent-receipts-total"
              className="text-2xs font-black uppercase tracking-widest px-2 py-1 rounded bg-amber-100 dark:bg-amber-950/60 text-amber-800 dark:text-amber-200 border border-amber-300 dark:border-amber-900/60 whitespace-nowrap"
            >
              {summary}
            </span>
          )}
        </div>
        {!canEditPaymentMonths && (
          <p
            data-slot="silent-receipts-read-only"
            className={`text-2xs font-semibold mt-3 ${currentTheme.muted}`}
          >
            {t.silentReceiptsReadOnly}
          </p>
        )}
      </div>

      {/* ── LES DEUX PORTES DE L'ÉDITEUR DES MOIS ────────────────────────────
          Offertes seulement à qui peut ÉCRIRE les mois (la base garde ce droit :
          `canEditPaymentMonths`). Chacune écrit UN reçu par appel, via
          `updatePaymentMonths` — la fonction de la base, ou la file hors ligne —
          et publie son compte rendu. Les deux reçoivent le MÊME ensemble d'hôtes,
          et n'affichent leur éditeur que si elles le détiennent.

          Une ASYMÉTRIE assumée : la passe est montée « seulement s'il y a du
          travail » (elle s'arrête à un reçu par élève), tandis que le parcours
          porte lui-même sa condition d'affichage — il écrit TOUS les reçus, donc
          il vide la liste par construction, et il doit survivre à son propre
          compte rendu. Un panneau démonté par sa liste emporterait la seule trace
          de ce qu'il vient d'écrire (le piège déjà payé par la passe). */}
      {canEditPaymentMonths && rows.length > 0 && (
        <SilentReceiptsPass
          classes={classes}
          yearMonths={academicYearMonths(selectedYear)}
          t={t}
          currentTheme={currentTheme}
          formatCurrency={formatCurrency}
          formatDate={formatDate}
          getGradeDisplay={getGradeDisplay}
          onWrite={(target, months) => updatePaymentMonths(target.studentId, target.payment, months)}
          isOffline={() => typeof navigator !== 'undefined' && navigator.onLine === false}
          editorHost={editorHost}
          onTakeEditor={setEditorHost}
        />
      )}
      {canEditPaymentMonths && (
        <SilentReceiptsWalk
          rows={rows}
          yearMonths={academicYearMonths(selectedYear)}
          t={t}
          currentTheme={currentTheme}
          formatCurrency={formatCurrency}
          formatDate={formatDate}
          onWrite={(target, months) => updatePaymentMonths(target.studentId, target.payment, months)}
          isOffline={() => typeof navigator !== 'undefined' && navigator.onLine === false}
          editorHost={editorHost}
          onTakeEditor={setEditorHost}
        />
      )}

      {rows.length === 0 ? (
        <div
          data-slot="silent-receipts-empty"
          className={`${currentTheme.card} p-8 rounded-2xl border ${currentTheme.border} text-center`}
        >
          <CalendarClock size={28} className={`mx-auto mb-2 ${currentTheme.muted}`} />
          <p className={`text-sm font-bold ${currentTheme.inkStrong}`}>{t.silentReceiptsEmpty}</p>
        </div>
      ) : (
        <div className="space-y-2">
          {rows.map(({ student, receipts, amount, covered, total: yearTotal }) => (
            <button
              key={student.id}
              type="button"
              data-slot="silent-receipts-row"
              data-student={student.id}
              data-receipt={receipts[0]?.id ?? ''}
              onClick={() => openFile(student, receipts[0]?.id)}
              title={t.silentReceiptsOpen}
              className={`w-full text-left ${currentTheme.card} p-4 rounded-2xl border ${currentTheme.border} ${currentTheme.rowHover} transition-all flex flex-wrap items-center justify-between gap-3`}
            >
              <div className="flex flex-col min-w-0">
                <span className={`font-bold ${currentTheme.inkStrong}`}>{student.name}</span>
                <span className={`text-2xs font-semibold ${currentTheme.muted}`}>
                  {getGradeDisplay(student.grade)} · {student.parentName}
                </span>
              </div>

              <div className="flex flex-col min-w-0">
                <span className={`text-2xs font-bold ${currentTheme.inkStrong}`}>
                  {t.silentReceiptsReceipts.replace('{count}', String(receipts.length))}
                </span>
                <span className={`text-2xs font-semibold ${currentTheme.muted}`}>
                  {t.silentReceiptsOldest.replace('{date}', formatDate(receipts[0]?.date ?? ''))}
                </span>
              </div>

              <div className="flex flex-col min-w-0">
                <span className={`text-2xs font-semibold ${currentTheme.muted}`}>
                  {t.monthsCoveredCount
                    .replace('{covered}', String(covered))
                    .replace('{total}', String(yearTotal))}
                </span>
              </div>

              <div className="flex items-center gap-3">
                <span className="font-bold text-amber-600 dark:text-amber-400">
                  {formatCurrency(amount)}
                </span>
                <ChevronRight size={18} className={currentTheme.muted} />
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * SilentReceiptsWalk — LE PARCOURS ÉLÈVE PAR ÉLÈVE, depuis l'écran École.
 *
 * ─── Pourquoi ───────────────────────────────────────────────────────────────
 * L'écran École savait LISTER les reçus muets (qui en porte, du plus gros montant
 * au plus petit) et sa passe groupée écrivait UN choix de mois pour toute une
 * classe. Mais la ligne de l'écran ne renseignait rien : elle ouvrait la FICHE de
 * l'élève, reçu muet le plus ancien déjà ouvert. Pour l'école, cela voulait dire
 * une fiche par famille — cent allers-retours d'écran pour un travail qui, lui,
 * est le même du premier au dernier.
 *
 * Ce panneau fait le geste INVERSE : il part de la liste, prend les élèves DANS
 * SON ORDRE (montant non documenté décroissant), et enchaîne leurs reçus muets
 * du plus ancien au plus récent — sans ouvrir une seule fiche. Un reçu, une
 * écriture, puis le suivant : la boucle s'arrête d'elle-même quand le plan est
 * fini, et elle publie ce qui a été écrit, reçu par reçu.
 *
 * ─── Ce que ce parcours ne fait pas ─────────────────────────────────────────
 *   • **Il n'invente pas de second choix de mois** : les pastilles sont celles de
 *     `PaymentMonthsEditor`, le composant qui porte déjà la règle (aucun mois
 *     coché = pas d'enregistrement) et la ligne du reçu (`formatPaidMonths`) —
 *     le même texte que le papier remis à la famille ;
 *   • **Il n'écrit rien « en lot »** : chaque appel est attendu avant le suivant,
 *     et le compte rendu se construit au fur et à mesure. La base ne connaît
 *     aucune écriture de masse de `months` — `public.set_payment_months(uuid,
 *     text[])` écrit UN reçu, et chaque appel laisse sa propre entrée au journal ;
 *   • **Il n'écrase jamais un reçu déjà renseigné** : le plan est pris au départ,
 *     la liste vit, et une cible qui a quitté la liste des muets entre-temps est
 *     ÉCARTÉE et nommée (`'stale'`) — un collègue a pu la renseigner, et réécrire
 *     des mois déjà déclarés serait un autre geste ;
 *   • **Il ne devine pas l'état du réseau** : `isOffline` lui est fourni (le
 *     signal du bandeau hors ligne, `navigator.onLine`). Hors ligne, chaque reçu
 *     part en FILE et le compte rendu le dit — « écrit » sur une ligne qui n'est
 *     pas encore en base serait le mensonge que tout ce module évite ;
 *   • **Il ne remplace pas la fiche** : les lignes de l'écran, elles, continuent
 *     d'ouvrir la fiche sur son reçu muet le plus ancien. Le parcours est le
 *     chemin rapide ; la fiche reste le chemin complet (suppression, reçu PDF,
 *     solde). Les deux vivent côte à côte, et le choix appartient au comptoir.
 *
 * ─── L'ARBITRAGE de l'éditeur, et pourquoi il vit dans la vue ───────────────
 * L'application n'a qu'UNE UI de mois, et l'écran École en porte désormais DEUX
 * portes (cette passe-ci et la passe par classe) : si les deux ouvraient leur
 * éditeur de leur côté, l'écran afficherait vingt-quatre pastilles au lieu de
 * douze pour le même reçu. La vue tient donc l'ensemble des hôtes
 * (`editorHost: 'pass' | 'walk' | null`) et le REMET à chaque porte
 * (`editorHost={editorHost}`) ; cette porte-ci ne rend l'éditeur que lorsqu'elle
 * le détient (`editorHost === 'walk'`) et elle le rend à la vue dès qu'elle
 * s'arrête. Le verrou `tests/months-editor-hosts.ts` refuse toute porte vers
 * l'éditeur qui ne se déclare pas.
 *
 * ─── Le déroulé ─────────────────────────────────────────────────────────────
 * `ready` (ce qui attend, et le bouton de départ) → `step` (l'élève, son reçu, la
 * position, l'éditeur, « Passer ce reçu ») → `report` (ce qui a été écrit, ce qui
 * a été refusé, ce qui a été laissé). Un refus ne fait PAS avancer : l'éditeur
 * reste ouvert sur le même reçu, avec le mois coché intact, et la phrase du refus
 * se lit à côté du reçu qui l'a essuyé — c'est le geste de la fiche
 * (`PaymentMonthsBackfill`), et c'est le bon ici : le poste est devant l'écran, il
 * peut réessayer ou laisser le reçu de côté.
 *
 * ─── Les marqueurs ─────────────────────────────────────────────────────────
 * `data-slot="silent-receipts-walk"` (la racine), `-ready`, `-start`, `-step`,
 * `-student` (avec `data-student`), `-progress`, `-receipt` (avec `data-receipt`),
 * `-skip`, `-refused`, `-report`, `-outcome` (avec `data-student`, `data-receipt`,
 * `data-ok` et `data-skip`), `-summary`, `-offline` et `-again`. Le reste (les
 * pastilles, la ligne des mois) appartient à `PaymentMonthsEditor`.
 */
import { useEffect, useState } from 'react';
import { CalendarClock, CheckCircle2, XCircle } from 'lucide-react';
import type { TranslationDict } from '../i18n/translations';
import type { CurrentTheme } from '../app/mainViewsProps';
import { formatPaidMonths, paymentMonthLabel } from '../lib/paymentMonths';
import type { SilentReceiptRow, SilentReceiptTarget, SilentReceiptWalkOutcome } from '../lib/silentReceipts';
import { silentReceiptsWalk, silentReceiptsWalkSummary, walkTargetIsSilent } from '../lib/silentReceipts';
import { PaymentMonthsEditor } from './PaymentMonthsEditor';

export interface SilentReceiptsWalkProps {
  /**
   * Les lignes de l'écran École, dans leur ordre (montant non documenté
   * décroissant) : c'est LUI qui décide de l'ordre du parcours, et c'est aussi la
   * liste VIVANTE où l'on vérifie qu'un reçu est encore muet au moment d'écrire.
   */
  rows: SilentReceiptRow[];
  /** Les douze mois de l'année jugée, en `YYYY-MM`, dans l'ordre (ceux de l'écran). */
  yearMonths: string[];
  t: TranslationDict;
  currentTheme: CurrentTheme;
  formatCurrency: (amount: number) => string;
  formatDate: (dateStr: string) => string;
  /**
   * Écrit UN reçu — l'écrivain de l'application (`updatePaymentMonths` : la
   * fonction `set_payment_months` de la base, ou la file hors ligne). Le parcours
   * l'appelle une fois par étape, et attend chaque retour avant la suivante.
   */
  onWrite: (target: SilentReceiptTarget, months: string[]) => Promise<boolean>;
  /** Le signal du bandeau hors ligne : vrai = les écritures partiront en file. */
  isOffline: () => boolean;
  /** L'éditeur des mois n'a qu'un hôte à la fois sur cet écran (voir la vue). */
  editorHost: 'pass' | 'walk' | null;
  /** Prendre l'éditeur pour soi, ou le RENDRE (`null`) dès que l'on s'arrête. */
  onTakeEditor: (host: 'pass' | 'walk' | null) => void;
}

export function SilentReceiptsWalk(props: SilentReceiptsWalkProps) {
  const {
    rows, yearMonths, t, currentTheme, formatCurrency, formatDate, onWrite, isOffline,
    editorHost, onTakeEditor,
  } = props;

  // Le plan est PRIS au départ et ne se recalcule pas : l'ordre de l'école est
  // celui qu'elle a lu à l'écran, et la liste qui se vide sous lui ne doit pas
  // décaler le parcours. La vivacité d'une cible se vérifie au moment d'écrire.
  const [plan, setPlan] = useState<SilentReceiptTarget[] | null>(null);
  const [index, setIndex] = useState(0);
  const [outcomes, setOutcomes] = useState<SilentReceiptWalkOutcome[]>([]);
  const [writing, setWriting] = useState(false);

  const ready = silentReceiptsWalk(rows);
  const step = plan !== null && index < plan.length ? plan[index]! : null;
  const summary = silentReceiptsWalkSummary(outcomes);
  const monthsLine = (list: string[]) => formatPaidMonths(list, {
    label: (ym) => paymentMonthLabel(ym, t),
    count: (n) => t.paidMonthsCount.replace('{count}', String(n)),
    rangeTo: t.paidMonthsRangeTo,
  });

  // REPRENDRE l'éditeur qu'une autre porte a pris puis rendu.
  //
  // Les deux portes de l'écran se partagent une seule UI de mois : si la passe par
  // classe prend l'éditeur pendant un parcours, le parcours se retrouverait sans
  // éditeur sur son étape — et rien à l'écran ne permettrait de le reprendre, donc
  // un cul-de-sac. Dès que l'éditeur est LIBRE et qu'une étape attend, le parcours
  // le reprend : chaque porte reste maîtresse de son geste, et la dernière
  // commencée gagne.
  useEffect(() => {
    if (step && editorHost === null) onTakeEditor('walk');
  }, [step, editorHost, onTakeEditor]);

  // Le refus que le parcours vient d'essuyer, quand il appartient à l'étape EN
  // COURS : il se lit à côté du reçu qui l'a essuyé, et non seulement à la fin.
  const last = outcomes[outcomes.length - 1];
  const refusal = step && last && !last.ok && last.skipped === null && last.target.payment.id === step.payment.id
    ? last
    : null;

  /** Publier l'étape et avancer — en rendant l'éditeur quand le plan est fini. */
  const advance = (outcome: SilentReceiptWalkOutcome) => {
    setOutcomes((prev) => [...prev, outcome]);
    const next = index + 1;
    setIndex(next);
    if (plan !== null && next >= plan.length) onTakeEditor(null);
  };

  const start = () => {
    const next = silentReceiptsWalk(rows);
    if (next.length === 0) return;
    setPlan(next);
    setIndex(0);
    setOutcomes([]);
    onTakeEditor('walk');
  };

  /** Arrêter : le plan est clos, l'éditeur rendu, le compte rendu publié. */
  const stop = () => {
    if (plan === null) return;
    setIndex(plan.length);
    onTakeEditor(null);
  };

  const skip = () => {
    if (!step || writing) return;
    advance({ target: step, months: [], ok: false, queued: false, skipped: 'passed' });
  };

  /**
   * Enregistrer l'étape : une écriture, puis la suivante.
   *
   * Une cible qui n'est plus muette est ÉCARTÉE (rien n'est tenté, et c'est dit),
   * et un refus de la base ne fait pas avancer — l'éditeur reste sur le reçu, avec
   * le brouillon intact, et le compte rendu porte le refus.
   */
  const save = async (months: string[]) => {
    if (!step || !plan || writing) return;
    setWriting(true);
    if (!walkTargetIsSilent(rows, step)) {
      advance({ target: step, months: [], ok: false, queued: false, skipped: 'stale' });
    } else {
      const offline = isOffline();
      const ok = await onWrite(step, months);
      if (ok) advance({ target: step, months: [...months], ok: true, queued: offline, skipped: null });
      else setOutcomes((prev) => [...prev, { target: step, months: [...months], ok: false, queued: false, skipped: null }]);
    }
    setWriting(false);
  };

  // RIEN À FAIRE, et aucun geste en cours : le panneau ne se montre pas. C'est LUI
  // qui décide — et non la vue — parce que son compte rendu doit survivre à la
  // liste qui se vide sous lui : le parcours écrit TOUS les reçus muets, donc la
  // dernière écriture d'un plan vide la liste, et un panneau démonté par sa liste
  // emporterait la seule trace de ce qu'il vient d'écrire.
  if (plan === null && ready.length === 0) return null;

  return (
    <div
      data-slot="silent-receipts-walk"
      className={`${currentTheme.card} p-6 rounded-2xl border ${currentTheme.border} space-y-3`}
    >
      <div>
        <h3 className={`text-sm font-bold ${currentTheme.inkStrong}`}>{t.silentReceiptsWalkTitle}</h3>
        <p className={`text-2xs font-semibold mt-1 max-w-2xl ${currentTheme.muted}`}>
          {t.silentReceiptsWalkHint}
        </p>
      </div>

      {/* ── 1. Ce qui attend, et le départ : toujours en haut de la liste ─── */}
      {plan === null && (
        <>
          <p data-slot="silent-receipts-walk-ready" className={`text-2xs font-black ${currentTheme.inkStrong}`}>
            {t.silentReceiptsWalkReady
              .replace('{receipts}', String(ready.length))
              .replace('{students}', String(rows.length))}
          </p>
          <button
            type="button"
            data-slot="silent-receipts-walk-start"
            onClick={start}
            disabled={ready.length === 0}
            className={`px-3 py-1.5 ${currentTheme.accentBg} ${currentTheme.accentHover} ${currentTheme.accentText} disabled:opacity-50 rounded text-2xs font-bold transition-all`}
          >
            {t.silentReceiptsWalkStart}
          </button>
        </>
      )}

      {/* ── 2. L'étape : l'élève, SON reçu, et l'éditeur partagé ──────────── */}
      {step && plan !== null && (
        <>
          <div data-slot="silent-receipts-walk-step" className={`p-3 rounded-xl ${currentTheme.surfaceInset} space-y-1`}>
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <span
                data-slot="silent-receipts-walk-student"
                data-student={step.studentId}
                className={`font-bold ${currentTheme.inkStrong}`}
              >
                {step.studentName}
              </span>
              <span
                data-slot="silent-receipts-walk-progress"
                className={`text-2xs font-black uppercase tracking-widest ${currentTheme.muted}`}
              >
                {t.silentReceiptsWalkProgress
                  .replace('{current}', String(index + 1))
                  .replace('{total}', String(plan.length))}
              </span>
            </div>
            <span
              data-slot="silent-receipts-walk-receipt"
              data-receipt={step.payment.id ?? ''}
              className={`text-2xs font-semibold ${currentTheme.muted} flex flex-wrap items-center gap-1`}
            >
              <CalendarClock size={12} className="flex-shrink-0" />
              {t.receiptNoShort} {step.payment.receiptNumber || 'N/A'}
              {' · '}
              {formatDate(step.payment.date)}
              {' · '}
              {formatCurrency(step.payment.amount)}
            </span>
          </div>

          {/* L'éditeur unique de l'application — et seulement quand cette porte
              le détient. La `key` change à chaque étape : un reçu neuf part de
              pastilles vierges (le brouillon vit dans l'éditeur, pas ici). Un
              REFUS, lui, ne change pas d'étape : le brouillon reste donc intact. */}
          {editorHost === 'walk' && (
            <PaymentMonthsEditor
              key={`${step.studentId}:${step.payment.id ?? index}`}
              yearMonths={yearMonths}
              initialMonths={[]}
              t={t}
              currentTheme={currentTheme}
              saving={writing}
              onSave={(months) => { void save(months); }}
              onCancel={stop}
            />
          )}

          {refusal && (
            <p data-slot="silent-receipts-walk-refused" className="text-2xs font-semibold text-rose-600 dark:text-rose-400">
              {t.silentReceiptsWalkRefused} — {monthsLine(refusal.months)}
            </p>
          )}

          <button
            type="button"
            data-slot="silent-receipts-walk-skip"
            onClick={skip}
            disabled={writing}
            className={`px-3 py-1.5 border ${currentTheme.border} ${currentTheme.muted} disabled:opacity-50 rounded text-2xs font-bold transition-all`}
          >
            {t.silentReceiptsWalkSkip}
          </button>
        </>
      )}

      {/* ── 3. Le compte rendu : ce qui est parti, et ce qui n'est pas parti ─ */}
      {plan !== null && step === null && (
        <>
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <span className={`text-2xs font-black uppercase tracking-widest ${currentTheme.muted}`}>
              {t.silentReceiptsWalkReportTitle}
            </span>
            <span data-slot="silent-receipts-walk-summary" className={`text-2xs font-black ${currentTheme.inkStrong}`}>
              {t.silentReceiptsWalkSummary
                .replace('{written}', String(summary.written))
                .replace('{refused}', String(summary.refused))
                .replace('{skipped}', String(summary.skipped))}
            </span>
          </div>
          {outcomes.some((outcome) => outcome.queued) && (
            <p data-slot="silent-receipts-walk-offline" className="text-2xs font-semibold text-amber-600 dark:text-amber-400">
              {t.silentReceiptsPassOffline}
            </p>
          )}
          <div data-slot="silent-receipts-walk-report" className="space-y-1">
            {outcomes.map((outcome, position) => (
              <div
                // La CLÉ porte la POSITION : le compte rendu est un journal de
                // gestes, et un reçu retenté après un refus y laisse DEUX lignes.
                // Deux lignes du même reçu, clées par le seul identifiant, se
                // confondraient — React n’en garderait qu’une, et l’école ne
                // lirait pas le refus qu’elle vient d’essuyer.
                key={`${outcome.target.studentId}:${outcome.target.payment.id ?? outcome.target.payment.date}:${position}`}
                data-slot="silent-receipts-walk-outcome"
                data-student={outcome.target.studentId}
                data-receipt={outcome.target.payment.id ?? ''}
                data-ok={String(outcome.ok)}
                data-skip={outcome.skipped ?? ''}
                className={`p-2 rounded-xl text-xs flex flex-wrap items-center gap-2 ${currentTheme.surfaceInset}`}
              >
                {outcome.ok
                  ? <CheckCircle2 size={14} className="flex-shrink-0 text-emerald-600" />
                  : <XCircle size={14} className="flex-shrink-0 text-rose-600" />}
                <span className={`font-bold ${currentTheme.inkStrong}`}>{outcome.target.studentName}</span>
                <span className={`text-2xs font-semibold ${currentTheme.muted}`}>
                  {t.receiptNoShort} {outcome.target.payment.receiptNumber || 'N/A'}
                  {outcome.ok && <>{' · '}{monthsLine(outcome.months)}</>}
                </span>
                <span className={`ml-auto text-2xs font-black ${outcome.ok ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}`}>
                  {outcome.skipped === 'stale'
                    ? t.silentReceiptsWalkStale
                    : outcome.skipped === 'passed'
                      ? t.silentReceiptsWalkPassed
                      : outcome.ok
                        ? (outcome.queued ? t.silentReceiptsPassQueued : t.silentReceiptsPassWritten)
                        : t.silentReceiptsPassRefused}
                </span>
              </div>
            ))}
          </div>
          <button
            type="button"
            data-slot="silent-receipts-walk-again"
            onClick={() => { setPlan(null); setIndex(0); setOutcomes([]); onTakeEditor(null); }}
            className={`px-3 py-1.5 border ${currentTheme.border} ${currentTheme.muted} hover:text-slate-600 dark:hover:text-slate-200 rounded text-2xs font-bold transition-all`}
          >
            {t.silentReceiptsWalkAgain}
          </button>
        </>
      )}
    </div>
  );
}

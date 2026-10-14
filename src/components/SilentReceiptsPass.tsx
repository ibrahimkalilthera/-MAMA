/**
 * SilentReceiptsPass — la PASSE GROUPÉE : une classe, plusieurs élèves, un seul
 * choix de mois.
 *
 * ─── Pourquoi ───────────────────────────────────────────────────────────────
 * Au guichet, un rattrapage de reçus muets se fait par CLASSE : les enfants d'une
 * même classe ont payé les mêmes mois, et refaire dix fois le même choix de
 * pastilles est exactement le travail que cette passe supprime. Ce qu'elle ne
 * supprime pas, c'est la règle du geste : **un reçu, une écriture**. La base ne
 * connaît aucune écriture de masse sur `months` — la fonction
 * `public.set_payment_months(uuid, text[])` écrit UN reçu, et chaque appel laisse
 * sa propre entrée `UPDATE_PAYMENT_MONTHS` au journal. La passe appelle donc cet
 * écrivain une fois par reçu retenu, dans l'ordre de la liste, et **publie ce qui
 * a été écrit** — reçu par reçu, en nommant les refus.
 *
 * ─── Ce que cette passe ne fait pas ─────────────────────────────────────────
 *   • **Elle n'invente pas de second choix de mois** : les pastilles sont celles
 *     de `PaymentMonthsEditor`, le composant qui porte déjà la règle (pas de mois
 *     coché = pas d'enregistrement) et la ligne du reçu, calculée par
 *     `formatPaidMonths` — le même texte que le papier remis à la famille ;
 *   • **Elle n'écrit pas « tout d'un coup »** : chaque appel est attendu avant le
 *     suivant, et le compte rendu se construit au fur et à mesure. Une écriture
 *     réussie n'est jamais effacée par un refus plus loin dans la file ;
 *   • **Elle ne cible pas un reçu déjà renseigné** : l'appelant ne lui donne que
 *     des reçus MUETS (`silentReceiptTargets`), et le plan est refait à partir de
 *     la liste vivante. Un reçu écrit entre-temps a quitté la liste, donc il
 *     n'est pas dans le plan — écraser un choix existant serait un autre geste ;
 *   • **Elle ne devine pas l'état du réseau** : `isOffline` lui est fourni (le
 *     signal du bandeau hors ligne, `navigator.onLine`). Hors ligne, chaque reçu
 *     part en FILE et le compte rendu le dit — « écrit » sur une ligne qui n'est
 *     pas encore en base serait le mensonge que tout ce module évite ;
 *   • **Elle ne partage pas l'éditeur des mois** : l'écran École porte DEUX portes
 *     vers la même UI de mois (cette passe, et le parcours élève par élève
 *     `SilentReceiptsWalk`). La vue tient l'ensemble des hôtes (`editorHost`) et
 *     le remet ; cette passe ne rend donc l'éditeur que lorsqu'elle le détient, et
 *     le rend dès qu'elle passe à la confirmation. Sans cet arbitrage, le même
 *     reçu afficherait deux éditeurs à l'écran — le défaut que
 *     `tests/months-editor-hosts.ts` refuse.
 *
 * ─── Le déroulé ─────────────────────────────────────────────────────────────
 * `pick` (classe, élèves, mois) → `confirm` (la liste EXACTE des reçus qui vont
 * partir, nommée avant d'écrire) → `report` (ce qui a été écrit, ce qui a été
 * refusé, ce qui est en file). Trois étapes plutôt qu'un bouton qui écrit
 * d'emblée : une écriture groupée non annoncée serait un geste que l'école ne
 * peut pas relire.
 *
 * ─── Les marqueurs ─────────────────────────────────────────────────────────
 * `data-slot="silent-receipts-pass"` (la racine), `-class` (le sélecteur),
 * `-student` (une ligne cochable, avec `data-student`), `-all` / `-clear`,
 * `-run` (écrire), `-back`, `-report`, `-outcome` (avec `data-student`,
 * `data-receipt` et `data-ok`) et `-summary`. Le reste (pastilles, ligne des
 * mois) appartient à `PaymentMonthsEditor`.
 */
import { useState } from 'react';
import { CalendarClock, CheckCircle2, XCircle } from 'lucide-react';
import type { TranslationDict } from '../i18n/translations';
import type { CurrentTheme } from '../app/mainViewsProps';
import { formatPaidMonths, paymentMonthLabel } from '../lib/paymentMonths';
import type { SilentReceiptClass, SilentReceiptTarget } from '../lib/silentReceipts';
import { silentReceiptTargets, silentReceiptsPassSummary } from '../lib/silentReceipts';
import { PaymentMonthsEditor } from './PaymentMonthsEditor';

/** Ce que le compte rendu publie pour UN reçu. */
export interface SilentReceiptOutcome {
  target: SilentReceiptTarget;
  months: string[];
  /** L'écrivain a rendu `true` (écrit en base, ou mis en file hors ligne). */
  ok: boolean;
  /** `true` quand cet `ok` est une mise en FILE, pas une ligne en base. */
  queued: boolean;
}

export interface SilentReceiptsPassProps {
  /** Les classes qui portent des reçus muets, et leurs élèves (`data-slot` de la liste). */
  classes: SilentReceiptClass[];
  /**
   * Les douze mois de l'année jugée, en `YYYY-MM`, dans l'ordre — l'année SUR
   * LAQUELLE la liste a été construite (la même pour tout le monde, puisque les
   * reçus sont retenus par la fenêtre de leur DATE). C'est cet ensemble que
   * proposent les pastilles : l'année de l'écran, jamais une autre.
   */
  yearMonths: string[];
  t: TranslationDict;
  currentTheme: CurrentTheme;
  formatCurrency: (amount: number) => string;
  formatDate: (dateStr: string) => string;
  getGradeDisplay: (grade: string | undefined, currentLang?: 'en' | 'fr') => string;
  /**
   * Écrit UN reçu — l'écrivain de l'application (`updatePaymentMonths` : la
   * fonction `set_payment_months` de la base, ou la file hors ligne). La passe
   * l'appelle une fois par reçu retenu, dans l'ordre de la liste, et attend
   * chaque retour avant le suivant.
   */
  onWrite: (target: SilentReceiptTarget, months: string[]) => Promise<boolean>;
  /** Le signal du bandeau hors ligne : vrai = les écritures partiront en file. */
  isOffline: () => boolean;
  /** L'éditeur des mois n'a qu'un hôte à la fois sur cet écran (voir la vue). */
  editorHost: 'pass' | 'walk' | null;
  /** Prendre l'éditeur pour soi, ou le RENDRE (`null`) dès que la passe l'a fini. */
  onTakeEditor: (host: 'pass' | 'walk' | null) => void;
}

export function SilentReceiptsPass(props: SilentReceiptsPassProps) {
  const {
    classes, yearMonths, t, currentTheme, formatCurrency, formatDate, getGradeDisplay, onWrite, isOffline,
    editorHost, onTakeEditor,
  } = props;

  const [grade, setGrade] = useState('');
  const [selected, setSelected] = useState<string[]>([]);
  const [months, setMonths] = useState<string[]>([]);
  const [outcomes, setOutcomes] = useState<SilentReceiptOutcome[]>([]);
  const [writing, setWriting] = useState(false);
  // `step` ET `runId` : l'identifiant de la passe sert de `key` à l'éditeur, pour
  // qu'une NOUVELLE passe reparte de pastilles vierges (le brouillon vit dans
  // `PaymentMonthsEditor`, pas ici).
  const [step, setStep] = useState<'pick' | 'confirm' | 'report'>('pick');
  const [runId, setRunId] = useState(0);

  const classRows = classes.find((c) => c.grade === grade)?.students ?? [];
  const targets = silentReceiptTargets(classRows, selected);
  const summary = silentReceiptsPassSummary(outcomes);
  const monthsLine = (list: string[]) => formatPaidMonths(list, {
    label: (ym) => paymentMonthLabel(ym, t),
    count: (n) => t.paidMonthsCount.replace('{count}', String(n)),
    rangeTo: t.paidMonthsRangeTo,
  });

  const toggleStudent = (studentId: string) => setSelected((prev) =>
    prev.includes(studentId) ? prev.filter((id) => id !== studentId) : [...prev, studentId]);
  /**
   * Choisir une classe, et PRENDRE l'éditeur des mois.
   *
   * L'écran École porte deux portes vers le même éditeur (cette passe et le
   * parcours élève par élève) : la vue tient l'ensemble des hôtes et le remet à
   * chacune. Prendre l'éditeur ici, c'est ce qui empêche les deux d'en afficher
   * un à la fois — vingt-quatre pastilles au lieu de douze pour le même reçu.
   */
  const chooseClass = (next: string) => {
    setGrade(next);
    setSelected([]);
    setMonths([]);
    setStep('pick');
    onTakeEditor(next === '' ? null : 'pass');
  };
  const reset = () => {
    setGrade('');
    setSelected([]);
    setMonths([]);
    setOutcomes([]);
    setStep('pick');
    setRunId((id) => id + 1);
    onTakeEditor(null);
  };

  /**
   * La passe elle-même : chaque reçu, séparément, dans l'ordre.
   *
   * Le compte rendu est poussé à CHAQUE tour (`setOutcomes([...done])`) et non à
   * la fin : si la dixième écriture échoue, les neuf premières sont déjà
   * publiées, et un écran qui se met à jour ne peut pas les perdre. C'est la
   * raison d'être de l'état `outcomes` — l'écrire après la boucle aurait rendu
   * tout le lot muet sur le premier refus.
   */
  const runPass = async () => {
    if (targets.length === 0 || months.length === 0 || writing) return;
    setWriting(true);
    const offline = isOffline();
    const done: SilentReceiptOutcome[] = [];
    for (const target of targets) {
      const ok = await onWrite(target, months);
      done.push({ target, months: [...months], ok, queued: ok && offline });
      setOutcomes([...done]);
    }
    setWriting(false);
    setStep('report');
  };

  return (
    <div
      data-slot="silent-receipts-pass"
      className={`${currentTheme.card} p-6 rounded-2xl border ${currentTheme.border} space-y-3`}
    >
      <div>
        <h3 className={`text-sm font-bold ${currentTheme.inkStrong}`}>{t.silentReceiptsPassTitle}</h3>
        <p className={`text-2xs font-semibold mt-1 max-w-2xl ${currentTheme.muted}`}>
          {t.silentReceiptsPassHint}
        </p>
      </div>

      {/* ── 1. Choisir : la classe, les élèves, les mois ─────────────────── */}
      {step === 'pick' && (
        <>
          <div className="flex flex-wrap items-center gap-3">
            <label className={`text-2xs font-black uppercase tracking-widest ${currentTheme.muted}`} htmlFor="silent-receipts-pass-class">
              {t.silentReceiptsPassClass}
            </label>
            <select
              id="silent-receipts-pass-class"
              data-slot="silent-receipts-pass-class"
              value={grade}
              onChange={(event) => chooseClass(event.target.value)}
              className={`text-xs font-bold px-2 py-1 rounded border ${currentTheme.border} ${currentTheme.input} ${currentTheme.inkStrong}`}
            >
              <option value="">{t.silentReceiptsPassChoose}</option>
              {classes.map((entry) => (
                <option key={entry.grade || '__none'} value={entry.grade}>
                  {getGradeDisplay(entry.grade)}
                </option>
              ))}
            </select>

            {grade !== '' && classRows.length > 0 && (
              <>
                <button
                  type="button"
                  data-slot="silent-receipts-pass-all"
                  onClick={() => setSelected(classRows.map((row) => row.student.id))}
                  className={`px-2 py-1 border ${currentTheme.border} ${currentTheme.muted} hover:text-slate-600 dark:hover:text-slate-200 rounded text-2xs font-bold transition-all`}
                >
                  {t.silentReceiptsPassAll}
                </button>
                <button
                  type="button"
                  data-slot="silent-receipts-pass-clear"
                  onClick={() => setSelected([])}
                  className={`px-2 py-1 border ${currentTheme.border} ${currentTheme.muted} hover:text-slate-600 dark:hover:text-slate-200 rounded text-2xs font-bold transition-all`}
                >
                  {t.silentReceiptsPassClear}
                </button>
                <span data-slot="silent-receipts-pass-remaining" className={`text-2xs font-black ${currentTheme.muted}`}>
                  {t.silentReceiptsPassRemaining.replace('{count}', String(classRows.length))}
                </span>
              </>
            )}
          </div>

          {grade !== '' && (
            <>
              <div className="space-y-1">
                {classRows.map((row) => {
                  const oldest = row.receipts[0];
                  const checked = selected.includes(row.student.id);
                  return (
                    <label
                      key={row.student.id}
                      data-slot="silent-receipts-pass-student"
                      data-student={row.student.id}
                      className={`flex items-center gap-3 p-2 rounded-xl text-xs cursor-pointer ${currentTheme.surfaceInset}`}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleStudent(row.student.id)}
                        className="flex-shrink-0"
                      />
                      <span className={`font-bold ${currentTheme.inkStrong}`}>{row.student.name}</span>
                      <span className={`text-2xs font-semibold ${currentTheme.muted}`}>
                        {t.silentReceiptsReceipts.replace('{count}', String(row.receipts.length))}
                        {' · '}
                        {t.silentReceiptsOldest.replace('{date}', formatDate(oldest?.date ?? ''))}
                      </span>
                      <span className={`ml-auto text-2xs font-bold ${currentTheme.muted}`}>
                        {formatCurrency(row.amount)}
                      </span>
                    </label>
                  );
                })}
              </div>

              <p className={`text-2xs font-semibold ${currentTheme.muted}`}>
                {t.silentReceiptsPassMonthsHint}
              </p>
              {/* Les pastilles de l'application — pas un second choix de mois. La
                  `key` repart d'une passe neuve : le brouillon vit dans l'éditeur.
                  Et l'éditeur n'est rendu QUE lorsque cette passe le détient
                  (`editorHost === 'pass'`) : c'est la moitié écran de l'arbitrage
                  avec le parcours élève par élève. */}
              {editorHost === 'pass' && (
                <PaymentMonthsEditor
                  key={`${grade}:${runId}`}
                  yearMonths={yearMonths}
                  initialMonths={months}
                  t={t}
                  currentTheme={currentTheme}
                  saving={writing}
                  // Les mois choisis sont retenus dans tous les cas ; l'étape de
                  // confirmation, elle, n'a de sens qu'avec au moins un élève coché
                  // (la ligne « aucun élève coché » dit déjà quoi faire).
                  onSave={(chosen) => {
                    setMonths(chosen);
                    if (selected.length > 0) {
                      setStep('confirm');
                      // L'éditeur disparaît à l'étape suivante : il est RENDU ici,
                      // sinon une autre porte croirait encore la passe dessus.
                      onTakeEditor(null);
                    }
                  }}
                  onCancel={() => { setSelected([]); setMonths([]); }}
                />
              )}
              {selected.length === 0 && (
                <p className={`text-2xs font-bold ${currentTheme.muted}`}>
                  {t.silentReceiptsPassNoneSelected}
                </p>
              )}
            </>
          )}
        </>
      )}

      {/* ── 2. Confirmer : la liste EXACTE des reçus qui vont partir ─────── */}
      {step === 'confirm' && (
        <>
          <span className={`text-2xs font-black uppercase tracking-widest ${currentTheme.muted}`}>
            {monthsLine(months)}
          </span>
          <div className="space-y-1">
            {targets.map((target) => (
              <div
                key={target.payment.id ?? target.studentId}
                className={`p-2 rounded-xl text-xs flex flex-wrap items-center gap-2 ${currentTheme.surfaceInset}`}
              >
                <CalendarClock size={14} className="flex-shrink-0" />
                <span className={`font-bold ${currentTheme.inkStrong}`}>{target.studentName}</span>
                <span className={`text-2xs font-semibold ${currentTheme.muted}`}>
                  {t.receiptNoShort} {target.payment.receiptNumber || 'N/A'}
                  {' · '}
                  {formatDate(target.payment.date)}
                  {' · '}
                  {formatCurrency(target.payment.amount)}
                </span>
              </div>
            ))}
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              data-slot="silent-receipts-pass-run"
              onClick={() => { void runPass(); }}
              disabled={writing}
              className={`px-3 py-1.5 ${currentTheme.accentBg} ${currentTheme.accentHover} ${currentTheme.accentText} disabled:opacity-50 rounded text-2xs font-bold transition-all`}
            >
              {t.silentReceiptsPassConfirm.replace('{count}', String(targets.length))}
            </button>
            <button
              type="button"
              data-slot="silent-receipts-pass-back"
              onClick={() => setStep('pick')}
              disabled={writing}
              className={`px-3 py-1.5 border ${currentTheme.border} ${currentTheme.muted} disabled:opacity-50 rounded text-2xs font-bold transition-all`}
            >
              {t.cancel}
            </button>
          </div>
        </>
      )}

      {/* ── 3. Publier : ce qui a été écrit, ce qui a été refusé ─────────── */}
      {step === 'report' && (
        <>
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <span className={`text-2xs font-black uppercase tracking-widest ${currentTheme.muted}`}>
              {t.silentReceiptsPassReportTitle}
            </span>
            <span data-slot="silent-receipts-pass-summary" className={`text-2xs font-black ${currentTheme.inkStrong}`}>
              {t.silentReceiptsPassSummary
                .replace('{written}', String(summary.written))
                .replace('{refused}', String(summary.refused))}
            </span>
          </div>
          {outcomes.some((outcome) => outcome.queued) && (
            <p data-slot="silent-receipts-pass-offline" className="text-2xs font-semibold text-amber-600 dark:text-amber-400">
              {t.silentReceiptsPassOffline}
            </p>
          )}
          <div data-slot="silent-receipts-pass-report" className="space-y-1">
            {outcomes.map((outcome) => (
              <div
                key={outcome.target.payment.id ?? outcome.target.studentId}
                data-slot="silent-receipts-pass-outcome"
                data-student={outcome.target.studentId}
                data-receipt={outcome.target.payment.id ?? ''}
                data-ok={String(outcome.ok)}
                className={`p-2 rounded-xl text-xs flex flex-wrap items-center gap-2 ${currentTheme.surfaceInset}`}
              >
                {outcome.ok
                  ? <CheckCircle2 size={14} className="flex-shrink-0 text-emerald-600" />
                  : <XCircle size={14} className="flex-shrink-0 text-rose-600" />}
                <span className={`font-bold ${currentTheme.inkStrong}`}>{outcome.target.studentName}</span>
                <span className={`text-2xs font-semibold ${currentTheme.muted}`}>
                  {t.receiptNoShort} {outcome.target.payment.receiptNumber || 'N/A'}
                  {' · '}
                  {monthsLine(outcome.months)}
                </span>
                <span className={`ml-auto text-2xs font-black ${outcome.ok ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}`}>
                  {outcome.ok
                    ? (outcome.queued ? t.silentReceiptsPassQueued : t.silentReceiptsPassWritten)
                    : t.silentReceiptsPassRefused}
                </span>
              </div>
            ))}
          </div>
          <button
            type="button"
            onClick={reset}
            className={`px-3 py-1.5 border ${currentTheme.border} ${currentTheme.muted} hover:text-slate-600 dark:hover:text-slate-200 rounded text-2xs font-bold transition-all`}
          >
            {t.silentReceiptsPassAgain}
          </button>
        </>
      )}
    </div>
  );
}

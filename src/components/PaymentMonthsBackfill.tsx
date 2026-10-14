/**
 * PaymentMonthsBackfill — le PARCOURS DE RATTRAPAGE des reçus muets.
 *
 * La fiche de l'élève savait déjà COMPTER ces reçus (la phrase ambre
 * `student-months-undeclared`) et en renseigner UN (le bouton par ligne du
 * carnet). Ce qui manquait, c'est la LISTE : il fallait faire défiler le carnet
 * et repérer chaque bouton ambre à l'œil pour savoir ce qui restait à faire. Ce
 * composant rend ce travail visible, et le fait avancer tout seul.
 *
 * ─── Ce qu'il décide, et où ────────────────────────────────────────────────
 *
 *   • **QUI** — les reçus que la fiche compte comme muets (`!p.months ||
 *     p.months.length === 0`), c'est-à-dire exactement le compte de
 *     `monthsCoverage().undeclared` (src/lib/paymentMonths.ts). Un reçu saisi
 *     avant la colonne `payments.months` a pris `{}` : sa couverture est
 *     INCONNUE, elle n'est pas nulle. Le parcours ne devine rien, il demande ;
 *   • **DANS QUEL ORDRE** — du plus ancien au plus récent : on rattrape dans
 *     l'ordre du calendrier, pas dans celui des clics. C'est l'appelant qui
 *     range (`silentPayments`) ; ce composant respecte la liste reçue ;
 *   • **UN PAR UN** — un seul éditeur ouvert à la fois, et le choix des mois
 *     reste celui de `PaymentMonthsEditor` : aucune seconde UI de mois, donc
 *     aucune seconde règle de tri ni de ligne de reçu. Quand l'enregistrement
 *     réussit, c'est l'appelant qui rouvre le suivant (voir
 *     `StudentDetailsModal` : `handleSaveMonths`) — l'avance est une décision de
 *     la fiche, pas ce composant ;
 *   • **AUCUN DROIT, AUCUN PARCOURS** — `canEditPaymentMonths` décide en amont
 *     (policy « Admin update payments » : `admin` et `dev`). Un parcours offert à
 *     un rôle que la base refuse serait un échec annoncé, pas empêché.
 *
 * Le composant est PUREMENT présentatif : ni Supabase, ni droits, ni état de
 * persistance. Il ne garde pas non plus « quel reçu est ouvert » — c'est la
 * fiche qui le tient (`editingMonthsPaymentId`), parce qu'un même reçu peut être
 * ouvert depuis le carnet ou depuis ici, et que deux hôtes pour un seul état
 * afficheraient deux éditeurs (vingt-quatre pastilles au lieu de douze).
 *
 * ─── Les marqueurs ─────────────────────────────────────────────────────────
 * `data-slot="payment-months-backfill"` (la racine), `data-slot=
 * "payment-months-backfill-progress"` (la ligne de progression),
 * `data-slot="payment-months-backfill-fill"` (l'action d'une ligne) et
 * `data-receipt={p.id}` sur chaque ligne. La progression elle-même est lue par
 * CLÉ (`data-slot`) et jamais par ses mots : un contrôle qui viserait « reçu 2
 * sur 5 » casserait à la première traduction, et la ligne « reçu n sur N » EST
 * une phrase traduite.
 *
 * Les marqueurs du carnet (`payment-months-fill`) restent distincts et en place :
 * ils sont le geste direct sur une ligne, que ce parcours ne remplace pas.
 */
import { Calendar } from 'lucide-react';
import type { Payment } from '../lib/useSupabaseData';
import type { TranslationDict } from '../i18n/translations';
import type { CurrentTheme } from '../app/mainViewsProps';
import { PaymentMonthsEditor } from './PaymentMonthsEditor';

export interface PaymentMonthsBackfillProps {
  /**
   * Les reçus MUETS de l'élève, du plus ancien au plus récent. Vide : le
   * parcours n'a rien à faire, et l'appelant ne le rend pas.
   */
  silentPayments: Payment[];
  /** Les douze mois de l'année scolaire jugée, en `YYYY-MM`, dans l'ordre. */
  yearMonths: string[];
  /**
   * L'id du reçu dont l'éditeur est ouvert ICI. `null` quand l'éditeur vit
   * ailleurs (le carnet du même reçu) : le parcours montre alors la liste seule.
   */
  editingPaymentId: string | null;
  /** Un enregistrement est en vol : les actions du parcours se ferment. */
  saving: boolean;
  t: TranslationDict;
  currentTheme: CurrentTheme;
  formatDate: (dateStr: string) => string;
  formatCurrency: (amount: number) => string;
  /** Ouvre l'éditeur sur un reçu du parcours (la fiche tient l'état). */
  onOpen: (payment: Payment) => void;
  /** Enregistre les mois d'un reçu ; `PaymentMonthsEditor` rend les mois triés. */
  onSave: (payment: Payment, months: string[]) => void;
  onCancel: () => void;
}

export function PaymentMonthsBackfill(props: PaymentMonthsBackfillProps) {
  const {
    silentPayments, yearMonths, editingPaymentId, saving, t, currentTheme,
    formatDate, formatCurrency, onOpen, onSave, onCancel,
  } = props;

  // Le rang du reçu ouvert, DANS l'ordre du parcours — 1 pour le premier. On le
  // calcule sur les identifiants, jamais sur le rang d'affichage : une liste qui
  // se réordonnerait (un reçu supprimé ailleurs) ne doit pas décaler le compte.
  const openIndex = editingPaymentId === null
    ? -1
    : silentPayments.findIndex((p) => p.id === editingPaymentId);
  const progress = openIndex >= 0
    ? t.paymentMonthsBackfillProgress
      .replace('{current}', String(openIndex + 1))
      .replace('{total}', String(silentPayments.length))
    : t.paymentMonthsBackfillRemaining.replace('{count}', String(silentPayments.length));

  return (
    <div
      data-slot="payment-months-backfill"
      className="space-y-2 rounded-2xl border border-amber-200 dark:border-amber-900/60 bg-amber-50/60 dark:bg-amber-950/20 p-4"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="text-2xs font-black uppercase tracking-widest text-amber-700 dark:text-amber-300">
          {t.paymentMonthsBackfillTitle}
        </span>
        <span data-slot="payment-months-backfill-progress" className="text-2xs font-black text-amber-700 dark:text-amber-300">
          {progress}
        </span>
      </div>
      <p className="text-2xs font-semibold text-amber-700/80 dark:text-amber-300/80">
        {t.paymentMonthsBackfillHint}
      </p>

      <div className="space-y-2">
        {silentPayments.map((p, idx) => (
          <div
            key={p.id ?? `${p.date}-${p.amount}-${idx}`}
            data-receipt={p.id ?? ''}
            className={`p-3 rounded-xl text-xs ${currentTheme.surfaceInset}`}
          >
            {editingPaymentId === p.id ? (
              <PaymentMonthsEditor
                yearMonths={yearMonths}
                initialMonths={p.months ?? []}
                t={t}
                currentTheme={currentTheme}
                saving={saving}
                onSave={(months) => onSave(p, months)}
                onCancel={onCancel}
              />
            ) : (
              <div className="flex items-center justify-between gap-3">
                <div className="flex flex-col min-w-0">
                  <span className={`font-bold ${currentTheme.inkStrong}`}>{formatDate(p.date)}</span>
                  {p.receiptNumber && (
                    <span className="text-2xs text-slate-400 font-mono truncate">{t.receiptNoShort} {p.receiptNumber}</span>
                  )}
                </div>
                <div className="flex items-center gap-3">
                  <span className="font-bold text-emerald-600">+{formatCurrency(p.amount)}</span>
                  <button
                    data-slot="payment-months-backfill-fill"
                    onClick={() => onOpen(p)}
                    disabled={saving}
                    className="px-2 py-1 bg-amber-100 dark:bg-amber-950/60 text-amber-800 dark:text-amber-200 border border-amber-300 dark:border-amber-900/60 hover:bg-amber-200 dark:hover:bg-amber-950/80 disabled:opacity-50 rounded text-2xs font-bold transition-all flex items-center gap-1"
                    title={t.paymentMonthsEdit}
                  >
                    <Calendar size={12} /> {t.paymentMonthsBackfillFill}
                  </button>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

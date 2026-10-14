/**
 * PaymentMonthsEditor — renseigner les mois qu'un reçu MUET a réellement payés.
 *
 * Le reçu visé est ANTÉRIEUR à la colonne `payments.months`
 * (`supabase/migrations/20261011000000_payments_months.sql`) : sa couverture est
 * inconnue, donc sa réimpression ne nomme que le mois de sa DATE, et la fiche de
 * l'élève le compte parmi les paiements « sans mois déclaré ». On ne devine pas
 * ce qu'il couvrait — c'est l'école qui le sait.
 *
 * Ce que l'écran doit rendre, et pourquoi ces choix :
 *
 *   • **Les douze mois de l'année en pastilles**, comme le formulaire
 *     d'encaissement : un mois se coche d'un clic, et aucun menu déroulant
 *     multiple ne demande de retenir une combinaison de touches.
 *   • **La ligne du reçu, calculée par `formatPaidMonths`** — le même module et
 *     les mêmes mots que le reçu imprimé. Ce qui se lit ici est ce qui s'imprime :
 *     une plage ou une liste se vérifie AVANT d'enregistrer, pas après.
 *   • **Aucun mois coché : le bouton d'enregistrement reste fermé.** Écrire un
 *     tableau vide ne déclarerait pas plus que le silence d'avant, en donnant
 *     l'impression d'une fiche complétée.
 *   • **L'ordre des clics ne sort pas d'ici** : l'enregistrement rend les mois
 *     triés selon le calendrier scolaire (`sortPaymentMonths`), donc la base et le
 *     journal lisent le même ordre quel que soit le chemin.
 *
 * Le brouillon vit DANS ce composant, pas dans la fiche : la fiche ne garde que
 * l'identité du reçu en cours d'édition. Le composant est purement présentatif —
 * il ne connaît ni Supabase, ni les droits (`canEditPaymentMonths` les décide
 * en amont, voir src/lib/paymentRights.ts).
 *
 * Les marqueurs (`data-slot="payment-months-editor"`, `data-month` sur chaque
 * pastille, `data-slot="payment-months-save"`) sont la contrepartie du pixel-check
 * E2E : le geste se rejoue sur une pile de recette (mode `recu-muet`,
 * scripts/verify-pdf-download.mjs) et un sélecteur qui viserait un LIBELLÉ
 * (« Septembre », « Enregistrer ») casserait à la première traduction. Les
 * marqueurs disent la même chose que `aria-pressed`, en plus stable.
 */
import { useState } from 'react';
import type { TranslationDict } from '../i18n/translations';
import type { CurrentTheme } from '../app/mainViewsProps';
import { formatPaidMonths, paymentMonthLabel, sortPaymentMonths } from '../lib/paymentMonths';

export interface PaymentMonthsEditorProps {
  /** Les douze mois de l'année scolaire jugée, en `YYYY-MM`, dans l'ordre. */
  yearMonths: string[];
  /**
   * Ce que le reçu déclare DÉJÀ. Vide dans le cas qui appelle cet éditeur (un
   * reçu muet) — on complète, on n'écrase pas un choix existant.
   */
  initialMonths: string[];
  t: TranslationDict;
  currentTheme: CurrentTheme;
  /** Un enregistrement est en vol : les deux boutons sont fermés. */
  saving: boolean;
  /** Appelé avec les mois TRIÉS selon le calendrier scolaire. */
  onSave: (months: string[]) => void;
  onCancel: () => void;
}

export function PaymentMonthsEditor(props: PaymentMonthsEditorProps) {
  const { yearMonths, initialMonths, t, currentTheme, saving, onSave, onCancel } = props;
  const [draft, setDraft] = useState<string[]>([...initialMonths]);

  // Le tri est celui du module pur, donc le même que celui du reçu : l'ordre des
  // clics n'a pas à se voir, ni à l'écran, ni en base.
  const toggle = (month: string) => {
    setDraft(prev => sortPaymentMonths(prev.includes(month) ? prev.filter(m => m !== month) : [...prev, month]));
  };

  // Le texte EXACT de la ligne « Mois » du reçu.
  const receiptLine = formatPaidMonths(draft, {
    label: (ym) => paymentMonthLabel(ym, t),
    count: (n) => t.paidMonthsCount.replace('{count}', String(n)),
    rangeTo: t.paidMonthsRangeTo,
  });

  return (
    <div className="flex flex-col gap-2 w-full" data-slot="payment-months-editor">
      <span className={`text-2xs font-bold ${currentTheme.muted}`}>{t.paymentMonthsEditHint}</span>
      <div role="group" aria-label={t.paymentMonthsEdit} className="flex flex-wrap gap-1.5">
        {yearMonths.map((month) => {
          const chosen = draft.includes(month);
          return (
            <button
              key={month}
              type="button"
              data-month={month}
              aria-pressed={chosen}
              onClick={() => toggle(month)}
              className={`px-2.5 py-1 rounded-xl border text-2xs font-black transition-all ${
                chosen
                  ? `${currentTheme.accentBg} ${currentTheme.accentText} ${currentTheme.accentBorder}`
                  : `${currentTheme.surfaceInset} ${currentTheme.border} ${currentTheme.muted}`
              }`}
            >
              {paymentMonthLabel(month, t)}
            </button>
          );
        })}
      </div>
      <span className={`text-2xs font-black ${currentTheme.inkStrong}`} data-slot="payment-months-line">{receiptLine}</span>
      <div className="flex gap-2">
        <button
          data-slot="payment-months-save"
          onClick={() => onSave(sortPaymentMonths(draft))}
          disabled={draft.length === 0 || saving}
          className={`px-2 py-1 ${currentTheme.accentBg} ${currentTheme.accentHover} ${currentTheme.accentText} disabled:opacity-50 rounded text-2xs font-bold transition-all`}
        >
          {t.paymentMonthsSave}
        </button>
        <button
          onClick={onCancel}
          className={`px-2 py-1 border ${currentTheme.border} ${currentTheme.muted} hover:text-slate-600 dark:hover:text-slate-200 rounded text-2xs font-bold transition-all`}
        >
          {t.cancel}
        </button>
      </div>
    </div>
  );
}

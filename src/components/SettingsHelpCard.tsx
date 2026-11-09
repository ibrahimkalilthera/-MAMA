/**
 * Premiers pas — la carte qui dit les trois gestes d'une journée d'école.
 *
 * L'audit d'usage a trouvé ZÉRO accompagnement dans une application de douze
 * vues métier : le personnel non technique apprenait par essai-erreur, et le
 * support absorbait chaque question. Une aide intégrée ne remplace pas une
 * formation, mais elle répond sur place aux trois questions qui reviennent —
 * comment encaisser, comment rattraper un reçu muet, quel papier remettre à une
 * famille qui conteste un mois.
 *
 * Elle vit dans les Paramètres, et c'est assumé : c'est l'écran que
 * l'administration ouvre déjà, et une bulle de visite guidée qui s'invite
 * par-dessus une caisse ouverte serait pire que le silence. Le texte est dans
 * la table de traduction (les clés `firstSteps…`), donc bilingue comme le reste.
 *
 * `data-slot="settings-first-steps"` la fait compter par le contrat de
 * composition (scripts/lib/settings-composition.mjs) : l'ajouter sans mettre la
 * table à jour fait échouer `check-settings-composition.mjs` ET le test DOM.
 */
import { HandCoins, Printer, Receipt, WifiOff } from 'lucide-react';
import { useMainViews } from '../app/mainViewsContext';

export function SettingsHelpCard() {
  const { t, currentTheme } = useMainViews();

  const steps = [
    { icon: HandCoins, title: t.firstStepsPayment, hint: t.firstStepsPaymentHint },
    { icon: Receipt, title: t.firstStepsMonths, hint: t.firstStepsMonthsHint },
    { icon: Printer, title: t.firstStepsReceipt, hint: t.firstStepsReceiptHint },
  ];

  return (
    <div data-slot="settings-first-steps" className="space-y-4">
      <div className="flex items-start gap-4">
        <div className={`p-3 ${currentTheme.card} rounded-2xl ${currentTheme.accent} shadow-sm`}>
          <HandCoins size={20} />
        </div>
        <div>
          <p className={`font-bold ${currentTheme.inkStrong}`}>{t.firstStepsTitle}</p>
          <p className={`text-xs ${currentTheme.muted}`}>{t.firstStepsHint}</p>
        </div>
      </div>

      <ol className="space-y-3">
        {steps.map((step, index) => {
          const Icon = step.icon;
          return (
            <li
              key={step.title}
              className={`flex items-start gap-3 p-4 ${currentTheme.surfaceInset} rounded-2xl`}
            >
              <span
                className={`w-6 h-6 flex-shrink-0 rounded-full ${currentTheme.accentSoft} ${currentTheme.accentSoftText} text-2xs font-black flex items-center justify-center`}
                aria-hidden="true"
              >
                {index + 1}
              </span>
              <div>
                <p className={`text-sm font-bold ${currentTheme.inkStrong} flex items-center gap-2`}>
                  <Icon size={14} className={currentTheme.muted} />
                  {step.title}
                </p>
                <p className={`text-xs ${currentTheme.muted} mt-0.5 leading-relaxed`}>{step.hint}</p>
              </div>
            </li>
          );
        })}
      </ol>

      <p className={`flex items-start gap-2 text-xs ${currentTheme.muted} font-semibold`}>
        <WifiOff size={14} className="flex-shrink-0 mt-0.5" />
        {t.firstStepsOffline}
      </p>
    </div>
  );
}

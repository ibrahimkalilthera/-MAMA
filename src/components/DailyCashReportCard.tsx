/**
 * ─── Le rapport de caisse du jour, dans l'écran qui porte déjà le journal ────
 *
 * « Qui a encaissé quoi aujourd'hui, et qu'est-ce qui a été annulé ? » — la
 * question de la fermeture de caisse. Elle se répond avec la MÊME lecture que
 * l'historique : le rapport ne lit pas le journal lui-même, il reçoit les lignes
 * de la vue qui l'héberge (`rows`, déjà fusionnées avec ce que « Charger tout
 * l'historique » a rapporté). Un rapport qui referait sa propre lecture pourrait
 * annoncer une journée que l'historique juste au-dessus ne montre pas.
 *
 * La carte vit dans l'onglet Historique des paiements parce que la contrainte est
 * la même, et qu'elle n'est pas cosmétique : la policy RLS de `audit_logs` ne
 * laisse LIRE que `admin`/`dev`. La garde de rôle de la vue couvre donc la carte —
 * elle n'en invente pas une seconde, et elle n'affiche rien sans elle.
 *
 * Deux choix d'affichage :
 *   • la journée est un CHAMP, pas un bouton « aujourd'hui » : on prépare aussi
 *     bien le rapport de la veille que celui du soir, et le champ suit le
 *     calendrier LOCAL du poste (`localDayIso`) ;
 *   • ce qui n'est pas chiffré est écrit. Un caissier dont un geste n'a pas de
 *     montant structuré voit sa ligne le dire, et le total du jour aussi — un
 *     total partiel qui se tairait serait pire qu'un total absent.
 */
import { useState } from 'react';
import { CalendarDays, Download } from 'lucide-react';
import { useMainViews } from '../app/mainViewsContext';
import { dailyCashReport, localDayIso } from '../lib/dailyCashReport';
import { paymentHistoryMoment } from '../lib/paymentHistoryExport';
import { generateDailyCashReportPdf } from '../lib/pdfDailyCashReport';
import type { PaymentHistoryRow } from '../lib/paymentHistory';

export function DailyCashReportCard({ rows }: { rows: PaymentHistoryRow[] }) {
  const { t, lang, currentTheme, formatCurrency } = useMainViews();
  const [day, setDay] = useState(() => localDayIso());

  // Le rapport vient du module pur qui porte la règle (journée locale, bornes du
  // filtre de l'écran, totaux de `paymentHistorySummary`) — l'écran et le PDF
  // reçoivent donc le même objet.
  const report = dailyCashReport({ rows, day });
  const money = (amount: number) => formatCurrency(amount);

  const downloadPdf = async () => {
    await generateDailyCashReportPdf({ report, formatMoney: money, lang });
  };

  return (
    <div className={`${currentTheme.card} border ${currentTheme.border} rounded-2xl p-6 space-y-4`}>
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-black tracking-tight flex items-center gap-2">
            <CalendarDays className={currentTheme.accentText} size={18} />
            <span>{t.dailyCashReportTitle}</span>
          </h3>
          <p className={`text-2xs ${currentTheme.muted} mt-1`}>{t.dailyCashReportSubtitle}</p>
        </div>
        <div className="flex items-center gap-3">
          <span className={`text-2xs font-black uppercase tracking-wider ${currentTheme.muted}`}>
            {t.dailyCashReportDay}
          </span>
          <input
            type="date"
            value={day}
            onChange={(event) => setDay(event.target.value)}
            aria-label={t.dailyCashReportDay}
            className={`${currentTheme.card} border ${currentTheme.border} rounded-xl px-3 py-2 text-xs font-bold ${currentTheme.inkStrong} focus:outline-none ${currentTheme.accentRing} transition-all`}
          />
          <button
            type="button"
            onClick={() => { void downloadPdf(); }}
            disabled={report.count === 0}
            className={`px-4 py-2 rounded-xl text-xs font-bold transition-all shadow-sm flex items-center gap-2 active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed ${currentTheme.card} border ${currentTheme.border} ${currentTheme.text} hover:opacity-80`}
          >
            <Download size={14} />
            <span>{t.exportPdf}</span>
          </button>
        </div>
      </div>

      {/* Le total du jour, la même phrase que le PDF imprime en tête. */}
      <div className={`${currentTheme.surfaceInset} rounded-xl px-4 py-3 space-y-1`}>
        <p className={`text-xs font-bold ${currentTheme.text}`}>
          {t.dailyCashReportTotals
            .replace('{count}', String(report.count))
            .replace('{collected}', money(report.collected))
            .replace('{cancelled}', money(report.cancelled))
            .replace('{net}', report.net < 0 ? `- ${money(-report.net)}` : money(report.net))}
        </p>
        {report.withoutAmount > 0 && (
          <p className="text-2xs font-bold text-amber-600 dark:text-amber-300">
            {t.paymentHistoryWithoutAmount.replace('{count}', String(report.withoutAmount))}
          </p>
        )}
      </div>

      <div className={`border ${currentTheme.border} rounded-xl overflow-hidden`}>
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className={`${currentTheme.surfaceInset} ${currentTheme.muted} text-2xs font-black uppercase tracking-[0.2em]`}>
              <th className="px-4 py-3">{t.dailyCashReportCashier}</th>
              <th className="px-4 py-3 text-right">{t.dailyCashReportEntries}</th>
              <th className="px-4 py-3 text-right">{t.dailyCashReportCollected}</th>
              <th className="px-4 py-3 text-right">{t.dailyCashReportCancelled}</th>
              <th className="px-4 py-3 text-right">{t.dailyCashReportNet}</th>
            </tr>
          </thead>
          <tbody className={`divide-y ${currentTheme.border}`}>
            {report.cashiers.length > 0 ? (
              report.cashiers.map((cashier) => (
                <tr key={cashier.key} className={`${currentTheme.rowHover} transition-all`}>
                  <td className="px-4 py-3">
                    <div className="flex flex-col">
                      <span className={`text-xs font-bold ${currentTheme.text}`}>{cashier.name || t.roleStaff}</span>
                      <span className="text-2xs text-slate-400 font-mono">{cashier.email || '—'}</span>
                      {cashier.withoutAmount > 0 && (
                        <span className="text-2xs font-bold text-amber-600 dark:text-amber-300">
                          {t.paymentHistoryWithoutAmount.replace('{count}', String(cashier.withoutAmount))}
                        </span>
                      )}
                    </div>
                  </td>
                  <td className={`px-4 py-3 text-right text-xs font-bold tabular-nums ${currentTheme.muted}`}>{cashier.count}</td>
                  <td className={`px-4 py-3 text-right text-xs font-black tabular-nums ${currentTheme.text}`}>{money(cashier.collected)}</td>
                  <td className={`px-4 py-3 text-right text-xs font-black tabular-nums ${cashier.cancelled > 0 ? 'text-rose-600 dark:text-rose-300' : currentTheme.muted}`}>
                    {cashier.cancelled > 0 ? `- ${money(cashier.cancelled)}` : money(0)}
                  </td>
                  <td className={`px-4 py-3 text-right text-xs font-black tabular-nums ${cashier.net < 0 ? 'text-rose-600 dark:text-rose-300' : currentTheme.text}`}>
                    {cashier.net < 0 ? `- ${money(-cashier.net)}` : money(cashier.net)}
                  </td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={5} className="px-6 py-10 text-center text-slate-400 italic">
                  {t.dailyCashReportEmpty}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="space-y-2">
        <h4 className="text-2xs font-black uppercase tracking-wider text-rose-600 dark:text-rose-300">
          {t.dailyCashReportCancellations.replace('{count}', String(report.cancellations.length))}
        </h4>
        {report.cancellations.length > 0 ? (
          <ul className={`divide-y ${currentTheme.border} border ${currentTheme.border} rounded-xl overflow-hidden`}>
            {report.cancellations.map((row) => (
              <li key={row.id} className="px-4 py-3 flex flex-wrap items-baseline gap-x-4 gap-y-1">
                <span className={`text-2xs font-mono ${currentTheme.muted}`}>{paymentHistoryMoment(row.at, lang)}</span>
                <span className={`text-xs font-mono ${currentTheme.muted}`}>{row.receiptNumber || '—'}</span>
                <span className={`text-xs font-bold ${currentTheme.text}`}>
                  {row.studentName || t.paymentHistoryUnknownStudent}
                </span>
                <span className="text-xs font-black tabular-nums text-rose-600 dark:text-rose-300">
                  {row.amount === null ? t.paymentHistoryAmountInDetails : `- ${money(row.amount)}`}
                </span>
                <span className={`text-2xs ${currentTheme.muted}`}>{row.actorName || t.roleStaff}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-2xs italic text-slate-400">{t.dailyCashReportNoCancellations}</p>
        )}
      </div>
    </div>
  );
}

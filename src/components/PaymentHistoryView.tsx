/**
 * Historique des paiements — admin/dev only, comme le journal dont il se lit.
 *
 * ─── Pourquoi cette vue, et pourquoi ici ─────────────────────────────────────
 * « Qui a encaissé ce paiement ? » n'a qu'une réponse possible : le journal
 * d'audit, seul endroit où l'utilisateur CONNECTÉ est écrit au moment du geste
 * (la table `payments` ne porte que l'élève, la date, le montant et le reçu —
 * mesuré le 2026-10-06). Cette vue n'invente donc aucune donnée : elle LIT le
 * journal, en garde les trois gestes de paiement, et les rend lisibles pour une
 * caisse — élève, montant, reçu, encaisseur.
 *
 * Elle vit à côté du journal d'audit et porte la même garde (`auth.isAdmin`) pour
 * une raison qui n'est pas cosmétique : la policy RLS de `audit_logs` ne laisse
 * LIRE que les rôles `admin`/`dev`. Un économe verrait donc un historique vide,
 * pas un historique filtré — lui montrer l'onglet serait mentir.
 *
 * Les montants CHIFFRÉS viennent de l'instantané `metadata` du geste (posé aux
 * trois gestes depuis le 2026-10-06) ; une entrée antérieure n'en a pas, et son
 * montant reste dans la phrase du journal, affichée telle quelle. Le résumé dit
 * alors combien de lignes ne sont PAS comptées dans le net — un total partiel qui
 * se tairait serait pire que pas de total.
 */
import { useState } from 'react';
import { Database, History, RefreshCw, Search } from 'lucide-react';
import { useMainViews } from '../app/mainViewsContext';
import { auditActionLabel, localizeAuditDetails } from '../lib/auditDisplay';
import { offlineOriginNote, offlineOriginOf } from '../lib/auditOffline';
import {
  PAYMENT_HISTORY_ACTIONS,
  filterPaymentHistory,
  paymentHistoryRows,
  paymentHistorySummary,
  type PaymentHistoryAction,
} from '../lib/paymentHistory';
import type { AuditLogEntry } from '../lib/auditLogger';

/** Le libellé i18n de chaque geste — le même que la colonne ACTIONS du journal. */
const ACTION_LABEL_KEYS: Record<PaymentHistoryAction, string> = {
  RECORD_PAYMENT: 'auditActionRecordPayment',
  DELETE_PAYMENT: 'auditActionDeletePayment',
  RESTORE_PAYMENT: 'auditActionRestorePayment',
};

/**
 * L'union de deux lectures du journal, sans doublon.
 *
 * « Charger tout l'historique » AJOUTE une lecture à celle que le poste porte
 * déjà : les deux listes se recouvrent (les cent dernières entrées apparaissent
 * dans les deux), et un journal qui afficherait deux fois la même ligne ferait
 * douter de tout le reste.
 */
function mergeLogs(...lists: AuditLogEntry[][]): AuditLogEntry[] {
  const byId = new Map<string, AuditLogEntry>();
  for (const list of lists) for (const entry of list) if (entry?.id) byId.set(entry.id, entry);
  return [...byId.values()].sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0));
}

export function PaymentHistoryView() {
  const { t, lang, currentTheme, auditLogs, students, fetchAuditLogs, fetchAuditJournalRange, formatCurrency, auth } =
    useMainViews();
  const [actionFilter, setActionFilter] = useState<PaymentHistoryAction | 'all'>('all');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [search, setSearch] = useState('');
  // Les entrées que « Charger tout l'historique » a rapportées, et l'état de la
  // lecture : une lecture en cours, une lecture refusée, ou ce qu'elle a couvert.
  const [loaded, setLoaded] = useState<AuditLogEntry[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [historyCoverage, setHistoryCoverage] = useState<{ count: number; from: string; to: string } | null>(null);

  // The audit journal (and therefore this view) is reserved to admin/dev, on the
  // sidebar AND by the RLS policy that guards audit_logs.
  if (!auth?.isAdmin) return null;

  const rows = paymentHistoryRows({ logs: mergeLogs(auditLogs, loaded), students });
  const viewRows = filterPaymentHistory(rows, { action: actionFilter, from: fromDate, to: toDate, search });
  const summary = paymentHistorySummary(viewRows);
  const fmt = (iso: string) => new Date(iso).toLocaleString(lang === 'fr' ? 'fr-FR' : 'en-US');
  const day = (iso: string) => new Date(iso).toLocaleDateString(lang === 'fr' ? 'fr-FR' : 'en-US');
  const money = (amount: number) => formatCurrency(amount);

  /**
   * Relire le journal depuis l'origine.
   *
   * Le geste existe parce que `fetchAuditLogs` ne charge que les cent dernières
   * entrées — largement assez pour une page qu'on fait défiler, mais pas pour un
   * historique d'encaissements, qu'un mois chargé en élèves repousserait hors des
   * cent lignes. Ce qui a été lu est DIT (nombre + période couverte) : une lecture
   * que la base aurait tronquée se lit alors à sa date la plus ancienne.
   */
  const loadWholeHistory = async () => {
    setLoadingHistory(true);
    try {
      const now = new Date();
      const entries = await fetchAuditJournalRange(new Date(0).toISOString(), now.toISOString());
      setLoaded(entries);
      const dates = entries.map((entry) => entry.createdAt).filter(Boolean).sort();
      setHistoryCoverage({
        count: entries.length,
        from: dates.length ? dates[0] : '',
        to: dates.length ? dates[dates.length - 1] : '',
      });
    } finally {
      setLoadingHistory(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-black tracking-tight flex items-center gap-2">
            <History className={currentTheme.accentText} size={24} />
            <span>{t.paymentHistory}</span>
          </h2>
          <p className={`text-xs ${currentTheme.muted} mt-1`}>{t.paymentHistorySubtitle}</p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => { void loadWholeHistory(); }}
            disabled={loadingHistory}
            className={`px-4 py-2 rounded-xl text-xs font-bold transition-all shadow-sm flex items-center gap-2 active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed ${currentTheme.card} border ${currentTheme.border} ${currentTheme.text} hover:opacity-80`}
          >
            <Database size={14} />
            <span>{t.paymentHistoryLoadAll}</span>
          </button>
          <button
            onClick={() => fetchAuditLogs()}
            className="px-4 py-2 bg-slate-800 hover:bg-slate-900 text-white rounded-xl text-xs font-bold transition-all shadow-sm flex items-center gap-2 active:scale-95"
          >
            <RefreshCw size={14} />
            <span>{t.refreshLogs}</span>
          </button>
        </div>
      </div>

      {historyCoverage && (
        <p className={`text-2xs ${currentTheme.muted}`}>
          {t.paymentHistoryLoaded
            .replace('{count}', String(historyCoverage.count))
            .replace('{from}', historyCoverage.from ? day(historyCoverage.from) : '—')
            .replace('{to}', historyCoverage.to ? day(historyCoverage.to) : '—')}
        </p>
      )}

      <div className="flex flex-col sm:flex-row flex-wrap items-start sm:items-center justify-between gap-3 no-print">
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative">
            <select
              value={actionFilter}
              onChange={(e) => setActionFilter(e.target.value as PaymentHistoryAction | 'all')}
              aria-label={t.auditFilterAction}
              className={`appearance-none cursor-pointer pl-4 pr-10 py-2.5 ${currentTheme.card} border ${currentTheme.border} rounded-xl focus:outline-none ${currentTheme.accentRing} transition-all text-xs font-bold ${currentTheme.inkStrong}`}
            >
              <option value="all">{t.auditFilterAllActions}</option>
              {PAYMENT_HISTORY_ACTIONS.map((action) => (
                <option key={action} value={action}>
                  {t[ACTION_LABEL_KEYS[action] as keyof typeof t]}
                </option>
              ))}
            </select>
          </div>
          <div className="flex items-center gap-2">
            <span className={`text-2xs font-black uppercase tracking-wider ${currentTheme.muted}`}>{t.auditFilterFrom}</span>
            <input
              type="date"
              value={fromDate}
              onChange={(e) => setFromDate(e.target.value)}
              aria-label={t.auditFilterFrom}
              className={`${currentTheme.card} border ${currentTheme.border} rounded-xl px-3 py-2 text-xs font-bold ${currentTheme.inkStrong} focus:outline-none ${currentTheme.accentRing} transition-all`}
            />
          </div>
          <div className="flex items-center gap-2">
            <span className={`text-2xs font-black uppercase tracking-wider ${currentTheme.muted}`}>{t.auditFilterTo}</span>
            <input
              type="date"
              value={toDate}
              onChange={(e) => setToDate(e.target.value)}
              aria-label={t.auditFilterTo}
              className={`${currentTheme.card} border ${currentTheme.border} rounded-xl px-3 py-2 text-xs font-bold ${currentTheme.inkStrong} focus:outline-none ${currentTheme.accentRing} transition-all`}
            />
          </div>
          <div className="relative">
            <Search size={14} className={`absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none ${currentTheme.muted}`} />
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t.paymentHistorySearch}
              aria-label={t.paymentHistorySearch}
              className={`${currentTheme.card} border ${currentTheme.border} rounded-xl pl-9 pr-3 py-2.5 text-xs font-bold ${currentTheme.inkStrong} focus:outline-none ${currentTheme.accentRing} transition-all`}
            />
          </div>
        </div>
        <span className={`text-2xs font-bold uppercase tracking-wider ${currentTheme.muted}`}>
          {t.auditFilterCount.replace('{shown}', String(viewRows.length)).replace('{total}', String(rows.length))}
        </span>
      </div>

      {/* Le résumé ne compte QUE les montants chiffrés, et dit ce qu'il laisse de côté. */}
      <div className={`flex flex-wrap items-center gap-x-4 gap-y-1 text-xs font-bold ${currentTheme.text}`}>
        <span>
          {t.paymentHistoryTotals
            .replace('{count}', String(summary.count))
            .replace('{collected}', money(summary.collected))
            .replace('{cancelled}', money(summary.cancelled))
            .replace('{net}', money(summary.net))}
        </span>
        {summary.withoutAmount > 0 && (
          <span className="text-amber-600 dark:text-amber-300 font-bold">
            {t.paymentHistoryWithoutAmount.replace('{count}', String(summary.withoutAmount))}
          </span>
        )}
      </div>

      <div className={`${currentTheme.card} border ${currentTheme.border} rounded-2xl overflow-hidden shadow-sm`}>
        <div className="max-h-[70vh] overflow-auto">
          <table className="w-full text-left border-collapse">
            <thead className="sticky top-0 z-10">
              <tr className={`${currentTheme.surfaceInset} ${currentTheme.muted} text-2xs font-black uppercase tracking-[0.2em]`}>
                <th className="px-4 py-4">{t.timestamp}</th>
                <th className="px-4 py-4">{t.studentName}</th>
                <th className="px-4 py-4">{t.actions}</th>
                <th className="px-4 py-4 text-right">{t.amount2}</th>
                <th className="px-4 py-4">{t.receipt}</th>
                <th className="px-4 py-4">{t.paymentHistoryCollectedBy}</th>
                <th className="px-4 py-4">{t.details}</th>
              </tr>
            </thead>
            <tbody className={`divide-y ${currentTheme.border}`}>
              {viewRows.length > 0 ? (
                viewRows.map((row) => {
                  const offline = offlineOriginOf(row.log);
                  const isCancel = row.action === 'DELETE_PAYMENT';
                  const badgeColor = isCancel
                    ? 'bg-rose-500/10 text-rose-600 dark:text-rose-300 border-rose-500/20'
                    : row.action === 'RESTORE_PAYMENT'
                      ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-300 border-emerald-500/20'
                      : `${currentTheme.accentSoft} ${currentTheme.accentSoftText} ${currentTheme.accentBorder}`;
                  return (
                    <tr key={row.id} className={`${currentTheme.rowHover} ${offline ? 'bg-rose-500/5' : ''} transition-all`}>
                      <td className="px-4 py-4 whitespace-nowrap align-top">
                        <span className={`text-xs font-mono ${offline ? 'text-rose-600 dark:text-rose-300 font-bold' : currentTheme.muted}`}>
                          {fmt(row.at)}
                        </span>
                        {offline && (
                          <span className="ml-2 text-2xs font-black tracking-wider uppercase px-2 py-0.5 rounded-full border bg-rose-500/10 text-rose-600 dark:text-rose-300 border-rose-500/20">
                            {t.auditOfflineBadge}
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-4 align-top">
                        <div className="flex flex-col">
                          <span className={`text-xs font-bold ${currentTheme.text}`}>
                            {row.studentName || t.paymentHistoryUnknownStudent}
                          </span>
                          {row.studentGrade && <span className={`text-2xs ${currentTheme.muted}`}>{row.studentGrade}</span>}
                        </div>
                      </td>
                      <td className="px-4 py-4 whitespace-nowrap align-top">
                        <span className={`text-2xs font-black tracking-wider uppercase px-2.5 py-1 rounded-full border ${badgeColor}`}>
                          {auditActionLabel(row.action, t)}
                        </span>
                      </td>
                      <td className="px-4 py-4 whitespace-nowrap align-top text-right">
                        {row.amount === null ? (
                          <span className={`text-2xs italic ${currentTheme.muted}`}>{t.paymentHistoryAmountInDetails}</span>
                        ) : (
                          <span className={`text-xs font-black tabular-nums ${isCancel ? 'text-rose-600 dark:text-rose-300' : currentTheme.text}`}>
                            {isCancel ? `− ${money(row.amount)}` : money(row.amount)}
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-4 whitespace-nowrap align-top">
                        <span className={`text-xs font-mono ${currentTheme.muted}`}>{row.receiptNumber || '—'}</span>
                      </td>
                      <td className="px-4 py-4 align-top">
                        <div className="flex flex-col">
                          <span className={`text-xs font-bold ${currentTheme.text}`}>{row.actorName || t.roleStaff}</span>
                          <span className="text-2xs text-slate-400 font-mono">{row.actorEmail || '—'}</span>
                          {row.actorRole && <span className={`text-2xs ${currentTheme.muted}`}>{row.actorRole}</span>}
                        </div>
                      </td>
                      <td className="px-4 py-4 align-top">
                        <span className={`text-xs font-medium ${offline ? 'text-rose-600 dark:text-rose-300' : currentTheme.text}`}>
                          {localizeAuditDetails(row.log.details, lang) || '—'}
                        </span>
                        {offline && (
                          <span className="block text-2xs font-bold text-rose-600 dark:text-rose-300">
                            {offlineOriginNote(offline, fmt, { captured: t.auditOfflineRowCaptured, synced: t.auditOfflineRowSynced })}
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })
              ) : (
                <tr>
                  <td colSpan={7} className="px-6 py-12 text-center text-slate-400 italic">
                    {rows.length === 0 ? t.paymentHistoryEmpty : t.noAuditEntriesMatchingFilters}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

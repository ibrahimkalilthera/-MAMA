/**
 * Historique des paiements — la caisse, et l'économe qui la tient.
 *
 * ─── Pourquoi cette vue, et pourquoi ici ─────────────────────────────────────
 * « Qui a encaissé ce paiement ? » n'a qu'une réponse possible : le journal
 * d'audit, seul endroit où l'utilisateur CONNECTÉ est écrit au moment du geste
 * (la table `payments` ne porte que l'élève, la date, le montant et le reçu —
 * mesuré le 2026-10-06). Cette vue n'invente donc aucune donnée : elle LIT le
 * journal, en garde les trois gestes de paiement, et les rend lisibles pour une
 * caisse — élève, montant, reçu, encaisseur.
 *
 * ─── Qui la lit, et ce que le 2026-10-15 a changé ────────────────────────────
 * La garde n'est plus `auth.isAdmin` : elle est `canViewPaymentHistory`
 * (`src/lib/paymentHistoryRights.ts`) — la MÊME liste de rôles que la base,
 * `admin`, `dev` ET `econome` (policy « Payment history viewers read payment
 * gestures », migration `20261020000000_econome_payment_history.sql`). L'économe
 * tient la caisse : lui cacher qui a encaissé quoi revenait à lui demander de
 * répondre à une question sans lui en donner les moyens.
 *
 * La policy ne lui ouvre QUE les lignes de cet écran — les trois gestes de caisse
 * et les quatre corrections d'argent — donc le reste du journal (rôles, élèves,
 * réglages) reste refusé à son rôle, et l'onglet du journal d'audit reste fermé
 * pour lui. C'est ce que la garde d'écran et la RLS disent ENSEMBLE : l'écran ne
 * montre pas plus que ce que la base accepte de rendre, et
 * `tests/payment-history-rights.test.ts` tient les deux moitiés.
 *
 * ─── Trois gestes, là où la caisse les cherche ───────────────────────────────
 *   1. **Cliquer la ligne MONTRE le reçu** (`generatePaymentReceiptPdf` publie
 *      l'aperçu ; le fichier part au second geste, depuis la modale). Une ligne
 *      ne réagit au clic que si le paiement est ENCORE VIVANT ; sinon la ligne
 *      n'a pas de reçu à montrer, et elle ne fait pas semblant d'en avoir un.
 *   2. **Supprimer le reçu fautif**, offert à qui la base laisse supprimer un
 *      paiement (`canDeletePayment`, `public.is_payment_deleter()`) : la
 *      confirmation vit DANS la ligne et dit le montant et le reçu qui partent.
 *   3. **Annuler une suppression** — la même règle que le journal d'audit
 *      (`restorablePayment`), sur le même journal fusionné.
 *
 * La ligne ne les offre que quand le geste ABOUTIT : le paiement vivant est
 * résolu (`livePaymentOf`), sinon aucun bouton n'est rendu — un bouton qui ne
 * peut pas marcher est un mensonge, pas une aide.
 *
 * La colonne MOTIF dit ce que la famille est venue RÉGLER — les mots de la ligne
 * « Motif » du reçu (`paymentMotifLabel`), et non une seconde formulation : un
 * reçu d'inscription réimprimé depuis cette page doit se lire comme le papier
 * remis au comptoir. Le motif d'un geste d'AVANT la colonne `payments.motif` est
 * celui de son reçu d'alors (« Frais de scolarité »), posé par `PaymentHistoryRow`
 * : la vue ne décide jamais d'un motif, elle affiche celui que la ligne porte.
 *
 * Les montants CHIFFRÉS viennent de l'instantané `metadata` du geste ; à défaut,
 * ils se relisent dans la phrase `details`, dont le gabarit est écrit par ce dépôt
 * (voir `paymentFactsFromDetails` — c'est la réparation du 2026-10-06 : les 3
 * seuls gestes de paiement du journal n'avaient PAS d'instantané, et la colonne
 * MONTANT disait « voir le détail » partout). Le résumé dit alors combien de
 * lignes il ne peut PAS additionner — un total partiel qui se tairait serait pire
 * que pas de total.
 */
import { useState } from 'react';
import { Database, Download, FileText, History, Receipt, RefreshCw, RotateCcw, Search, Trash2 } from 'lucide-react';
import { useMainViews } from '../app/mainViewsContext';
import { DailyCashReportCard } from './DailyCashReportCard';
import { auditActionLabel, localizeAuditDetails } from '../lib/auditDisplay';
import { offlineOriginNote, offlineOriginOf } from '../lib/auditOffline';
import { downloadBytes } from '../lib/browserDownload';
import type { Payment, Student } from '../lib/domainTypes';
import { restorablePayment, type ArchivedPayment } from '../lib/paymentUndo';
import { restorableSalary, type ArchivedSalaryPayment } from '../lib/salaryUndo';
import { correctionHistoryRows } from '../lib/correctionHistory';
import { canViewPaymentHistory } from '../lib/paymentHistoryRights';
import {
  PAYMENT_HISTORY_ACTIONS,
  filterPaymentHistory,
  livePaymentOf,
  paymentHistoryRows,
  paymentHistorySummary,
  type PaymentHistoryAction,
  type PaymentHistoryRow,
} from '../lib/paymentHistory';
import {
  PAYMENT_HISTORY_CSV_MIME,
  buildPaymentHistoryCsv,
  paymentHistoryCsvBytes,
  paymentHistoryExportFilename,
} from '../lib/paymentHistoryExport';
import { generatePaymentHistoryPdf } from '../lib/pdfPaymentHistory';
import { DEFAULT_PAYMENT_MOTIF, paymentMotifLabel } from '../lib/paymentMotifs';
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
  const {
    t, lang, currentTheme, auditLogs, students, staff, fetchAuditLogs, fetchAuditJournalRange, formatCurrency, auth,
    canDeletePayment, deletePayment, generatePaymentReceiptPdf, restorePayment, restoreSalaryPayment,
  } = useMainViews();
  const [actionFilter, setActionFilter] = useState<PaymentHistoryAction | 'all'>('all');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [search, setSearch] = useState('');
  // La ligne dont la suppression attend sa confirmation, et celle en cours de
  // suppression. La confirmation vit DANS la ligne (jamais un dialogue
  // navigateur) : la phrase dit quel reçu et quel montant partent.
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  // Les entrées que « Charger tout l'historique » a rapportées, et l'état de la
  // lecture : une lecture en cours, une lecture refusée, ou ce qu'elle a couvert.
  const [loaded, setLoaded] = useState<AuditLogEntry[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [historyCoverage, setHistoryCoverage] = useState<{ count: number; from: string; to: string } | null>(null);

  // Qui lit ce journal est décidé par la BASE, et la garde d'écran est son miroir
  // (`public.is_payment_history_viewer()` : admin, dev, économe). Un rôle hors de
  // cette liste ne verrait AUCUNE ligne de la policy : lui montrer l'écran
  // afficherait « rien encaissé » sur une caisse pleine.
  if (!canViewPaymentHistory(auth?.profile?.role)) return null;

  // Le journal fusionné, lu UNE fois : le tableau, « restaurer » et le rapport de
  // caisse doivent voir les mêmes lignes.
  const allLogs = mergeLogs(auditLogs, loaded);
  const rows = paymentHistoryRows({ logs: allLogs, students });
  const viewRows = filterPaymentHistory(rows, { action: actionFilter, from: fromDate, to: toDate, search });
  const summary = paymentHistorySummary(viewRows);
  // Les GESTES DE CORRECTION (salaire ou dépense retirés, salaire rétabli) vivent
  // dans leur propre lecture : ils ne sont pas des encaissements, donc le net et
  // les colonnes du tableau ci-dessus ne les voient pas (voir `correctionHistory`).
  const corrections = correctionHistoryRows({ logs: allLogs, staff });
  const fmt = (iso: string) => new Date(iso).toLocaleString(lang === 'fr' ? 'fr-FR' : 'en-US');
  const day = (iso: string) => new Date(iso).toLocaleDateString(lang === 'fr' ? 'fr-FR' : 'en-US');
  const money = (amount: number) => formatCurrency(amount);

  // Les filtres ACTIFS, réunis une fois : l'écran, le CSV et le PDF lisent tous
  // les trois le même objet, donc un fichier ne peut pas porter une autre
  // question que celle affichée. Le formateur de montants vient de l'écran
  // (`formatCurrency` du contexte) : le document et la vue chiffrent pareil.
  const activeFilter = { action: actionFilter, from: fromDate, to: toDate, search };
  const exportContext = { t, lang, formatMoney: money };

  /**
   * Le CSV de la vue AFFICHÉE — mêmes lignes, mêmes colonnes, mêmes libellés.
   *
   * Il n'exporte jamais `rows` : la question posée à l'écran (période, action,
   * recherche) est la seule qu'un fichier doit emporter. Le BOM reste, comme pour
   * l'export du journal : le tableur doit lire les accents.
   */
  const downloadCsv = () => {
    downloadBytes(
      paymentHistoryCsvBytes(buildPaymentHistoryCsv(viewRows, exportContext, corrections)),
      paymentHistoryExportFilename('csv'),
      PAYMENT_HISTORY_CSV_MIME,
    );
  };

  /**
   * Le PDF de la même vue : mêmes lignes, mêmes filtres écrits en tête — et les
   * gestes de correction dans leur propre section, sinon le papier dirait moins
   * que l'écran, et un lecteur croirait que rien n'a été retiré.
   */
  const downloadPdf = async () => {
    await generatePaymentHistoryPdf({ rows: viewRows, summary, filter: activeFilter, corrections, formatMoney: money, lang });
  };

  /**
   * MONTRER le reçu d'une ligne. L'aperçu s'ouvre ; le fichier ne part qu'au
   * second geste, depuis la modale (`generatePaymentReceiptPdf` publie l'aperçu).
   *
   * Le caissier imprimé est celui de la LIGNE : c'est le geste qu'on réimprime,
   * pas la session ouverte aujourd'hui.
   */
  const openReceipt = async (row: PaymentHistoryRow, live: { student: Student; payment: Payment }) => {
    await generatePaymentReceiptPdf({
      student: live.student,
      payment: live.payment,
      lang,
      cashierName: row.actorName || 'Administration',
    });
  };

  /**
   * Confirmer la suppression d'un reçu.
   *
   * Le journal vient de recevoir son entrée `DELETE_PAYMENT` : on le RELIT, sinon
   * la ligne « Paiement supprimé » n'apparaîtrait qu'au prochain rechargement —
   * et l'écran semblerait n'avoir rien fait.
   */
  const confirmDelete = async (row: PaymentHistoryRow, live: { student: Student; payment: Payment }) => {
    setDeletingId(row.id);
    try {
      if (await deletePayment(live.student.id, live.payment)) {
        setPendingDeleteId(null);
        await fetchAuditLogs();
      }
    } finally {
      setDeletingId(null);
    }
  };

  /** Annuler une suppression — le MÊME geste que le journal d'audit. */
  const restore = async (archived: ArchivedPayment) => {
    if (await restorePayment(archived)) await fetchAuditLogs();
  };

  /**
   * Rétablir un SALAIRE retiré — l'exact pendant de la corbeille de la paie.
   *
   * La règle est celle de `restorableSalary` : seule une suppression À
   * INSTANTANÉ se rétablit, et jamais deux fois (une entrée
   * `RESTORE_SALARY_PAYMENT` retire le bouton). Une suppression d'avant cette
   * fonction n'en porte pas : la ligne reste visible, sans bouton — on n'invente
   * pas la ligne qu'on n'a pas gardée.
   */
  const restoreSalary = async (archived: ArchivedSalaryPayment) => {
    if (await restoreSalaryPayment(archived)) await fetchAuditLogs();
  };

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
            onClick={downloadCsv}
            disabled={viewRows.length === 0}
            className={`px-4 py-2 rounded-xl text-xs font-bold transition-all shadow-sm flex items-center gap-2 active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed ${currentTheme.card} border ${currentTheme.border} ${currentTheme.text} hover:opacity-80`}
          >
            <Download size={14} />
            <span>{t.exportCsv}</span>
          </button>
          <button
            onClick={() => { void downloadPdf(); }}
            disabled={viewRows.length === 0}
            className={`px-4 py-2 rounded-xl text-xs font-bold transition-all shadow-sm flex items-center gap-2 active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed ${currentTheme.card} border ${currentTheme.border} ${currentTheme.text} hover:opacity-80`}
          >
            <FileText size={14} />
            <span>{t.exportPdf}</span>
          </button>
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
            className={`px-4 py-2 bg-slate-800 ${currentTheme.hoverSurfaceStrong} text-white rounded-xl text-xs font-bold transition-all shadow-sm flex items-center gap-2 active:scale-95`}
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
                <th className="px-4 py-4">{t.paymentMotif}</th>
                <th className="px-4 py-4">{t.paymentHistoryCollectedBy}</th>
                <th className="px-4 py-4">{t.details}</th>
              </tr>
            </thead>
            <tbody className={`divide-y ${currentTheme.border}`}>
              {viewRows.length > 0 ? (
                viewRows.map((row) => {
                  const offline = offlineOriginOf(row.log);
                  const isCancel = row.action === 'DELETE_PAYMENT';
                  // Le paiement ENCORE VIVANT que la ligne désigne : sans lui, il n'y a
                  // ni reçu à montrer ni geste à corriger — et l'écran n'offre alors
                  // ni l'un ni l'autre, au lieu de cliquer dans le vide.
                  const live = livePaymentOf(row, students);
                  // Une suppression encore annulable : la MÊME règle que le journal
                  // d'audit (`restorablePayment`), lue sur le même journal fusionné.
                  const archived = restorablePayment(row.log, allLogs);
                  const confirming = pendingDeleteId === row.id && !!live;
                  const badgeColor = isCancel
                    ? 'bg-rose-500/10 text-rose-600 dark:text-rose-300 border-rose-500/20'
                    : row.action === 'RESTORE_PAYMENT'
                      ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-300 border-emerald-500/20'
                      : `${currentTheme.accentSoft} ${currentTheme.accentSoftText} ${currentTheme.accentBorder}`;
                  return (
                    <tr
                      key={row.id}
                      onClick={live ? () => { void openReceipt(row, live); } : undefined}
                      title={live ? t.receipt2 : undefined}
                      className={`${currentTheme.rowHover} ${offline ? 'bg-rose-500/5' : ''} ${live ? 'cursor-pointer' : ''} transition-all`}
                    >
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
                        <div className="flex flex-col items-start gap-2">
                          <span className={`text-2xs font-black tracking-wider uppercase px-2.5 py-1 rounded-full border ${badgeColor}`}>
                            {auditActionLabel(row.action, t)}
                          </span>
                          {/* La confirmation dit le montant ET le reçu qui partent,
                              puis se referme sur elle-même — même forme que la
                              fiche élève, pas de dialogue navigateur. */}
                          {confirming && live ? (
                            <div className="flex max-w-[18rem] flex-col gap-2 whitespace-normal">
                              <span className="text-2xs font-bold text-rose-600 dark:text-rose-300">
                                {t.deletePaymentConfirm
                                  .replace('{amount}', money(live.payment.amount))
                                  .replace('{receipt}', live.payment.receiptNumber || 'N/A')}
                              </span>
                              <div className="flex gap-2">
                                <button
                                  onClick={(e) => { e.stopPropagation(); void confirmDelete(row, live); }}
                                  disabled={deletingId === row.id}
                                  className={`px-2 py-1 bg-rose-600 ${currentTheme.hoverAlertSolid} disabled:opacity-50 text-white rounded text-2xs font-bold transition-all`}
                                >
                                  {t.deletePayment}
                                </button>
                                <button
                                  onClick={(e) => { e.stopPropagation(); setPendingDeleteId(null); }}
                                  className={`px-2 py-1 border ${currentTheme.border} ${currentTheme.muted} hover:text-slate-600 dark:hover:text-slate-200 rounded text-2xs font-bold transition-all`}
                                >
                                  {t.cancel}
                                </button>
                              </div>
                            </div>
                          ) : (
                            <div className="flex flex-wrap items-center gap-1.5">
                              {live && (
                                <button
                                  onClick={(e) => { e.stopPropagation(); void openReceipt(row, live); }}
                                  title={t.downloadReceiptPdf}
                                  className={`px-2 py-1 ${currentTheme.accentBg} ${currentTheme.accentHover} ${currentTheme.accentText} rounded text-2xs font-bold transition-all shadow-sm flex items-center gap-1`}
                                >
                                  <Receipt size={12} /> {t.receipt2}
                                </button>
                              )}
                              {/* « Payment deleters delete payments » : pas de rôle
                                  (admin, dev ou econome), pas de bouton — et pas
                                  d'id non plus : `deletePayment` refuse une ligne
                                  sans identifiant (même garde que la fiche élève). */}
                              {canDeletePayment && live && live.payment.id && (
                                <button
                                  onClick={(e) => { e.stopPropagation(); setPendingDeleteId(row.id); }}
                                  title={t.deletePayment}
                                  className={`px-2 py-1 bg-rose-50 dark:bg-rose-950/40 text-rose-600 dark:text-rose-300 border border-rose-200 dark:border-rose-900/60 ${currentTheme.hoverAlert} rounded text-2xs font-bold transition-all flex items-center gap-1`}
                                >
                                  <Trash2 size={12} /> {t.deletePayment}
                                </button>
                              )}
                              {archived && (
                                <button
                                  onClick={(e) => { e.stopPropagation(); void restore(archived); }}
                                  title={t.restorePaymentHint}
                                  className="px-2 py-1 bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-900/60 hover:bg-emerald-100 dark:hover:bg-emerald-950/60 rounded text-2xs font-bold transition-all flex items-center gap-1"
                                >
                                  <RotateCcw size={12} /> {t.restorePayment}
                                </button>
                              )}
                            </div>
                          )}
                        </div>
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
                      {/* Le motif du reçu. Le geste ORDINAIRE reste discret ; ce qui
                          sort de l'ordinaire (l'inscription) prend l'accent, parce
                          que c'est ce qu'une caisse doit repérer d'un coup d'œil
                          dans une liste d'encaissements. */}
                      <td className="px-4 py-4 whitespace-nowrap align-top">
                        <span
                          className={`text-2xs font-bold px-2 py-0.5 rounded-full border ${
                            row.motif === DEFAULT_PAYMENT_MOTIF
                              ? `${currentTheme.border} ${currentTheme.muted}`
                              : `${currentTheme.accentSoft} ${currentTheme.accentSoftText} ${currentTheme.accentBorder}`
                          }`}
                        >
                          {paymentMotifLabel(row.motif, t)}
                        </span>
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
                  <td colSpan={8} className="px-6 py-12 text-center text-slate-400 italic">
                    {rows.length === 0 ? t.paymentHistoryEmpty : t.noAuditEntriesMatchingFilters}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/*
        ─── LES GESTES DE CORRECTION ───────────────────────────────────────────
        Ce que l'école a RETIRÉ du registre — un salaire saisi pour le mauvais
        membre, une dépense enregistrée deux fois — et ce qu'elle a rétabli.

        Pourquoi un bloc À PART, et pas des lignes de plus dans le tableau : ce ne
        sont pas des encaissements. Une seule liste aurait fait dire au net
        « encaissé » un montant qu'aucune famille n'a payé. Ici, chaque famille
        garde son sens : le net reste celui de la caisse, et les corrections se
        lisent pour ce qu'elles sont — des gestes, avec leur auteur.

        Le montant n'existe que si l'instantané en porte un (`salaryUndo`) : une
        ligne sans montant le dit par un tiret plutôt que d'afficher un zéro qui
        aurait l'air d'un montant.
      */}
      <div className={`${currentTheme.card} border ${currentTheme.border} rounded-2xl overflow-hidden shadow-sm`}>
        <div className="p-6 border-b border-slate-100">
          <h3 className={`text-sm font-black ${currentTheme.inkStrong} flex items-center gap-2`}>
            <Trash2 size={16} className="text-rose-600 dark:text-rose-300" />
            <span>{t.paymentHistoryCorrections}</span>
          </h3>
          <p className={`text-2xs ${currentTheme.muted} mt-1`}>
            {t.paymentHistoryCorrectionsNote.replace('{count}', String(corrections.length))}
          </p>
        </div>
        {corrections.length === 0 ? (
          <p className={`px-6 py-8 text-center text-xs italic ${currentTheme.muted}`}>
            {t.paymentHistoryCorrectionsEmpty}
          </p>
        ) : (
          <div className="max-h-[50vh] overflow-auto">
            <table className="w-full text-left border-collapse">
              <thead className="sticky top-0 z-10">
                <tr className={`${currentTheme.surfaceInset} ${currentTheme.muted} text-2xs font-black uppercase tracking-[0.2em]`}>
                  <th className="px-4 py-4">{t.timestamp}</th>
                  <th className="px-4 py-4">{t.actions}</th>
                  <th className="px-4 py-4">{t.paymentHistorySubject}</th>
                  <th className="px-4 py-4 text-right">{t.amount2}</th>
                  <th className="px-4 py-4">{t.paymentHistoryCollectedBy}</th>
                  <th className="px-4 py-4">{t.details}</th>
                </tr>
              </thead>
              <tbody className={`divide-y ${currentTheme.border}`}>
                {corrections.map((row) => {
                  const offline = offlineOriginOf(row.log);
                  // Une suppression encore annulable : la MÊME règle que la
                  // restauration d'un reçu, sur le même journal fusionné.
                  const archived = restorableSalary(row.log, allLogs);
                  const removed = row.action !== 'RESTORE_SALARY_PAYMENT';
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
                      <td className="px-4 py-4 whitespace-nowrap align-top">
                        <div className="flex flex-col items-start gap-2">
                          <span className={`text-2xs font-black tracking-wider uppercase px-2.5 py-1 rounded-full border ${
                            removed
                              ? 'bg-rose-500/10 text-rose-600 dark:text-rose-300 border-rose-500/20'
                              : 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-300 border-emerald-500/20'
                          }`}>
                            {auditActionLabel(row.action, t)}
                          </span>
                          {archived && (
                            <button
                              onClick={() => { void restoreSalary(archived); }}
                              title={t.restoreSalaryPaymentHint}
                              className="px-2 py-1 bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-900/60 hover:bg-emerald-100 dark:hover:bg-emerald-950/60 rounded text-2xs font-bold transition-all flex items-center gap-1"
                            >
                              <RotateCcw size={12} /> {t.restoreSalaryPayment}
                            </button>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-4 align-top">
                        <span className={`text-xs font-bold ${currentTheme.text}`}>{row.subject || '—'}</span>
                      </td>
                      <td className="px-4 py-4 whitespace-nowrap align-top text-right">
                        {row.amount === null ? (
                          <span className={`text-2xs italic ${currentTheme.muted}`}>{t.paymentHistoryAmountInDetails}</span>
                        ) : (
                          <span className={`text-xs font-black tabular-nums ${removed ? 'text-rose-600 dark:text-rose-300' : 'text-emerald-600 dark:text-emerald-300'}`}>
                            {removed ? `− ${money(row.amount)}` : money(row.amount)}
                          </span>
                        )}
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
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Le rapport de caisse du jour : la MÊME lecture que le tableau ci-dessus,
          regroupée par caissier. Il reçoit l'historique déjà fusionné (`rows`) et
          choisit sa PROPRES journée — les filtres du tableau (période, action,
          recherche) ne le réduisent donc pas : un rapport de caisse est celui
          d'une journée, pas d'une recherche. */}
      <DailyCashReportCard rows={rows} />
    </div>
  );
}

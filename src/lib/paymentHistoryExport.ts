/**
 * ─── Ce que l'historique des paiements emporte hors de l'écran ───────────────
 *
 * L'écran d'historique répond à une question DÉJÀ filtrée : « qu'est-ce qui a été
 * encaissé entre le 1er et le 5, pour un élève dont le nom contient “awa” ? ».
 * Un export qui repartirait de toutes les entrées pour se refiltrer lui-même
 * répondrait à une autre question que celle posée à l'écran — et le jour où les
 * deux filtres divergeraient, plus personne ne saurait lequel croire. Les
 * fonctions d'ici ne reçoivent donc QUE les lignes déjà filtrées
 * (`filterPaymentHistory`) et n'ajoutent aucune règle de sélection.
 *
 * Deux conséquences, et elles décident de la forme du module :
 *
 *   • les colonnes sont CELLES DE L'ÉCRAN, dans son ordre, avec les mêmes
 *     libellés résolus par le dictionnaire — un tableur et un écran qui nomment
 *     autrement la même colonne feraient douter des deux ;
 *   • un montant d'annulation reste SIGNÉ (« - 4000 XOF ») comme l'écran le
 *     montre : le rendre positif pour « faire propre dans Excel » effacerait le
 *     geste qui a annulé l'encaissement, c'est-à-dire la seule chose que la ligne
 *     avait à dire.
 *
 * ─── Et une limite MESURÉE, qui décide de deux caractères ───────────────────
 * L'écran écrit le signe moins typographique (« − », U+2212). Un PDF dessiné avec
 * une police standard de jsPDF est encodé en WinAnsi (Latin-1 étendu), qui ne
 * porte PAS ce caractère : mesuré sur les octets réels, il imprime « " » — le
 * document aurait dit `" 4000 XOF` là où l'écran dit `− 4000 XOF`. L'export écrit
 * donc le trait d'union ASCII, et c'est aussi ce qu'un tableur lit comme un signe
 * négatif (U+2212 ne l'est pas pour Excel). Pour la même raison, les bornes d'une
 * période se séparent d'un tiret cadratin « — » — lui, présent dans WinAnsi, comme
 * les autres documents du dépôt l'emploient déjà.
 *
 * C'est aussi ce qui fait que le CSV et le PDF ne peuvent pas se contredire : le
 * générateur PDF (`pdfPaymentHistory.ts`) dessine exactement les cellules que le
 * CSV écrit, colonne par colonne.
 *
 * Pur : ni DOM, ni PDF, ni téléchargement — le CSV se mesure sur des lignes
 * fabriquées, sans monter quoi que ce soit.
 */
import type { TranslationDict } from '../i18n/translations';
import { auditActionLabel, localizeAuditDetails } from './auditDisplay';
import { offlineOriginNote, offlineOriginOf } from './auditOffline';
import { paymentMotifLabel } from './paymentMotifs';
import type { PaymentHistoryFilter, PaymentHistoryRow } from './paymentHistory';

/** Le type MIME du CSV — le même que l'export du journal d'audit. */
export const PAYMENT_HISTORY_CSV_MIME = 'text/csv;charset=utf-8';

/** Ce que les deux écritures (CSV, PDF) partagent : la langue et le formateur. */
export interface PaymentHistoryExportContext {
  t: TranslationDict;
  lang: 'en' | 'fr';
  /**
   * Le formateur de montants de l'ÉCRAN (`formatCurrency`, injecté par le
   * contexte) : le document et la vue ne peuvent donc pas chiffrer autrement.
   */
  formatMoney: (amount: number) => string;
}

/**
 * La locale du poste.
 *
 * Seule paire autorisée par `tests/pdf-i18n-guard.test.ts` : tout autre
 * `lang === 'fr' ? '<texte>'` est un libellé bilingue en dur, qui doit vivre
 * dans le dictionnaire.
 */
export function paymentHistoryLocale(lang: 'en' | 'fr'): string {
  return lang === 'fr' ? 'fr-FR' : 'en-US';
}

/** L'instant d'une ligne, écrit comme l'écran l'écrit. */
export function paymentHistoryMoment(at: string, lang: 'en' | 'fr'): string {
  const ms = Date.parse(String(at ?? ''));
  return Number.isFinite(ms) ? new Date(ms).toLocaleString(paymentHistoryLocale(lang)) : '—';
}

/**
 * Une borne de période (`AAAA-MM-JJ`), écrite en date courte.
 *
 * Une borne n'est pas un instant : l'écrire avec son heure (« 00:00:00 ») ferait
 * croire que le filtre a été posé à minuit pile. Une borne illisible est rendue
 * telle quelle plutôt que devinée.
 */
export function paymentHistoryBound(value: string | undefined, lang: 'en' | 'fr'): string {
  const text = String(value ?? '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
  const ms = Date.parse(`${text}T00:00:00`);
  return Number.isFinite(ms) ? new Date(ms).toLocaleDateString(paymentHistoryLocale(lang)) : text;
}

/**
 * Les HUIT colonnes de l'écran, dans SON ordre — le CSV et le PDF les nomment de même.
 *
 * Le MOTIF est la huitième, juste après le reçu : il décrit CE reçu (ce que la
 * famille est venue régler), et le lecteur d'un tableur ou d'un PDF le lit donc à
 * côté du numéro qu'il qualifie. Son libellé est celui de la ligne « Motif » du
 * papier remis au comptoir (`paymentMotifLabel`) — un motif ne se nomme pas de
 * deux façons selon qu'on le regarde à l'écran ou dans un fichier.
 */
export function paymentHistoryColumnLabels(t: TranslationDict): string[] {
  return [t.timestamp, t.studentName, t.actions, t.amount2, t.receipt, t.paymentMotif, t.paymentHistoryCollectedBy, t.details];
}

/**
 * Le montant d'une ligne, ou le renvoi au détail quand l'entrée n'a pas d'instantané.
 *
 * Le signe est le trait d'union ASCII, pas le « − » de l'écran : mesuré sur le PDF
 * réel, la police WinAnsi le transforme en guillemet (voir l'en-tête du module).
 */
function amountCell(row: PaymentHistoryRow, { t, formatMoney }: PaymentHistoryExportContext): string {
  if (row.amount === null) return t.paymentHistoryAmountInDetails;
  return row.action === 'DELETE_PAYMENT' ? `- ${formatMoney(row.amount)}` : formatMoney(row.amount);
}

/** L'élève d'une ligne : son nom, et sa classe entre parenthèses comme l'écran la montre. */
function studentCell(row: PaymentHistoryRow, { t }: PaymentHistoryExportContext): string {
  const name = row.studentName || t.paymentHistoryUnknownStudent;
  return row.studentName && row.studentGrade ? `${name} (${row.studentGrade})` : name;
}

/** L'encaisseur : nom, compte et rôle, comme la colonne ENCAISSÉ PAR les montre. */
function cashierCell(row: PaymentHistoryRow, { t }: PaymentHistoryExportContext): string {
  const name = row.actorName || t.roleStaff;
  const account = row.actorEmail ? ` (${row.actorEmail})` : '';
  return row.actorRole ? `${name}${account} · ${row.actorRole}` : `${name}${account}`;
}

/** Le détail d'une ligne, avec la note hors ligne quand elle existe (comme l'écran). */
function detailsCell(row: PaymentHistoryRow, { t, lang }: PaymentHistoryExportContext): string {
  const details = localizeAuditDetails(row.log.details, lang) || '—';
  const origin = offlineOriginOf(row.log);
  if (!origin) return details;
  const note = offlineOriginNote(origin, (iso) => paymentHistoryMoment(iso, lang), {
    captured: t.auditOfflineRowCaptured,
    synced: t.auditOfflineRowSynced,
  });
  return `${details} · ${note}`;
}

/** Une ligne de l'écran, cellule par cellule — l'ordre suit `paymentHistoryColumnLabels`. */
export function paymentHistoryCells(row: PaymentHistoryRow, context: PaymentHistoryExportContext): string[] {
  return [
    paymentHistoryMoment(row.at, context.lang),
    studentCell(row, context),
    auditActionLabel(row.action, context.t),
    amountCell(row, context),
    row.receiptNumber || '—',
    paymentMotifLabel(row.motif, context.t),
    cashierCell(row, context),
    detailsCell(row, context),
  ];
}

/**
 * Le CSV complet : en-tête puis lignes, `\r\n` et guillemets doublés.
 *
 * Les lignes sont celles qu'on lui donne — déjà filtrées. Une liste vide donne un
 * en-tête seul : un fichier qui n'aurait aucune ligne reste lisible comme « la
 * question posée n'a rien ramené », ce que le bouton désactivé dit déjà.
 */
export function buildPaymentHistoryCsv(
  rows: PaymentHistoryRow[],
  context: PaymentHistoryExportContext,
): string {
  const escape = (value: string) => `"${value.replace(/"/g, '""')}"`;
  const lines = [paymentHistoryColumnLabels(context.t), ...rows.map((row) => paymentHistoryCells(row, context))];
  return lines.map((cells) => cells.map(escape).join(',')).join('\r\n');
}

/** Le CSV prêt à écrire : le BOM que le tableur attend pour lire les accents. */
export function paymentHistoryCsvBytes(csv: string): Uint8Array {
  return new TextEncoder().encode('\ufeff' + csv);
}

/**
 * Les filtres ACTIFS, en une phrase — un document imprimé doit se relire seul.
 *
 * Sans filtres, la phrase le DIT (`paymentHistoryPdfNoFilter`) au lieu de rester
 * vide : un lecteur qui reçoit la liste complète doit savoir qu'elle l'est, sinon
 * il croira à un filtre oublié. L'action est résolue par le dictionnaire (le même
 * libellé que la colonne ACTIONS), et un filtre « toutes les actions » n'écrit
 * rien — il n'écarte rien.
 */
export function describePaymentHistoryFilter(
  filter: PaymentHistoryFilter | undefined,
  t: TranslationDict,
  lang: 'en' | 'fr',
): string {
  const parts: string[] = [];
  const from = String(filter?.from ?? '').trim();
  const to = String(filter?.to ?? '').trim();
  if (from || to) {
    // Le tiret cadratin sépare les deux bornes : mesuré, il traverse WinAnsi —
    // contrairement à la flèche « → », que jsPDF imprimait « !’ ».
    parts.push(`${t.paymentHistoryPdfPeriod} : ${from ? paymentHistoryBound(from, lang) : '—'} — ${to ? paymentHistoryBound(to, lang) : '—'}`);
  }
  const action = filter?.action && filter.action !== 'all' ? filter.action : null;
  if (action) parts.push(`${t.auditFilterAction} : ${auditActionLabel(action, t)}`);
  const search = String(filter?.search ?? '').trim();
  if (search) parts.push(`${t.paymentHistoryPdfSearch} : « ${search} »`);
  return parts.length ? parts.join(' · ') : t.paymentHistoryPdfNoFilter;
}

/** Le nom du fichier remis au poste, horodaté — deux exports ne s'écrasent pas. */
export function paymentHistoryExportFilename(
  extension: 'csv' | 'pdf',
  today: string = new Date().toISOString().slice(0, 10),
): string {
  return `Historique_Paiements_${today}.${extension}`;
}

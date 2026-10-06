/**
 * ─── L'HISTORIQUE DES PAIEMENTS : lire le journal, sans le réécrire ──────────
 *
 * « Qui a encaissé, combien, pour quel élève ? » — la question de la caisse. La
 * réponse ne vit PAS dans `payments` : la table ne porte que l'id de l'élève, la
 * date, le montant et le reçu (mesuré le 2026-10-06 : 7 colonnes, aucune pour
 * l'encaisseur). L'utilisateur CONNECTÉ est écrit dans le journal d'audit au
 * moment du geste, avec son nom, son courriel et son rôle — et c'est le seul
 * endroit qui le porte.
 *
 * Deux conséquences, et elles décident de la forme de ce module :
 *
 *   • l'historique se lit dans `audit_logs`, pas dans `payments`. Il montre donc
 *     les GESTES : l'encaissement, l'annulation, la restauration. Un reçu annulé
 *     disparaît de `payments` mais reste ici, avec son montant et son auteur — ce
 *     qu'une caisse doit pouvoir relire ;
 *   • le MONTANT chiffré vient de l'instantané `metadata` de l'entrée
 *     (`paymentSnapshotOf`, posé aux trois gestes depuis le 2026-10-06). Une
 *     entrée antérieure n'en a pas : son montant n'existe QUE dans la phrase
 *     `details`, qui s'affiche et ne s'additionne pas. On ne découpe donc jamais
 *     cette phrase — un montant extrait d'un texte libre finirait par additionner
 *     une date, et le total serait faux sans que rien ne le dise.
 *
 * Ce que le module NE fait pas : il ne filtre jamais sur `user_name` « pour voir
 * les encaissements de X » sans que l'appelant le demande, il ne devine pas un
 * élève absent de la liste, et il ne recompte pas une ligne deux fois.
 *
 * Pur : ni horloge, ni DOM, ni réseau — il se mesure sur des entrées fabriquées.
 */
import type { AuditLogEntry } from './auditLogger';
import type { Student } from './domainTypes';
import { paymentSnapshotOf } from './paymentUndo';

/**
 * Les gestes qui touchent un paiement, et eux seuls.
 *
 * `RECORD_SALARY_PAYMENT` n'en fait pas partie : un salaire SORT de la caisse, il
 * ne s'encaisse pas — le mélanger à un historique d'encaissements rendrait le net
 * faux d'un montant qui n'a rien à y faire.
 */
export const PAYMENT_HISTORY_ACTIONS = ['RECORD_PAYMENT', 'DELETE_PAYMENT', 'RESTORE_PAYMENT'] as const;

export type PaymentHistoryAction = (typeof PAYMENT_HISTORY_ACTIONS)[number];

const ACTION_SET: ReadonlySet<string> = new Set(PAYMENT_HISTORY_ACTIONS);

/** Cette entrée de journal est-elle un geste de paiement ? */
export function isPaymentHistoryAction(action: string | null | undefined): action is PaymentHistoryAction {
  return typeof action === 'string' && ACTION_SET.has(action);
}

/** Une ligne de l'historique — ce que l'écran affiche, colonne par colonne. */
export interface PaymentHistoryRow {
  id: string;
  /** L'instant du geste (ISO) : celui du poste s'il a été saisi hors ligne. */
  at: string;
  action: PaymentHistoryAction;
  /** L'utilisateur CONNECTÉ au moment du geste (le journal le fige). */
  actorName: string;
  actorEmail: string;
  actorRole: string;
  /** L'élève, quand il est identifiable. `null` n'est jamais deviné. */
  studentId: string | null;
  studentName: string | null;
  studentGrade: string | null;
  /** Le montant CHIFFRÉ, ou `null` si l'entrée ne porte pas d'instantané. */
  amount: number | null;
  receiptNumber: string | null;
  /**
   * L'entrée d'origine. La ligne n'en recopie ni le détail ni la marque « hors
   * ligne » : `localizeAuditDetails` et `offlineOriginOf` en sont les SEULES
   * définitions, et les recopier ici en ferait deux.
   */
  log: AuditLogEntry;
}

/**
 * Les lignes de l'historique, les plus récentes d'abord.
 *
 * @param logs les entrées du journal (toutes actions confondues : le tri se fait ici)
 * @param students l'annuaire des élèves, pour lire un nom et une classe ACTUELS
 *   (`students` est la photo du jour ; l'instantané, lui, garde le nom du geste)
 */
export function paymentHistoryRows({
  logs,
  students = [],
}: {
  logs: AuditLogEntry[];
  students?: Student[];
}): PaymentHistoryRow[] {
  const byId = new Map(students.map((student) => [student.id, student]));
  const rows: PaymentHistoryRow[] = [];

  for (const log of logs) {
    if (!isPaymentHistoryAction(log.action)) continue;
    const snapshot = paymentSnapshotOf(log);
    // Le SEUL endroit qui sait que l'encaissement vise un ÉLÈVE en `target_id`
    // (`dataOps/payments.ts` y passe `studentId`) ; une suppression et une
    // restauration y mettent l'id du PAIEMENT, donc leur élève ne se lit que dans
    // l'instantané — sans lui, l'élève reste inconnu plutôt que deviné.
    const studentId = snapshot?.studentId ?? (log.action === 'RECORD_PAYMENT' ? (log.targetId || null) : null);
    const live = studentId ? byId.get(studentId) : undefined;
    const snapshotName = snapshot?.studentName?.trim();
    rows.push({
      id: log.id,
      at: log.createdAt,
      action: log.action,
      actorName: log.userName?.trim() || '',
      actorEmail: log.userEmail?.trim() || '',
      actorRole: log.userRole?.trim() || '',
      studentId,
      studentName: snapshotName || live?.name?.trim() || null,
      studentGrade: live?.grade?.trim() || null,
      amount: snapshot ? snapshot.amount : null,
      receiptNumber: snapshot?.receiptNumber?.trim() || null,
      log,
    });
  }

  return rows.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
}

/** Les bornes d'un filtre : `'all'` (ou absent) n'écarte rien. */
export interface PaymentHistoryFilter {
  action?: PaymentHistoryAction | 'all';
  /** Bornes `AAAA-MM-JJ` INCLUSES, comme le journal d'audit. */
  from?: string;
  to?: string;
  /** Nom d'élève, de reçu ou de caissier — insensible à la casse. */
  search?: string;
}

/** L'instant d'une borne, ou `null` quand la borne est absente/illisible. */
function boundOf(value: string | undefined, endOfDay: boolean): number | null {
  const text = String(value ?? '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return null;
  const ms = new Date(`${text}T${endOfDay ? '23:59:59.999' : '00:00:00.000'}`).getTime();
  return Number.isNaN(ms) ? null : ms;
}

/**
 * Les lignes qui passent le filtre.
 *
 * La recherche porte sur l'élève, le reçu et le caissier : ce sont les trois
 * questions qu'on pose à une caisse (« le paiement d'Awa », « le reçu REC-568 »,
 * « ce qu'a encaissé l'économe »).
 */
export function filterPaymentHistory(rows: PaymentHistoryRow[], filter: PaymentHistoryFilter = {}): PaymentHistoryRow[] {
  const from = boundOf(filter.from, false);
  const to = boundOf(filter.to, true);
  const search = String(filter.search ?? '').trim().toLowerCase();
  const action = filter.action && filter.action !== 'all' ? filter.action : null;

  return rows.filter((row) => {
    if (action && row.action !== action) return false;
    const at = new Date(row.at).getTime();
    if (from !== null && !(at >= from)) return false;
    if (to !== null && !(at <= to)) return false;
    if (!search) return true;
    return [row.studentName, row.receiptNumber, row.actorName, row.actorEmail]
      .some((value) => (value ?? '').toLowerCase().includes(search));
  });
}

/**
 * Ce que les lignes affichées disent de la caisse.
 *
 * `net` n'additionne QUE les montants chiffrés — un encaissement + une
 * restauration montent, une annulation descend. `withoutAmount` compte les lignes
 * dont le montant n'existe que dans la phrase : tant qu'il n'est pas à zéro, le
 * net est PARTIEL, et l'écran le dit au lieu de laisser croire à un total.
 */
export interface PaymentHistorySummary {
  count: number;
  collected: number;
  cancelled: number;
  net: number;
  withoutAmount: number;
}

export function paymentHistorySummary(rows: PaymentHistoryRow[]): PaymentHistorySummary {
  let collected = 0;
  let cancelled = 0;
  let withoutAmount = 0;
  for (const row of rows) {
    if (row.amount === null) {
      withoutAmount += 1;
      continue;
    }
    if (row.action === 'DELETE_PAYMENT') cancelled += row.amount;
    else collected += row.amount;
  }
  return { count: rows.length, collected, cancelled, net: collected - cancelled, withoutAmount };
}

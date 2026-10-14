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
 *   • le MONTANT chiffré vient d'abord de l'instantané `metadata` de l'entrée
 *     (`paymentSnapshotOf`, posé aux trois gestes depuis le 2026-10-06) ; à
 *     défaut, il se RELIT dans la phrase `details` (voir plus bas).
 *
 * ─── Pourquoi la phrase se relit, alors qu'elle ne se découpait pas ──────────
 * La règle d'origine — « on ne découpe jamais `details` » — pariait sur
 * l'instantané. Mesuré sur la base hébergée le 2026-10-06 : la colonne `metadata`
 * existe, et **les 3 seuls gestes de paiement du journal l'ont à `NULL`** (les
 * trois précèdent l'écriture de l'instantané). Ce que l'écran montrait alors :
 * « voir le détail » dans la colonne MONTANT sur TOUTES les lignes, « — » dans la
 * colonne du reçu, et un résumé annonçant « encaissé 0 FCFA » pour des
 * encaissements bien réels. Ne rien découper n'était donc pas prudent, c'était
 * faux — et l'école l'a vu avant nous.
 *
 * Ce qui rend la relecture sûre, et pas devinette : le gabarit n'est pas du texte
 * libre, il est ÉCRIT par `dataOps/payments.ts` et `offlineReplay.ts`, et
 * `paymentFactsFromDetails` ne lit QUE lui — ancré au début, montant numérique
 * suivi du mot `FCFA`, reçu entre parenthèses. Une phrase qui n'a pas cette forme
 * ne rend rien, et sa ligne reste comptée dans `summary.withoutAmount` : le
 * résumé dit alors, comme avant, quel montant il ne peut pas additionner.
 *
 * Ce que le module NE fait pas : il ne filtre jamais sur `user_name` « pour voir
 * les encaissements de X » sans que l'appelant le demande, il ne devine pas un
 * élève absent de la liste, et il ne recompte pas une ligne deux fois.
 *
 * Pur : ni horloge, ni DOM, ni réseau — il se mesure sur des entrées fabriquées.
 */
import type { AuditLogEntry } from './auditLogger';
import type { Payment, Student } from './domainTypes';
import { paymentMotifFromDetails, paymentMotifOf } from './paymentMotifs';
import type { PaymentMotif } from './paymentMotifs';
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

/** Ce qu'une phrase de journal dit d'un geste, quand l'entrée n'a pas d'instantané. */
export interface PaymentSentenceFacts {
  amount: number | null;
  receiptNumber: string | null;
  studentName: string | null;
}

/**
 * Les gabarits CONNUS d'une phrase de paiement — deux, et tous les deux écrits par
 * ce dépôt : la forme française d'aujourd'hui, et l'anglaise que les versions
 * d'avant le 2026-09-13 écrivaient (`localizeAuditDetails` la traduit à
 * l'affichage, mais le journal garde, lui, l'original — on ne réécrit pas une
 * trace).
 *
 * Chacune est ANCRÉE au début et exige le mot `FCFA` : un nombre ne peut donc pas
 * être lu dans une date, dans un numéro de reçu ou dans un nom.
 */
const SENTENCE_PATTERNS: RegExp[] = [
  /^Paiement de ([0-9][0-9\s\u00a0\u202f.,]*) FCFA \(re[uç]u ([^)]*)\)/,
  /^Payment of ([0-9][0-9\s.,]*) FCFA recorded \(Receipt: ([^)]*)\)/,
];

/** La marque de rejeu posée à la fin de `details` (`offlineReplay`) : hors sujet ici. */
const REPLAY_TAG = /\s*\[replay\]\s*$/;

/** Le nom d'élève, quand la phrase le porte (`— élève X`), sinon rien. */
const STUDENT_IN_SENTENCE = /— élève (.+)$/;

/**
 * Un montant écrit par l'école — « 4000 », « 4 000 », « 4.000 ».
 *
 * « 4.000 » et « 4,000 » sont des milliers ; un séparateur qui ne groupe pas par
 * trois reste une partie décimale. Les montants de cette école sont entiers, mais
 * on ne transforme pas `1,5` en `15`.
 */
function amountFromText(raw: string): number | null {
  const text = raw.replace(/[\s\u00a0\u202f]/g, '');
  if (!text) return null;
  const grouped = /^\d{1,3}([.,]\d{3})+$/.test(text);
  const value = Number(grouped ? text.replace(/[.,]/g, '') : text.replace(',', '.'));
  return Number.isFinite(value) ? value : null;
}

/** Le reçu écrit dans la phrase, ou `null` quand l'école a écrit « N/A ». */
function receiptFromText(raw: string): string | null {
  const text = raw.trim();
  return text && !/^n\/?a$/i.test(text) ? text : null;
}

/**
 * Ce qu'une phrase de journal dit du geste.
 *
 * `amount: null` n'est pas une erreur : c'est une phrase que ce module ne sait
 * pas lire (une restauration d'avant le 2026-10-06, dont le gabarit ne portait
 * pas le reçu, par exemple). Elle s'affiche alors telle quelle, et le résumé la
 * compte dans `withoutAmount` au lieu de l'additionner.
 */
export function paymentFactsFromDetails(details: string | null | undefined): PaymentSentenceFacts {
  const text = String(details ?? '').replace(REPLAY_TAG, '').trim();
  const studentName = STUDENT_IN_SENTENCE.exec(text)?.[1]?.trim() || null;
  if (!text) return { amount: null, receiptNumber: null, studentName };
  for (const pattern of SENTENCE_PATTERNS) {
    const matched = pattern.exec(text);
    if (!matched) continue;
    return {
      amount: amountFromText(matched[1] ?? ''),
      receiptNumber: receiptFromText(matched[2] ?? ''),
      studentName,
    };
  }
  // Une phrase sans gabarit chiffré (« Paiement restauré ») : le nom reste
  // lisible, le montant reste inconnu.
  return { amount: null, receiptNumber: null, studentName };
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
  /** Le montant CHIFFRÉ — de l'instantané, ou relu dans la phrase. `null` si ni l'un ni l'autre. */
  amount: number | null;
  receiptNumber: string | null;
  /**
   * Le motif du reçu — `scolarite` (le geste ordinaire) quand la ligne n'en
   * déclare aucun, JAMAIS `null`.
   *
   * C'est la règle du reçu lui-même (`paymentMotifOf`) : un paiement d'avant la
   * colonne `payments.motif` a été imprimé « Frais de scolarité », et la
   * réimpression d'aujourd'hui doit dire exactement ce que le papier d'alors
   * disait. Un trou (« — ») ferait croire à un motif PERDU là où il n'y en a
   * jamais eu. Il se lit dans l'instantané `metadata` quand le geste en porte un,
   * sinon dans la mention ` — motif : …` de la phrase du journal, sinon il est
   * ordinaire.
   */
  motif: PaymentMotif;
  /**
   * L'id du PAIEMENT que le geste désigne, ou `null`.
   *
   * Il vient de l'instantané, ou de `target_id` pour une suppression et une
   * restauration (qui y mettent l'id du paiement, là où l'encaissement y met
   * l'élève). C'est lui qui relie une ligne au paiement ENCORE VIVANT — donc au
   * reçu qu'on peut réimprimer, et au geste qu'on peut corriger.
   */
  paymentId: string | null;
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
    const facts = paymentFactsFromDetails(log.details);
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
      studentName: snapshotName || live?.name?.trim() || facts.studentName,
      studentGrade: live?.grade?.trim() || null,
      // L'instantané fait foi ; sinon la phrase, dont le gabarit est écrit par ce
      // dépôt (voir `paymentFactsFromDetails`).
      amount: snapshot ? snapshot.amount : facts.amount,
      receiptNumber: snapshot?.receiptNumber?.trim() || facts.receiptNumber,
      // L'instantané d'abord ; sinon la mention de la phrase, quand l'entrée
      // précède la colonne `payments.motif` ; sinon le motif ordinaire — celui
      // qu'un reçu muet imprime.
      motif: paymentMotifOf(snapshot?.motif ?? paymentMotifFromDetails(log.details)),
      paymentId: snapshot?.paymentId || (log.action === 'RECORD_PAYMENT' ? null : log.targetId || null),
      log,
    });
  }

  return rows.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
}

/**
 * Le paiement ENCORE VIVANT qu'une ligne désigne — l'élève ET la ligne, ou `null`.
 *
 * Trois chemins, du plus sûr au plus large :
 *   1. l'id du paiement, quand le geste le nomme (l'instantané, ou le `target_id`
 *      d'une suppression/restauration) ;
 *   2. le numéro de reçu, quand il n'y a pas d'instantané — le cas de TOUS les
 *      encaissements d'avant le 2026-10-06 (mesuré) — et qu'un SEUL paiement de
 *      cet élève le porte : un reçu ambigu n'est pas deviné ;
 *   3. rien. Un paiement annulé n'est plus là, et l'écran n'a alors aucun reçu à
 *      montrer — ce qui est la vérité, pas une panne.
 */
export function livePaymentOf(
  row: PaymentHistoryRow,
  students: Student[],
): { student: Student; payment: Payment } | null {
  const student = row.studentId ? students.find((s) => s.id === row.studentId) : undefined;
  if (!student) return null;
  if (row.paymentId) {
    const byId = student.payments.find((p) => p.id === row.paymentId);
    if (byId) return { student, payment: byId };
  }
  if (row.receiptNumber) {
    const byReceipt = student.payments.filter((p) => (p.receiptNumber ?? '') === row.receiptNumber);
    if (byReceipt.length === 1) return { student, payment: byReceipt[0]! };
  }
  return null;
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

/**
 * ─── L'INSTANTANÉ d'un paiement : qui l'écrit, qui le relit ──────────────────
 *
 * Les trois gestes qui touchent un paiement — encaissement, suppression,
 * restauration — écrivent dans `audit_logs.metadata` l'instantané STRUCTURÉ de la
 * ligne (`20261005000004_audit_logs_metadata.sql`), et ce module est le seul
 * endroit qui en connaît la forme :
 *
 *   • `dataOps/payments.ts` et `offlineReplay.ts` le POSENT (en ligne comme au
 *     rejeu hors ligne) ;
 *   • la vue Audit le RELIT pour savoir quelle suppression est encore annulable,
 *     et propose alors « Restaurer » ;
 *   • l'**Historique des paiements** (`paymentHistory.ts`) le relit aussi, et
 *     c'est ce qui lui donne un MONTANT CHIFFRÉ au lieu d'une phrase à découper :
 *     une entrée d'encaissement d'avant le 2026-10-06 n'en porte pas, donc le seul
 *     montant y vit dans `details` — visible à l'œil, jamais additionné.
 *
 * Pourquoi pas une phrase : `details` raconte le geste à l'œil, mais un montant
 * noyé dans du texte ne se réinsère pas — et ne s'additionne pas. Il faut l'`id`
 * d'origine, le `student_id`, la date et l'année : donc une forme fixe, celle-ci.
 *
 * La suppression y ajoute sa règle propre (seule une suppression se restaure) :
 * voir `archivedPaymentOf`, qui n'accepte QUE `DELETE_PAYMENT` là où
 * `paymentSnapshotOf` lit n'importe quelle entrée qui porte l'instantané.
 *
 * Une suppression est annulable tant qu'aucune entrée `RESTORE_PAYMENT` ne nomme
 * le MÊME paiement (`target_id` = l'id du paiement). Le journal ne se réécrit
 * jamais : la restauration AJOUTE sa ligne à côté de la suppression, elle ne
 * l'efface pas — l'école voit donc les deux gestes, et dans quel ordre.
 */
import type { AuditLogEntry } from './auditLogger';
import type { Payment } from './domainTypes';

/** L'instantané d'un paiement retiré — exactement de quoi le réinsérer à l'identique. */
export interface ArchivedPayment {
  paymentId: string;
  studentId: string;
  studentName?: string;
  date: string;
  amount: number;
  academicYear?: string;
  receiptNumber?: string;
}

/** Le marqueur de forme : un `metadata` d'un autre genre n'est pas un instantané de paiement. */
export const PAYMENT_UNDO_KIND = 'payment_row';

/** L'instantané d'un paiement, tel qu'il part dans `metadata` au moment de la suppression. */
export function archivedPaymentFrom(
  studentId: string,
  studentName: string | undefined,
  payment: Payment,
): ArchivedPayment {
  return {
    paymentId: payment.id ?? '',
    studentId,
    studentName,
    date: payment.date,
    amount: payment.amount,
    academicYear: payment.academicYear,
    receiptNumber: payment.receiptNumber,
  };
}

/**
 * L'instantané rangé dans un objet `metadata` prêt à écrire (clés en snake_case,
 * comme les lignes).
 *
 * Posé par les TROIS gestes : à l'encaissement il donne à l'historique un montant
 * chiffré et un élève lié ; à la suppression il rend le geste annulable ; à la
 * restauration il garde la même forme, donc un rejeu n'a pas à relire une ligne
 * qui a changé.
 */
export function paymentSnapshotMetadata(archived: ArchivedPayment): Record<string, unknown> {
  return {
    kind: PAYMENT_UNDO_KIND,
    payment_id: archived.paymentId,
    student_id: archived.studentId,
    student_name: archived.studentName ?? null,
    date: archived.date,
    amount: archived.amount,
    academic_year: archived.academicYear ?? null,
    receipt_number: archived.receiptNumber ?? null,
  };
}

const asText = (v: unknown): string | undefined => (typeof v === 'string' && v ? v : undefined);

/**
 * Relit l'instantané d'un paiement, quelle que soit l'action qui l'a posé.
 *
 * `null` si le `metadata` n'en porte pas la forme : un objet inattendu n'est
 * jamais deviné. C'est la SEULE lecture de cette forme — `archivedPaymentOf`
 * l'enveloppe de la règle de l'annulation, elle ne la relit pas.
 */
export function paymentSnapshotOf(
  log: Pick<AuditLogEntry, 'metadata'>,
): ArchivedPayment | null {
  const m = log.metadata as Record<string, unknown> | null | undefined;
  if (!m || m.kind !== PAYMENT_UNDO_KIND) return null;
  const paymentId = asText(m.payment_id);
  const studentId = asText(m.student_id);
  const date = asText(m.date);
  const amount = typeof m.amount === 'number' ? m.amount : Number(m.amount);
  if (!paymentId || !studentId || !date || !Number.isFinite(amount)) return null;
  return {
    paymentId,
    studentId,
    date,
    amount,
    studentName: asText(m.student_name),
    academicYear: asText(m.academic_year),
    receiptNumber: asText(m.receipt_number),
  };
}

/**
 * Relit l'instantané d'une SUPPRESSION de paiement, ou `null`.
 *
 * La règle de l'annulation est ici, et nulle part ailleurs : une entrée
 * `RECORD_PAYMENT` peut porter le même instantané (l'historique s'en sert) sans
 * qu'une restauration ait de sens pour elle.
 */
export function archivedPaymentOf(
  log: Pick<AuditLogEntry, 'action' | 'metadata'>,
): ArchivedPayment | null {
  if (log.action !== 'DELETE_PAYMENT') return null;
  return paymentSnapshotOf(log);
}

/** Les ids des paiements DÉJÀ restaurés (une entrée `RESTORE_PAYMENT` les nomme). */
export function restoredPaymentIds(logs: Pick<AuditLogEntry, 'action' | 'targetId'>[]): Set<string> {
  const restored = new Set<string>();
  for (const log of logs) {
    if (log.action === 'RESTORE_PAYMENT' && log.targetId) restored.add(log.targetId);
  }
  return restored;
}

/**
 * L'instantané d'une suppression ENCORE annulable, ou `null`.
 *
 * `null` dans trois cas, et chacun se dit : l'entrée n'est pas une suppression de
 * paiement ; elle n'a pas d'instantané (les suppressions d'avant cette colonne —
 * on n'invente pas une ligne qu'on n'a pas gardée) ; ou le paiement a déjà été
 * restauré (une seconde restauration écraserait un geste réel).
 */
export function restorablePayment(log: AuditLogEntry, logs: AuditLogEntry[]): ArchivedPayment | null {
  const archived = archivedPaymentOf(log);
  if (!archived) return null;
  return restoredPaymentIds(logs).has(archived.paymentId) ? null : archived;
}

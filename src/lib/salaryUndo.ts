/**
 * ─── L'INSTANTANÉ d'un paiement de SALAIRE : qui l'écrit, qui le relit ────────
 *
 * Un salaire se saisit vite et se trompe aussi vite : le mauvais membre, un
 * montant doublé, un mois payé deux fois. Jusqu'ici le seul recours était de
 * supprimer le MEMBRE ENTIER (`salary_payments.staff_id` est `ON DELETE CASCADE`,
 * mesuré : retirer un membre emporte toute sa paie) — disproportionné, et le
 * journal ne disait plus quel salaire avait disparu.
 *
 * `deleteSalaryPayment` retire donc la SEULE ligne fautive, et ce module est le
 * seul endroit qui connaît la forme de l'instantané qu'elle laisse :
 *
 *   • `dataOps/payments.ts` et `offlineReplay.ts` le POSENT (en ligne comme au
 *     rejeu), dans `metadata` de l'entrée `DELETE_SALARY_PAYMENT` ;
 *   • la vue « Historique des paiements » le RELIT, et propose alors « Rétablir »
 *     sur la ligne du geste ;
 *   • `restoreSalaryPayment` le réinsère à l'IDENTIQUE — même id, même membre,
 *     même montant, même date, même année scolaire.
 *
 * Pourquoi pas la phrase : `details` raconte le geste à l'œil, mais un montant
 * noyé dans du texte ne se réinsère pas. Il faut l'id d'origine, le membre, la
 * date et l'année : donc une forme fixe, celle-ci.
 *
 * Deux règles, et elles sont la raison d'être de ce fichier :
 *   • la suppression est la SEULE action qui rend un salaire restaurable
 *     (`archivedSalaryOf` n'accepte que `DELETE_SALARY_PAYMENT`) — une entrée
 *     `RECORD_SALARY_PAYMENT` porte le même genre d'instantané sans qu'une
 *     restauration ait de sens pour elle ;
 *   • une suppression n'est annulable QUE si aucune entrée
 *     `RESTORE_SALARY_PAYMENT` ne nomme déjà le même paiement. Le journal ne se
 *     réécrit jamais : la restauration AJOUTE sa ligne à côté de la suppression,
 *     et l'école voit les deux gestes, dans l'ordre.
 *
 * Le genre (`kind`) est distinct de celui d'un reçu (`PAYMENT_UNDO_KIND`) : un
 * `metadata` de salaire relu par le lecteur de paiements rend `null`, et
 * inversement. Deux familles d'argent qui ne se confondent pas, jusque dans le
 * journal.
 *
 * Pur : ni horloge, ni DOM, ni réseau.
 */
import type { AuditLogEntry } from './auditLogger';
import type { SalaryPayment } from './domainTypes';

/** L'instantané d'un paiement de salaire retiré — de quoi le réinsérer à l'identique. */
export interface ArchivedSalaryPayment {
  /** L'id de la ligne `salary_payments` (pas celui du membre). */
  salaryPaymentId: string;
  staffId: string;
  staffName?: string;
  date: string;
  amount: number;
  academicYear?: string;
}

/** Le marqueur de forme : un `metadata` d'un reçu n'est pas un instantané de salaire. */
export const SALARY_UNDO_KIND = 'salary_payment_row';

/** L'instantané d'un paiement de salaire, tel qu'il part dans `metadata` à la suppression. */
export function archivedSalaryFrom(
  staffId: string,
  staffName: string | undefined,
  payment: SalaryPayment,
): ArchivedSalaryPayment {
  return {
    salaryPaymentId: payment.id ?? '',
    staffId,
    staffName,
    date: payment.date,
    amount: payment.amount,
    academicYear: payment.academicYear,
  };
}

/**
 * L'instantané rangé dans un objet `metadata` prêt à écrire (clés en snake_case,
 * comme les lignes) — la même forme au rejeu hors ligne qu'en ligne, sinon une
 * suppression rejouée ne serait pas annulable.
 */
export function salarySnapshotMetadata(archived: ArchivedSalaryPayment): Record<string, unknown> {
  return {
    kind: SALARY_UNDO_KIND,
    salary_payment_id: archived.salaryPaymentId,
    staff_id: archived.staffId,
    staff_name: archived.staffName ?? null,
    date: archived.date,
    amount: archived.amount,
    academic_year: archived.academicYear ?? null,
  };
}

const asText = (v: unknown): string | undefined => (typeof v === 'string' && v ? v : undefined);

/**
 * Relit l'instantané d'un paiement de salaire, quelle que soit l'action qui l'a
 * posé. `null` si le `metadata` n'en porte pas la forme : un objet inattendu
 * n'est jamais deviné.
 */
export function salarySnapshotOf(
  log: Pick<AuditLogEntry, 'metadata'>,
): ArchivedSalaryPayment | null {
  const m = log.metadata as Record<string, unknown> | null | undefined;
  if (!m || m.kind !== SALARY_UNDO_KIND) return null;
  const salaryPaymentId = asText(m.salary_payment_id);
  const staffId = asText(m.staff_id);
  const date = asText(m.date);
  const amount = typeof m.amount === 'number' ? m.amount : Number(m.amount);
  if (!salaryPaymentId || !staffId || !date || !Number.isFinite(amount)) return null;
  return {
    salaryPaymentId,
    staffId,
    date,
    amount,
    staffName: asText(m.staff_name),
    academicYear: asText(m.academic_year),
  };
}

/**
 * Relit l'instantané d'une SUPPRESSION de salaire, ou `null`.
 *
 * La règle de l'annulation est ici, et nulle part ailleurs : seule une
 * suppression se restaure.
 */
export function archivedSalaryOf(
  log: Pick<AuditLogEntry, 'action' | 'metadata'>,
): ArchivedSalaryPayment | null {
  if (log.action !== 'DELETE_SALARY_PAYMENT') return null;
  return salarySnapshotOf(log);
}

/** Les ids des salaires DÉJÀ restaurés (une entrée `RESTORE_SALARY_PAYMENT` les nomme). */
export function restoredSalaryIds(logs: Pick<AuditLogEntry, 'action' | 'targetId'>[]): Set<string> {
  const restored = new Set<string>();
  for (const log of logs) {
    if (log.action === 'RESTORE_SALARY_PAYMENT' && log.targetId) restored.add(log.targetId);
  }
  return restored;
}

/**
 * L'instantané d'une suppression de salaire ENCORE annulable, ou `null`.
 *
 * `null` dans trois cas, et chacun se dit : l'entrée n'est pas une suppression de
 * salaire ; elle n'a pas d'instantané (on n'invente pas une ligne qu'on n'a pas
 * gardée) ; ou le salaire a déjà été restauré (une seconde restauration
 * écraserait un geste réel).
 */
export function restorableSalary(log: AuditLogEntry, logs: AuditLogEntry[]): ArchivedSalaryPayment | null {
  const archived = archivedSalaryOf(log);
  if (!archived) return null;
  return restoredSalaryIds(logs).has(archived.salaryPaymentId) ? null : archived;
}

/**
 * ─── Le rejeu des gestes de PAIE ─────────────────────────────────────────────
 *
 * Sorti de `src/lib/offlineReplay.ts` pour son budget de lignes (700,
 * `scripts/check-line-budget.mjs`) : la chaîne y portait 727 lignes, et la paie
 * est justement la famille qu'on pouvait détacher sans rien mélanger — elle
 * n'écrit qu'une table, `salary_payments`, sans solde à réconcilier ni cascade
 * à suivre (la même raison qui a fait sortir le rejeu des préférences
 * d'affichage dans `offlineReplaySettings.ts`).
 *
 * Deux gestes, et leurs deux phrases de journal, au même endroit :
 *   • `replayAddSalaryPayment` — l'enregistrement d'une paie saisi hors ligne ;
 *   • `replayDeleteSalaryPayment` — le RETRAIT d'une paie fautive.
 *
 * Ce qui est écrit est le chemin EN LIGNE, mot pour mot : une paie rejouée se lit
 * et s'ANNULE comme une paie faite en ligne, sinon la trace d'une correction
 * dépendrait du réseau qu'avait le poste ce jour-là. La suppression rejouée
 * emporte donc le MÊME instantané (`salaryUndo.ts`) que `deleteSalaryPayment`
 * (`dataOps/salaryCorrections.ts`) — sans lui, la ligne « salaire supprimé » du
 * journal ne porterait rien à réinsérer.
 */
import type { ReplayDb } from './offlineReplay';
import type { OfflinePayload } from './offlineQueue';
import type { SalaryPayment } from './domainTypes';
import type { LogAuditParams } from './auditLogger';
import { rowIdColumn } from './offlineReplay';
import { salarySnapshotMetadata } from './salaryUndo';

/** Le contenu d'un geste de retrait mis en file (voir `offlineQueue`). */
type DeleteSalaryPayload = Extract<OfflinePayload, { type: 'deleteSalaryPayment' }>['payload'];

/**
 * Écrit la paie qu'un poste avait enregistrée sans réseau.
 *
 * @returns `true` seulement quand la ligne est réellement en base.
 */
export async function replayAddSalaryPayment(
  db: ReplayDb,
  localId: string | undefined,
  payload: Omit<SalaryPayment, 'id'>,
): Promise<boolean> {
  const { error } = await db.from('salary_payments').insert({
    ...rowIdColumn(localId),
    staff_id: payload.staffId,
    amount: payload.amount,
    date: payload.date,
    academic_year: payload.academicYear || null,
  });
  return !error;
}

/**
 * Retire la paie fautive qu'un poste avait retirée sans réseau.
 *
 * `.select('id')` + le contrôle de longueur : la MÊME règle honnête que le chemin
 * en ligne — une suppression filtrée par la policy RLS (« Finance admins delete
 * salary_payments ») revient en 200 avec un corps VIDE, et la compter comme
 * réussie retirerait de la file un geste que la base n'a jamais reçu.
 *
 * @returns `true` seulement quand une ligne a réellement été supprimée.
 */
export async function replayDeleteSalaryPayment(
  db: ReplayDb,
  payload: DeleteSalaryPayload,
): Promise<boolean> {
  const { data, error } = await db.from('salary_payments').delete().eq('id', payload.id).select('id');
  return !error && Boolean(data) && data.length > 0;
}

/** L'entrée de journal d'une paie enregistrée hors ligne — la phrase du chemin en ligne. */
export function salaryAddAuditInfo(
  payload: Omit<SalaryPayment, 'id'>,
  tag: string,
): Omit<LogAuditParams, 'user'> {
  return {
    action: 'RECORD_SALARY_PAYMENT',
    targetType: 'salary_payment',
    targetId: null,
    details: `${payload.amount} FCFA (${payload.date})${tag}`,
  };
}

/**
 * L'entrée de journal d'un retrait rejoué — MÊME phrase et MÊME instantané que le
 * chemin en ligne : un geste rejoué se lit ET s'annule comme un geste fait en
 * ligne.
 */
export function salaryDeleteAuditInfo(
  payload: DeleteSalaryPayload,
  tag: string,
): Omit<LogAuditParams, 'user'> {
  return {
    action: 'DELETE_SALARY_PAYMENT',
    targetType: 'salary_payment',
    targetId: payload.id,
    details: `Salaire de ${payload.amount} FCFA (${payload.date}) supprimé — membre ${payload.staffName ?? payload.staffId}${tag}`,
    metadata: salarySnapshotMetadata({
      salaryPaymentId: payload.id,
      staffId: payload.staffId,
      staffName: payload.staffName,
      date: payload.date,
      amount: payload.amount,
      academicYear: payload.academicYear,
    }),
  };
}

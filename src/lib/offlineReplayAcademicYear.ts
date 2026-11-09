/**
 * ─── Le rejeu d'une plage de scolarité réglée sans réseau ────────────────────
 *
 * Même rôle que `offlineReplaySchoolName.ts`, pour une donnée qui n'est pas un
 * réglage d'écran : les bornes de l'année scolaire décident de ce qu'un reçu
 * réclame à une famille (« encore dû : juillet » ou pas). Une administration qui
 * les règle au guichet pendant une coupure doit donc les retrouver en base au
 * retour de la ligne, et pas seulement sur son poste.
 *
 * L'ÉCRITURE EST CELLE DU CHEMIN EN LIGNE, mot pour mot : `update` des deux
 * colonnes sur la ligne de l'année, suivie d'un `select` — une écriture retirée
 * par une politique revient en 200 avec un corps vide, et la compter comme
 * envoyée retirerait de la file un geste que la base n'a jamais reçu.
 *
 * Un mois hors 1..12 est REFUSÉ sans écrire : la file vit dans le `localStorage`
 * du poste, donc elle est modifiable à la main, et un rejeu plus permissif que le
 * formulaire écrirait une plage que la base rejette (`CHECK (1..12)`).
 */
import type { ReplayDb } from './offlineReplay';
import type { LogAuditParams } from './auditLogger';
import { isSchoolMonth } from './paymentMonths';

/** Le contenu d'un geste `setYearMonths` mis en file (voir offlineQueue). */
export interface QueuedYearMonths {
  year: string;
  startMonth: number;
  endMonth: number;
}

/**
 * Écrit la plage de scolarité qu'un poste a réglée sans réseau.
 *
 * @returns `true` seulement quand la ligne est réellement en base.
 */
export async function replayYearMonths(db: ReplayDb, payload: QueuedYearMonths): Promise<boolean> {
  const year = String(payload?.year ?? '').trim();
  const startMonth = Number(payload?.startMonth);
  const endMonth = Number(payload?.endMonth);
  if (!year || !isSchoolMonth(startMonth) || !isSchoolMonth(endMonth)) return false;
  const { data, error } = await db
    .from('academic_years')
    .update({ start_month: startMonth, end_month: endMonth })
    .eq('year_name', year)
    .select('year_name');
  return !error && Boolean(data) && data.length > 0;
}

/**
 * L'entrée de journal d'une plage rejouée — la MÊME forme que le chemin en ligne
 * (`saveAcademicYearMonths`) : `UPDATE_SETTING` sur la ligne de l'année, avec les
 * deux bornes réellement écrites. Un rejeu ne se lit donc pas autrement qu'un
 * geste fait avec la ligne.
 */
export function yearMonthsAuditInfo(
  payload: QueuedYearMonths,
  tag: string,
): Omit<LogAuditParams, 'user'> {
  const year = String(payload?.year ?? '').trim();
  return {
    action: 'UPDATE_SETTING',
    targetType: 'academic_years',
    targetId: year,
    details: `academic_years ${year} = ${payload?.startMonth}→${payload?.endMonth}${tag}`,
  };
}

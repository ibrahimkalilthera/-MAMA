/**
 * ─── Le rejeu d'un nom d'école déclaré sans réseau ──────────────────────────
 *
 * Même rôle que `offlineReplaySettings.ts`, pour une donnée qui n'est PAS un
 * réglage d'écran : le nom de l'école est un fait de l'ÉTABLISSEMENT, écrit une
 * fois pour tout le parc (`src/lib/schoolName.ts`, clé `school.name`), et il doit
 * pouvoir être déclaré sans réseau — sinon le geste est refusé à l'administration
 * au moment précis où elle le fait, c'est-à-dire exactement quand le poste n'a
 * pas de ligne.
 *
 * L'ÉCRITURE EST CELLE DU CHEMIN EN LIGNE, mot pour mot : la ligne est bâtie par
 * `schoolNameRow`, le même constructeur que `dataOps/settings.ts`. Deux formes
 * jumelles finiraient par diverger, et l'école lirait alors un autre nom que
 * celui qui a été écrit.
 *
 * Deux honnêtetés, les mêmes que le reste de la file :
 *   • `.select('key')` — une écriture retirée par une politique revient en 200
 *     avec un corps VIDE ; la compter comme envoyée retirerait de la file un nom
 *     que la base n'a jamais reçu ;
 *   • un nom HORS CONTRAT est refusé SANS écrire. La file vit dans le
 *     `localStorage` du poste, donc elle est modifiable à la main : un rejeu plus
 *     permissif que le chemin en ligne écrirait en base un nom que l'écran
 *     n'accepterait jamais.
 */
import type { ReplayDb } from './offlineReplay';
import type { LogAuditParams } from './auditLogger';
import { SCHOOL_NAME_KEY, normalizeSchoolName, schoolNameRow } from './schoolName';

/** Le contenu d'un geste `setSchoolName` mis en file (voir offlineQueue). */
export interface QueuedSchoolName {
  name: string;
}

/**
 * Écrit le nom d'école qu'un poste a déclaré sans réseau.
 *
 * @returns `true` seulement quand la ligne est réellement en base.
 */
export async function replaySchoolName(db: ReplayDb, payload: QueuedSchoolName): Promise<boolean> {
  const name = normalizeSchoolName(payload?.name);
  if (name === null) return false;
  const { data, error } = await db
    .from('app_settings')
    .upsert(schoolNameRow(name), { onConflict: 'key' })
    .select('key');
  return !error && Boolean(data) && data.length > 0;
}

/**
 * L'entrée de journal d'un nom d'école rejoué — la MÊME forme que le chemin en
 * ligne (`UPDATE_SETTING`, la clé et sa valeur, qui sont des identifiants
 * stockés et jamais de la prose à traduire).
 *
 * Le nom y est écrit NORMALISÉ : une entrée de journal doit dire ce qui est
 * parti en base, pas ce que le `localStorage` du poste portait.
 */
export function schoolNameAuditInfo(
  payload: QueuedSchoolName,
  tag: string,
): Omit<LogAuditParams, 'user'> {
  const name = normalizeSchoolName(payload?.name) ?? '';
  return {
    action: 'UPDATE_SETTING',
    targetType: 'app_settings',
    targetId: SCHOOL_NAME_KEY,
    details: `${SCHOOL_NAME_KEY} = ${name}${tag}`,
  };
}

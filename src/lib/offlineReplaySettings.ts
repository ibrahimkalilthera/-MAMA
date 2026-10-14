/**
 * ─── Le rejeu d'un réglage d'affichage ──────────────────────────────────────
 *
 * Sorti de `src/lib/offlineReplay.ts` pour deux raisons, et aucune n'est
 * cosmétique :
 *
 *   • son budget de lignes (700, `scripts/check-line-budget.mjs`) : le rejeu
 *     d'un réglage n'a rien à faire dans le même fichier que celui d'un
 *     encaissement, et l'ajouter là faisait franchir le budget d'une chaîne qui
 *     portait 694 lignes ;
 *   • c'est le SEUL geste de la file qui n'écrit pas une donnée d'école : il
 *     écrit une ligne d'`app_settings` (la copie qui voyage avec la sauvegarde),
 *     donc il n'a ni solde à réconcilier, ni identifiant à retrouver, ni
 *     cascade à suivre. Le laisser à part dit cette différence.
 *
 * L'ÉCRITURE EST CELLE DU CHEMIN EN LIGNE, mot pour mot : la ligne est bâtie par
 * `displayPreferenceRow`, le même constructeur que `dataOps/settings.ts`. Deux
 * formes jumelles finiraient par diverger, et c'est cette ligne-là qu'un poste
 * réinstallé adoptera — il verrait alors autre chose que ce que le poste auteur
 * avait à l'écran.
 */
import type { ReplayDb } from './offlineReplay';
import type { LogAuditParams } from './auditLogger';
import {
  DISPLAY_PREFERENCE_KEYS,
  displayPreferenceRow,
  isDisplayPreferenceValue,
} from './displayPreferences';
import type { DisplayPreferenceName } from './displayPreferences';

/** Le contenu d'un geste `setDisplayPreference` mis en file (voir offlineQueue). */
export interface QueuedDisplayPreference {
  name: DisplayPreferenceName;
  value: string;
}

/**
 * Écrit la préférence qu'un poste avait changée sans réseau.
 *
 * `.select('key')` : une écriture retirée par une politique revient en 200 avec
 * un corps VIDE, et la compter comme envoyée retirerait de la file un réglage que
 * la base n'a jamais reçu — la même honnêteté que les autres rejeux du dépôt.
 *
 * @returns `true` seulement quand la ligne est réellement en base.
 */
export async function replayDisplayPreference(
  db: ReplayDb,
  payload: QueuedDisplayPreference,
): Promise<boolean> {
  const key = DISPLAY_PREFERENCE_KEYS[payload.name];
  if (!key) return false;
  // Une valeur hors contrat n'est pas écrite, MÊME si elle a été mise en file :
  // la file vit dans le `localStorage` du poste, donc elle est modifiable à la
  // main, et la contrainte de la base ne vérifie que le TYPE (une chaîne). La
  // même valeur est refusée par le chemin en ligne — un rejeu plus permissif
  // publierait en base un thème qui n'existe pas, et c'est la copie d'école que
  // tous les postes neufs adopteraient.
  if (!isDisplayPreferenceValue(payload.name, payload.value)) return false;
  const { data, error } = await db
    .from('app_settings')
    .upsert(displayPreferenceRow(key, payload.value), { onConflict: 'key' })
    .select('key');
  return !error && Boolean(data) && data.length > 0;
}

/**
 * L'entrée de journal d'un réglage rejoué — la MÊME forme que le chemin en ligne
 * (`UPDATE_SETTING`, clé et valeur, qui sont des identifiants stockés et jamais
 * de la prose à traduire).
 */
export function displayPreferenceAuditInfo(
  payload: QueuedDisplayPreference,
  tag: string,
): Omit<LogAuditParams, 'user'> {
  const key = DISPLAY_PREFERENCE_KEYS[payload.name];
  return {
    action: 'UPDATE_SETTING',
    targetType: 'app_settings',
    targetId: key,
    details: `${key} = ${payload.value}${tag}`,
  };
}

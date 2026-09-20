/**
 * Les années scolaires de la base partagée.
 *
 * Deux responsabilités, et la seconde est ce qui fait que l'année **avance toute
 * seule** :
 *   • LIRE la liste (l'app listait une copie en dur, donc son sélecteur ne
 *     proposait aucune des années où les données vivaient) ;
 *   • ENTRETENIR la ligne de l'année en cours — la créer si elle manque, et
 *     déplacer `is_current` dessus. Sur un 1er septembre, la première personne qui
 *     ouvre l'app crée ainsi l'année de la rentrée, sans qu'aucun geste manuel
 *     soit nécessaire.
 *
 * L'entretien est **best effort et silencieux, à une exception près** : il écrit
 * dans `academic_years`, que seule une policy `is_admin()` autorise (`admin`,
 * `dev`). L'appelant ne le tente donc que pour ces rôles — sinon ce serait un 403
 * par session, c'est-à-dire du bruit qui apprend à ignorer les erreurs.
 *
 * HORS LIGNE, les deux responsabilités continuent d'être tenues : la liste est
 * relue dans un cache local du poste (le sélecteur n'est plus réduit au jeu de
 * repli), et la déclaration de l'année part dans la file au lieu d'être
 * abandonnée — un poste qui démarre sa rentrée sans réseau ne peut pas décider
 * seul, pour tout le parc, quelle année est courante.
 */
import { supabase } from '../supabaseClient';
import type { AcademicYearRow } from '../academicYears';
import { currentYearName } from '../academicYears';
import { enqueueOfflineAction, isActionQueued } from '../offlineQueue';
import { isStationOffline } from '../networkUtils';

/** Les années lues sur ce poste, pour que le sélecteur survive à une coupure. */
const YEARS_CACHE_KEY = 'mama_thera_academic_years_cache_v1';

function readCachedAcademicYears(): AcademicYearRow[] | null {
  if (typeof localStorage === 'undefined') return null;
  try {
    const raw = localStorage.getItem(YEARS_CACHE_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return null;
    const rows = parsed
      .map((row) => row as AcademicYearRow)
      .filter((row) => Boolean(row && typeof row.year_name === 'string' && row.year_name));
    return rows.length > 0 ? rows : null;
  } catch {
    return null;
  }
}

function writeCachedAcademicYears(rows: AcademicYearRow[]): void {
  try {
    localStorage.setItem(YEARS_CACHE_KEY, JSON.stringify(rows));
  } catch {
    /* quota, mode privé : la base reste la source */
  }
}

/**
 * Lit les années, ou `null` si la base est injoignable.
 *
 * `null` et non `[]` : un échec réseau n'est pas « l'école n'a aucune année ».
 * L'appelant garde alors sa liste de repli au lieu d'afficher un sélecteur vide.
 */
export async function fetchAcademicYears(): Promise<AcademicYearRow[] | null> {
  const { data, error } = await supabase.from('academic_years').select('year_name, is_current').order('year_name');
  if (error || !data) return readCachedAcademicYears();
  const rows = data.map((row) => ({ year_name: row.year_name, is_current: row.is_current }));
  // Écrit APRÈS un vrai chargement : le cache ne peut donc jamais contenir autre
  // chose que ce que la base a réellement répondu.
  writeCachedAcademicYears(rows);
  return rows;
}

/**
 * Fait de `year` l'année courante de la base : elle existait déjà, ou elle est
 * créée.
 *
 * Relit la table elle-même plutôt que de faire confiance à une liste lue
 * ailleurs : entre la lecture et l'entretien il peut s'être passé une session, et
 * une décision prise sur une liste périmée écraserait un `is_current` légitime.
 *
 * @returns `true` si la base a accepté, `false` sinon (droits, réseau) — le
 *   refus n'est pas une panne de l'app : l'année de travail du poste reste juste,
 *   c'est seulement la déclaration partagée qui attend un administrateur.
 */
export async function keepAcademicYearCurrent(year: string): Promise<boolean> {
  if (!year) return false;
  // Sans ligne, la déclaration ne peut pas être décidée par ce poste : elle est
  // mise en file (une seule fois par année — un poste redémarré dix fois hors
  // ligne ne doit pas empiler dix fois la même déclaration).
  if (isStationOffline()) {
    if (isActionQueued('setCurrentYear')) return true;
    enqueueOfflineAction('setCurrentYear', { year });
    return true;
  }
  const existing = await fetchAcademicYears();
  if (!existing) return false;

  const present = existing.some((row) => row.year_name === year);
  if (!present) {
    const { error } = await supabase.from('academic_years').insert({ year_name: year, is_current: true });
    if (error) return false;
    // Les autres années ne sont pas désignées par ce chemin : l'insertion a posé
    // le drapeau sur la nouvelle, et l'ancienne doit le perdre.
  }

  const declared = currentYearName(existing);
  const others = existing.filter((row) => row.year_name !== year && row.is_current);
  for (const row of others) {
    const { error } = await supabase.from('academic_years').update({ is_current: false }).eq('year_name', row.year_name);
    if (error) return false;
  }
  if (!present || declared !== year) {
    const { error } = await supabase.from('academic_years').update({ is_current: true }).eq('year_name', year);
    if (error) return false;
  }
  return true;
}

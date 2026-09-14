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
 */
import { supabase } from '../supabaseClient';
import type { AcademicYearRow } from '../academicYears';
import { currentYearName } from '../academicYears';

/**
 * Lit les années, ou `null` si la base est injoignable.
 *
 * `null` et non `[]` : un échec réseau n'est pas « l'école n'a aucune année ».
 * L'appelant garde alors sa liste de repli au lieu d'afficher un sélecteur vide.
 */
export async function fetchAcademicYears(): Promise<AcademicYearRow[] | null> {
  const { data, error } = await supabase.from('academic_years').select('year_name, is_current').order('year_name');
  if (error || !data) return null;
  return data.map((row) => ({ year_name: row.year_name, is_current: row.is_current }));
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

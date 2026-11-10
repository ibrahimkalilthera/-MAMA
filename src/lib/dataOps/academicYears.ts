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
import { isSchoolMonth } from '../paymentMonths';
import { logAuditEvent } from '../auditLogger';

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
  const { data, error } = await supabase
    .from('academic_years')
    .select('year_name, is_current, start_month, end_month, selected_at')
    .order('year_name');
  if (error || !data) return readCachedAcademicYears();
  const rows = data.map((row) => ({
    year_name: row.year_name,
    is_current: row.is_current,
    start_month: row.start_month,
    end_month: row.end_month,
    // L'instant de la DÉCISION partagée, s'il y en a une : c'est lui qui fait
    // qu'un poste adopte l'année publiée par l'administration (voir
    // `pickWorkingYear`). Il voyage avec le cache hors ligne, comme le reste.
    selected_at: row.selected_at ?? null,
  }));
  // Écrit APRÈS un vrai chargement : le cache ne peut donc jamais contenir autre
  // chose que ce que la base a réellement répondu.
  writeCachedAcademicYears(rows);
  return rows;
}

/**
 * Ce qu'un enregistrement de la plage de mois peut rendre — jamais un booléen.
 * « enregistré », « mis en file hors ligne » et « refusé » ne veulent pas dire la
 * même chose pour l'école : le premier a changé les reçus de tout le parc, le
 * second attend la ligne, le troisième n'a rien changé.
 */
export type AcademicYearMonthsSaveResult = 'saved' | 'queued' | 'refused';

/**
 * Enregistre la plage de scolarité d'une année : son premier et son dernier mois.
 *
 * Le geste appartient à l'ADMINISTRATION, et la base le dit déjà (la politique
 * d'écriture d'`academic_years` est `is_admin()`), donc aucune politique
 * nouvelle n'est créée pour lui — comme le nom de l'école.
 *
 * Trois refus, et chacun évite d'écrire une plage qui n'existe pas : un mois hors
 * 1..12, un mois vide, une année vide. La plage aberrante (fin avant début dans
 * le même cycle) n'est PAS refusée : une année d'octobre à juin est normale, et
 * `academicYearMonths` la déroule correctement.
 *
 * `.select('year_name')` : une écriture retirée par une politique revient en 200
 * avec un corps VIDE. La compter comme enregistrée ferait croire à l'école que
 * toutes les familles ont été relues sur une plage que la base n'a jamais reçue.
 */
export async function saveAcademicYearMonths(
  year: string,
  startMonth: number,
  endMonth: number,
): Promise<AcademicYearMonthsSaveResult> {
  const name = String(year ?? '').trim();
  if (!name || !isSchoolMonth(startMonth) || !isSchoolMonth(endMonth)) return 'refused';

  if (isStationOffline()) {
    try {
      enqueueOfflineAction('setYearMonths', { year: name, startMonth, endMonth });
    } catch (err) {
      console.error('Plage de scolarité non mise en file :', (err as Error)?.message ?? err);
      return 'refused';
    }
    return 'queued';
  }

  const { data, error } = await supabase
    .from('academic_years')
    .update({ start_month: startMonth, end_month: endMonth })
    .eq('year_name', name)
    .select('year_name');
  if (error || !data || data.length === 0) {
    console.warn('Plage de scolarité non enregistrée :', error?.message ?? 'aucune ligne écrite');
    return 'refused';
  }
  void logAuditEvent({
    action: 'UPDATE_SETTING',
    targetType: 'academic_years',
    targetId: name,
    details: `academic_years ${name} = ${startMonth}→${endMonth}`,
  });
  return 'saved';
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
    // Un refus de la file (quota atteint) rend `false` : la déclaration d'année
    // n'est pas retenue, et le redémarrage suivant ne la trouvera pas dans la
    // file — le dire vaut mieux que de laisser croire qu'elle y est.
    try {
      enqueueOfflineAction('setCurrentYear', { year });
    } catch (err) {
      console.error('Année scolaire non mise en file :', (err as Error)?.message ?? err);
      return false;
    }
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

/**
 * PUBLIE l'année de travail pour TOUT LE PARC — le geste d'un admin/dev.
 *
 * La différence avec `keepAcademicYearCurrent` n'est pas technique, elle est de
 * nature : celui-ci ENTRETIENT la déclaration (le 1er septembre, tout seul),
 * celui-là DÉCIDE. Et une décision se date (`selected_at`), sinon les postes ne
 * peuvent pas distinguer « l'administration a changé l'année » de « un poste a
 * ouvert une archive hier ». `pickWorkingYear` ne suit une publication que si
 * elle est plus récente que le choix du poste : la dernière décision gagne.
 *
 * Le drapeau est déplacé sur une seule ligne (l'ancienne le perd), et la ligne
 * est CRÉÉE si l'année n'existe pas encore — un 1er septembre, personne ne l'a
 * forcément créée. `.select('year_name')` : une écriture retirée par la policy
 * revient en 200 avec un corps vide, et la compter comme publiée ferait croire
 * à l'école que tout le parc a suivi.
 *
 * Hors ligne, la décision part dans la file AVEC son drapeau `publish` : le
 * rejeu l'écrit telle quelle, datée au moment du rejeu (voir
 * `offlineReplay.ts`). Un refus de la file rend `false` — l'écran ne dit pas
 * « publié pour tous » quand rien n'est retenu.
 */
export async function publishWorkingYear(year: string): Promise<boolean> {
  const name = String(year ?? '').trim();
  if (!name) return false;
  if (isStationOffline()) {
    if (isActionQueued('setCurrentYear')) return true;
    try {
      enqueueOfflineAction('setCurrentYear', { year: name, publish: true });
    } catch (err) {
      console.error('Année scolaire non publiée (file refusée) :', (err as Error)?.message ?? err);
      return false;
    }
    return true;
  }
  const existing = await fetchAcademicYears();
  if (!existing) return false;

  const selectedAt = new Date().toISOString();
  const present = existing.some((row) => row.year_name === name);
  if (!present) {
    const { error } = await supabase
      .from('academic_years')
      .insert({ year_name: name, is_current: true, selected_at: selectedAt });
    if (error) return false;
  }

  for (const row of existing.filter((candidate) => candidate.year_name !== name && candidate.is_current)) {
    const { error } = await supabase
      .from('academic_years')
      .update({ is_current: false })
      .eq('year_name', row.year_name);
    if (error) return false;
  }

  const { data, error } = await supabase
    .from('academic_years')
    .update({ is_current: true, selected_at: selectedAt })
    .eq('year_name', name)
    .select('year_name');
  if (error || !data || data.length === 0) return false;

  void logAuditEvent({
    action: 'UPDATE_SETTING',
    targetType: 'academic_years',
    targetId: name,
    details: `academic_years ${name} publiée comme année de travail de tous les postes`,
  });
  return true;
}

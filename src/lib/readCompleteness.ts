/**
 * ─── Une lecture TRONQUÉE doit se voir, pas se deviner ──────────────────────
 *
 * PostgREST rend au plus 1 000 lignes par requête. Ce n'est pas une erreur : la
 * réponse est un 200, le corps est bien formé, et rien dans le JSON ne dit
 * « il en manque ». Une lecture non paginée de `payments` s'arrête donc au
 * millième reçu — et comme la requête est triée par date CROISSANTE, ce sont les
 * reçus les plus RÉCENTS qui disparaissent. Le solde de l'école est alors faux
 * d'un montant que personne ne voit, et aucun écran ne le dit.
 *
 * Ce module ne lit rien et n'appelle personne : il nomme le fait. C'est la
 * moitié qui manquait à la pagination — un `range()` qui ne dit pas s'il a tout
 * lu laisse exactement le même trou, en plus discret.
 *
 * Trois règles, et elles sont volontairement prudentes :
 *
 *   • Un total CONNU et supérieur au chargé est une troncature certaine.
 *   • Un total INCONNU n'est pas une preuve de complétude : à la taille d'une
 *     page, on ne peut pas distinguer « exactement 1 000 » de « 1 412 ». La
 *     lecture est alors SUSPECTE, et se nomme comme telle — jamais comme un
 *     succès.
 *   • En dessous d'une page pleine, sans total, il n'y a rien à signaler : la
 *     requête a rendu tout ce qu'elle avait, et le plafond n'a pas été atteint.
 */

/** Le plafond rendu par PostgREST, nommé une fois pour tout le dépôt. */
export const POSTGREST_PAGE_SIZE = 1000;

/** Une lecture incomplète : la table, ce qui a été lu, et le total si on le sait. */
export interface ReadShortfall {
  table: string;
  loaded: number;
  total: number | null;
}

/**
 * Le total connu dépasse-t-il ce qui a été chargé ?
 *
 * `total` nul veut dire « on ne sait pas » — pas « c'est complet ». C'est
 * `shortfallOf` qui tranche ce cas, parce qu'il peut aussi regarder la taille
 * de la page.
 */
export function isTruncated(loaded: number, total: number | null): boolean {
  return total !== null && total > loaded;
}

/**
 * Le manque à signaler, ou `null` quand la lecture est complète.
 *
 * Un total nul ET une page pleine reste un manque : on ne PEUT pas affirmer que
 * la suite n'existe pas, et l'affirmer serait exactement le mensonge que ce
 * module existe pour empêcher.
 */
export function shortfallOf(table: string, loaded: number, total: number | null): ReadShortfall | null {
  if (total !== null) return total > loaded ? { table, loaded, total } : null;
  return loaded >= POSTGREST_PAGE_SIZE ? { table, loaded, total: null } : null;
}

/** Groupe les milliers avec une espace simple — stable hors locale du poste. */
const grouped = (value: number): string => String(value).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');

/**
 * La phrase que l'écran peut afficher telle quelle.
 *
 * « récent » n'est écrit que si l'appelant DIT que la lecture est triée par date
 * croissante : sur une table triée autrement (ou pas triée), nommer un côté
 * serait un second mensonge. Par défaut, la phrase reste neutre.
 */
export function formatShortfall(
  shortfall: ReadShortfall,
  options: { readAscendingByDate?: boolean } = {},
): string {
  const loaded = grouped(shortfall.loaded);
  if (shortfall.total === null) {
    return `${shortfall.table} : au moins ${loaded} lignes lues, le total est inconnu — la suite n’a pas été demandée`;
  }
  const total = grouped(shortfall.total);
  const tail = options.readAscendingByDate
    ? 'les lignes les plus récentes manquent'
    : 'la suite n’a pas été lue';
  return `${shortfall.table} : chargé ${loaded} sur ${total} — ${tail}`;
}

/**
 * Les décalages à demander pour couvrir `total` lignes.
 *
 * `total` nul ne permet PAS de planifier : on rend la seule première page, et
 * c'est la réponse (son nombre de lignes) qui décidera de la suite. Inventer un
 * plafond ici reviendrait à relire la même page en espérant autre chose.
 *
 * Une page n'est jamais demandée AU-DELÀ du total : `total = 1000` rend `[0]`,
 * pas `[0, 1000]` — la seconde serait vide et coûterait un aller-retour pour
 * rien.
 */
export function planPages(total: number | null, pageSize: number = POSTGREST_PAGE_SIZE): number[] {
  if (pageSize <= 0) throw new RangeError(`planPages : taille de page invalide (${pageSize})`);
  if (total === null || total <= pageSize) return [0];
  const offsets: number[] = [];
  for (let offset = 0; offset < total; offset += pageSize) offsets.push(offset);
  return offsets;
}

/** Recoller les pages DANS L'ORDRE demandé (l'ordre des pages, pas un tri). */
export function mergePages<T>(pages: T[][]): T[] {
  return pages.flat();
}

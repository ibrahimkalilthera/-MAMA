/**
 * ─── LIRE TOUTES LES LIGNES, PAS LES 1 000 PREMIÈRES ────────────────────────
 *
 * PostgREST rend AU PLUS 1 000 lignes par requête, et il ne le dit pas : une
 * réponse tronquée a la même forme qu'une réponse complète. Le chargement de
 * l'école demandait donc chaque table en UNE requête — le jour où `payments`
 * franchit 1 000 lignes (une année scolaire ordinaire y suffit), les reçus les
 * plus RÉCENTS disparaissent de l'écran, des soldes et des PDF, et personne ne
 * peut le voir : la table s'affiche, simplement elle est incomplète.
 *
 * Ce module lit par PAGES et rend le total que la base a déclaré (`count`), pour
 * que la différence puisse être nommée (`formatShortfall`, voir
 * `readCompleteness.ts`). Il ne devine jamais : un total inconnu ne devient pas
 * « complet », et un plafond de pages atteint devient un manque dit, pas une
 * boucle infinie.
 *
 * Le client Supabase est injecté (une fonction `fetchPage`) : ce module ne
 * connaît ni Supabase ni le réseau, et un faux lecteur suffit à le prouver.
 */
import type { ReadShortfall } from './readCompleteness';
import { POSTGREST_PAGE_SIZE, shortfallOf } from './readCompleteness';

/** Le sous-ensemble d'une réponse PostgREST dont ce lecteur a besoin. */
export interface PageResult<T> {
  data: T[] | null;
  count: number | null;
  error: { message: string } | null;
}

export interface PagedReadResult<T> {
  rows: T[];
  /** Le total déclaré par la base, ou `null` quand elle ne l'a pas compté. */
  total: number | null;
  /** Non nul quand la lecture n'a pas rendu tout ce que la base déclarait. */
  shortfall: ReadShortfall | null;
  /** Combien de requêtes ont été nécessaires (mesure lisible dans un rapport). */
  pages: number;
}

/**
 * Un plafond de pages, NOMMÉ.
 *
 * 50 pages = 50 000 lignes. Au-delà, ce n'est plus un chargement d'école mais
 * une requête mal bornée : continuer remplirait la mémoire du poste sans que
 * personne l'ait demandé. Le plafond atteint rend un MANQUE (total inconnu),
 * jamais un silence.
 */
export const MAX_READ_PAGES = 50;

/**
 * Lit toutes les pages d'une table.
 *
 * `fetchPage(from, to)` doit demander `count: 'exact'` : sans lui, la base ne
 * dit pas combien de lignes existent, et une page pleine est indiscernable d'une
 * dernière page pleine (le lecteur s'arrête alors sur le compte rendu, et le
 * manque reste `null` — une absence de preuve n'est pas une preuve d'absence,
 * mais elle est visible dans `total`).
 *
 * Une erreur de page est RELANCÉE : c'est l'appelant qui décide de réessayer
 * (le chargement de l'école a déjà sa politique de reprise), et une lecture
 * partielle silencieuse serait exactement le défaut que ce module répare.
 */
export async function readAllPages<T>(
  table: string,
  fetchPage: (from: number, to: number) => PromiseLike<PageResult<T>>,
  opts: { pageSize?: number; maxPages?: number } = {},
): Promise<PagedReadResult<T>> {
  const pageSize = opts.pageSize ?? POSTGREST_PAGE_SIZE;
  const maxPages = opts.maxPages ?? MAX_READ_PAGES;
  if (!Number.isInteger(pageSize) || pageSize <= 0) {
    throw new Error(`Taille de page invalide pour « ${table} » : ${pageSize}`);
  }

  const rows: T[] = [];
  let total: number | null = null;
  let page = 0;
  let lastPageWasFull = false;

  while (page < maxPages) {
    const from = page * pageSize;
    const result = await fetchPage(from, from + pageSize - 1);
    if (result.error) {
      throw new Error(`Lecture de « ${table} » (page ${page + 1}) : ${result.error.message}`);
    }
    const batch = result.data ?? [];
    if (typeof result.count === 'number') total = result.count;
    rows.push(...batch);
    page += 1;
    lastPageWasFull = batch.length === pageSize;
    // Deux raisons de s'arrêter, et elles ne se confondent pas : la page n'était
    // pas pleine (donc la table est finie), ou le total déclaré est atteint.
    if (!lastPageWasFull) break;
    if (total !== null && rows.length >= total) break;
    if (total !== null && rows.length > total) break;
  }

  // Le plafond atteint avec une dernière page PLEINE : la table continue, et
  // on ne prétend pas l'avoir lue. Le total reste celui que la base a déclaré
  // (ou `null`), et `shortfallOf` nomme les deux nombres disponibles.
  //
  // Hors plafond, on ne signale QUE ce que le total prouve : une table de
  // exactement 1 000 lignes rend une page pleine puis une page vide, et
  // `shortfallOf` la déclarerait suspecte à tort si on l'appelait sans
  // condition. Une absence de preuve ne doit pas fabriquer une alerte.
  const plafondAtteint = page >= maxPages && lastPageWasFull;
  const shortfall = plafondAtteint
    ? shortfallOf(table, rows.length, total)
    : (total !== null && total > rows.length
      ? { table, loaded: rows.length, total }
      : null);

  return { rows, total, shortfall, pages: page };
}

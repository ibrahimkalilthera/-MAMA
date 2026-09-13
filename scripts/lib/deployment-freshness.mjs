/**
 * scripts/lib/deployment-freshness.mjs — la prod sert-elle le build de CE
 * commit, ou encore celui d'avant ?
 *
 * WHY THIS EXISTS
 * ---------------
 * Les E2E post-déploiement attendaient un `HTTP 200` de la racine avant de
 * commencer. Un 200 est satisfait par le déploiement PRÉCÉDENT : pendant la
 * propagation d'un alias, un cache de bord sert encore l'ancien HTML. Le test
 * jugeait alors le build d'un autre commit — et le pixel-check, qui compare des
 * pixels, produisait un ROUGE qui accusait l'application pour une page qu'on
 * n'avait même pas publiée. Un rouge pareil coûte plus qu'un rouge absent : il
 * envoie chercher une régression de rendu là où il n'y a que quelques secondes
 * de propagation.
 *
 * Le build porte donc son identité (`scripts/lib/build-stamp.mjs`, balise
 * `build-sha`), et ce module dit ce que la page SERVIE en fait. Six états, dont
 * quatre sont des raisons de RÉESSAYER et non des verdicts :
 *
 *   • `unreachable`   — aucune réponse (DNS, TLS, délai) : on réessaie ;
 *   • `serving-error` — 5xx de la plateforme : on réessaie, ça ne juge pas l'app ;
 *   • `not-live`      — un statut qui n'est pas 200 (le 404 « deployment not
 *     found » mesuré sur un domaine mort) : on réessaie, puis on abandonne en
 *     le NOMMANT ;
 *   • `stale`         — 200, une identité présente, et ce n'est pas la nôtre :
 *     la propagation est en cours. C'est LE cas qui rendait un rouge menteur :
 *     au bout du délai, le verdict est « la prod sert encore <sha> », c'est-à-dire
 *     un problème de PUBLICATION, jamais de rendu ;
 *   • `unknown`       — 200, aucune identité : le build n'a pas d'estampille
 *     (construit hors CI, ou antérieur à l'estampille). On ne peut PAS conclure
 *     — et « invérifiable » n'est pas « vert » dans ce dépôt : l'état est nommé,
 *     jamais confondu avec `fresh` ;
 *   • `fresh`         — 200 et l'identité est celle attendue : le seul feu vert.
 *
 * PUR : il reçoit un statut et un HTML, il rend un état et des phrases. Donc
 * chaque branche se prouve sans publier de site.
 */

/** Les états, nommés pour que rien ne se confonde avec un feu vert. */
export const FRESHNESS = {
  FRESH: 'fresh',
  STALE: 'stale',
  UNKNOWN: 'unknown',
  NOT_LIVE: 'not-live',
  SERVING_ERROR: 'serving-error',
  UNREACHABLE: 'unreachable',
};

/** Les états qui valent un nouvel essai : la propagation et les hoquets passent. */
export const RETRYABLE = [FRESHNESS.STALE, FRESHNESS.UNKNOWN, FRESHNESS.NOT_LIVE, FRESHNESS.SERVING_ERROR, FRESHNESS.UNREACHABLE];

/** Un sha de commit, tel que `build-stamp.mjs` en écrit un. */
const SHA_LIKE = /^[0-9a-f]{7,40}$/i;

/**
 * L'identité que la page servie déclare, ou `null` si elle n'en déclare aucune.
 *
 * @param {string} html
 * @returns {string|null}
 */
export function servedBuildSha(html) {
  const m = String(html ?? '').match(/<meta[^>]*name=["']build-sha["'][^>]*content=["']([^"']+)["']/i)
    ?? String(html ?? '').match(/<meta[^>]*content=["']([^"']+)["'][^>]*name=["']build-sha["']/i);
  const sha = (m?.[1] ?? '').trim();
  return SHA_LIKE.test(sha) ? sha.toLowerCase() : null;
}

/**
 * @param {{ expectedSha?: string, url?: string, status?: number|null, html?: string, error?: string|null }} input
 * @returns {{ state: string, served: string|null, retryable: boolean, detail: string, warning: string|null }}
 */
export function freshnessVerdict({ expectedSha = '', url = '', status = null, html = '', error = null } = {}) {
  const wanted = String(expectedSha ?? '').trim().toLowerCase();

  if (error) {
    return {
      state: FRESHNESS.UNREACHABLE,
      served: null,
      retryable: true,
      detail: `${url} n'a pas répondu (${error}) — DNS, TLS ou délai`,
      warning: null,
    };
  }
  if (status === null) {
    return {
      state: FRESHNESS.UNREACHABLE,
      served: null,
      retryable: true,
      detail: `${url} n'a pas pu être interrogée`,
      warning: null,
    };
  }
  if (status >= 500) {
    return {
      state: FRESHNESS.SERVING_ERROR,
      served: null,
      retryable: true,
      detail: `${url} répond HTTP ${status} — la plateforme hoquette, ce n'est pas un verdict sur l'application`,
      warning: null,
    };
  }
  if (status !== 200) {
    return {
      state: FRESHNESS.NOT_LIVE,
      served: null,
      retryable: true,
      detail: `${url} répond HTTP ${status} — le déploiement n'est pas (encore) servi`,
      warning: null,
    };
  }

  const served = servedBuildSha(html);
  if (!SHA_LIKE.test(wanted)) {
    return {
      state: FRESHNESS.UNKNOWN,
      served,
      retryable: false,
      detail: `${url} répond 200${served ? ` et déclare le build ${served.slice(0, 7)}` : ''} — aucun commit attendu n'a été fourni, donc la fraîcheur n'est pas jugée`,
      warning: 'aucun commit attendu (--sha) : la prod répond, mais rien ne dit qu’elle sert le build qu’on teste',
    };
  }
  if (!served) {
    return {
      state: FRESHNESS.UNKNOWN,
      served: null,
      retryable: true,
      detail: `${url} répond 200 SANS identité de build — impossible de dire si c'est le build de ${wanted.slice(0, 7)} ou le précédent`,
      warning: 'le build servi ne porte pas d’identité (construit hors CI, ou antérieur à l’estampille) — la fraîcheur reste invérifiable',
    };
  }
  if (served !== wanted) {
    return {
      state: FRESHNESS.STALE,
      served,
      retryable: true,
      detail: `${url} sert encore le build ${served.slice(0, 7)}, pas ${wanted.slice(0, 7)} — propagation en cours`,
      warning: null,
    };
  }
  return {
    state: FRESHNESS.FRESH,
    served,
    retryable: false,
    detail: `${url} sert bien le build ${wanted.slice(0, 7)} de ce commit`,
    warning: null,
  };
}

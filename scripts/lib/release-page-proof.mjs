/**
 * ─── Quand une adresse machine est refusée, la page de version se prouve autrement ─
 *
 * MESURÉ le 2026-09-27, en lisant enfin les journaux de run (ils demandent un
 * jeton) : `https://github.com/<dépôt>/releases/latest` répond **200** depuis un
 * poste ordinaire et **404** depuis un runner GitHub Actions. Cinq runs de suite,
 * la même réponse, pendant que SUR LE MÊME RUN `api.github.com` (la liste des
 * versions) et `raw.githubusercontent.com` (le frein d'urgence) répondaient 200.
 * Ce n'est donc pas « le lien est mort à jamais » : c'est « ce client-ci, depuis
 * cette adresse-là, n'a pas le droit de lire cette page ».
 *
 * La veille ne pouvait pas trancher, et elle avait raison de ne pas trancher : un
 * 404 est le cas mesuré d'un dépôt supprimé, renommé ou rendu privé, donc
 * l'ignorer aurait rendu aveugle le seul contrôle qui protège la porte de sortie
 * d'un poste PORTABLE. Mais laisser un contrôle rouge en permanence est l'autre
 * faute : un contrôle toujours allumé ne se lit plus.
 *
 * Ce module pose donc la seconde question : **une version PUBLIÉE existe-t-elle
 * pour ce dépôt ?** — par l'API, avec le jeton que le job possède déjà.
 *
 * Trois règles, et chacune protège une propriété différente :
 *
 * **1. Le jeton ne va QU'À api.github.com.** Il est lu dans l'environnement et
 * posé en en-tête d'un seul appel ; il n'est jamais journalisé, jamais renvoyé, et
 * jamais transmis à un hôte tiers — ce script voisine un lien vers WhatsApp, et une
 * fuite d'en-tête serait une fuite de jeton.
 *
 * **2. Une version BROUILLON ne compte pas.** Une release en brouillon n'a pas de
 * page publique : la nommer « prouvée » ferait passer un vert pour un lien
 * qu'aucun utilisateur ne pourrait atteindre — précisément le faux vert que ce
 * dépôt pourchasse.
 *
 * **3. Ce que ça prouve est plus étroit que la lecture anonyme, et le verdict le
 * dit.** L'API prouve qu'une page de version a une CIBLE ; elle ne prouve pas
 * qu'un navigateur verrait la page. Le verdict rend donc un AVERTISSEMENT nommé,
 * jamais un silence : un repli qui se tairait serait un vert qu'on ne saurait pas
 * expliquer.
 */
import { RELEASE_TAG_PAGE } from './embedded-links.mjs';

/** Le temps maximal d'une lecture — le même que la lecture principale. */
const TIMEOUT_MS = 20000;

/** Une adresse de page de versions dont on sait extraire `propriétaire/dépôt`. */
const GITHUB_RELEASES_URL = /^https:\/\/github\.com\/([^/]+)\/([^/]+)\/releases(?:\/(?:latest|tag\/[^/?#]+))?\/?$/;

/**
 * Ce que l'API du dépôt répond à « quelle version est publiée sous la tête ? ».
 *
 * @param {string} url l'adresse de la page refusée (celle du poste)
 * @param {string|null} [token] le jeton du job ; `null` veut dire « aucun », et
 *   c'est un ARGUMENT plutôt qu'un secret global, pour qu'un cas de test puisse
 *   prouver le refus sans jeton sans dépendre de l'environnement qui l'exécute.
 * @returns {Promise<{ ok: boolean, tag?: string, error?: string }>} un verdict
 *   nommé : `ok` avec le tag publié, ou `ok:false` avec LA raison (pas de jeton,
 *   adresse non reconnue, statut de l'API, brouillon, panne de transport).
 */
export async function releaseApiProof(url, token = process.env.GITHUB_TOKEN ?? null) {
  if (!token) {
    return { ok: false, error: 'aucun jeton dans l’environnement (GITHUB_TOKEN absent)' };
  }
  const matched = GITHUB_RELEASES_URL.exec(String(url ?? ''));
  if (!matched) {
    // Une adresse qu'on ne sait pas découper ne se devine pas : on refuse de
    // conclure plutôt que d'interroger le mauvais dépôt.
    return { ok: false, error: `adresse de page de versions non reconnue (${url})` };
  }
  // Le tag d'une page `/releases/tag/<tag>` est déjà la réponse : l'API n'ajoute
  // rien, et l'appel n'est pas payé.
  const direct = /\/releases\/tag\/([^/?#]+)/.exec(String(url ?? ''));
  if (direct && RELEASE_TAG_PAGE.test(String(url))) return { ok: true, tag: decodeURIComponent(direct[1]) };

  const [, owner, repo] = matched;
  try {
    const res = await fetch(`https://api.github.com/repos/${owner}/${repo}/releases/latest`, {
      headers: {
        Accept: 'application/vnd.github+json',
        // Le SEUL hôte qui reçoit ce jeton (règle 1).
        Authorization: `Bearer ${token}`,
        'User-Agent': 'embedded-links-check',
        'X-GitHub-Api-Version': '2022-11-28',
      },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (res.status !== 200) return { ok: false, error: `l’API a répondu HTTP ${res.status}` };
    const json = await res.json();
    const tag = String(json?.tag_name ?? '').trim();
    if (!tag) return { ok: false, error: 'l’API ne nomme aucune version publiée' };
    if (json?.draft === true) {
      return { ok: false, error: `la version ${tag} est un BROUILLON — elle n’a pas de page publique` };
    }
    return { ok: true, tag };
  } catch (error) {
    return { ok: false, error: String(error?.cause?.code ?? error?.name ?? error?.message ?? error) };
  }
}

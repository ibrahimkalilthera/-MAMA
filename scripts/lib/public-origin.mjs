/**
 * scripts/lib/public-origin.mjs — l'origine publique répond-elle VRAIMENT ?
 *
 * WHY THIS EXISTS
 * ---------------
 * Un déploiement Vercel vert ne dit qu'une chose : la commande a rendu 0. Le
 * 13/09, un domaine du projet répondait `HTTP 404 DEPLOYMENT_NOT_FOUND` pendant
 * que le job de déploiement était vert — la plateforme avait accepté le
 * déploiement, puis l'origine que l'application embarque (`public-origin.cjs`,
 * le repli d'un poste dont l'interface locale ne démarre pas) ne servait plus
 * rien. Personne ne l'aurait su avant qu'un utilisateur ne le dise.
 *
 * Ce fichier porte le VERDICT, pas la lecture : il prend un statut, un corps et
 * les sondes de modules, et rend des problèmes nommés. Le réseau vit dans
 * `scripts/check-public-origin.mjs`, ce qui permet d'asserter chaque branche de
 * refus sans dépôt ni site en ligne.
 *
 * Ce que « répond » veut dire, et pourquoi trois exigences :
 *   1. l'origine RÉPOND (DNS, TLS, statut) — un domaine mort est le cas mesuré ;
 *   2. elle sert l'APPLICATION (la coquille du document, pas une page d'erreur
 *      servie en 200 — une plateforme qui rend une page est un vert trompeur) ;
 *   3. ses MODULES se téléchargent — une coquille qui se charge pendant que le
 *      bundle répond 404 est une application qui ne démarre pas, c'est-à-dire le
 *      même faux vert déplacé d'un cran.
 */
import { assetUrlsIn } from './shared-project.mjs';

/**
 * Le nombre de modules sondés. Le document en référence un ou deux ; au-delà,
 * c'est que la page a changé de forme et qu'il vaut mieux le dire que de payer
 * dix téléchargements.
 */
export const MAX_PROBED_MODULES = 5;

/** Les modules que le DOCUMENT charge lui-même (les seuls nécessaires au démarrage). */
export const moduleUrlsIn = (html, base = '') =>
  assetUrlsIn(html, base).filter((u) => /\.m?js(\?|$)/i.test(u));

/** Un type de contenu qui ne peut pas être un module : la page d'erreur servie en 200. */
const looksLikeScript = (contentType) => !contentType || /javascript|ecmascript|text\/plain/i.test(contentType);

/**
 * @param {{ url: string, status?: number|null, body?: string, error?: string|null,
 *   probes?: { url: string, status: number, contentType?: string|null }[] }} input
 * @returns {{ ok: boolean, problems: string[], warnings: string[], modules: string[] }}
 */
export function originVerdict({ url, status = null, body = '', error = null, probes = [] } = {}) {
  const problems = [];
  const warnings = [];
  const modules = [];

  if (error) {
    problems.push(
      `l'origine ${url} ne répond pas du tout (${error}) — DNS, TLS ou délai : ` +
        "c'est le premier maillon de la chaîne, et un poste qui bascule sur son repli n'aurait rien à charger",
    );
    return { ok: false, problems, warnings, modules };
  }
  if (status === null) {
    problems.push(`aucune réponse de ${url} — une origine qu'on n'a pas pu interroger n'est pas un feu vert`);
    return { ok: false, problems, warnings, modules };
  }

  const firstLine = String(body ?? '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)[0] ?? '';

  if (status !== 200) {
    problems.push(
      `l'origine ${url} répond HTTP ${status}${firstLine ? ` — « ${firstLine.slice(0, 120)} »` : ''} — ` +
        'un déploiement vert sur une origine morte est un faux vert, et un poste y basculerait pour rien',
    );
    return { ok: false, problems, warnings, modules };
  }

  // 2. Ce que la page SERT : la coquille de l'application, pas autre chose. Un 200
  //    qui rend une page d'erreur ou un domaine parqué est plus dangereux qu'un 404,
  //    parce qu'il ressemble à une réponse.
  if (!/<div id="root"/i.test(String(body ?? '')) || !/<\/html>/i.test(String(body ?? ''))) {
    problems.push(
      `l'origine ${url} répond 200 avec autre chose que l'application (aucune coquille « #root ») — ` +
        'une origine qui répond sans servir l\'app est un faux vert de la pire espèce : il a le bon code',
    );
  }

  modules.push(...moduleUrlsIn(String(body ?? ''), url));
  if (!modules.length) {
    problems.push(
      `la page servie par ${url} ne référence AUCUN module — elle ne peut pas démarrer, ` +
        'et rien dans son HTML ne dit pourquoi',
    );
    return { ok: false, problems, warnings, modules };
  }
  if (modules.length > MAX_PROBED_MODULES) {
    warnings.push(
      `${modules.length} modules référencés, ${MAX_PROBED_MODULES} sondés — les autres ne sont pas jugés, et le dire vaut mieux que de payer leur téléchargement`,
    );
  }

  // 3. Les modules se téléchargent-ils ? C'est ce qu'un navigateur fait avant de
  //    peindre quoi que ce soit, et ce qu'un contrôle qui ne lit que la coquille
  //    ne peut pas voir.
  for (const module of modules.slice(0, MAX_PROBED_MODULES)) {
    const probe = probes.find((p) => p?.url === module);
    if (!probe) {
      warnings.push(`module non sondé : ${module} — il n'est donc pas jugé`);
      continue;
    }
    if (probe.status !== 200) {
      problems.push(
        `le module ${module} répond HTTP ${probe.status} — la coquille se charge et l'application ne démarre pas : ` +
          'un poste resterait sur un écran blanc',
      );
      continue;
    }
    if (!looksLikeScript(probe.contentType)) {
      problems.push(
        `le module ${module} est servi comme « ${probe.contentType} » — ce n'est pas du JavaScript, ` +
          "donc c'est une page d'erreur déguisée en fichier",
      );
    }
  }

  return { ok: problems.length === 0, problems, warnings, modules };
}

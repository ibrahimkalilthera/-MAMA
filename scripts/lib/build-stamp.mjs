/**
 * scripts/lib/build-stamp.mjs — QUELLE version du code la prod sert-elle ?
 *
 * WHY THIS EXISTS
 * ---------------
 * `pdf-e2e.yml` attendait un `HTTP 200` de la racine avant de lancer son
 * pixel-check. Or un 200 peut venir du déploiement PRÉCÉDENT : la propagation
 * d'un alias Vercel n'est pas instantanée, et un cache de bord peut encore
 * servir l'ancien HTML. Le pixel-check jugeait alors le build d'un AUTRE commit
 * — et un rouge accusait l'application pour une page qui n'était même pas celle
 * qu'on venait de publier. C'est la pire espèce de rouge : il envoie chercher
 * une régression de rendu là où il n'y a que quelques secondes de propagation.
 *
 * La seule façon de trancher est que le build LIVE dise lui-même de quel commit
 * il vient. Ce plugin estampille le `<head>` du HTML construit avec le sha du
 * commit, lu dans l'environnement du build (`BUILD_SHA`, sinon `GITHUB_SHA`) :
 *
 *   <meta name="build-sha" content="4b3837c…">
 *
 * Sans sha connu — un build local, un `vite dev` — AUCUNE balise n'est écrite :
 * un build hors CI ne peut pas mentir sur son identité, il peut seulement ne
 * rien dire, et `scripts/lib/deployment-freshness.mjs` traduit ce silence en
 * `unknown` plutôt qu'en feu vert (c'est la règle du dépôt : invérifiable n'est
 * pas un vert).
 *
 * La transformation est PURE et testée sur des chaînes : ce que ce plugin écrit
 * dans un `<head>` ne doit pas se vérifier en publiant un site.
 */

/** Le nom de la balise que le contrôle de fraîcheur lit. */
export const BUILD_STAMP_META = 'build-sha';

/** Un sha de commit : 7 à 40 caractères hexadécimaux. Rien d'autre n'est estampillé. */
const SHA_LIKE = /^[0-9a-f]{7,40}$/i;

/**
 * Ajoute la balise d'identité au HTML, ou le rend inchangé.
 *
 * @param {string} html le HTML produit par Vite
 * @param {string} sha le commit du build (vide si inconnu → rien n'est écrit)
 * @returns {string}
 */
export function stampHtml(html, sha) {
  const text = String(html ?? '');
  const stamp = String(sha ?? '').trim();
  // Pas de sha plausible : on n'invente pas une identité. Un build local ne doit
  // pas se faire passer pour le commit qu'il n'est pas.
  if (!SHA_LIKE.test(stamp)) return text;
  if (!/<head[^>]*>/i.test(text)) return text;
  // Idempotent : un HTML déjà estampillé n'est pas estampillé deux fois (Vite
  // peut repasser, et deux balises feraient douter de laquelle fait foi).
  if (text.includes(`name="${BUILD_STAMP_META}"`)) return text;
  return text.replace(/<head([^>]*)>/i, (m) => `${m}\n    <meta name="${BUILD_STAMP_META}" content="${stamp}">`);
}

/**
 * Le plugin Vite. Le sha vient de l'environnement du build, dans cet ordre :
 * `BUILD_SHA` (le workflow de déploiement le pose explicitement, donc c'est la
 * source qui ne dépend d'aucune magie), `GITHUB_SHA` (fourni par Actions à tous
 * ses pas), puis `VERCEL_GIT_COMMIT_SHA` (l'identité que le BÂTISSEUR lui-même
 * annonce pour ce build). Trois sources parce qu'un build qui ne dit pas son
 * commit ne peut pas être distingué du précédent — et l'absence d'estampille est
 * un refus explicite côté contrôle, pas un silence : mieux vaut viser juste avec
 * trois chemins qu'échouer proprement avec un.
 *
 * @param {{ sha?: string }} [options]
 * @returns {{ name: string, transformIndexHtml: (html: string) => string }}
 */
export function buildStamp({
  sha = process.env.BUILD_SHA || process.env.GITHUB_SHA || process.env.VERCEL_GIT_COMMIT_SHA || '',
} = {}) {
  return {
    name: 'build-stamp',
    transformIndexHtml: (html) => stampHtml(html, sha),
  };
}

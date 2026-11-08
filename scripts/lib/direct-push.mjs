/**
 * ─── UN COMMIT ARRIVÉ SUR `main` SANS PASSER PAR UNE PR ─────────────────────
 *
 * La protection de branche GitHub est le bon outil, et elle est active depuis
 * le 2026-11-08 — mais avec `enforce_admins: false` : un administrateur peut
 * encore pousser directement sur `main`. Un commit poussé ainsi contourne
 * TOUTES les portes de ce dépôt (lint, tests, RLS, cohérence de release) sans
 * que rien ne le dise. Ce garde est donc la moitié CI de la réponse, et
 * `pre-push` (scripts/lib/push-target.mjs) la moitié locale.
 *
 * Ce module est la moitié pure du garde : il reçoit la liste des PR associées au
 * commit (ce que l'API GitHub rend) et le message, et il tranche. Aucun réseau
 * ici — le script `check-direct-push.mjs` fait l'appel, le test fait le reste.
 *
 * Une exception NOMMÉE, et une seule : les commits de release
 * (`chore(release): …`) sont produits par le script de version, ne touchent que
 * `package.json` / `package-lock.json` / l'historique, et sont poussés par la
 * même automatisation qui vient de faire passer la chaîne. Les exempter est un
 * choix visible dans ce commentaire — pas un trou.
 */

/** Le préfixe des commits de release, écrit une fois. */
export const RELEASE_COMMIT_PREFIX = 'chore(release):';

/**
 * Ce commit est-il arrivé par une PR ?
 *
 * @param {{ associatedPulls?: { number?: number }[] | null, message?: string | null }} input
 * @returns {{ ok: boolean, reason: string }}
 */
export function directPushVerdict(input = {}) {
  const pulls = Array.isArray(input.associatedPulls) ? input.associatedPulls : null;
  if (pulls === null) {
    // L'API n'a pas répondu, ou a rendu autre chose qu'une liste. Ce n'est pas
    // la preuve d'un push direct, et ce n'est pas non plus la preuve du
    // contraire : un garde qui refuse sur une réponse illisible devient un
    // garde qu'on désactive.
    return { ok: true, reason: 'liste des PR indisponible — rien à conclure' };
  }
  if (pulls.length > 0) {
    return { ok: true, reason: `commit associé à ${pulls.length} PR` };
  }
  const message = String(input.message ?? '').trim();
  if (message.startsWith(RELEASE_COMMIT_PREFIX)) {
    return { ok: true, reason: 'commit de release (exception nommée)' };
  }
  return {
    ok: false,
    reason:
      'ce commit n’est associé à AUCUNE pull request : il est arrivé sur main sans passer les portes du dépôt. ' +
      'Poussez une branche et ouvrez une PR.',
  };
}

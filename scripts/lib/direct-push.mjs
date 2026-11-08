/**
 * ─── UN COMMIT ARRIVÉ SUR `main` SANS PASSER PAR UNE PR ─────────────────────
 *
 * La protection de branche GitHub est la vraie barrière, et depuis le
 * 2026-11-08 elle vaut AUSSI pour l'administrateur (`enforce_admins: true`) :
 * plus personne ne peut pousser directement sur `main`, pas même le compte qui
 * possède le dépôt. C'était la dernière exception — les releases, produites et
 * poussées par ce compte — et elle a disparu le jour où elles ont eu leur
 * propre chemin : `npm run release:pr` ouvre une PR, la fusion la fait entrer
 * (scripts/release-pr.mjs, docs/PROTECTION_MAIN.md).
 *
 * Ce garde reste, comme la ceinture d'un pont qui a déjà ses rambardes : il ne
 * bloque pas un push (seul GitHub pourrait), il rend VISIBLE un commit qui
 * serait arrivé sans PR — y compris par une modification de la règle, un
 * contournement d'API ou un `enforce_admins` remis à `false` par mégarde. Un
 * commit sans PR contourne toutes les portes du dépôt (lint, tests, RLS,
 * cohérence de release) sans que rien ne le dise ; c'est exactement ce silence
 * que ce module casse.
 *
 * Ce module est la moitié pure du garde : il reçoit la liste des PR associées au
 * commit (ce que l'API GitHub rend) et le message, et il tranche. Aucun réseau
 * ici — le script `check-direct-push.mjs` fait l'appel, le test fait le reste.
 *
 * Il n'y a plus d'exception de release, et c'est délibéré : un commit
 * `chore(release): …` poussé directement serait le contournement le plus
 * commode du dépôt, et il n'a plus aucune raison d'exister.
 */

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
  return {
    ok: false,
    reason:
      'ce commit n’est associé à AUCUNE pull request : il est arrivé sur main sans passer les portes du dépôt. ' +
      'Poussez une branche et ouvrez une PR — une release aussi (`npm run release:pr`).',
  };
}

/**
 * ─── POUSSER SUR `main` — la porte qui refuse AVANT le départ ───────────────
 *
 * La protection de branche est ACTIVE depuis le 2026-11-08, et depuis le même
 * jour elle vaut aussi pour l'administrateur (`enforce_admins: true`, voir
 * docs/PROTECTION_MAIN.md) : GitHub refuse déjà un push direct sur `main` pour
 * TOUS les comptes, y compris le propriétaire. Il n'y a donc plus d'exception,
 * pas même pour les commits de release — ce sont eux qui ont fait tomber la
 * dernière, en obtenant leur propre chemin (`npm run release:pr` ouvre une PR).
 *
 * Ce module reste la porte que le dépôt possède sur ce poste : `pre-push`
 * répond AVANT que le commit ne quitte la machine, avec le chemin de
 * remplacement dans le message. Ce module en est la moitié pure — il reçoit les
 * références que git lui tend et tranche. Aucun réseau, aucun `git` ici : le
 * script lit, le test décide.
 *
 * Une seule exception, et elle est NOMMÉE plutôt que devinée :
 *   `ALLOW_MAIN_PUSH=1`, qui est une décision humaine assumée. Le garde
 *   l'annonce au lieu de la subir — GitHub, lui, la refusera de toute façon
 *   tant que la règle est en place.
 *
 * Ce que ce garde ne peut pas faire : empêcher `git push --no-verify` ou
 * `HUSKY=0`. Il ne remplace pas la protection, il ferme le chemin par lequel
 * tout le monde pousse normalement — et un garde local qui refuse est plus tôt
 * qu'un garde de CI qui constate.
 */

/** La seule référence protégée : la branche de production. */
export const MAIN_REF = 'refs/heads/main';

/** La marque d'une suppression de référence dans le protocole pre-push. */
const ZERO_SHA = /^0+$/;

/**
 * Les lignes que git écrit sur l'entrée standard de `pre-push` :
 * `<sha local> <ref local> <sha distant> <ref distant>`.
 *
 * Une ligne illisible est ignorée : le protocole est stable, et une ligne
 * partielle ne doit pas faire croire à un push protégé.
 *
 * @param {string} text
 * @returns {Array<{ localRef: string, localSha: string, remoteRef: string, remoteSha: string }>}
 */
export function parsePushLines(text) {
  const pushes = [];
  for (const line of String(text ?? '').split('\n')) {
    const parts = line.trim().split(/\s+/);
    if (parts.length < 4) continue;
    const [localSha, localRef, remoteSha, remoteRef] = parts;
    if (!localRef || !remoteRef) continue;
    pushes.push({ localSha, localRef, remoteSha, remoteRef });
  }
  return pushes;
}

/**
 * La référence à vérifier quand git n'écrit RIEN sur l'entrée standard.
 *
 * Mesuré sur ce poste le 2026-11-08 : `git push` (Git for Windows 2.56) lance
 * bien le hook, mais lui donne 0 octet — le protocole promis n'arrive pas. Un
 * garde qui refuse alors tout devient un garde qu'on désactive (`--no-verify`),
 * et un garde qu'on désactive ne protège plus rien.
 *
 * Le repli n'est pas un blanc-seing : il nomme la branche COURANTE (`HEAD`), et
 * c'est la branche que `git push` pousse par défaut quand elle a un upstream.
 * L'annonce est obligatoire — le script dit qu'il a déduit, jamais qu'il a lu.
 *
 * @param {string} branch branche courante (`git rev-parse --abbrev-ref HEAD`)
 * @param {string} sha commit de tête
 * @returns {string | null} une ligne au format du protocole, ou `null` si la
 *   branche n'est pas nommable (HEAD détaché) — l'appelant en fait un refus
 */
export function fallbackPushLine(branch, sha) {
  const name = String(branch ?? '').trim();
  const id = String(sha ?? '').trim();
  if (!name || name === 'HEAD' || !id) return null;
  // Le SHA distant n'est pas connu dans ce repli : il n'est pas lu par le
  // verdict, qui ne juge que la RÉFÉRENCE distante et le commit de tête.
  return `${id} refs/heads/${name} ${'0'.repeat(40)} refs/heads/${name}`;
}

/**
 * Ce push doit-il passer ?
 *
 * @param {{ remoteRef: string, localSha: string, remoteSha?: string,
 *           allowMain?: boolean }} input
 * @returns {{ ok: boolean, code: number, reason: string }}
 */
export function pushVerdict(input) {
  const remoteRef = String(input?.remoteRef ?? '');
  if (remoteRef !== MAIN_REF) {
    return { ok: true, code: 0, reason: `branche « ${remoteRef} » — hors de main, rien à refuser` };
  }
  if (ZERO_SHA.test(String(input?.localSha ?? ''))) {
    return {
      ok: false,
      code: 1,
      reason: 'suppression de `main` : la branche de production ne se supprime pas. Créez une PR, ou passez par l’interface GitHub.',
    };
  }  if (input?.allowMain) {
    return {
      ok: true,
      code: 0,
      reason: 'push direct sur `main` AUTORISÉ explicitement (ALLOW_MAIN_PUSH=1) — décision humaine, que GitHub refusera de toute façon',
    };
  }
  return {
    ok: false,
    code: 1,
    reason:
        'push direct sur main refusé : un commit qui arrive ainsi contourne toutes les portes (lint, tests, RLS, cohérence de release). ' +
        'Poussez une branche et ouvrez une PR (docs/PROTECTION_MAIN.md). ' +
        'Une release suit le même chemin : `npm run release:pr` (aucune exception, pas même `chore(release):`).',
  };
}

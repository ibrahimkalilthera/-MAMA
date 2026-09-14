// ─────────────────────────────────────────────────────────────────────────────
// scripts/lib/ephemeral-cleanup.mjs — qui est un RÉSIDU, qui est « en vol » ?
//
// Le garde-fou de fin de job jugeait tout compte jetable comme un résidu. Mesuré
// le 2026-09-14 : le veilleur des comptes propriétaires et le E2E métier se
// déclenchent sur le même push, sur la même base ; le compte de contrôle du
// premier existait pendant que le second vérifiait le sien. Un compte créé il y a
// douze secondes par le voisin n'est pas un nettoyage cassé — c'est un vol en
// cours — et le faire rougir imputait à l'application un défaut qu'elle n'avait
// pas. (Le même jour, un vrai résidu, lui, vivait depuis cinq minutes.)
//
// La règle est donc l'ÂGE, et rien d'autre :
//   • créé il y a moins de `graceMs` → **en vol** : nommé, jamais compté comme un
//     échec ;
//   • au-delà → **résidu** : rouge, avec sa date.
// Un vrai résidu vieillit : il sera rouge au passage suivant. Un faux résidu, lui,
// ne peut pas survivre au vol de son auteur (quelques secondes).
//
// La fonction est PURE (comptes et profils reçus, horloge injectée) parce que ce
// jugement est exactement ce qui a coûté deux runs rouges — il se teste.
// ─────────────────────────────────────────────────────────────────────────────

/** Fenêtre pendant laquelle un compte jetable est considéré « en vol ». */
export const DEFAULT_IN_FLIGHT_MS = 120_000;

/**
 * Classe les comptes et profils jetables en résidus et vols en cours.
 *
 * @param {object} input
 * @param {Array<{id:string,email:string,created_at?:string}>} input.users
 * @param {Array<{id:string,email:string,created_at?:string}>} input.profiles
 * @param {(email: string) => boolean} input.isEphemeral  motifs du dépôt (une seule source)
 * @param {number} [input.now]      horloge injectée (ms epoch)
 * @param {number} [input.graceMs]  âge en deçà duquel un compte n'est pas jugé
 * @returns {{residues: {users: object[], profiles: object[]}, inFlight: {users: object[], profiles: object[]}}}
 */
export function classifyEphemeral({
  users = [],
  profiles = [],
  isEphemeral,
  now = Date.now(),
  graceMs = DEFAULT_IN_FLIGHT_MS,
} = {}) {
  if (typeof isEphemeral !== 'function') {
    throw new Error('classifyEphemeral: isEphemeral est requis — un classement sans motifs ne juge rien');
  }

  // Une date illisible n'est PAS un sursis : sans âge lisible, on ne peut pas
  // prouver que le compte est en vol, donc il compte comme un résidu.
  const ageOf = (row) => {
    const t = Date.parse(row?.created_at ?? '');
    return Number.isFinite(t) ? now - t : Number.POSITIVE_INFINITY;
  };

  const ephemeralUsers = users.filter((u) => isEphemeral(u?.email));
  const inFlightUsers = ephemeralUsers.filter((u) => ageOf(u) < graceMs);
  const inFlightIds = new Set(inFlightUsers.map((u) => u.id));

  const ephemeralProfiles = profiles.filter((p) => isEphemeral(p?.email));

  const withAge = (row) => ({ ...row, ageMs: ageOf(row) });

  return {
    residues: {
      users: ephemeralUsers.filter((u) => !inFlightIds.has(u.id)).map(withAge),
      // Un profil s'efface en cascade avec son compte : orphelin (aucun compte),
      // ou accroché à un compte qui, lui, est un résidu → il est un résidu.
      profiles: ephemeralProfiles.filter((p) => !inFlightIds.has(p.id)).map(withAge),
    },
    inFlight: {
      users: inFlightUsers.map(withAge),
      profiles: ephemeralProfiles.filter((p) => inFlightIds.has(p.id)).map(withAge),
    },
  };
}

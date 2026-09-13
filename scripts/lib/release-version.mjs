// ─────────────────────────────────────────────────────────────────────────────
// scripts/lib/release-version.mjs — l'algèbre des numéros de version.
//
// Sorti de release-coherence.mjs le 2026-09-13 : ce fichier portait CINQ métiers
// (lire un flux, comparer local↔distant, juger la portée du canal, lire le frein,
// décider une publication) dans 727 lignes, et rien n'y était remplaçable
// séparément. Ce qui suit ne sait qu'une chose : ranger et comparer des numéros.
//
// Une version illisible n'a PAS de rang : on ne devine pas un ordre à partir
// d'une chaîne libre, donc `compareVersions` rend `null` plutôt qu'un zéro qui
// ferait passer une chaîne quelconque pour la plus vieille des versions.
// ─────────────────────────────────────────────────────────────────────────────

export const releaseTag = (version) => `v${String(version ?? '').trim()}`;

/**
 * « v1.0.5 » → [1, 0, 5]. Un tag qui n'est pas un numéro n'a pas de rang, donc
 * pas de comparaison : on ne devine pas un ordre à partir d'une chaîne libre.
 *
 * @param {unknown} value
 * @returns {number[]|null}
 */

export function versionParts(value) {
  const match = String(value ?? '').trim().match(/^v?(\d+(?:\.\d+)*)$/);
  if (!match) return null;
  return match[1].split('.').map(Number);
}

/**
 * Comparer deux versions, chiffre par chiffre (donc sans comparer des chaînes :
 * « 1.0.10 » > « 1.0.9 », ce qu'un tri alphabétique se trompe à dire).
 *
 * @param {unknown} a
 * @param {unknown} b
 * @returns {number|null} -1, 0, 1 — `null` si l'une des deux n'est pas lisible
 */
export function compareVersions(a, b) {
  const left = versionParts(a);
  const right = versionParts(b);
  if (!left || !right) return null;
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    const diff = (left[index] ?? 0) - (right[index] ?? 0);
    if (diff !== 0) return diff > 0 ? 1 : -1;
  }
  return 0;
}


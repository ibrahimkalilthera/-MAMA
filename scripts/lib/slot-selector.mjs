/**
 * ─── Composer un sélecteur `data-slot`, jamais le recopier ───────────────────
 *
 * Les suites qui interrogent le DOM par marqueur doivent partir des TABLES
 * partagées (`scripts/lib/appshell-slots.mjs`, `scripts/lib/settings-composition.mjs`),
 * jamais d'un nom recopié à la main. Ces deux fonctions construisent le
 * sélecteur à partir de la valeur de table — ainsi, un nom ne peut plus diverger
 * du marqueur que le composant déclare : il n'existe qu'à un endroit.
 *
 * Un nom écrit en clair dans un `querySelector` est ce que `scripts/check-data-slots.mjs`
 * traque ; le composer ici le rend impossible par construction.
 */

/** Le sélecteur d'un marqueur de valeur : `[data-slot="X"]`. */
export const slotSelector = (slot) => `[data-slot="${slot}"]`;

/** Le sélecteur d'un préfixe de marqueurs : `[data-slot^="P"]`. */
export const slotPrefixSelector = (prefix) => `[data-slot^="${prefix}"]`;

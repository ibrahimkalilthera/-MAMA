/**
 * ─── Le contrat de composition des Paramètres, en UNE seule table ───────────
 *
 * Deux preuves gardent la découpe de l'écran des Paramètres :
 *
 *   • `scripts/check-settings-composition.mjs` lit la SOURCE de la coquille —
 *     quels composants elle importe et rend, dans quel ordre, et combien
 *     d'enfants la pile de sections porte réellement (les `data-slot` déclarés
 *     par les composants) ;
 *   • `tests/settings-composition.test.tsx` mesure le DOM monté — les mêmes
 *     enfants, dans le même ordre, tels que le navigateur les voit.
 *
 * Les deux lisent CE module. Sans lui, chacune portait sa propre copie de la
 * liste, et la mise à jour d'une seule laissait l'autre verte sur un contrat
 * périmé. Ici, changer la structure SANS mettre à jour `SETTINGS_STACK_SLOTS`
 * fait échouer les deux — la mise à jour devient OBLIGATOIRE, pas optionnelle.
 *
 * `SETTINGS_STACK_SLOTS` est la table de référence : sa LONGUEUR est le nombre
 * d'enfants attendus de la racine `.space-y-6`, et son contenu est leur ordre.
 */

/** Le panneau racine de l'écran (déclaré par `SettingsView`). */
export const SETTINGS_PANEL_SLOT = 'settings-panel';
/** La pile `.space-y-6` qui ordonne les sections (déclarée par `SettingsView`). */
export const SETTINGS_STACK_SLOT = 'settings-sections';
/** La 5e section, la modale « Définir mot de passe », rendue HORS de la pile. */
export const SETTINGS_PASSWORD_MODAL_SLOT = 'settings-password-modal';

/**
 * Les composants de section que la coquille importe et rend, dans l'ordre.
 * La modale en fait partie : c'est une section, pas un bloc de la pile.
 */
export const SETTINGS_SECTIONS = [
  'SettingsPreferencesCard',
  'SettingsBackupCard',
  'SettingsClassesCard',
  'SettingsUsersCard',
  'SettingsPasswordModal',
];

/** Les sections EN PILE (tout sauf la modale), dans l'ordre du rendu. */
export const SETTINGS_STACK_SECTIONS = SETTINGS_SECTIONS.filter(
  (section) => section !== 'SettingsPasswordModal',
);

/**
 * Les enfants de la pile, dans l'ordre du DOM. Ce sont les `data-slot` que les
 * composants de `SETTINGS_STACK_SECTIONS` déclarent : `SettingsPreferencesCard`
 * en porte cinq (langue, devise, densité des tableaux, thème, logo), les trois
 * autres un chacun. C'est CETTE longueur — 8 — que comptent les deux preuves.
 */
export const SETTINGS_STACK_SLOTS = [
  'settings-system-language',
  'settings-currency-format',
  'settings-table-density',
  'settings-theme-settings',
  'settings-upload-logo',
  'settings-backup',
  'settings-classes',
  'settings-staff-access',
];

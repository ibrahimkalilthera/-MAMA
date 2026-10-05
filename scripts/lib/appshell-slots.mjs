/**
 * ─── Le contrat de composition du shell (AppShell), en UNE table ─────────────
 *
 * `tests/appshell-overlays.test.tsx` mesure le shell MONTÉ : chaque région et
 * chaque panneau, dans l'ordre du DOM, repérés par leur `data-slot`. Cette table
 * est la SEULE source de ces noms — le test les importe, il ne les recopie pas.
 *
 * Recopier un nom dans un sélecteur est exactement ce qui rend la divergence
 * possible : une faute de frappe (`app-env-bagde`) ou un renommage d'un seul
 * côté (`app-header` → `app-head`) ne fait pas échouer le test — il cherche un
 * marqueur que personne ne pose, et `querySelectorAll` rend une liste vide. Ici,
 * le nom vit à un endroit ; le composant le DÉCLARE (`data-slot="…"`), le test le
 * LIT, et `scripts/check-data-slots.mjs` confronte les deux.
 *
 * L'ordre de `APPSHELL_SLOTS` est celui du DOM, et c'est LUI que verrouille le
 * test : retirer, réordonner ou absorber un panneau fait tomber un cas nommé.
 */

/** La racine du shell. */
export const APPSHELL_SLOT = 'app-shell';
/** L'en-tête d'impression (masqué à l'écran). */
export const APPSHELL_PRINT_HEADER_SLOT = 'app-shell-print-header';
/** La barre latérale (bureau). */
export const APPSHELL_SIDEBAR_SLOT = 'app-sidebar';
/** La navigation mobile (pied, petit écran). */
export const APPSHELL_MOBILE_NAV_SLOT = 'app-mobile-nav';
/** La zone de contenu principale. */
export const APPSHELL_MAIN_SLOT = 'app-shell-main';
/** L'en-tête de page (titre, recherche, actions). */
export const APPSHELL_HEADER_SLOT = 'app-header';
/** La bannière d'accueil. */
export const APPSHELL_WELCOME_BANNER_SLOT = 'app-welcome-banner';
/** Le bandeau « année clôturée ». */
export const APPSHELL_LOCKED_YEAR_BANNER_SLOT = 'app-locked-year-banner';
/** La bulle de conversation flottante. */
export const APPSHELL_FLOATING_CHAT_SLOT = 'app-floating-chat';
/** Le bandeau hors ligne. */
export const APPSHELL_OFFLINE_BANNER_SLOT = 'app-offline-banner';
/** La pastille d'environnement (DEV / PROD). */
export const APPSHELL_ENV_BADGE_SLOT = 'app-env-badge';
/** Le conteneur de toasts. */
export const APPSHELL_TOASTS_SLOT = 'app-toasts';

/**
 * L'espace de noms du shell — le préfixe que partagent TOUS ses marqueurs. Sert
 * au sélecteur de préfixe, qui doit lui-même être dérivé de la table.
 */
export const APPSHELL_SLOT_PREFIX = 'app-';

/**
 * Les marqueurs du shell, DANS L'ORDRE DU DOM. C'est cette liste — et sa
 * longueur — que mesure la composition montée.
 */
export const APPSHELL_SLOTS = [
  APPSHELL_SLOT,
  APPSHELL_PRINT_HEADER_SLOT,
  APPSHELL_SIDEBAR_SLOT,
  APPSHELL_MOBILE_NAV_SLOT,
  APPSHELL_MAIN_SLOT,
  APPSHELL_HEADER_SLOT,
  APPSHELL_WELCOME_BANNER_SLOT,
  APPSHELL_LOCKED_YEAR_BANNER_SLOT,
  APPSHELL_FLOATING_CHAT_SLOT,
  APPSHELL_OFFLINE_BANNER_SLOT,
  APPSHELL_ENV_BADGE_SLOT,
  APPSHELL_TOASTS_SLOT,
];

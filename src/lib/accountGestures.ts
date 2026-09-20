/**
 * « Ce geste exige la connexion » — un code, une règle, et rien d'autre.
 *
 * Pourquoi ce module existe, et pourquoi PAS dans `useAuth` : une valeur
 * importée depuis un crochet React tire tout le fichier, donc `supabaseClient`,
 * donc un client qui refuse de se charger là où le stockage du navigateur
 * n'existe pas (le runner de tests). C'est la raison d'être du contrôle
 * `check-import-effects.mjs` du dépôt — et c'est mesuré : importer le code depuis
 * `useAuth` a fait échouer `tests/settings-filter-honesty.test.tsx` sur
 * `ReferenceError: sessionStorage is not defined`, avant même d'exécuter un seul
 * test. Ici il n'y a donc ni React ni Supabase : seulement une chaîne et une
 * comparaison, importables de partout.
 *
 * La RÈGLE qu'il porte : créer un compte et changer un mot de passe passent par
 * l'authentification du serveur (GoTrue : `signUp`, `resetPasswordForEmail`, RPC
 * `admin_set_user_password`). Aucune file hors ligne ne peut les porter, et un
 * mot de passe ne peut évidemment pas être stocké pour être rejoué plus tard.
 * Un changement de RÔLE, lui, écrit une ligne de table : il part en file.
 */
export const ACCOUNT_NEEDS_CONNECTION = 'ACCOUNT_NEEDS_CONNECTION';

/** L'erreur (ou son code) dit-elle « il faut la connexion » ? — pour l'affichage. */
export function isConnectionRequiredError(message?: string | null): boolean {
  return message === ACCOUNT_NEEDS_CONNECTION;
}

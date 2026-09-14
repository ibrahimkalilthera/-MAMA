/**
 * ─── Qui a le droit de SUPPRIMER, décidé par la BASE ────────────────────────
 *
 * `supabase/migrations/20260809000000_auth_and_rls.sql` réserve la SUPPRESSION
 * de huit tables à `public.is_admin()` — donc aux rôles `admin` et `dev` :
 * `students`, `parents`, `payments`, `staff`, `salary_payments`, `expenses`,
 * `vendor_expenses`, `user_profiles`. (Les tâches et les classes, elles, ne sont
 * pas concernées : leurs policies laissent passer tout compte connecté.)
 *
 * Ce que ça donnait sans ce module, mesuré sur la base partagée le 2026-09-14 :
 * un utilisateur `staff` — le rôle que Supabase pose à l'inscription — voyait le
 * bouton « Supprimer », le pressait, et PostgREST répondait **200 avec un corps
 * vide**. Rien n'était supprimé, et l'écran l'annonçait quand même. La couche
 * d'écriture dit maintenant l'échec (`src/lib/dataOps/*.ts`, règle honnête du
 * `.select('id')`) ; ce module fait l'autre moitié du travail : **l'action
 * n'existe pas là où le serveur refuse**, donc l'échec est empêché au lieu
 * d'être annoncé.
 *
 * Pourquoi les listes sont ici et nulle part ailleurs : deux copies écrites à la
 * main divergent, et c'est exactement l'écart que ce dépôt pourchasse partout.
 * `tests/delete-rights.test.ts` compare donc ces deux listes aux policies de la
 * MIGRATION, **dans les deux sens** — un rôle ou une table ajoutés d'un seul
 * côté font rougir le test au lieu de rouvrir un bouton qui ne peut pas aboutir.
 */

/**
 * Les rôles que `public.is_admin()` accepte (`role IN ('admin', 'dev')`).
 * `src/lib/useAuth.ts` en derive `isAdmin`, et l'interface en derive le droit de
 * supprimer : une seule liste, deux lecteurs.
 */
export const ADMIN_ROLES = ['admin', 'dev'] as const;

/** Les tables dont la suppression est réservée aux administrateurs. */
export const ADMIN_ONLY_DELETE_TABLES = [
  'students',
  'parents',
  'payments',
  'staff',
  'salary_payments',
  'expenses',
  'vendor_expenses',
  'user_profiles',
] as const;

/**
 * Ce rôle est-il un administrateur au sens de la base ?
 * (le miroir exact de `public.is_admin()`)
 */
export function isAdminRole(role: string | null | undefined): boolean {
  return ADMIN_ROLES.includes(String(role ?? '').trim().toLowerCase() as (typeof ADMIN_ROLES)[number]);
}

/**
 * Ce rôle peut-il supprimer une ligne des tables ci-dessus ?
 *
 * C'est la question que pose l'interface avant d'AFFICHER une action de
 * suppression. Elle lit aujourd'hui la même liste que `isAdminRole` — parce que
 * la base dit la même chose — mais elle est nommée séparément pour que le jour
 * où une policy se resserre, l'écran suive sans qu'on touche aux droits
 * d'administration généraux.
 */
export function canDeleteRecords(role: string | null | undefined): boolean {
  return isAdminRole(role);
}

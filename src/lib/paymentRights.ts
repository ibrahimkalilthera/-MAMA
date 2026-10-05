/**
 * ─── Qui a le droit de SUPPRIMER un paiement d'élève, décidé par la BASE ─────
 *
 * `supabase/migrations/20261005000003_econome_delete_payments.sql` définit
 * `public.is_payment_deleter()` = `admin`, `dev`, **`econome`** : c'est lui qui
 * ouvre la SEULE policy de suppression de `payments`
 * (« Payment deleters delete payments »).
 *
 * ─── Le défaut que ce module empêche ────────────────────────────────────────
 * Mesuré le 2026-10-05 : le bouton « supprimer un paiement » était masqué à
 * l'économe, parce que la base réservait `payments` à `public.is_admin()`
 * (admin, dev). Or l'économe tient la caisse et saisit les reçus : corriger un
 * montant tapé deux fois est son geste quotidien. Le retirer à la base l'aurait
 * laissé sans recours, ou pire, aurait rouvert le bouton sans que la base suive —
 * exactement l'échec silencieux (200, zéro ligne) que `src/lib/deleteRights.ts`
 * empêche pour les autres tables.
 *
 * Comme `payrollRights.ts` et `deleteRights.ts`, les listes vivent ICI et nulle
 * part ailleurs : `tests/payment-rights.test.ts` les compare à la fonction de la
 * MIGRATION, dans les deux sens — un rôle ajouté d'un seul côté fait rougir le
 * test au lieu de rouvrir un bouton qui ne peut pas aboutir.
 *
 * ⚠️ Ce droit ne concerne QUE `payments`. Supprimer un ÉLÈVE, un parent, un
 * employé, une dépense ou un paiement de salaire reste réservé à `is_admin()` ou
 * `is_finance_admin()` (voir `deleteRights.ts`) : « enregistrer et détruire ne
 * sont pas le même droit ».
 */

/** Les rôles de `public.is_payment_deleter()` — suppriment un paiement d'élève. */
export const PAYMENT_DELETER_ROLES = ['admin', 'dev', 'econome'] as const;

/** Le rôle, réduit à sa forme comparable (l'écriture vient d'une colonne Postgres). */
const norm = (role: string | null | undefined): string => String(role ?? '').trim().toLowerCase();

/**
 * Ce rôle peut-il supprimer un paiement d'élève ?
 * Le miroir exact de `public.is_payment_deleter()`.
 */
export function canDeletePayments(role: string | null | undefined): boolean {
  return (PAYMENT_DELETER_ROLES as readonly string[]).includes(norm(role));
}

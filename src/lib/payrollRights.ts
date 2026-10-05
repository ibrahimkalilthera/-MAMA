/**
 * ─── Qui a le droit d'ÉCRIRE la paie et le personnel, décidé par la BASE ─────
 *
 * `supabase/migrations/20260902000000_general_manager_role.sql` définit
 * `public.is_finance_admin()` = `admin`, `dev`, `general_manager` : c'est lui qui
 * ouvre l'insertion des MEMBRES (`staff`).
 *
 * `supabase/migrations/20261005000000_econome_payroll_writes.sql` définit
 * `public.is_payroll_writer()` = `is_finance_admin()` **plus `econome`** : c'est
 * lui qui ouvre l'insertion et la correction des PAIEMENTS DE SALAIRE
 * (`salary_payments`).
 *
 * ─── Le défaut que ce module empêche ────────────────────────────────────────
 * Mesuré le 2026-10-05 : un compte `econome` enregistrait la paie hors ligne ;
 * chaque rejeu était refusé par la policy (`42501`), et les saisies restaient
 * dans la file — « refusées », jamais envoyées. La cause n'était ni la file ni le
 * rejeu : l'écran n'avait aucune garde de rôle, donc il proposait une écriture
 * que la base refusait. Le même piège existait pour `staff`, qui peut ouvrir
 * l'écran Paie sans pouvoir y écrire quoi que ce soit.
 *
 * Comme `src/lib/deleteRights.ts` pour la suppression, les listes vivent ICI et
 * nulle part ailleurs : `tests/payroll-rights.test.ts` les compare aux deux
 * fonctions de la MIGRATION, dans les deux sens — un rôle ajouté d'un seul côté
 * fait rougir le test au lieu de rouvrir un bouton qui ne peut pas aboutir.
 */

/** Les rôles de `public.is_payroll_writer()` — écrivent un paiement de salaire. */
export const PAYROLL_WRITER_ROLES = ['admin', 'dev', 'general_manager', 'econome'] as const;

/** Les rôles de `public.is_finance_admin()` — écrivent les membres du personnel. */
export const STAFF_WRITER_ROLES = ['admin', 'dev', 'general_manager'] as const;

/** Le rôle, réduit à sa forme comparable (l'écriture vient d'une colonne Postgres). */
const norm = (role: string | null | undefined): string => String(role ?? '').trim().toLowerCase();

/**
 * Ce rôle peut-il enregistrer (ou corriger) un paiement de salaire ?
 * Le miroir exact de `public.is_payroll_writer()`.
 */
export function canWritePayroll(role: string | null | undefined): boolean {
  return (PAYROLL_WRITER_ROLES as readonly string[]).includes(norm(role));
}

/**
 * Ce rôle peut-il ajouter ou modifier un membre du personnel ?
 * Le miroir exact de `public.is_finance_admin()`.
 */
export function canManageStaff(role: string | null | undefined): boolean {
  return (STAFF_WRITER_ROLES as readonly string[]).includes(norm(role));
}

/**
 * ─── Qui a le droit de SUPPRIMER un paiement, ou d'en RENSEIGNER les mois, ───
 * ─── décidé par la BASE ────────────────────────────────────────────────────
 *
 * Deux droits, deux policies, deux listes — et elles ne se confondent pas :
 * `canDeletePayments` (policy « Payment deleters delete payments »,
 * `public.is_payment_deleter()`) et `canUpdatePaymentMonths` (policy « Admin
 * update payments », `public.is_admin()`).
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
 * ⚠️ Ces droits ne concernent QUE `payments`. Supprimer un ÉLÈVE, un parent, un
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

/**
 * ─── Qui peut RENSEIGNER les mois d'un paiement déjà enregistré ─────────────
 *
 * Les reçus saisis avant la colonne `payments.months`
 * (`supabase/migrations/20261011000000_payments_months.sql`) ont pris `{}` :
 * leur couverture est INCONNUE, et toute réimpression retombe donc sur le mois
 * de la seule DATE. La famille repart avec un papier qui ne nomme qu'un mois
 * sur les trois qu'elle a payés — et c'est la fiche de l'élève qui le lui dit.
 *
 * Corriger cela est une ÉCRITURE de `payments`, donc c'est la policy
 * « Admin update payments » (`public.is_admin()`) qui décide, pas l'écran :
 * `20260809000000_auth_and_rls.sql` ouvre l'UPDATE de cette table aux rôles
 * ci-dessous, et RIEN d'autre ne la rouvre.
 *
 * ⚠️ Deux choses à dire, parce qu'elles sont des limites et non des détails :
 *
 *   1. **L'économe n'y est pas.** Il tient la caisse et repartage les reçus,
 *      mais `is_payment_deleter()` ne couvre que la SUPPRESSION ; laisser
 *      l'écran lui montrer ce bouton rouvrirait exactement le défaut que
 *      `paymentRights.ts` documente pour la corbeille — un bouton que la base
 *      refuse (200, zéro ligne). Ouvrir l'UPDATE à l'économe est une décision
 *      de propriétaire, pas une conséquence de ce module.
 *   2. **La policy couvre la LIGNE, pas la colonne.** Postgres ne sait pas
 *      restreindre un UPDATE à `months` : qui a ce droit peut, au niveau de la
 *      base, réécrire aussi le MONTANT. L'écran, lui, n'écrit que `months`
 *      (`updatePaymentMonths`, src/lib/dataOps/payments.ts) — la garantie est
 *      donc côté code, et c'est le journal d'audit qui la rend vérifiable.
 *      Un droit finement borné à la colonne demanderait une fonction
 *      `SECURITY DEFINER`, pas une policy.
 */
export const PAYMENT_MONTH_EDITOR_ROLES = ['admin', 'dev'] as const;

/**
 * Ce rôle peut-il renseigner les mois d'un paiement déjà enregistré ?
 * Le miroir exact de la condition de la policy « Admin update payments ».
 */
export function canUpdatePaymentMonths(role: string | null | undefined): boolean {
  return (PAYMENT_MONTH_EDITOR_ROLES as readonly string[]).includes(norm(role));
}

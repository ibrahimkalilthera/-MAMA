/**
 * ─── Qui a le droit de SUPPRIMER un paiement, ou d'en RENSEIGNER les mois, ───
 * ─── décidé par la BASE ────────────────────────────────────────────────────
 *
 * Deux droits, deux mécanismes, deux listes — et elles ne se confondent pas :
 * `canDeletePayments` (policy « Payment deleters delete payments »,
 * `public.is_payment_deleter()`) et `canUpdatePaymentMonths` (FONCTION
 * `public.set_payment_months()`, gardée par `public.is_payment_month_editor()` —
 * la seule écriture de ce dépôt bornée à UNE colonne).
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
 * Le droit qui décide n'est PAS une policy, et c'est le fond du sujet :
 *
 *   1. **Une policy est au niveau de la LIGNE.** `FOR UPDATE USING (…)` laisserait
 *      le rôle `authenticated` — que TOUS les postes partagent — réécrire
 *      n'importe quelle colonne d'un reçu autorisé, MONTANT compris. C'était la
 *      limite dite du 2026-10-13 au matin.
 *   2. **Le droit vit donc dans une FONCTION**,
 *      `public.set_payment_months(uuid, text[])`
 *      (`supabase/migrations/20261013000000_econome_payment_months.sql`),
 *      `SECURITY DEFINER`, gardée par `public.is_payment_month_editor()` — la
 *      liste ci-dessous, et rien d'autre. Elle n'écrit QUE `months` : ni montant,
 *      ni date, ni numéro de reçu, ni élève. C'est une borne par CONSTRUCTION
 *      (la seule colonne nommée dans sa requête), pas une convention de code.
 *   3. **L'économe y est** (décision du propriétaire, 2026-10-13). Il tient la
 *      caisse et repartage les reçus : il supprime DÉJÀ un reçu fautif
 *      (`is_payment_deleter()`), donc lui refuser de renseigner les mois du reçu
 *      qu'il a sous les yeux était incohérent — et le seul recours laissé à
 *      l'école était de SUPPRIMER le reçu pour le ressaisir, ce qui change son
 *      numéro, sa date et son auteur au journal.
 *   4. **La policy « Admin update payments » reste `is_admin()`** — admin, dev.
 *      L'économe n'a donc AUCUN chemin d'UPDATE direct sur `payments` : la
 *      fonction est son seul chemin. `tests/payment-rights.test.ts` veille sur
 *      les deux moitiés — la liste de la fonction, ET la policy qui n'a pas bougé
 *      (une migration qui l'ouvrirait doit faire rougir le test, pas passer).
 */
export const PAYMENT_MONTH_EDITOR_ROLES = ['admin', 'dev', 'econome'] as const;

/**
 * Ce rôle peut-il renseigner les mois d'un paiement déjà enregistré ?
 * Le miroir exact de `public.is_payment_month_editor()`.
 */
export function canUpdatePaymentMonths(role: string | null | undefined): boolean {
  return (PAYMENT_MONTH_EDITOR_ROLES as readonly string[]).includes(norm(role));
}

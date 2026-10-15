/**
 * ─── Qui a le droit d'ÉCRIRE les finances, décidé par la BASE ───────────────
 * (et, pour les dépenses fournisseur, qui a le droit de les DÉTRUIRE)
 *
 * Trois fonctions de la base, trois listes — et aucune n'est recopiée ailleurs :
 *
 * `public.is_finance_admin()` = `admin`, `dev`, `general_manager`
 *   (`20260902000000_general_manager_role.sql`). C'est elle qui garde encore la
 *   SUPPRESSION : licencier un membre ou détruire une dépense fournisseur reste
 *   un acte de gestionnaire financier — écrire et détruire ne sont pas le même
 *   droit. Pour les dépenses fournisseur, cette règle est celle que la base
 *   EXÉCUTE depuis le 2026-10-13 (`20260906000002_vendor_expense_gm_policies.sql`,
 *   sa moitié DELETE jamais appliquée jusqu'ici) : deux noms hérités en base
 *   refusaient le Gestionnaire Principal pendant que l'écran lui montrait la
 *   corbeille. `canDeleteVendorExpenses()` est le miroir de cette policy.
 *
 * `public.is_payroll_writer()` = `is_finance_admin()` **plus `econome`**
 *   (`20261005000000_econome_payroll_writes.sql`) : les PAIEMENTS DE SALAIRE.
 *   L'économe tient la caisse, c'est son métier.
 *
 * `public.is_finance_writer()` = la même liste, nommée à part
 *   (`20261014000000_finance_writer_staff_vendor.sql`) : l'INSERTION et la
 *   correction des MEMBRES du personnel (`staff`) et l'INSERTION des DÉPENSES
 *   FOURNISSEUR (`vendor_expenses`). Décision du propriétaire (2026-10-13) :
 *   « l'économe a accès à tout sauf les paramètres du système » — il ajoute un
 *   employé, un membre de l'administration et un membre T et P, comme il
 *   enregistre les dépenses.
 *
 * ─── Le défaut que ce module empêche ────────────────────────────────────────
 * Mesuré le 2026-10-05 : un compte `econome` enregistrait la paie hors ligne ;
 * chaque rejeu était refusé par la policy (`42501`), et les saisies restaient
 * dans la file — « refusées », jamais envoyées. La cause n'était ni la file ni le
 * rejeu : l'écran n'avait aucune garde de rôle, donc il proposait une écriture
 * que la base refusait.
 *
 * Mesuré le 2026-10-13 sur la base de l'école, poste `econome` : le même défaut
 * avait deux formes, dans les deux sens.
 *   • `staff` et `vendor_expenses` → insertion refusée (`42501`) : les écrans
 *     « Pai/Salaires » et « Dépenses » ne montraient pourtant AUCUNE action à ce
 *     rôle — l'inverse exact du défaut de la paie, une capacité en base que
 *     l'écran taisait ;
 *   • `expenses` → insertion ACCEPTÉE (1 ligne) : la base l'ouvrait déjà, et
 *     pourtant l'icône ✚ « Ajouter une dépense » ne s'affichait pas chez lui.
 * Les trois portes lisent désormais `canWriteFinance()`.
 *
 * Comme `src/lib/deleteRights.ts` pour la suppression, les listes vivent ICI et
 * nulle part ailleurs : `tests/finance-rights.test.ts` les compare aux fonctions
 * des MIGRATIONS, dans les deux sens — un rôle ajouté d'un seul côté fait rougir
 * le test au lieu de rouvrir une action que la base refuse (`42501`) ou d'en
 * cacher une qu'elle accepte.
 */

/** Les rôles de `public.is_finance_admin()` — suppriment le personnel et les dépenses fournisseur. */
export const FINANCE_ADMIN_ROLES = ['admin', 'dev', 'general_manager'] as const;

/** Les rôles de `public.is_payroll_writer()` — écrivent un paiement de salaire. */
export const PAYROLL_WRITER_ROLES = ['admin', 'dev', 'general_manager', 'econome'] as const;

/** Les rôles de `public.is_finance_writer()` — écrivent le personnel et les dépenses fournisseur. */
export const FINANCE_WRITER_ROLES = ['admin', 'dev', 'general_manager', 'econome'] as const;

/**
 * Les rôles qui SUPPRIMENT une dépense fournisseur — `public.is_finance_admin()`,
 * tel qu'il est exécuté par `20260906000002_vendor_expense_gm_policies.sql`.
 *
 * Ce n'est PAS une seconde liste : c'est le même tableau, nommé pour ce qu'il
 * décide là (comme `PAYMENT_DELETER_ROLES` l'est pour les reçus). L'économe
 * SAISIT la dépense fournisseur (`FINANCE_WRITER_ROLES`) sans pouvoir la
 * détruire : écrire et détruire ne sont pas le même droit.
 */
export const VENDOR_EXPENSE_DELETER_ROLES = FINANCE_ADMIN_ROLES;

/**
 * Les rôles qui SUPPRIMENT un paiement de salaire — `public.is_finance_admin()`,
 * tel qu'il est exécuté par la policy « Finance admins delete salary_payments »
 * (`20260902000000_general_manager_role.sql`, et sa revue de dédoublonnage
 * `20261015000000_inherited_policy_closure.sql`).
 *
 * Même tableau que `VENDOR_EXPENSE_DELETER_ROLES`, nommé pour ce qu'il décide
 * ici — et la distinction qui compte est ailleurs : l'ÉCONOME enregistre la paie
 * (`PAYROLL_WRITER_ROLES`) sans pouvoir la détruire. C'est la décision écrite
 * noir sur blanc par `20261005000000_econome_payroll_writes.sql` (« la
 * suppression reste à `is_finance_admin()` : enregistrer et détruire ne sont pas
 * le même droit ») — une saisie fautive se corrige donc en la RETIRANT, geste
 * réservé aux gestionnaires financiers.
 */
export const SALARY_PAYMENT_DELETER_ROLES = FINANCE_ADMIN_ROLES;

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
 * Ce rôle peut-il écrire les finances hors paie — ajouter/corriger un membre du
 * personnel, créer une dépense fournisseur, saisir une dépense générale ?
 * Le miroir exact de `public.is_finance_writer()`.
 *
 * Note sur `expenses` : la policy de la base y est PLUS LARGE que cette liste
 * (tout compte authentifié — la saisie quotidienne des dépenses fait partie du
 * rôle `staff`, décision de `20260902000000_general_manager_role.sql`). L'écran
 * peut donc être plus étroit que la base sans jamais lui promettre une écriture
 * qu'elle refuserait : c'est la seule direction que ce module interdit.
 */
export function canWriteFinance(role: string | null | undefined): boolean {
  return (FINANCE_WRITER_ROLES as readonly string[]).includes(norm(role));
}

/**
 * Ce rôle peut-il SUPPRIMER une dépense fournisseur ?
 * Le miroir exact de `public.is_finance_admin()` — admin, dev, Gestionnaire
 * Principal. Plus ÉTROIT que `canWriteFinance()` : l'économe y figure pour
 * l'écriture et pas pour la destruction.
 *
 * L'écran lit cette fonction (`ExpensesView`), la fonction de la base décide, et
 * `tests/finance-rights.test.ts` compare les deux listes DANS LES DEUX SENS : un
 * rôle ajouté d'un seul côté rouvrirait (ou fermerait) une corbeille que la base
 * ne suit pas.
 */
export function canDeleteVendorExpenses(role: string | null | undefined): boolean {
  return (VENDOR_EXPENSE_DELETER_ROLES as readonly string[]).includes(norm(role));
}

/**
 * Ce rôle peut-il SUPPRIMER un paiement de salaire ?
 * Le miroir exact de `public.is_finance_admin()` — admin, dev, Gestionnaire
 * Principal. L'économe y est ABSENT alors qu'il enregistre la paie : écrire et
 * détruire ne sont pas le même droit, et c'est la base qui le dit.
 *
 * L'écran lit cette fonction (`PayrollView`), la policy décide, et
 * `tests/finance-rights.test.ts` compare les deux listes DANS LES DEUX SENS : un
 * rôle ajouté d'un seul côté rouvrirait (ou fermerait) une corbeille que la base
 * ne suit pas.
 */
export function canDeleteSalaryPayments(role: string | null | undefined): boolean {
  return (SALARY_PAYMENT_DELETER_ROLES as readonly string[]).includes(norm(role));
}

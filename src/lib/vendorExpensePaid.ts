/**
 * ─── QUI A LE DROIT D'ÉCRIRE `vendor_expenses.amount_paid` ─────────────────
 *
 * La colonne porte DEUX fois le même fait quand le statut le dit déjà : « payé »
 * signifie `amount`, « impayé » signifie 0. Depuis la migration
 * `20261108000000_vendor_expense_paid_consistency.sql`, la base REMPLACE la
 * valeur envoyée dans ces deux cas : le client qui l'envoie quand même ne gagne
 * rien, mais il laisse croire, dans son propre code, que cette valeur compte —
 * et une future écriture pourrait s'appuyer sur cette croyance.
 *
 * Le SEUL cas où le nombre est une vraie saisie est le paiement PARTIEL : la
 * base le VALIDE (strictement entre 0 et le dû) au lieu de l'inventer. C'est
 * donc le seul cas où le client l'envoie, et cette fonction est là pour que les
 * quatre chemins d'écriture (`addVendorExpense`, `updateVendorExpense`, et
 * leurs deux branches de rejeu hors ligne) répondent la même chose — un rejeu
 * qui écrirait la colonne là où le chemin en ligne s'en abstient ferait diverger
 * les deux, et c'est exactement ce que ce dépôt refuse ailleurs.
 */
export type VendorPaymentStatus = 'unpaid' | 'partial' | 'paid';

/**
 * Le client doit-il joindre `amount_paid` à son écriture ?
 *
 * Seulement pour un partiel — c'est-à-dire quand le montant est la déclaration,
 * et non une conséquence du statut. Un statut absent ou inconnu répond `false` :
 * la base refusera la ligne (`23514`), et c'est elle qui doit trancher, pas un
 * client qui devine.
 */
export function clientWritesAmountPaid(status: string | undefined | null): boolean {
  return status === 'partial';
}

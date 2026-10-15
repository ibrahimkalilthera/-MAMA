/**
 * ─── Qui a le droit de LIRE l'historique des paiements ──────────────────────
 *
 * Le droit est celui de la BASE, et il a deux moitiés inséparables :
 *   • un RÔLE — `public.is_payment_history_viewer()` = `admin`, `dev`,
 *     **`econome`** (`supabase/migrations/20261020000000_econome_payment_history.sql`) ;
 *   • des LIGNES — la policy « Payment history viewers read payment gestures »
 *     n'ouvre que les gestes que cet écran montre : les trois de la caisse
 *     (`PAYMENT_HISTORY_ACTIONS`, `src/lib/paymentHistory.ts`) et les quatre
 *     corrections d'argent (`CORRECTION_HISTORY_ACTIONS`,
 *     `src/lib/correctionHistory.ts`).
 *
 * ─── Le défaut que ce module empêche ────────────────────────────────────────
 * Mesuré le 2026-10-15, sur la demande du propriétaire (« l'économe doit avoir
 * accès à l'historique des paiements ») : la ligne du rail ne s'affichait pas
 * pour son compte. La cause n'était PAS dans le rail — `audit_logs` n'était
 * lisible que par `admin`/`dev`, et l'historique des paiements se lit dans ce
 * journal, seul endroit qui nomme l'encaisseur. Ouvrir l'onglet sans la lecture
 * aurait rendu « rien encaissé » sur une caisse pleine.
 *
 * ─── Ce que ce droit n'est PAS ──────────────────────────────────────────────
 * Lire ces lignes n'ouvre RIEN d'autre du journal : ni les changements de rôle,
 * ni les suppressions d'élèves, ni les réglages — la policy est filtrée par
 * `action`, et le reste de `audit_logs` demeure refusé à l'économe. Ce n'est pas
 * non plus un droit d'écriture : il SUPPRIME déjà un reçu fautif
 * (`canDeletePayments`, `src/lib/paymentRights.ts`) et il RENSEIGNE ses mois
 * (`canUpdatePaymentMonths`), décidés ailleurs et pour d'autres raisons.
 *
 * La liste vit ici et nulle part ailleurs : `tests/payment-history-rights.test.ts`
 * la compare à `public.is_payment_history_viewer()`, dans les deux sens, et exige
 * que l'union des deux listes d'ACTIONS soit exactement celle de la policy — un
 * rôle ou un geste ajouté d'un seul côté rougit au lieu d'ouvrir un écran qui ne
 * peut pas aboutir.
 */

/** Les rôles de `public.is_payment_history_viewer()` — lisent l'historique des paiements. */
export const PAYMENT_HISTORY_VIEWER_ROLES = ['admin', 'dev', 'econome'] as const;

/** Le rôle, réduit à sa forme comparable (l'écriture vient d'une colonne Postgres). */
const norm = (role: string | null | undefined): string => String(role ?? '').trim().toLowerCase();

/**
 * Ce rôle peut-il lire l'historique des paiements ?
 * Le miroir exact de `public.is_payment_history_viewer()`.
 */
export function canViewPaymentHistory(role: string | null | undefined): boolean {
  return (PAYMENT_HISTORY_VIEWER_ROLES as readonly string[]).includes(norm(role));
}

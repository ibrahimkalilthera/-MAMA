// ─────────────────────────────────────────────────────────────────────────────
// scripts/lib/vendor-expense-ledger.mjs — le statut d'une dépense fournisseur
// tient-il sa promesse de montant payé ?
//
// ─── Le fait mesuré, le 2026-11-08 ──────────────────────────────────────────
// `vendor_expenses` porte DEUX copies du même fait : `payment_status` (« payé »,
// « partiel », « impayé ») et `amount_paid` (le montant). Quatre calculs d'argent
// les lisent ensemble — `useDashboard`, `ExpensesView`, `useYearOps`,
// `pdfExpensesReport` :
//
//     status === 'paid'    ? amount
//     status === 'partial' ? amount_paid
//                         : 0
//
// et rien, en base, ne les empêchait de se contredire : un `paid` à 0, un
// `unpaid` qui porte un montant, un `partial` à 150 % du dû. La dépense de
// l'école est alors annoncée fausse, et AUCUN contrôle ne la compare à quoi que
// ce soit — contrairement au registre des reçus, qui a son
// `check:payment-ledger` et sa veille quotidienne.
//
// ─── Le déclencheur ferme les écritures, ce contrôle mesure l'histoire ──────
// `20261108000000_vendor_expense_paid_consistency.sql` normalise toute écriture
// FUTURE (et a rattrapé les lignes existantes). Il ne garantit rien de ce qui
// pourrait arriver APRÈS lui : une ligne écrite pendant que le déclencheur est
// désactivé (restauration de sauvegarde, `ALTER TABLE … DISABLE TRIGGER`), une
// migration qui le remplace, ou une restauration partielle. C'est exactement le
// rôle du contrôle du registre des reçus : le calcul est autoritaire, et la
// veille mesure qu'il ne se contourne pas.
//
// Depuis `20261108000002_…`, deux déclencheurs portent la règle :
// `vendor_expense_paid_consistency` (BEFORE) RANGE `amount_paid` selon le
// statut, `vendor_expense_paid_validation` (AFTER) REFUSE. L'ordre est une
// garantie, pas un détail : un refus en BEFORE passe avant la vérification RLS,
// et transformait un refus d'autorisation (401) en erreur de forme (400).
//
// Ce module porte la RÈGLE et les requêtes ; il se teste sans base. Le script
// (scripts/check-vendor-expenses.mjs) ne fait que lire et imprimer.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * La règle, écrite UNE fois — et c'est la même que celle du déclencheur.
 *
 * `counted` est ce que l'application COMPTE pour cette dépense. Une ligne est
 * divergente quand `amount_paid` ne vaut pas `counted` : c'est la seule
 * définition qui vaille, parce que c'est celle qui décide du total des dépenses
 * affiché à l'école.
 */
export const VENDOR_EXPENSE_PAID_RULE = `
  case
    when v.payment_status = 'paid' then v.amount
    when v.payment_status = 'partial' then coalesce(v.amount_paid, 0)
    else 0
  end
`;

/**
 * Les dépenses dont le montant payé contredit le statut.
 *
 * Même prédicat que le `WHERE` du rattrapage de la migration — pas une
 * reformulation approchante : si les deux divergeaient, le contrôle deviendrait
 * vert sur des lignes que la réparation considère fausses (ou l'inverse), et
 * personne ne saurait laquelle des deux lectures croire.
 *
 * `amount < 0` est inclus ICI aussi : une dette négative est une corruption de
 * saisie, et le contrôle doit la nommer même si le déclencheur, lui, la laisse
 * passer (il refuse les écritures futures, il n'a pas réécrit l'histoire).
 */
export const VENDOR_EXPENSE_DIVERGENCE_SQL = `
  select v.id,
         v.vendor_name,
         v.payment_status,
         v.amount,
         coalesce(v.amount_paid, 0) as amount_paid,
         ${VENDOR_EXPENSE_PAID_RULE.trim()} as counted
    from public.vendor_expenses v
   where v.amount < 0
      or v.payment_status is null
      or v.payment_status not in ('unpaid', 'partial', 'paid')
      or (v.payment_status = 'paid'    and v.amount_paid is distinct from v.amount)
      or (v.payment_status = 'unpaid'  and coalesce(v.amount_paid, 0) <> 0)
      or (v.payment_status = 'partial' and (coalesce(v.amount_paid, 0) <= 0 or v.amount_paid >= v.amount))
   order by abs(coalesce(v.amount_paid, 0) - v.amount) desc, v.id
`;

/**
 * Les totaux, pour dire sur QUOI porte le contrôle.
 *
 * Un contrôle qui ne dit pas combien de dépenses il a lues ne prouve rien :
 * « aucun écart » sur une base vide et « aucun écart » sur 300 dépenses
 * s'écrivent de la même façon dans un journal.
 *
 * `counted_total` est le total que l'application affiche (statut + montant
 * lus ensemble) ; `paid_total` est la somme des montants STOCKÉS. Deux nombres
 * différents ne sont pas une erreur en soi quand des `partial` existent — c'est
 * pourquoi le contrôle compare aussi les lignes une à une.
 */
export const VENDOR_EXPENSE_TOTALS_SQL = `
  select count(*)::int as expenses,
         count(*) filter (where payment_status = 'paid')::int as paid,
         count(*) filter (where payment_status = 'partial')::int as partial,
         count(*) filter (where payment_status = 'unpaid')::int as unpaid,
         coalesce(sum(amount), 0) as owed_total,
         coalesce(sum(amount_paid), 0) as paid_total,
         coalesce(sum(
           case
             when payment_status = 'paid' then amount
             when payment_status = 'partial' then coalesce(amount_paid, 0)
             else 0
           end), 0) as counted_total
    from public.vendor_expenses
`;

/** Ce qu'une divergence VEUT DIRE — le geste qu'elle appelle, pas son signe. */
export const VENDOR_GAP_LABELS = {
  'negative-amount': 'un dû négatif (saisie corrompue, hors de la règle statut/montant)',
  'unknown-status': 'un statut inconnu (ni unpaid, ni partial, ni paid)',
  'paid-without-amount': 'une dépense marquée payée à 0 FCFA',
  'paid-amount-mismatch': 'une dépense payée pour un montant qui n’est pas son dû',
  'unpaid-with-amount': 'une dépense impayée qui porte un montant payé',
  'partial-without-amount': 'un paiement partiel à 0 FCFA',
  'partial-at-or-over-due': 'un paiement partiel qui atteint ou dépasse le dû',
  closed: 'le montant payé tient la promesse du statut',
};

/**
 * Ce qu'une ligne divergente est, en un mot.
 *
 * Les montants arrivent en CHAÎNES depuis `pg` (`numeric` → « 8000 ») : ils sont
 * ramenés en nombres AVANT d'être comparés, car « 900 » > « 1000 » est vrai pour
 * des chaînes — un contrôle juste la plupart du temps est faux quand il compte.
 *
 * @param {{ status?: string|null, amount?: unknown, amountPaid?: unknown }} input
 * @returns {keyof typeof VENDOR_GAP_LABELS}
 */
export function classifyVendorExpense({ status = null, amount = 0, amountPaid = 0 } = {}) {
  const due = Number(amount ?? 0);
  const paid = Number(amountPaid ?? 0);
  if (due < 0) return 'negative-amount';
  if (status !== 'paid' && status !== 'partial' && status !== 'unpaid') return 'unknown-status';
  if (status === 'paid') {
    if (paid === due) return 'closed';
    return paid === 0 ? 'paid-without-amount' : 'paid-amount-mismatch';
  }
  if (status === 'unpaid') return paid === 0 ? 'closed' : 'unpaid-with-amount';
  // `partial` : le nombre est une VRAIE saisie, donc il est borné — c'est la
  // seule branche où le déclencheur refuse au lieu de normaliser.
  if (paid <= 0) return 'partial-without-amount';
  if (paid >= due) return 'partial-at-or-over-due';
  return 'closed';
}

/**
 * Le rapport : les divergences classées, et les totaux sur lesquels elles portent.
 *
 * `gap` est l'écart entre le montant STOCKÉ et ce que le statut en attend
 * (`paid` → le dû, `unpaid` → 0, `partial` → lui-même). Un `partial` hors bornes
 * n'a donc pas d'écart arithmétique : son défaut est que le nombre est
 * impossible, et c'est `kind` qui le dit.
 *
 * @param {{ divergences?: Record<string, unknown>[], totals?: Record<string, unknown> }} input
 */
export function summarizeVendorExpenses({ divergences = [], totals = {} } = {}) {
  const rows = divergences.map((row) => {
    const due = Number(row.amount ?? 0);
    const paid = Number(row.amount_paid ?? 0);
    const status = row.payment_status == null ? null : String(row.payment_status);
    const counted = Number(row.counted ?? 0);
    const expected = status === 'paid' ? due : status === 'unpaid' ? 0 : paid;
    return {
      id: String(row.id ?? ''),
      vendor: row.vendor_name == null ? null : String(row.vendor_name),
      status,
      due,
      paid,
      counted,
      gap: paid - expected,
      kind: classifyVendorExpense({ status, amount: due, amountPaid: paid }),
    };
  });

  /** @type {Record<string, number>} */
  const byKind = {};
  for (const row of rows) byKind[row.kind] = (byKind[row.kind] ?? 0) + 1;

  return {
    expenses: Number(totals.expenses ?? 0),
    paid: Number(totals.paid ?? 0),
    partial: Number(totals.partial ?? 0),
    unpaid: Number(totals.unpaid ?? 0),
    owedTotal: Number(totals.owed_total ?? 0),
    paidTotal: Number(totals.paid_total ?? 0),
    countedTotal: Number(totals.counted_total ?? 0),
    diverging: rows.length,
    rows,
    byKind,
  };
}

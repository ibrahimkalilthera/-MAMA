// Suite du contrôle quotidien des dépenses fournisseurs
// (scripts/check-vendor-expenses.mjs + scripts/lib/vendor-expense-ledger.mjs).
//
// WHY THIS EXISTS
// ---------------
// Le 2026-11-08, `vendor_expenses.payment_status` et `amount_paid` pouvaient se
// contredire (un `paid` à 0, un `unpaid` qui porte un montant, un `partial` à
// 150 % du dû) sans que rien ne le mesure — alors que les quatre calculs d'argent
// de l'application les lisent ensemble. Le déclencheur de la migration
// `20261108000000` ferme les écritures futures ; ce contrôle mesure l'histoire.
//
// Ce qui se trompe sans base : le CLASSEMENT d'une divergence (un partiel
// « au-dessus du dû » n'est pas un partiel à 0), et la RÈGLE elle-même — si la
// requête du contrôle et le `WHERE` de la migration divergeaient, l'un dirait
// vert sur ce que l'autre déclare faux.
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

import {
  VENDOR_EXPENSE_DIVERGENCE_SQL,
  VENDOR_EXPENSE_PAID_RULE,
  VENDOR_EXPENSE_TOTALS_SQL,
  VENDOR_GAP_LABELS,
  classifyVendorExpense,
  summarizeVendorExpenses,
} from '../scripts/lib/vendor-expense-ledger.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel: string) => readFileSync(join(root, rel), 'utf8');
const MIGRATION = 'supabase/migrations/20261108000000_vendor_expense_paid_consistency.sql';

describe('dépenses fournisseurs — le classement d’une divergence', () => {
  it('un statut payé sans montant n’est pas la même histoire qu’un payé au mauvais montant', () => {
    assert.equal(classifyVendorExpense({ status: 'paid', amount: 1000, amountPaid: 0 }), 'paid-without-amount');
    assert.equal(classifyVendorExpense({ status: 'paid', amount: 1000, amountPaid: 500 }), 'paid-amount-mismatch');
    assert.equal(classifyVendorExpense({ status: 'paid', amount: 1000, amountPaid: 1000 }), 'closed');
  });

  it('un impayé qui porte un montant est nommé, même pour 1 FCFA', () => {
    assert.equal(classifyVendorExpense({ status: 'unpaid', amount: 1000, amountPaid: 1 }), 'unpaid-with-amount');
    assert.equal(classifyVendorExpense({ status: 'unpaid', amount: 1000, amountPaid: 0 }), 'closed');
  });

  it('un partiel est borné des deux côtés — le déclencheur refuse, il ne normalise pas', () => {
    assert.equal(classifyVendorExpense({ status: 'partial', amount: 1000, amountPaid: 0 }), 'partial-without-amount');
    assert.equal(
      classifyVendorExpense({ status: 'partial', amount: 1000, amountPaid: 1000 }),
      'partial-at-or-over-due',
      'un partiel égal au dû devrait être « payé »',
    );
    assert.equal(classifyVendorExpense({ status: 'partial', amount: 1000, amountPaid: 1500 }), 'partial-at-or-over-due');
    assert.equal(classifyVendorExpense({ status: 'partial', amount: 1000, amountPaid: 400 }), 'closed');
  });

  it('un statut inconnu et un dû négatif passent AVANT les autres lectures', () => {
    assert.equal(classifyVendorExpense({ status: 'settled', amount: 1000, amountPaid: 1000 }), 'unknown-status');
    assert.equal(classifyVendorExpense({ status: null, amount: 1000, amountPaid: 0 }), 'unknown-status');
    // Le dû négatif est une corruption de saisie : le déclencheur la laisse
    // passer (il refuse les écritures futures, il n'a pas réécrit l'histoire),
    // donc le contrôle doit la nommer.
    assert.equal(classifyVendorExpense({ status: 'paid', amount: -500, amountPaid: -500 }), 'negative-amount');
  });

  it('les montants arrivent en chaînes depuis pg — ils sont comparés en nombres', () => {
    // « 900 » > « 1000 » est vrai pour des chaînes : un contrôle juste la plupart
    // du temps serait faux quand il compte.
    assert.equal(classifyVendorExpense({ status: 'paid', amount: '1000', amountPaid: '900' }), 'paid-amount-mismatch');
    assert.equal(classifyVendorExpense({ status: 'paid', amount: '1000', amountPaid: '1000' }), 'closed');
  });

  it('chaque classe a un libellé lisible — un rapport sans mot ne dit rien', () => {
    for (const kind of Object.keys(VENDOR_GAP_LABELS)) {
      assert.ok(VENDOR_GAP_LABELS[kind as keyof typeof VENDOR_GAP_LABELS].length > 10, `${kind} porte un libellé`);
    }
  });
});

describe('dépenses fournisseurs — le rapport', () => {
  const totals = {
    expenses: 12,
    paid: 7,
    partial: 3,
    unpaid: 2,
    owed_total: '1500000',
    paid_total: '1100000',
    counted_total: '1110000',
  };

  it('compte les divergences par classe, et donne l’écart de chacune', () => {
    const summary = summarizeVendorExpenses({
      totals,
      divergences: [
        { id: 'a', vendor_name: 'Fournisseur A', payment_status: 'paid', amount: '100000', amount_paid: '40000', counted: '100000' },
        { id: 'b', vendor_name: 'Fournisseur B', payment_status: 'unpaid', amount: '50000', amount_paid: '5000', counted: '0' },
        { id: 'c', vendor_name: 'Fournisseur C', payment_status: 'partial', amount: '20000', amount_paid: '30000', counted: '30000' },
      ],
    });

    assert.equal(summary.expenses, 12);
    assert.equal(summary.diverging, 3);
    assert.equal(summary.owedTotal, 1500000);
    assert.equal(summary.paidTotal, 1100000);
    assert.equal(summary.countedTotal, 1110000);
    assert.deepEqual(summary.rows.map((row) => row.kind), [
      'paid-amount-mismatch',
      'unpaid-with-amount',
      'partial-at-or-over-due',
    ]);
    assert.equal(summary.rows[0]?.gap, -60000, 'payé 40 000 pour un dû de 100 000 : il manque 60 000');
    assert.equal(summary.rows[1]?.gap, 5000, 'un impayé qui porte 5 000 afficherait 5 000 de trop');
    assert.equal(
      summary.rows[2]?.gap,
      0,
      'un partiel hors bornes n’a pas d’écart arithmétique : son défaut est que le nombre est impossible',
    );
    assert.deepEqual(summary.byKind, {
      'paid-amount-mismatch': 1,
      'unpaid-with-amount': 1,
      'partial-at-or-over-due': 1,
    });
  });

  it('un registre qui tient rend un rapport vide, pas un rapport muet', () => {
    const summary = summarizeVendorExpenses({ totals });
    assert.equal(summary.diverging, 0);
    assert.deepEqual(summary.rows, []);
    assert.equal(summary.expenses, 12, 'la couverture est dite même quand il n’y a rien à corriger');
  });

  it('les totaux absents ne deviennent pas NaN', () => {
    const summary = summarizeVendorExpenses();
    assert.equal(summary.expenses, 0);
    assert.equal(summary.diverging, 0);
    assert.equal(summary.owedTotal, 0);
  });
});

describe('dépenses fournisseurs — la règle mesurée est celle du déclencheur', () => {
  const migration = read(MIGRATION);
  const sql = read('scripts/check-vendor-expenses.mjs');

  it('le contrôle lit ce que l’application compte : paid → dû, partial → montant, sinon 0', () => {
    assert.match(VENDOR_EXPENSE_PAID_RULE, /payment_status = 'paid' then v\.amount/);
    assert.match(VENDOR_EXPENSE_PAID_RULE, /payment_status = 'partial' then coalesce\(v\.amount_paid, 0\)/);
    assert.match(VENDOR_EXPENSE_DIVERGENCE_SQL, /else 0/);
  });

  it('son WHERE porte les trois mêmes conditions que le rattrapage de la migration', () => {
    for (const condition of [
      /payment_status = 'paid'\s+and v\.amount_paid is distinct from v\.amount/,
      /payment_status = 'unpaid'\s+and coalesce\(v\.amount_paid, 0\) <> 0/,
      /payment_status = 'partial' and \(coalesce\(v\.amount_paid, 0\) <= 0 or v\.amount_paid >= v\.amount\)/,
    ]) {
      assert.match(VENDOR_EXPENSE_DIVERGENCE_SQL, condition, 'le contrôle reprend la condition du déclencheur');
    }
    // La migration écrit la même règle, dans sa propre syntaxe : si elle change
    // sans que le contrôle suive, l'un des deux dira faux sur l'autre.
    assert.match(migration, /v\.payment_status = 'paid'   AND v\.amount_paid IS DISTINCT FROM v\.amount/i);
    assert.match(migration, /v\.payment_status = 'unpaid' AND coalesce\(v\.amount_paid, 0\) <> 0/i);
    assert.match(migration, /v\.payment_status = 'partial' AND \(coalesce\(v\.amount_paid, 0\) <= 0 OR v\.amount_paid >= v\.amount\)/i);
  });

  it('le contrôle est en LECTURE SEULE — il ne corrige rien', () => {
    assert.doesNotMatch(sql, /\bupdate\s+public\.vendor_expenses/i, 'une réparation automatique effacerait la trace du contournement');
    assert.doesNotMatch(sql, /--repair/, 'aucune option de réparation : un partiel hors bornes demande un arbitrage');
    assert.match(sql, /process\.exitCode = 1/, 'un écart rend la commande rouge');
    assert.match(sql, /SUPABASE_DB_PASSWORD absent/, 'sans mot de passe, « pas regardé » n’est pas un vert');
  });

  it('les totaux disent sur QUOI porte le contrôle', () => {
    assert.match(VENDOR_EXPENSE_TOTALS_SQL, /count\(\*\)::int as expenses/);
    assert.match(VENDOR_EXPENSE_TOTALS_SQL, /owed_total/);
    assert.match(VENDOR_EXPENSE_TOTALS_SQL, /counted_total/);
  });
});

describe('dépenses fournisseurs — la veille quotidienne est branchée', () => {
  it('la commande existe sous son nom', () => {
    const pkg = JSON.parse(read('package.json'));
    assert.equal(pkg.scripts['check:vendor-expenses'], 'node scripts/check-vendor-expenses.mjs');
  });

  it('le workflow a un cron ET un push — un cron sans run resterait dormant', () => {
    const workflow = read('.github/workflows/vendor-expense-watch.yml');
    assert.match(workflow, /cron: '35 6 \* \* \*'/, 'avant l’audit des automatisations de 06:41');
    assert.match(workflow, /paths:/, 'un push sur la règle ou le contrôle doit lancer une mesure');
    assert.match(workflow, /npm run check:vendor-expenses/);
    assert.match(workflow, /AUTOMATION_EVIDENCE: '1'/, 'le contrôle publie ce qu’il a lu et trouvé');
    assert.match(
      workflow,
      /Publier la preuve d’action/,
      'le nom de l’étape est le contrat que lit l’audit (EVIDENCE_STEP_NAME)',
    );
  });
});

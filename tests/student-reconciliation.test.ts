/**
 * L'ÉTAT DE RAPPROCHEMENT — mois réglés, mois encore dus, et la règle qui
 * empêche l'avis de relance de réclamer une famille qui a payé.
 *
 * Le module est PUR : ni React, ni base. C'est ici que le critère est
 * verrouillé, pas dans la modale : la modale prouve le câblage DOM, ce fichier
 * prouve le calcul ET la phrase.
 *
 * Ce qui compte, et pourquoi :
 *   • les mois réglés portent le REÇU qui les déclare — un état se vérifie sur
 *     les papiers de la famille, pas sur une case cochée ;
 *   • un reçu MUET (aucun mois déclaré) ne dit pas ce qu'il couvre : la phrase
 *     des mois dus doit alors porter sa RÉSERVE, jamais annoncer « encore dus »
 *     tout court — c'est le pire papier qu'une école puisse envoyer ;
 *   • l'année illisible ne fait pas inventer de mois : elle le DIT ;
 *   • l'argent suit la remise, comme la fiche, et un solde ne devient jamais
 *     négatif.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { academicYearMonths, paymentMonthLabel } from '../src/lib/paymentMonths';
import type { PaymentLike } from '../src/lib/paymentMonths';
import { reconciliationDue, studentReconciliation } from '../src/lib/studentReconciliation';
import type { ReconciliationWords } from '../src/lib/studentReconciliation';
import { translations } from '../src/i18n/translations';

const YEAR = '2026-2027';
const year = academicYearMonths(YEAR); // 2026-09 … 2027-08

/** Les mots tels que l'écran les monte — depuis le dictionnaire réel. */
function words(lang: 'fr' | 'en'): ReconciliationWords {
  return {
    label: (ym: string) => paymentMonthLabel(ym, translations[lang]),
    dueLine: translations[lang].reconciliationDueLine,
    dueReserved: translations[lang].reconciliationDueReserved,
    complete: translations[lang].monthsCoverageComplete,
    noYear: translations[lang].reconciliationNoYear,
  };
}

/** Un reçu qui DÉCLARE les mois `months` — `undefined` : reçu muet. */
const receipt = (id: string, date: string, amount: number, months?: string[]): PaymentLike =>
  ({ id, date, amount, receiptNumber: `REC-${id}`, months });

const student = (payments: PaymentLike[], over: Partial<{ totalDue: number; amountPaid: number; scholarshipDiscount: number }> = {}) => ({
  payments,
  totalDue: 150000,
  amountPaid: payments.reduce((sum, p) => sum + p.amount, 0),
  ...over,
});

describe('studentReconciliation — les mois réglés et les mois restants', () => {
  it('attache chaque mois réglé au reçu qui le déclare, et laisse les autres en reste', () => {
    const rec = studentReconciliation(student([receipt('p1', '2026-09-04', 50000, ['2026-09'])]), year);
    assert.deepEqual(rec.covered.map((f) => f.month), ['2026-09']);
    assert.deepEqual(
      rec.covered[0].receipts.map((r) => r.receiptNumber),
      ['REC-p1'],
      'le mois porte le reçu qui le déclare : la famille et l’école parlent du même papier',
    );
    assert.equal(rec.due.length, 11, 'onze mois restent — aucun n’est déclaré par un reçu');
    assert.equal(rec.undeclared, 0);
  });

  it('suit la REMISE comme la fiche, et ne rend jamais un solde négatif', () => {
    const remise = studentReconciliation(student([receipt('p1', '2026-09-04', 50000, ['2026-09'])], { scholarshipDiscount: 10 }), year);
    assert.equal(remise.totalDue, 135000, 'le dû est net de remise (150 000 − 10 %)');
    assert.equal(remise.balance, 85000);

    const avance = studentReconciliation(student([receipt('p2', '2026-09-04', 200000, ['2026-09'])], { amountPaid: 200000 }), year);
    assert.equal(avance.balance, 0, 'une famille en avance ne doit rien : pas de solde négatif');
  });

  it('ignore un mois d’une AUTRE année scolaire — il n’est ni réglé, ni dû ici', () => {
    const rec = studentReconciliation(student([receipt('p1', '2025-10-04', 50000, ['2025-10'])]), year);
    assert.deepEqual(rec.covered, [], 'octobre 2025 n’est pas octobre 2026');
    assert.equal(rec.due.length, 12, 'et il ne retire aucun mois de l’année jugée');
  });
});

describe('reconciliationDue — la phrase des mois dus, et sa réserve', () => {
  it('dit la liste simple quand chaque reçu déclare ses mois', () => {
    const rec = studentReconciliation(student([receipt('p1', '2026-09-04', 50000, ['2026-09', '2026-10'])]), year);
    const due = reconciliationDue(rec, words('fr'));
    assert.equal(due.reserved, false, 'aucun reçu muet : rien à réserver');
    assert.equal(due.line, 'Encore dus : Novembre, Décembre, Janvier, Février, Mars, Avril, Mai, Juin, Juillet, Août.');
  });

  it('REFUSE la formule sèche dès qu’un reçu est muet — sa couverture est inconnue', () => {
    // Le cas qui compte : la famille a peut-être déjà payé octobre, mais le reçu
    // saisi avant la colonne `months` ne le dit pas. Annoncer « encore dus »
    // tout court reviendrait à réclamer un mois réglé.
    const rec = studentReconciliation(student([
      receipt('p1', '2026-09-04', 50000, ['2026-09']),
      receipt('p2', '2026-09-06', 50000), // muet
    ]), year);
    assert.equal(rec.undeclared, 1, 'le reçu muet est compté');
    const due = reconciliationDue(rec, words('fr'));
    assert.equal(due.reserved, true);
    // Octobre est nommé — aucun reçu ne le déclare — mais il l'est SOUS RÉSERVE :
    // c'est peut-être exactement le mois que le reçu muet a payé.
    assert.equal(
      due.line,
      'Octobre, Novembre, Décembre, Janvier, Février, Mars, Avril, Mai, Juin, Juillet, Août — sous réserve : 1 reçu(s) ne déclarent aucun mois. Vérifiez les reçus de la famille avant toute relance.',
      'la phrase porte la réserve, ET le nombre de reçus à vérifier',
    );
    assert.notEqual(
      due.line,
      words('fr').dueLine.replace('{months}', due.months.map((m) => paymentMonthLabel(m, translations.fr)).join(', ')),
      'jamais la formule sèche quand la couverture est incertaine',
    );
  });

  it('porte la même réserve en anglais', () => {
    const rec = studentReconciliation(student([receipt('p1', '2026-09-06', 50000)]), year);
    const due = reconciliationDue(rec, words('en'));
    assert.equal(due.reserved, true);
    assert.ok(due.line.includes('subject to confirmation'), due.line);
    assert.ok(due.line.includes('1 receipt(s) declare no months'), due.line);
  });

  it('dit la couverture complète quand TOUS les mois sont déclarés', () => {
    const rec = studentReconciliation(student([receipt('p1', '2026-09-04', 300000, year)]), year);
    assert.deepEqual(rec.due, []);
    const due = reconciliationDue(rec, words('fr'));
    assert.equal(due.line, translations.fr.monthsCoverageComplete);
    assert.equal(due.reserved, false);
  });

  it('ne fabrique AUCUN mois quand l’année est illisible — et le dit', () => {
    const rec = studentReconciliation(student([receipt('p1', '2026-09-04', 50000, ['2026-09'])]), []);
    assert.deepEqual(rec.yearMonths, []);
    assert.deepEqual(rec.covered, []);
    assert.deepEqual(rec.due, []);
    const due = reconciliationDue(rec, words('fr'));
    assert.equal(due.line, translations.fr.reconciliationNoYear);
    assert.equal(due.reserved, false, 'rien à réserver puisqu’aucun mois n’est nommé');
  });
});

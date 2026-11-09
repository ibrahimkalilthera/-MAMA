/**
 * Suite for `src/lib/outstandingInstallments.ts` — le RESTE DÛ de l'école.
 *
 * L'écran des versements partiels ne calcule rien : il affiche cet agrégat. Ces
 * cas tiennent donc les trois promesses de la vue — un mois entamé et non soldé
 * y est, un mois soldé n'y est plus, et ce qui ne peut pas être rattaché à un
 * mois est COMPTÉ au lieu de disparaître du total.
 *
 * Frais annuels 120 000 FCFA, pas de bourse → 10 000 FCFA par mois.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  filterOutstanding,
  outstandingInstallments,
  type OutstandingStudentLike,
} from '../src/lib/outstandingInstallments';

const student = (over: Partial<OutstandingStudentLike> = {}): OutstandingStudentLike => ({
  id: 's1',
  name: 'Ali Diallo',
  grade: '9eme A',
  totalDue: 120000,
  scholarshipDiscount: 0,
  payments: [],
  ...over,
});

describe('outstandingInstallments — ce qui reste dû, mois par mois', () => {
  it('un mois entamé et non soldé porte son reste', () => {
    const report = outstandingInstallments([
      student({
        payments: [{ id: 'p1', amount: 4000, dueAmount: 10000, months: ['2026-09'], date: '2026-10-01' }],
      }),
    ]);
    assert.equal(report.students.length, 1);
    const row = report.students[0]!;
    assert.equal(row.studentId, 's1');
    assert.deepEqual(row.months, [
      { month: '2026-09', due: 10000, paid: 4000, remaining: 6000, lastDate: '2026-10-01' },
    ]);
    assert.equal(row.remaining, 6000);
    assert.equal(report.total, 6000);
    assert.equal(report.monthCount, 1);
  });

  it('deux versements partiels sur le même mois s’additionnent, sans double compte', () => {
    // Le second geste a été saisi quand il restait 6 000 : son `dueAmount` vaut
    // 6 000, pas 10 000. Le reste ne doit donc pas repartir de 10 000.
    const report = outstandingInstallments([
      student({
        payments: [
          { id: 'p1', amount: 4000, dueAmount: 10000, months: ['2026-09'], date: '2026-09-20' },
          { id: 'p2', amount: 2000, dueAmount: 6000, months: ['2026-09'], date: '2026-10-05' },
        ],
      }),
    ]);
    const month = report.students[0]!.months[0]!;
    assert.equal(month.paid, 6000);
    assert.equal(month.remaining, 4000);
    assert.equal(month.lastDate, '2026-10-05', 'la relance cite le geste le plus récent');
  });

  it('un mois SOLDÉ quitte la liste — c’est le travail qui reste, pas l’historique', () => {
    const report = outstandingInstallments([
      student({
        payments: [
          { id: 'p1', amount: 4000, dueAmount: 10000, months: ['2026-09'] },
          { id: 'p2', amount: 6000, dueAmount: 6000, months: ['2026-09'] },
        ],
      }),
    ]);
    assert.equal(report.students.length, 0);
    assert.equal(report.total, 0);
    assert.equal(report.monthCount, 0);
  });

  it('un versement partiel sur un AUTRE mois ne ferme pas celui-ci', () => {
    const report = outstandingInstallments([
      student({
        payments: [
          { id: 'p1', amount: 4000, dueAmount: 10000, months: ['2026-09'] },
          { id: 'p2', amount: 9000, dueAmount: 10000, months: ['2026-10'] },
        ],
      }),
    ]);
    assert.deepEqual(report.students[0]!.months.map((m) => [m.month, m.remaining]), [
      ['2026-09', 6000],
      ['2026-10', 1000],
    ]);
    assert.equal(report.total, 7000);
  });

  it('un élève sans frais déclarés ne produit aucune ligne', () => {
    const report = outstandingInstallments([
      student({ totalDue: 0, payments: [{ amount: 4000, dueAmount: 10000, months: ['2026-09'] }] }),
    ]);
    assert.equal(report.students.length, 0, 'sans frais, il n’y a pas de reste à relancer');
  });

  it('compte les versements partiels qui ne déclarent aucun mois, sans les additionner', () => {
    const report = outstandingInstallments([
      student({
        payments: [
          { amount: 4000, dueAmount: 10000, months: [] },
          { amount: 3000, dueAmount: 10000, months: ['2026-09'] },
        ],
      }),
    ]);
    assert.equal(report.undeclared, 1);
    // Il n'est dans aucun mois : le total ne peut donc pas le compter, et c'est
    // exactement pourquoi l'écran le nomme à part.
    assert.equal(report.total, 7000);
  });

  it('ignore un paiement soldé et un paiement sans montant attendu', () => {
    const report = outstandingInstallments([
      student({
        payments: [
          { amount: 10000, dueAmount: 10000, months: ['2026-09'] },
          { amount: 10000, months: ['2026-10'] },
        ],
      }),
    ]);
    assert.equal(report.students.length, 0);
    assert.equal(report.undeclared, 0);
  });
});

describe('outstandingInstallments — l’ordre de la relance', () => {
  it('trie les élèves par nom, puis les mois dans l’ordre du calendrier', () => {
    const report = outstandingInstallments([
      student({ id: 'b', name: 'Binta Traoré', payments: [{ amount: 1000, dueAmount: 10000, months: ['2026-11', '2026-09'] }] }),
      student({ id: 'a', name: 'Aly Diallo', payments: [{ amount: 1000, dueAmount: 10000, months: ['2026-10'] }] }),
      student({ id: 'c', name: 'émilie Cissé', payments: [{ amount: 1000, dueAmount: 10000, months: ['2026-09'] }] }),
    ]);
    assert.deepEqual(report.students.map((s) => s.studentName), ['Aly Diallo', 'Binta Traoré', 'émilie Cissé']);
    assert.deepEqual(report.students[1]!.months.map((m) => m.month), ['2026-09', '2026-11']);
    assert.equal(report.monthCount, 4);
  });

  it('la recherche nomme un élève ou une classe, sans accent ni casse', () => {
    const report = outstandingInstallments([
      student({ id: 'a', name: 'Aly Diallo', grade: '9eme A', payments: [{ amount: 1000, dueAmount: 10000, months: ['2026-09'] }] }),
      student({ id: 'b', name: 'Binta Traoré', grade: '6eme B', payments: [{ amount: 2000, dueAmount: 10000, months: ['2026-09'] }] }),
    ]);
    assert.deepEqual(filterOutstanding(report, 'ALY').students.map((s) => s.studentId), ['a']);
    assert.deepEqual(filterOutstanding(report, '6eme').students.map((s) => s.studentId), ['b']);
    assert.equal(filterOutstanding(report, '  ').students.length, 2, 'une recherche vide ne filtre rien');
    assert.equal(filterOutstanding(report, 'zzz').students.length, 0);
    // Les totaux suivent la recherche : le badge ne somme pas des lignes cachées.
    assert.equal(filterOutstanding(report, 'binta').total, 8000);
    assert.equal(filterOutstanding(report, '').total, 17000);
  });
});

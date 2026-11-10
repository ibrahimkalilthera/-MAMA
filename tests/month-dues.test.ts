/**
 * Suite for the two decisions this change adds to the shared database:
 *
 *   • `students.month_dues` — the amount a month CLAIMS, decided by the school
 *     (économe / admin / dev) instead of being only the annual-fee share. The
 *     decided amount must reach `installmentTarget` (the counter's "amount due
 *     for this month"), the remaining debt and the partial-payment list, and it
 *     must live on the pupil's record so every station reads the same number.
 *
 *   • `academic_years.selected_at` — the YEAR an admin/dev published for the
 *     whole fleet. A station follows it when the publication is NEWER than its
 *     own choice; a station that opened an archive afterwards keeps it; and a
 *     declaration the app merely MAINTAINS (no `selected_at`) publishes nothing.
 *
 * Both rules are pure, so they are locked here without a database or a browser.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { installmentTarget, monthDueOf, readMonthDues } from '../src/lib/paymentInstallments';
import { pickWorkingYear } from '../src/lib/academicYears';

describe('students.month_dues — le montant d’un mois décidé par l’école', () => {
  it('relit { "YYYY-MM": montant } et écarte tout ce qui n’est pas un mois', () => {
    assert.deepEqual(
      readMonthDues({ '2026-11': 9000, '2026-13': 1, sept: 2, '2027-01': -5, '2026-12': '12000' }),
      { '2026-11': 9000, '2026-12': 12000 },
    );
    assert.equal(readMonthDues(null), undefined);
    assert.equal(readMonthDues([]), undefined);
    assert.equal(readMonthDues({}), undefined);
  });

  it('prend la décision de l’école, sinon la part des frais annuels', () => {
    const student = { totalDue: 120000, monthDues: { '2026-11': 9000 } };
    assert.equal(monthDueOf(student, '2026-11', 12), 9000);
    assert.equal(monthDueOf(student, '2026-12', 12), 10000);
  });

  it('fait du montant décidé le « à régler » du mois, reste dû compris', () => {
    const student = {
      totalDue: 120000,
      monthDues: { '2026-11': 9000 },
      payments: [{ date: '2026-11-01', amount: 4000, dueAmount: 9000, months: ['2026-11'] }],
    };
    const target = installmentTarget(student, ['2026-11'], 12);
    assert.equal(target.due, 9000);
    assert.equal(target.partialPaid, 4000);
    assert.equal(target.remaining, 5000);
  });

  it('additionne les mois décidés sans changer la somme des mois ordinaires', () => {
    const student = { totalDue: 100000, monthDues: { '2026-11': 9000 } };
    assert.equal(installmentTarget(student, ['2026-10', '2026-11'], 10).due, 19000);
    assert.equal(installmentTarget({ totalDue: 100000 }, ['2026-10', '2026-11'], 10).due, 20000);
  });
});

describe('academic_years.selected_at — l’année publiée pour tout le parc', () => {
  it('suit la décision publiée quand elle est plus récente que le choix du poste', () => {
    const rows = [
      { year_name: '2025-2026', is_current: true, selected_at: '2026-11-10T08:00:00.000Z' },
      { year_name: '2026-2027', is_current: false, selected_at: null },
    ];
    const stored = { year: '2026-2027', at: '2026-11-09T08:00:00.000Z' };
    assert.equal(
      pickWorkingYear({ rows, stored, today: new Date('2026-11-10T10:00:00.000Z') }),
      '2025-2026',
    );
  });

  it('respecte un choix local fait APRÈS la publication', () => {
    const rows = [
      { year_name: '2025-2026', is_current: true, selected_at: '2026-11-10T08:00:00.000Z' },
      { year_name: '2026-2027', is_current: false, selected_at: null },
    ];
    const stored = { year: '2026-2027', at: '2026-11-10T09:00:00.000Z' };
    assert.equal(
      pickWorkingYear({ rows, stored, today: new Date('2026-11-10T10:00:00.000Z') }),
      '2026-2027',
    );
  });

  it('ignore une déclaration entretenue mais NON datée (aucune publication)', () => {
    const rows = [
      { year_name: '2026-2027', is_current: false },
      { year_name: '2027-2028', is_current: true },
    ];
    const stored = { year: '2026-2027', at: '2027-09-01T08:00:00.000Z' };
    assert.equal(
      pickWorkingYear({ rows, stored, today: new Date('2027-09-02T10:00:00.000Z') }),
      '2026-2027',
    );
  });
});

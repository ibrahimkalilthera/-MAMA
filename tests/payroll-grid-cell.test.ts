// Pure unit tests for the school-year payroll grid cell rule (PayrollView).
//
// Locks the audit fix: the 12-month grid follows the school year, and the
// current month only turns red "unpaid" once the payroll window closes — from
// the 11th (src/lib/payrollWindow.ts), never before. The day-10/day-11
// boundary below is the exact threshold the rest of the app uses (sidebar,
// banner, employee cards), so the grid can never disagree with them.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { payrollGridCellStatus } from '../src/lib/payrollGrid';

const now = new Date('2026-09-06T12:00:00Z'); // 6 September 2026: window open
const nowLate = new Date('2026-09-12T12:00:00Z'); // 12 September 2026: late

const status = (opts: Partial<Parameters<typeof payrollGridCellStatus>[0]>) =>
  payrollGridCellStatus({
    isFuture: false,
    isCurrentCell: true,
    totalPaid: 0,
    totalExpected: 100000,
    now,
    ...opts,
  });

describe('payrollGridCellStatus (grille 12 mois — année scolaire + seuil unifié)', () => {
  it('classe un mois futur comme planifié, quel que soit le solde', () => {
    assert.equal(status({ isFuture: true, totalPaid: 0 }), 'scheduled');
    assert.equal(status({ isFuture: true, totalPaid: 50000 }), 'scheduled');
  });

  it('laisse le mois courant impayé « en cours » tant que la fenêtre est ouverte (1–10)', () => {
    assert.equal(status({ now: new Date('2026-09-01T12:00:00Z') }), 'open');
    assert.equal(status({ now: new Date('2026-09-05T12:00:00Z') }), 'open');
    assert.equal(status({ now: new Date('2026-09-10T12:00:00Z') }), 'open', 'le 10 reste dans la fenêtre');
  });

  it('passe en rouge « non payé » dès le 11 (même seuil que la sidebar et les cartes)', () => {
    assert.equal(status({ now: new Date('2026-09-11T12:00:00Z') }), 'unpaid');
    assert.equal(status({ now: new Date('2026-09-12T12:00:00Z') }), 'unpaid');
  });

  it('un mois passé non payé est « non payé » (pas de grâce pour les mois écoulés)', () => {
    assert.equal(status({ isCurrentCell: false, now }), 'unpaid');
    assert.equal(status({ isCurrentCell: false, now: nowLate }), 'unpaid');
  });

  it('solde complet → payé ; acompte → partiel', () => {
    assert.equal(status({ totalPaid: 100000 }), 'settle');
    assert.equal(status({ totalPaid: 120000 }), 'settle', 'un trop-perçu reste payé');
    assert.equal(status({ totalPaid: 40000 }), 'partial');
    assert.equal(status({ totalPaid: 99999 }), 'partial');
  });
});

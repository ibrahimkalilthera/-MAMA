/**
 * `withYearSpan` — la plage qu'on vient d'enregistrer est celle que l'écran
 * montre, MÊME quand la liste des années ne porte pas encore la ligne.
 *
 * Le défaut réparé : au guichet, l'administration passait le premier mois de
 * septembre à octobre, enregistrait, et le sélecteur revenait à septembre. La
 * base avait pourtant reçu `start_month = 10` (vérifié en production). La carte
 * lit la plage EN VIGUEUR sur les lignes d'`academic_years` (`yearMonths`) ; sur
 * un poste dont la lecture d'années était revenue VIDE — une lecture faite sans
 * session, la policy étant `to authenticated` — la mise à jour « par
 * correspondance » ne touchait aucune ligne, et l'écran retombait donc sur la
 * plage par défaut.
 *
 * Ce que la fonction doit garantir, et que chaque cas mesure :
 *   • la ligne EXISTANTE est réécrite, et rien d'autre ne bouge ;
 *   • la ligne ABSENTE est AJOUTÉE — c'est ce qui fait que le geste se voit ;
 *   • la liste d'entrée n'est jamais modifiée sur place (l'état React compare) ;
 *   • une année vide ne fabrique aucune ligne.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { AcademicYearRow } from '../src/lib/academicYears';
import { withYearSpan } from '../src/lib/academicYears';

const ROWS: AcademicYearRow[] = [
  { year_name: '2025-2026', is_current: false, start_month: 9, end_month: 6 },
  { year_name: '2026-2027', is_current: true, start_month: 9, end_month: 6 },
];

describe('withYearSpan — la plage enregistrée devient la plage lue', () => {
  it('réécrit la ligne de l’année, et laisse les autres intactes', () => {
    const next = withYearSpan(ROWS, '2026-2027', 10, 6);
    const target = next.find((row) => row.year_name === '2026-2027');
    assert.equal(target?.start_month, 10, 'le premier mois enregistré doit se lire : c’est lui qui « revenait à septembre »');
    assert.equal(target?.end_month, 6);
    assert.equal(target?.is_current, true, 'le reste de la ligne survit à la mise à jour');
    assert.deepEqual(
      next.find((row) => row.year_name === '2025-2026'),
      ROWS[0],
      'une autre année ne doit pas bouger : la plage est celle d’une année, pas de toutes',
    );
    assert.equal(next.length, ROWS.length, 'aucune ligne en double');
  });

  it('AJOUTE la ligne absente — c’est le cas qui rendait le geste invisible', () => {
    const next = withYearSpan([], '2026-2027', 10, 7);
    assert.deepEqual(next, [{ year_name: '2026-2027', start_month: 10, end_month: 7 }]);
  });

  it('ajoute à la liste existante sans écraser les années déjà lues', () => {
    const next = withYearSpan(ROWS.slice(0, 1), '2026-2027', 10, 6);
    assert.equal(next.length, 2, 'les années déjà lues restent offertes au sélecteur');
    assert.equal(next[0].year_name, '2025-2026');
    assert.equal(next[1].start_month, 10);
  });

  it('ne modifie pas la liste d’entrée', () => {
    const snapshot = JSON.stringify(ROWS);
    withYearSpan(ROWS, '2026-2027', 10, 6);
    assert.equal(JSON.stringify(ROWS), snapshot, 'l’état d’entrée est immuable : React ne verrait pas le changement sinon');
  });

  it('une année vide ne fabrique aucune ligne', () => {
    assert.deepEqual(withYearSpan(ROWS, '   ', 10, 6), ROWS);
  });
});

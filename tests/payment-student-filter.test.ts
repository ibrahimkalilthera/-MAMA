/**
 * Suite pure (sans DOM, sans React) pour src/lib/paymentStudentFilter.ts.
 *
 * Le formulaire Enregistrer le Paiement combine un filtre de CLASSE et une
 * RECHERCHE par nom ou matricule. La frappe ne pouvant pas être simulée sous le
 * harnais happy-dom (React lit `onChange` via un value-tracker que le DOM de
 * test ne fait jamais bouger), le comportement — et donc l'intersection des
 * deux filtres — est vérifié ici, à la source.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ALL_CLASSES, filterStudents, matchesClass, matchesSearch } from '../src/lib/paymentStudentFilter';

const student = (name: string, grade?: string, studentId?: string) => ({ name, grade, studentId });
const names = (list: { name: string }[]) => list.map((s) => s.name);

describe('paymentStudentFilter — recherche nom/matricule combinée au filtre de classe', () => {
  it('la requête vide ne filtre rien et « toutes les classes » accepte tout le monde', () => {
    assert.equal(matchesSearch(student('Awa', '1A', 'MAT-1'), '   '), true);
    assert.equal(matchesClass('1A', ALL_CLASSES), true);
  });

  it('filtre de classe : insensible à la casse et aux espaces', () => {
    assert.equal(matchesClass(' 1a ', '1A'), true);
    assert.equal(matchesClass(' 1a ', '2A'), false);
  });

  it('recherche par nom, insensible à la casse et aux espaces parasites', () => {
    const list = [student('Awa', '1A', 'MAT-001'), student('Binta', '2A', '2026-0002')];
    assert.deepEqual(names(filterStudents(list, ALL_CLASSES, '  bInTa ')), ['Binta']);
  });

  it('recherche par matricule', () => {
    const list = [student('Awa', '1A', 'MAT-001'), student('Binta', '2A', '2026-0002')];
    assert.deepEqual(names(filterStudents(list, ALL_CLASSES, '0002')), ['Binta']);
    assert.deepEqual(names(filterStudents(list, ALL_CLASSES, 'MAT-00')), ['Awa']);
  });

  it('combine recherche ET classe (intersection)', () => {
    const list = [student('Awa', '1A', 'MAT-001'), student('Binta', '2A', '2026-0002')];
    assert.deepEqual(names(filterStudents(list, '2A', 'binta')), ['Binta']);
    assert.deepEqual(filterStudents(list, '1A', 'binta'), []); // nom trouvé mais mauvaise classe
    assert.deepEqual(names(filterStudents(list, '1A', 'awa')), ['Awa']);
    assert.deepEqual(filterStudents(list, '1A', 'introuvable'), []);
  });

  it('un élève sans matricule reste trouvable par son nom', () => {
    assert.equal(matchesSearch(student('Coumba'), 'coumba'), true);
    assert.deepEqual(names(filterStudents([student('Coumba')], ALL_CLASSES, 'coum')), ['Coumba']);
  });
});

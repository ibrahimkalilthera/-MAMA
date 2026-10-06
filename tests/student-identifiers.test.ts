/**
 * Pure tests for the student-identifier policy.
 * No DOM is needed: this module only normalizes class labels and identifiers.
 *
 * ─── La politique a changé le 2026-10-06, et ces cas le DISENT ──────────────
 * Jusqu'ici le matricule était réservé aux 9e (un numéro d'examen saisi à la
 * main), et `visibleStudentIdentifier` rendait `undefined` pour toute autre
 * classe — c'était même le cas CENTRAL de cette suite (« 6B → undefined »).
 * Le propriétaire a demandé un matricule pour TOUS les élèves, déjà enregistrés
 * comme à venir : le matricule appartient maintenant à la base, et `6B` n'est
 * plus un motif d'absence. Ce n'est donc pas un test affaibli, c'est la règle
 * qui a changé — et `isNinthGradeClass` garde son seul rôle : le champ ÉDITABLE
 * du formulaire (le numéro d'examen que l'école seule connaît).
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { isNinthGradeClass, studentMatricule } from '../src/lib/studentIdentifiers';

describe('isNinthGradeClass', () => {
  it('accepts ninth-grade codes, sections, and localized display labels', () => {
    for (const value of ['9', '9A', '9D', '9e', '9ème Année A', '9eme(A)', '9emeA', '9th Year D', '9thA']) {
      assert.equal(isNinthGradeClass(value), true, `expected ${value} to be eligible`);
    }
  });

  it('rejects every other grade and numeric prefix that only contains a 9', () => {
    for (const value of ['', '8A', '10A', '19A', '29ème Année', '3e', undefined]) {
      assert.equal(isNinthGradeClass(value), false, `expected ${String(value)} to be rejected`);
    }
  });
});

describe('studentMatricule — le matricule appartient à TOUT élève', () => {
  it('ne dépend plus de la classe : la classe n’est même plus un argument', () => {
    // Le changement, dit dans la FORME : tant que le matricule se lisait à
    // travers la classe (`visibleStudentIdentifier(grade, id)`), une 6e ne
    // pouvait pas en porter un. La fonction qui reste ne prend que le matricule.
    assert.equal(studentMatricule.length, 1);
  });

  it('rend la valeur trimée, quelle qu’elle soit', () => {
    assert.equal(studentMatricule(' MT-2026-004 '), 'MT-2026-004');
    assert.equal(studentMatricule('MT-2026-005'), 'MT-2026-005');
  });

  it('une valeur vide ou absente n’est pas un matricule (fiche pas encore drainée)', () => {
    assert.equal(studentMatricule('   '), undefined);
    assert.equal(studentMatricule(''), undefined);
    assert.equal(studentMatricule(null), undefined);
    assert.equal(studentMatricule(undefined), undefined);
  });
});

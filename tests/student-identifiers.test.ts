/**
 * Pure tests for the ninth-grade-only matricule policy.
 * No DOM is needed: this module only normalizes class labels and identifiers.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { isNinthGradeClass, visibleStudentIdentifier } from '../src/lib/studentIdentifiers';

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

describe('visibleStudentIdentifier', () => {
  it('trims and returns a matricule only for ninth grade', () => {
    assert.equal(visibleStudentIdentifier('9D', ' MT-2026-004 '), 'MT-2026-004');
    assert.equal(visibleStudentIdentifier('9emeA', 'MT-2026-005'), 'MT-2026-005');
    assert.equal(visibleStudentIdentifier('6B', 'MT-2026-006'), undefined);
    assert.equal(visibleStudentIdentifier('9A', '   '), undefined);
    assert.equal(visibleStudentIdentifier(null, 'MT-2026-000'), undefined);
  });
});

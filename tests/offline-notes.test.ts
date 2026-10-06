/**
 * Unit tests for the offline student row builders' noteEntries mapping.
 *
 * The Notes ⇄ Calendar bridge stores dated entries in the student's
 * `noteEntries` field; at the DB boundary these builders translate it to the
 * `note_entries` jsonb column. A regression here silently drops every dated
 * note from the offline queue (that exact bug shipped once before), so both
 * builders are locked: presence, absence, deep equality and coexistence with
 * the other mapped fields.
 *
 * DOM-free by design (pure row mapping) — the shared happy-dom harness is
 * intentionally unused, see tests/harness.ts "When NOT to use it".
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { studentToRow, studentUpdatesToRow } from '../src/lib/offlineReplay';
import type { Student } from '../src/app/types';

const entries = [
  { date: '2026-09-10', text: 'Promesse de paiement vendredi' },
  { date: '2026-09-12', text: 'A rappeler pour la cantine' },
];

const student = (overrides: Partial<Student> = {}): Student => ({
  id: 's1',
  name: 'Ali Diallo',
  parentName: 'M. Diallo',
  parentEmail: 'p@x.com',
  parentPhone: '+223',
  totalDue: 150000,
  amountPaid: 50000,
  dueDate: '2026-12-31',
  payments: [],
  notes: 'ancienne note',
  ...overrides,
});

describe('studentToRow (offline insert)', () => {
  it('maps noteEntries to the note_entries jsonb column, deep-equal', () => {
    const row = studentToRow(student({ noteEntries: entries }));
    assert.deepEqual(row.note_entries, entries, 'the dated entries survive the boundary');
  });

  it('maps an empty noteEntries list to an empty jsonb array', () => {
    const row = studentToRow(student({ noteEntries: [] }));
    assert.deepEqual(row.note_entries, []);
  });

  it('defaults to an empty array when noteEntries is absent', () => {
    const row = studentToRow(student());
    assert.deepEqual(row.note_entries, [], 'no noteEntries → empty jsonb array, not undefined');
  });

  it('still maps the other student fields alongside note_entries', () => {
    const row = studentToRow(student({ grade: '9A', studentId: ' MT-2026-001 ', noteEntries: entries, amountPaid: 75000, flagged: true }));
    assert.equal(row.amount_paid, 75000);
    assert.equal(row.flagged, true);
    assert.equal(row.name, 'Ali Diallo');
    assert.equal(row.student_id, 'MT-2026-001', 'eligible matricules are trimmed at the DB boundary');
    assert.deepEqual(row.note_entries, entries);
  });

  it('keeps the matricule of an insert for ANY class — plus un privilège des 9e', () => {
    // Changement de politique (2026-10-06) : ce cas affirmait `null` pour une 6e.
    // Un matricule appartient désormais à TOUT élève (la base l'attribue) ;
    // l'application ne le conditionne plus à la classe.
    const row = studentToRow(student({ grade: '6B', studentId: 'MT-2026-006' }));
    assert.equal(row.student_id, 'MT-2026-006');
  });

  it('un matricule absent part en NULL — c’est la base qui numérote', () => {
    const row = studentToRow(student({ grade: '6B', studentId: undefined }));
    assert.equal(row.student_id, null, 'la colonne reste vide : le déclencheur attribue MT-<année>-<n°>');
  });
});

describe('studentUpdatesToRow (offline update)', () => {
  it('maps noteEntries to note_entries, deep-equal', () => {
    const row = studentUpdatesToRow({ noteEntries: entries });
    assert.deepEqual(row.note_entries, entries);
  });

  it('sets no note_entries key when the update has no noteEntries', () => {
    const row = studentUpdatesToRow({ name: 'Ali B. Diallo', amountPaid: 60000 });
    assert.equal('note_entries' in row, false, 'no spurious jsonb write');
    assert.equal(row.name, 'Ali B. Diallo');
    assert.equal(row.amount_paid, 60000);
  });

  it('ignores an explicit undefined noteEntries', () => {
    const row = studentUpdatesToRow({ noteEntries: undefined, notes: 'nouvelle' });
    assert.equal('note_entries' in row, false);
    assert.equal(row.notes, 'nouvelle');
  });

  it('maps noteEntries alongside the other updated fields', () => {
    const row = studentUpdatesToRow({ name: 'Ali', grade: '9D', studentId: 'MT-2026-009', noteEntries: entries, totalDue: 180000 });
    assert.deepEqual(row.note_entries, entries);
    assert.equal(row.name, 'Ali');
    assert.equal(row.total_due, 180000);
    assert.equal(row.student_id, 'MT-2026-009');
  });

  it('ne touche plus au matricule quand une mise à jour change de classe', () => {
    // Avant : sortir de 9e effaçait le matricule. Il appartient maintenant à
    // l'élève — changer de classe le laisse en place.
    const row = studentUpdatesToRow({ grade: '8C', studentId: 'MT-2026-008' });
    assert.equal(row.grade, '8C');
    assert.equal(row.student_id, 'MT-2026-008', 'le matricule est conservé');
  });

  it('une mise à jour sans matricule ne touche PAS à la colonne', () => {
    // Avant : entrer en 9e sans nouveau numéro remettait la colonne à NULL, ce qui
    // effaçait le matricule que la base venait d'attribuer.
    const row = studentUpdatesToRow({ grade: '9A' });
    assert.equal(row.grade, '9A');
    assert.equal('student_id' in row, false, 'aucune écriture : le matricule en place survit');
  });

  it('un matricule vidé dans le formulaire n’efface pas celui de la base', () => {
    const row = studentUpdatesToRow({ studentId: '   ' });
    assert.equal('student_id' in row, false, 'un identifiant lu par les familles ne s’efface pas par accident');
  });
});
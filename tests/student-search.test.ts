/**
 * Suite pure (sans DOM, sans React) pour src/lib/studentSearch.ts — la règle
 * UNIQUE qui décide si un élève correspond à une recherche (nom OU matricule).
 *
 * Elle est partagée par le formulaire d'encaissement, le rattachement d'un enfant
 * à un parent, et tout écran qui parcourt une liste d'élèves : c'est donc ici, à
 * la source, que le comportement est verrouillé. La frappe ne peut pas être
 * simulée sous le harnais happy-dom (React lit `onChange` via un value-tracker que
 * le DOM de test ne fait jamais bouger) : les suites de composants vérifient le
 * CÂBLAGE, celle-ci vérifie la RÈGLE.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { filterStudentsByQuery, matchesStudentQuery } from '../src/lib/studentSearch';

const student = (name: string, studentId?: string) => ({ name, studentId });
const names = (list: { name: string }[]) => list.map((s) => s.name);

describe('studentSearch — nom OU matricule, une seule règle', () => {
  it('une requête vide ou blanche ne filtre rien', () => {
    assert.equal(matchesStudentQuery(student('Awa', 'MT-2026-421'), ''), true);
    assert.equal(matchesStudentQuery(student('Awa', 'MT-2026-421'), '   '), true);
  });

  it('trouve par nom, sans tenir compte de la casse ni des espaces autour', () => {
    assert.equal(matchesStudentQuery(student('Awa Traoré'), '  awa '), true);
    assert.equal(matchesStudentQuery(student('Awa Traoré'), 'TRAORÉ'), true);
    assert.equal(matchesStudentQuery(student('Awa'), 'binta'), false);
  });

  it('trouve par matricule, entier ou partiel', () => {
    assert.equal(matchesStudentQuery(student('Awa', 'MT-2026-421'), 'mt-2026-421'), true);
    assert.equal(matchesStudentQuery(student('Awa', 'MT-2026-421'), '421'), true);
    assert.equal(matchesStudentQuery(student('Awa', 'MT-2026-421'), 'MT-2026-9'), false);
  });

  it('un matricule entouré d’espaces se cherche comme celui qui est affiché', () => {
    // Le matricule passe par `studentMatricule` : la valeur CHERCHÉE est la même
    // que celle montrée et imprimée, jamais la colonne brute.
    assert.equal(matchesStudentQuery(student('Awa', '  MT-2026-7  '), 'MT-2026-7'), true);
  });

  it('un élève sans matricule reste trouvable par son nom', () => {
    assert.equal(matchesStudentQuery(student('Coumba'), 'coumba'), true);
    assert.equal(matchesStudentQuery(student('Coumba', ''), 'coumba'), true);
    assert.equal(matchesStudentQuery(student('Coumba', '  '), 'coumba'), true);
  });

  it('la requête est un fragment CONTIGU de « nom matricule »', () => {
    // Le nom et le matricule forment UNE chaîne, cherchée telle quelle : la fin
    // du nom suivie du matricule correspond, tandis qu'une requête qui sauterait
    // une partie du nom ne correspond pas. C'est la règle d'origine du formulaire
    // d'encaissement, conservée à l'identique — pas un « tous les mots ».
    assert.equal(matchesStudentQuery(student('Awa Traoré', 'MT-77'), 'traoré mt-77'), true);
    assert.equal(matchesStudentQuery(student('Awa Traoré', 'MT-77'), 'awa mt-77'), false);
  });

  it('filterStudentsByQuery réduit la liste sans la réordonner', () => {
    const list = [student('Awa', 'MT-001'), student('Binta', 'MT-002'), student('Coumba')];
    assert.deepEqual(names(filterStudentsByQuery(list, 'binta')), ['Binta']);
    assert.deepEqual(names(filterStudentsByQuery(list, 'MT-00')), ['Awa', 'Binta']);
    assert.deepEqual(names(filterStudentsByQuery(list, 'introuvable')), []);
    assert.deepEqual(names(filterStudentsByQuery(list, '')), ['Awa', 'Binta', 'Coumba']);
  });
});

/**
 * Payment-entry student filtering — pure, DOM-free.
 *
 * The cashier narrows a long student list two ways that COMBINE (logical AND):
 * a class filter and a free-text search over the student's name OR matricule
 * (`studentId`). The rule lives out of the component, so it can be pinned by
 * unit tests: React's synthetic `onChange` cannot be driven programmatically
 * under the happy-dom harness (the value tracker never reports a change), so
 * the search behaviour is asserted against this module rather than through a
 * simulated keystroke.
 *
 * La recherche elle-même n'est plus écrite ici : elle vit dans
 * `studentSearch.ts`, partagée avec les autres écrans qui parcourent une liste
 * d'élèves (rattachement d'un enfant à un parent). `matchesSearch` reste exporté
 * pour que le formulaire d'encaissement et ses tests n'aient pas à changer de
 * nom — c'est la MÊME règle, pas une copie.
 */
import type { Student } from './domainTypes';
import { matchesStudentQuery } from './studentSearch';

/** La valeur du filtre « toutes les classes » — jamais une classe réelle. */
export const ALL_CLASSES = 'all';

/** Un élève passe le filtre de classe (insensible à la casse et aux espaces). */
export const matchesClass = (grade: string | undefined, classFilter: string): boolean =>
  classFilter === ALL_CLASSES || (grade ?? '').trim().toLowerCase() === classFilter.trim().toLowerCase();

/** Un élève correspond à la recherche par nom OU matricule ; requête vide = tout. */
export const matchesSearch = matchesStudentQuery;

/**
 * Les élèves visibles = intersection du filtre de classe ET de la recherche.
 * Générique pour conserver le type d'entrée (`Student[]` reste `Student[]`).
 */
export const filterStudents = <S extends Pick<Student, 'name' | 'studentId' | 'grade'>>(
  students: S[],
  classFilter: string,
  query: string,
): S[] => students.filter((s) => matchesClass(s.grade, classFilter) && matchesSearch(s, query));

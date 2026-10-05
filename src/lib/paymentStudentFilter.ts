/**
 * Payment-entry student filtering — pure, DOM-free.
 *
 * The cashier narrows a long student list two ways that COMBINE (logical AND):
 * a class filter and a free-text search over the student's name OR matricule
 * (`studentId`). The rule lives here, out of the component, so it can be
 * pinned by unit tests: React's synthetic `onChange` cannot be driven
 * programmatically under the happy-dom harness (the value tracker never
 * reports a change), so the search behaviour is asserted against this module
 * rather than through a simulated keystroke.
 */
import type { Student } from './domainTypes';

/** La valeur du filtre « toutes les classes » — jamais une classe réelle. */
export const ALL_CLASSES = 'all';

/** Un élève passe le filtre de classe (insensible à la casse et aux espaces). */
export const matchesClass = (grade: string | undefined, classFilter: string): boolean =>
  classFilter === ALL_CLASSES || (grade ?? '').trim().toLowerCase() === classFilter.trim().toLowerCase();

/** Un élève correspond à la recherche par nom OU matricule ; requête vide = tout. */
export const matchesSearch = (
  student: Pick<Student, 'name' | 'studentId'>,
  query: string,
): boolean => {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  return `${student.name} ${student.studentId ?? ''}`.toLowerCase().includes(needle);
};

/**
 * Les élèves visibles = intersection du filtre de classe ET de la recherche.
 * Générique pour conserver le type d'entrée (`Student[]` reste `Student[]`).
 */
export const filterStudents = <S extends Pick<Student, 'name' | 'studentId' | 'grade'>>(
  students: S[],
  classFilter: string,
  query: string,
): S[] => students.filter((s) => matchesClass(s.grade, classFilter) && matchesSearch(s, query));

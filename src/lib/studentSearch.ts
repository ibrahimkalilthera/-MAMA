/**
 * La RECHERCHE d'un élève — une seule règle, pure, sans DOM.
 *
 * « Chercher un élève » veut dire la même chose PARTOUT où une liste d'élèves est
 * montrée ou parcourue : on tape un NOM ou un MATRICULE, on ignore la casse et
 * les espaces autour de la requête, et un champ vide ne filtre rien (c'est ce que
 * « pas de filtre » veut dire — chaque appelant n'a donc pas à traiter le cas à
 * part).
 *
 * ─── Pourquoi ici, et pas dans chaque écran ─────────────────────────────────
 * Ce même besoin vivait déjà dans le formulaire d'encaissement (voir
 * `paymentStudentFilter.ts`, qui délègue désormais ici), et le propriétaire a
 * demandé la même recherche dans le rattachement d'un enfant à un parent. Quatre
 * copies d'une règle finissent toujours par diverger : l'une cherche le matricule
 * brut, l'autre la valeur nettoyée, la troisième oublie la casse. La règle est
 * donc écrite UNE fois.
 *
 * Le matricule passe par `studentMatricule` (jamais `studentId` brut) : c'est la
 * MÊME valeur que celle affichée, imprimée et envoyée — un élève trouvé par un
 * matricule que l'écran n'affiche pas serait introuvable à l'œil.
 */
import type { Student } from './domainTypes';
import { studentMatricule } from './studentIdentifiers';

/**
 * L'élève correspond-il à la requête (nom OU matricule, casse et espaces
 * ignorés) ? Une requête vide (ou blanche) correspond à tout le monde.
 */
export const matchesStudentQuery = (
  student: Pick<Student, 'name' | 'studentId'>,
  query: string,
): boolean => {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  const matricule = studentMatricule(student.studentId);
  return `${student.name} ${matricule ?? ''}`.toLowerCase().includes(needle);
};

/**
 * La liste réduite à ce qui correspond à la requête. Générique pour conserver le
 * type d'entrée (`Student[]` reste `Student[]`).
 */
export const filterStudentsByQuery = <S extends Pick<Student, 'name' | 'studentId'>>(
  students: S[],
  query: string,
): S[] => students.filter((s) => matchesStudentQuery(s, query));

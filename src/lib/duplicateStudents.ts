/**
 * Les fiches d'élève qui partagent un NOM et une CLASSE — le même critère que
 * `scripts/lib/duplicate-students.mjs`.
 *
 * ─── Pourquoi la règle vit deux fois ────────────────────────────────────────
 * Le contrôle de clôture relit la BASE (`partition by lower(trim(p.name)),
 * coalesce(p.grade, '')`) ; l'application, elle, affiche les fiches qu'elle a
 * déjà chargées. Elle ne peut donc pas appeler le script — mais elle ne peut pas
 * non plus se contenter d'un critère voisin : si l'écran disait « doublon » là où
 * la feuille du bureau ne dit rien (ou l'inverse), les deux se contrediraient, et
 * c'est l'écran que l'école lit en premier. La règle est donc réécrite ici, pure,
 * avec EXACTEMENT la forme du contrôle :
 *
 *     lower(trim(name)) + coalesce(grade, '')
 *
 * `tests/duplicate-students-ui.test.ts` verrouille les deux côté à côte, pour
 * qu'une modification de l'un force à relire l'autre.
 *
 * ─── Ce que la règle ne fait PAS ────────────────────────────────────────────
 * Elle ne tranche rien. Deux homonymes dans une même classe existent — le
 * 2026-10-06, la base en portait deux groupes sur 423 fiches. La marque SIGNALE
 * les fiches à regarder ; c'est l'école qui décide, depuis la fiche.
 *
 * Un nom vide ne forme jamais de groupe : deux fiches sans nom ne partagent rien,
 * et les grouper ferait un faux groupe sur tout un registre incomplet.
 */
import type { Student } from './domainTypes';

/** Le contrôle dont ce module est le miroir côté application. */
export const CONTROL_STUDENT_NAME_GRADE = 'meme_nom_meme_classe';

/** Ce qu'une fiche doit porter pour être comparée. */
type StudentIdentity = Pick<Student, 'name' | 'grade'>;
/** Une fiche comparée, avec son id (les marques se posent par id). */
type IdentifiedStudent = StudentIdentity & { id: string };

/**
 * L'empreinte du groupe : le nom replié (casse et espaces de bord ignorés) puis
 * la classe TELLE QUELLE. Le contrôle groupe `coalesce(grade, '')` sans replier
 * la classe : « 5A » et « 5a » restent donc deux classes, et le miroir le fait
 * aussi — replier la classe ici créerait des groupes que le bureau ne voit pas.
 *
 * `null` pour une fiche sans nom : elle n'appartient à aucun groupe.
 */
export const duplicateStudentKey = (student: StudentIdentity): string | null => {
  const name = String(student.name ?? '').trim().toLowerCase();
  if (!name) return null;
  return `${name}|${student.grade ?? ''}`;
};

/** Combien de fiches par groupe — la clé étant `duplicateStudentKey`. */
export function duplicateStudentGroupSizes(students: StudentIdentity[]): Map<string, number> {
  const sizes = new Map<string, number>();
  for (const student of students) {
    const key = duplicateStudentKey(student);
    if (key === null) continue;
    sizes.set(key, (sizes.get(key) ?? 0) + 1);
  }
  return sizes;
}

/**
 * Les fiches à regarder, par id : la taille de leur groupe (toujours ≥ 2).
 * Une fiche absente de la carte n'est pas suspecte — c'est le seul test dont la
 * liste a besoin.
 */
export function duplicateStudentGroupsById<S extends IdentifiedStudent>(students: S[]): Map<string, number> {
  const sizes = duplicateStudentGroupSizes(students);
  const groups = new Map<string, number>();
  for (const student of students) {
    const key = duplicateStudentKey(student);
    if (key === null) continue;
    const size = sizes.get(key) ?? 0;
    if (size > 1) groups.set(student.id, size);
  }
  return groups;
}

/**
 * Les fiches du groupe de `student` — l'annuaire ENTIER qui partage son nom
 * replié et sa classe. C'est ce que l'outil de comparaison affiche côte à côte :
 * le groupe est recalculé à chaque rendu depuis l'annuaire, jamais figé.
 *
 * `[]` quand la fiche n'a pas de nom : elle n'appartient à aucun groupe.
 */
export function duplicateStudentGroup<S extends IdentifiedStudent>(students: S[], student: StudentIdentity): S[] {
  const key = duplicateStudentKey(student);
  if (key === null) return [];
  return students.filter((candidate) => duplicateStudentKey(candidate) === key);
}

/**
 * Le nombre de fiches du groupe de `student`, CETTE fiche comprise (1 quand elle
 * est seule, 0 quand elle n'a pas de nom). C'est ce que la fiche ouverte annonce.
 *
 * Les fiches de MÊME id ne comptent qu'une fois : l'appelant peut passer une
 * copie éditée de la fiche sélectionnée, et elle ne doit pas se compter deux fois.
 */
export function duplicateStudentGroupSize<S extends IdentifiedStudent>(
  students: S[],
  student: IdentifiedStudent,
): number {
  const key = duplicateStudentKey(student);
  if (key === null) return 0;
  const peers = new Set<string>();
  for (const other of students) {
    if (other.id === student.id) continue;
    if (duplicateStudentKey(other) === key) peers.add(other.id);
  }
  return peers.size + 1;
}

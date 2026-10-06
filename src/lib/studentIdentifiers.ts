/**
 * Student identifier policy.
 *
 * ─── Le matricule appartient à TOUS les élèves (2026-10-06) ─────────────────
 * Jusqu'ici, le matricule (`students.student_id`) était réservé aux classes de
 * 9e : c'était un NUMÉRO D'EXAMEN, saisi à la main, que seul le formulaire de 9e
 * proposait. Le propriétaire a demandé « un numéro de matricule pour tous les
 * élèves ajoutés, et pour tous ceux qui seront ajoutés dans le futur ».
 *
 * Le matricule est donc la propriété de tout élève : la BASE l'attribue
 * (`MT-<année>-<n°>`, migration 20261006000000) quand il est vide — à
 * l'insertion, et par rattrapage pour les élèves déjà enregistrés. Rien dans
 * l'application ne conditionne plus l'existence, l'affichage ou la recherche
 * d'un matricule à la classe.
 *
 * Ce qui reste vrai, et devient le SEUL rôle de `isNinthGradeClass` : un élève
 * de 9e porte un numéro d'examen que l'ÉCOLE saisit (elle seule le connaît) —
 * le formulaire lui laisse donc un champ éditable, que les autres classes n'ont
 * pas. Un matricule, une fois porté, ne se perd plus : ni en changeant de
 * classe, ni en passant d'année.
 */

/**
 * Return true when a grade/class value denotes 9th year — the year whose
 * students carry an exam number the school types in.
 *
 * Accepted examples include `9`, `9A`, `9D`, `9e`, `9eme`, `9eme Annee D`,
 * and `9th Year D`. Values such as `8A`, `10A`, and `19A` are rejected.
 */
export const isNinthGradeClass = (grade: string | null | undefined): boolean => {
  if (!grade?.trim()) return false;

  const normalized = grade
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
  const tokens = normalized.match(/[a-z0-9]+/g) || [];

  return tokens.some((token) =>
    token === '9' ||
    /^9(?:[a-z]|e(?:me)?[a-z]?|th[a-z]?)$/.test(token)
  );
};

/**
 * Le matricule d'un élève : la valeur affichée, cherchée, imprimée et envoyée.
 *
 * Aucune condition de classe — c'est le point de la politique. Un `undefined`
 * veut dire « il n'y a pas encore de valeur » (une fiche créée hors ligne attend
 * son drainage), jamais « cet élève n'a pas droit à un matricule ».
 */
export const studentMatricule = (studentId: string | null | undefined): string | undefined => {
  const trimmed = studentId?.trim();
  return trimmed ? trimmed : undefined;
};

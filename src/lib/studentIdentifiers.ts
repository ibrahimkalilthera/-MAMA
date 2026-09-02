/**
 * Student identifier policy.
 *
 * A matricule is only meaningful for 9th-year classes. Class values can be
 * stored as compact codes (9A, 9D), French/English display labels, or custom
 * section names, so the check works on the normalized alpha-numeric tokens.
 */

/**
 * Return true when a grade/class value denotes 9th year.
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

/** Return a matricule only when the student's class is eligible for one. */
export const visibleStudentIdentifier = (
  grade: string | null | undefined,
  studentId: string | null | undefined,
): string | undefined => {
  const normalizedStudentId = studentId?.trim();
  return isNinthGradeClass(grade) && normalizedStudentId ? normalizedStudentId : undefined;
};

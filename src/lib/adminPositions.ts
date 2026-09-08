/**
 * Curated list of school-administration positions for the
 * "Ajouter un membre de l'administration" flow (Payroll).
 *
 * Bilingual — the label of the current language is what gets stored in
 * staff.position, so the payroll directory shows the position in the user's
 * language. The order mirrors the school's hierarchy as requested.
 */
export const ADMIN_POSITIONS: Record<'en' | 'fr', readonly string[]> = {
  fr: [
    'Promotrice',
    'Gestionnaire Principal',
    'Proviseur',
    'Censeur',
    'Surveillant Général',
    'Secrétaire',
    'Économe',
    'Directeur Général',
    'Directeur des Études',
    'Chef des Travaux',
  ],
  en: [
    'Founder',
    'General Manager',
    'Principal',
    'Discipline Master',
    'Head Supervisor',
    'Secretary',
    'Bursar',
    'General Director',
    'Director of Studies',
    'Head of Works',
  ],
};

/**
 * Curated positions for the technical-center members added through the
 * "Ajouter un Membre du Centre Technique" flow (Payroll). These members use
 * the same employee form end-to-end; their receipt is the technical-center
 * fiche (public/templates/fiche-technique.pdf) instead of the employee fiche.
 *
 * Bilingual — the label of the current language is what gets stored in
 * staff.position (prefilled in the technique modal, still editable as a
 * free-text position like the employee form).
 */
export const TECH_POSITIONS: Record<'en' | 'fr', readonly string[]> = {
  fr: [
    'Membre du Centre Technique',
    'Technicien',
    'Technicienne',
    'Agent Technique',
    'Formateur Technique',
    'Instructeur Technique',
  ],
  en: [
    'Technical Center Member',
    'Technician',
    'Technical Agent',
    'Technical Trainer',
    'Technical Instructor',
  ],
};

/** True when the stored staff.position is one of the technical-center roles.
 *  Positions are stored in the creation language, so both lists are checked
 *  (case-insensitive). */
export function isTechniquePosition(position: string | null | undefined): boolean {
  if (!position) return false;
  const norm = position.trim().toLocaleLowerCase();
  return (
    TECH_POSITIONS.fr.some((p) => p.toLocaleLowerCase() === norm) ||
    TECH_POSITIONS.en.some((p) => p.toLocaleLowerCase() === norm)
  );
}

/** True when the stored staff.position is one of the curated admin roles.
 *  Positions are stored in the creation language, so both lists are checked
 *  (case-insensitive). */
export function isAdminPosition(position: string | null | undefined): boolean {
  if (!position) return false;
  const norm = position.trim().toLocaleLowerCase();
  return (
    ADMIN_POSITIONS.fr.some((p) => p.toLocaleLowerCase() === norm) ||
    ADMIN_POSITIONS.en.some((p) => p.toLocaleLowerCase() === norm)
  );
}
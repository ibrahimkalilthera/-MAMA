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
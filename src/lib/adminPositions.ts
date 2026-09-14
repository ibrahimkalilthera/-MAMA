/**
 * What kind of staff member a row is — one owner for that question.
 *
 * Three flows create staff members (employee, Centre T et P, administration),
 * each with its own document. Before migration 20260914000000 the kind had no
 * home in the schema and was GUESSED at render time from the free-text position
 * label, in whichever language the form was filled in — so a typed position
 * outside the curated lists silently produced the wrong document, and editing a
 * position could move a member from one kind to another. The category is now a
 * column written at creation; `staffCategory()` is the single reader, and it
 * keeps the old guess alive only for rows written before that column.
 */
import type { StaffCategory } from './domainTypes';

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

/**
 * The three kinds of staff member this app knows how to document, and the only
 * values the `staff.category` column accepts (migration 20260914000000).
 *
 *   employee   → "Ajouter un Employé"          → fiche de paiement de salaire
 *   technique  → "Ajouter un Membre du Centre T et P" → fiche T et P
 *   admin      → "Ajouter un Membre de l'Administration" → bulletin de paie
 *
 * The category is written by the flow that created the member, so it is a
 * FACT about the row rather than a guess made at render time.
 */
export type { StaffCategory };

export const STAFF_CATEGORIES: readonly StaffCategory[] = ['employee', 'technique', 'admin'];

/** True when a stored value is one of the three categories. */
export function isStaffCategory(value: unknown): value is StaffCategory {
  return typeof value === 'string' && (STAFF_CATEGORIES as readonly string[]).includes(value);
}

/**
 * What kind of member a staff row IS.
 *
 * A row written since migration 20260914000000 carries its category, and the
 * column is what answers — never the prose it happens to display. Rows written
 * before that column exist without one, so their stored position is consulted as
 * a fallback (same bilingual lists, same case-insensitive match as before), and
 * anything unrecognised is an employee — what those rows already rendered as.
 *
 * The fallback is why this is a function rather than a column read at each call
 * site: one place knows that legacy means "infer", and every consumer (payroll
 * filter, badge, PDF dispatch) asks the same question.
 */
export function staffCategory(staff: {
  category?: string | null;
  position?: string | null;
}): StaffCategory {
  if (isStaffCategory(staff.category)) return staff.category;
  if (isTechniquePosition(staff.position)) return 'technique';
  if (isAdminPosition(staff.position)) return 'admin';
  return 'employee';
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
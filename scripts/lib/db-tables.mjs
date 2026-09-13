// ─────────────────────────────────────────────────────────────────────────────
// scripts/lib/db-tables.mjs — les tables qu'une sauvegarde doit contenir, dans
// l'ordre où on peut les RÉÉCRIRE.
//
// Une seule liste, parce que deux listes divergent : celle-ci est lue par la
// sauvegarde, par la restauration et par leurs tests. L'ordre n'est pas
// décoratif — `students.parent_id` référence `parents`, `payments.student_id`
// référence `students` (`supabase/FULL_SETUP_MIGRATION.sql`, mesuré) : restaurer
// dans le désordre écrit des lignes que la base refuse.
//
// Ce que cette liste NE contient pas, et pourquoi c'est dit ici plutôt que
// découvert au pire moment : **les comptes `auth.users`**. Leurs mots de passe
// sont des empreintes bcrypt qui ne sortent pas par l'API REST ; un instantané
// de cette liste restaure les DONNÉES, pas les identifiants. Les deux tables qui
// référencent `auth.users` (`user_profiles`, `app_settings.updated_by`,
// `calendar_notes.created_by`) sont donc restaurées en dernier, et une ligne
// dont le compte n'existe pas est **nommée** comme non restaurée — jamais
// silencieusement perdue.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Chaque entrée porte sa clé primaire : c'est elle qui rend la restauration
 * idempotente (`?<pk>=eq.<valeur>` relit la ligne avant de l'écrire, et
 * l'insertion se fait en `resolution=merge-duplicates`).
 */
export const BACKUP_TABLES = [
  { name: 'academic_years', pk: 'id', label: 'années scolaires' },
  { name: 'parents', pk: 'id', label: 'parents' },
  { name: 'students', pk: 'id', label: 'élèves' },
  { name: 'staff', pk: 'id', label: 'personnel' },
  { name: 'payments', pk: 'id', label: 'paiements' },
  { name: 'salary_payments', pk: 'id', label: 'salaires versés' },
  { name: 'expenses', pk: 'id', label: 'dépenses' },
  { name: 'vendor_expenses', pk: 'id', label: 'dépenses fournisseurs' },
  { name: 'todos', pk: 'id', label: 'tâches' },
  { name: 'custom_classes', pk: 'id', label: 'classes personnalisées' },
  { name: 'calendar_notes', pk: 'id', label: 'notes d’agenda', authRef: 'created_by' },
  { name: 'app_settings', pk: 'key', label: 'réglages', authRef: 'updated_by' },
  { name: 'user_profiles', pk: 'id', label: 'profils', authRef: 'id' },
  { name: 'audit_logs', pk: 'id', label: 'journal d’audit' },
];

/** Les tables qui portent les données MÉTIER de l'école (pas la configuration). */
export const BUSINESS_TABLES = BACKUP_TABLES.filter((t) =>
  ['students', 'parents', 'staff', 'payments', 'salary_payments', 'expenses', 'vendor_expenses'].includes(t.name),
);

/**
 * Vrai si la liste est utilisable (non vide, sans doublon, avec clé primaire).
 *
 * @param {{ name: string, pk: string }[]} [tables] la liste à juger ; par défaut
 *   l'inventaire du dépôt. Le paramètre est nommé indépendamment de `label` et
 *   `authRef` : un test fabrique volontairement des listes minimales.
 * @returns {boolean}
 */
export function tablesAreSound(tables = BACKUP_TABLES) {
  if (!Array.isArray(tables) || tables.length === 0) return false;
  const names = tables.map((t) => t.name);
  if (new Set(names).size !== names.length) return false;
  return tables.every((t) => typeof t.name === 'string' && t.name && typeof t.pk === 'string' && t.pk);
}

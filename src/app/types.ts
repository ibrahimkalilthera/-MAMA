/**
 * UI-layer type re-exports.
 *
 * The canonical domain types (Parent, Student, Staff, …, Language, User,
 * SchoolClass, DEFAULT_SCHOOL_CLASSES) live in src/lib/domainTypes.ts. This
 * file used to be the App-side source of truth with useSupabaseData.ts
 * re-declaring the same interfaces; that duplication is gone (see
 * DEVELOPMENT_HISTORY.md), and this shim keeps every existing `../app/types`
 * import site working unchanged.
 */
export * from '../lib/domainTypes';

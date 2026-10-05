/**
 * Table density preference persistence.
 *
 * A single device-level setting (`comfort` default, `compact`), stored in
 * localStorage like the theme — every account on the poste shares it. Only the
 * TABLE rows/headers are affected (see the `.density-compact` rule in
 * src/index.css); the rest of the layout is untouched.
 *
 * Corrupt or missing entries degrade to the default and writes never throw
 * (storage full / private mode simply won't persist).
 */

export type TableDensity = 'comfort' | 'compact';

export const DEFAULT_DENSITY: TableDensity = 'comfort';

const KEY = 'school-finance-density-v1';

/** Read the stored density. Never throws; missing/unavailable → default. */
export function getStoredDensity(): TableDensity {
  try {
    // SSR / non-browser (renderToString in tests) has no localStorage.
    if (typeof localStorage === 'undefined') return DEFAULT_DENSITY;
    return localStorage.getItem(KEY) === 'compact' ? 'compact' : 'comfort';
  } catch {
    return DEFAULT_DENSITY;
  }
}

/** Persist the density. Never throws. */
export function saveDensity(density: TableDensity): void {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(KEY, density);
  } catch {
    // Storage full / private mode — the choice simply won't persist.
  }
}

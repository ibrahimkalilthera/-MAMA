/**
 * Which database THIS install talks to — resolved at build time, displayed at
 * runtime.
 *
 * The definition itself lives in `scripts/lib/shared-project.mjs` because the
 * Node guard (`npm run check:shared-db`) and this module must not be able to
 * disagree about which project is the shared one: that file is imported, not
 * copied. TypeScript sees it through `allowJs`.
 */
import { describeDatabase, SHARED_PROJECT_REF, SHARED_PROJECT_URL } from '../../scripts/lib/shared-project.mjs';

const rawUrl = import.meta.env?.VITE_SUPABASE_URL as string | undefined;

/**
 * What the running application can say about its database. `diverges` is the
 * state that must never be silent: the install is on neither the shared project
 * nor the declared staging one, which means its users see their own data while
 * believing they see everyone's.
 */
export const database = describeDatabase(rawUrl);

export { SHARED_PROJECT_REF, SHARED_PROJECT_URL };

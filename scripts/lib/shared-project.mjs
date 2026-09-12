/**
 * WHICH DATABASE — one definition, for the app AND for the checks.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * Every install (the Windows setup, the web deploy at mama-thera.vercel.app)
 * must read and write the SAME Supabase project: that is the whole point of a
 * shared school finance database — a payment entered on the office PC must be
 * visible on the director's laptop a second later. Nothing enforced it. The
 * project ref `rpcjdohfxwukbqngbprw` was written in 16 scattered places
 * (vercel.json CSP, four workflows, six scripts, the dev history) and NOWHERE in
 * the application, so a build pointed at another project — `.env.staging` names
 * a different one, and `.env` is gitignored so it is whatever the building
 * machine happens to have — would ship silently. Two installs, two databases,
 * and every user believes the others see the same thing.
 *
 * So the shared project is named once, here, and `scripts/check-shared-db.mjs`
 * refuses a production build that resolves anywhere else. Plain `.mjs` (not
 * `.ts`) on purpose: the Vite app, the Node guard and the test runner all import
 * this same file, which is what makes it a single definition rather than two
 * that agree today.
 */

/** The one database every user of this application shares. */
export const SHARED_PROJECT_REF = 'rpcjdohfxwukbqngbprw';

/** Its REST/auth URL, derived so the two can never disagree. */
export const SHARED_PROJECT_URL = `https://${SHARED_PROJECT_REF}.supabase.co`;

/**
 * The builds allowed to resolve elsewhere, each with its reason and its guard.
 *
 * Staging is a real project (its own ref) because pointing staging at the
 * production database is how test data ends up in the school's accounts. It is
 * allowed to differ on ONE condition, checked below: it must declare
 * `VITE_APP_ENV=staging`, so a staging build can never present itself as
 * production (the UI badge and the audit trail both read that variable).
 */
export const ALLOWED_DIVERGENCE = [
  {
    mode: 'staging',
    projectRef: 'vulbmmzhcmnzswcvswfk',
    requires: { VITE_APP_ENV: 'staging' },
    because: 'jeu de données de test — ne doit jamais recevoir les écritures de l’école',
  },
];

/** Vite modes that produce something a user can install or open. */
export const USER_FACING_MODES = ['production', 'staging'];

/**
 * The project ref a Supabase URL points at, or null when the URL is not one.
 * @param {string | undefined | null} url
 * @returns {string | null}
 */
export function projectRefOf(url) {
  const match = String(url ?? '').match(/^https?:\/\/([a-z0-9-]+)\.supabase\.(co|in)\b/i);
  return match ? match[1] : null;
}

/**
 * What the running app should say about its database — the fact a support call
 * needs and that nothing displayed before: is this install on the shared one?
 *
 * @param {string | undefined | null} url the resolved VITE_SUPABASE_URL
 * @returns {{ ref: string | null, isShared: boolean, isStaging: boolean,
 *   diverges: boolean, label: string }}
 */
export function describeDatabase(url) {
  const ref = projectRefOf(url);
  const stagingRef = ALLOWED_DIVERGENCE[0]?.projectRef ?? null;
  const isStaging = ref !== null && ref === stagingRef;
  const isShared = ref === SHARED_PROJECT_REF;
  return {
    ref,
    isShared,
    isStaging,
    // A staging install is deliberately elsewhere; any OTHER ref is a real
    // divergence — that is the state in which users stop sharing data.
    diverges: ref !== null && !isShared && !isStaging,
    label: ref ?? 'ref inconnue',
  };
}

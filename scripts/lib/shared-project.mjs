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
 * Les URLs de modules chargées par une page, en absolu.
 *
 * Sert à vérifier un déploiement RÉEL : on ne peut pas lire l'application
 * déployée sans savoir d'abord quels fichiers elle télécharge. Deux écritures
 * dans le HTML de Vite, les deux présentes à la fois : les `<script src>` du
 * document et la carte `__vite__mapDeps` des imports dynamiques.
 *
 * @param {string} html
 * @param {string} [base] origine du site, pour résoudre les chemins relatifs
 * @returns {string[]} URLs absolues, uniques, dans l'ordre d'apparition
 */
export function assetUrlsIn(html, base = '') {
  const text = String(html ?? '');
  const found = [];
  const push = (raw) => {
    if (!raw) return;
    try {
      const abs = new URL(raw, base).href;
      if (!found.includes(abs)) found.push(abs);
    } catch {
      /* une référence illisible n'est pas une preuve : on l'ignore */
    }
  };
  for (const m of text.matchAll(/<script[^>]+src=["']([^"']+)["']/gi)) push(m[1]);
  for (const m of text.matchAll(/["'](assets\/[A-Za-z0-9._/-]+\.js)["']/g)) push(m[1]);
  return found;
}

/**
 * Les morceaux référencés par du JavaScript construit.
 *
 * Indispensable pour lire un déploiement réel : la page ne déclare qu'UN script
 * d'entrée, et les morceaux qui suivent — dont `vendor-supabase-*.js`, celui qui
 * porte l'URL de la base — sont nommés dans le code, pas dans le HTML. Les
 * chercher uniquement dans la page fait rendre « aucun module », donc un faux
 * échec : notre premier essai sur le site réel s'y est cassé les dents.
 *
 * @param {string} js
 * @returns {string[]} chemins relatifs uniques, dans l'ordre d'apparition
 */
export function bareAssetRefs(js) {
  const found = [];
  for (const m of String(js ?? '').matchAll(/["']((?:\/[^"']*)?assets\/[A-Za-z0-9._/-]+\.js)["']/g)) {
    if (!found.includes(m[1])) found.push(m[1]);
  }
  return found;
}

/**
 * Les refs de projet Supabase présentes dans du JavaScript construit.
 *
 * Deux formes, parce qu'un minifieur peut couper la chaîne : l'URL complète
 * (`https://ref.supabase.co`) et la forme nue (`ref.supabase.co`). Une URL
 * reconstruite par concaténation échapperait aux deux — c'est une limite
 * assumée, et elle est dite : le contrôle échoue quand il ne trouve RIEN, il ne
 * rend jamais un vert sur un bundle qu'il n'a pas su lire.
 *
 * @param {string} js
 * @returns {string[]} refs uniques
 */
export function supabaseRefsIn(js) {
  const text = String(js ?? '');
  const refs = [];
  for (const m of text.matchAll(/https?:\/\/([a-z0-9-]{15,})\.supabase\.(?:co|in)\b/gi)) {
    if (!refs.includes(m[1])) refs.push(m[1]);
  }
  for (const m of text.matchAll(/(?:^|[^a-z0-9-])([a-z0-9]{18,})\.supabase\.(?:co|in)\b/gi)) {
    if (!refs.includes(m[1])) refs.push(m[1]);
  }
  return refs;
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

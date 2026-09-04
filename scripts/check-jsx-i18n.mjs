/**
 * JSX visible-text i18n gate — hardcoded strings in the UI must not come back.
 *
 * The app renders every user-facing label through the central `t.*` dictionary
 * (translations.ts, en + fr). This guard scans `src/**\/*.tsx` and fails the
 * lint if a VISIBLE string is hardcoded instead:
 *
 *   1. string-literal values of visible attributes — placeholder, title,
 *      aria-label, label, alt — that contain letters;
 *   2. JSX text children (`>Some text<`) that contain letters;
 *   3. hardcoded bilingual ternaries — `lang === 'fr' ? 'X' : 'Y'` where the
 *      branches are display text (the `N°/Ref` receipt-number family).
 *
 * Everything else stays legal on purpose (documented below): style/data
 * attributes, expression values (`={t.x}`), numbers/dates/amounts, and the
 * whitelist of non-translatable strings (school branding, addresses,
 * signatory names, document labels, and input FORMAT EXAMPLES — placeholders
 * like `Jane Doe` or `+223 70 00 00 00` are sample data, not UI copy).
 *
 * Usage: node scripts/check-jsx-i18n.mjs (wired into `npm run lint`).
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '..');
const SRC = join(ROOT, 'src');

// ── Whitelist: exact strings that are legitimately not translated ────────────
// School branding, addresses, signatory names and document labels are proper
// nouns / fixed content. Input FORMAT EXAMPLES (placeholders showing the
// expected shape of user data) are sample data, not UI copy — they stay
// literal so the field reads naturally in either language.
const EXACT_WHITELIST = new Set([
  // School branding & locations
  'COMPLEXE SCOLAIRE MAMA THERA',
  'Complexe Scolaire Mama Thera',
  'Bamako, Mali',
  'Ségou, Mali',
  // Signatories / portal titles (proper nouns)
  'Ibrahim Thera, Portal Admin',
  'Ibrahim Thera / Executive Signature',
  'Ibrahim Thera, Executive Admin',
  'Ibrahim Thera / Official Board Seal',
  'Finance Exécutive Admin Portal',
  // Document labels
  'PHOTO',
  'PASSPORT',
  'Logo',
  // Input format examples (placeholder sample data)
  'Jane Doe',
  'Teacher',
  'Ibrahim',
  'Djeneba',
  'D, E, F...',
  'e.g. 150000',
  'RIB: ML01 00001 ...',
  'Spouse: +223 60 00 00 00',
  'MT-2026-001 (Optional)',
]);

// Value shapes that never need translation.
const NUMERIC = /^[\d\s.,+-]+$/; // amounts, phone numbers, years
const EMAIL = /^[\w.+-]+@[\w-]+\.[\w.]+$/;
const DOTS = /^[•·\s]+$/;
const PHONE = /^[+\d][\d\s()-]{5,}$/;

/** Strip line + block comments (doc text, not markup). */
const stripComments = (code) =>
  code
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1');

/** Strip JS string literals (content, not markup) — keeps `{t.x}` visible. */
const stripStrings = (code) =>
  code
    .replace(/"(?:[^"\\\n]|\\.)*"/g, '""')
    .replace(/'(?:[^'\\\n]|\\.)*'/g, "''")
    .replace(/`(?:[^`\\]|\\.)*`/gs, '``');

/** Visible string-literal attributes (aria-label listed FIRST: `label` must
 *  not match the tail of `aria-label`). */
const VISIBLE_ATTR_RE = /\b(aria-label|label|placeholder|title|alt)\s*=\s*"([^"]+)"/g;

/** JSX text children on a single line, no `{` expression inside. */
const TEXT_CHILD_RE = />([^<>{}\n][^<>{}\n]*)<\//g;

/** Bare string literals in JSX expression children: >{'Text'}< — same visible
 *  text as a plain child, just wrapped in an expression (needed when the
 *  string contains special JSX chars). */
const BRACED_CHILD_RE = /\{\s*'([^']{2,})'\s*\}/g;

/** Hardcoded bilingual ternary: lang === 'fr' ? 'X' : 'Y' with display text.
 *  Locale codes (fr-FR / en-US) and language codes (fr / en) are allowed. */
const BILINGUAL_TERNARY_RE = /lang\s*===\s*'fr'\s*\?\s*'([^']+)'\s*:\s*'([^']+)'/g;
const ALLOWED_TERNARY_BRANCHES = new Set(['fr', 'en', 'fr-FR', 'en-US', 'FR', 'EN']);

const walk = (dir, acc = []) => {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === 'dist' || entry === '.git') continue;
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) walk(p, acc);
    else if (/\.tsx$/.test(entry)) acc.push(p);
  }
  return acc;
};

const violations = [];

for (const file of walk(SRC)) {
  const code = readFileSync(file, 'utf8');
  const rel = file.replace(/\\/g, '/').replace(SRC.replace(/\\/g, '/') + '/', '');
  // Line-start offsets map an offset back to its source line.
  const lineStarts = [0];
  for (let i = 0; i < code.length; i++) if (code[i] === '\n') lineStarts.push(i + 1);
  const lineOf = (offset) => {
    let lo = 0, hi = lineStarts.length - 1;
    while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (lineStarts[mid] <= offset) lo = mid; else hi = mid - 1; }
    return lo + 1;
  };

  const bare = stripComments(code);

  // 1. Visible string-literal attributes
  for (const m of bare.matchAll(VISIBLE_ATTR_RE)) {
    const val = m[2].trim();
    if (!/[\p{L}]/u.test(val)) continue; // symbols, digits, dots
    if (EXACT_WHITELIST.has(val)) continue;
    if (NUMERIC.test(val) || EMAIL.test(val) || DOTS.test(val) || PHONE.test(val)) continue;
    violations.push(
      `${rel}:${lineOf(m.index)}  —  visible attribute ${m[1]}="${m[2].slice(0, 70)}" is hardcoded (use a t.* key)`
    );
  }

  // 2. JSX text children
  const markup = stripStrings(bare);
  for (const m of markup.matchAll(TEXT_CHILD_RE)) {
    const val = m[1].trim();
    if (!/[\p{L}]/u.test(val)) continue; // symbols, digits
    if (EXACT_WHITELIST.has(val)) continue;
    if (NUMERIC.test(val) || EMAIL.test(val) || DOTS.test(val) || PHONE.test(val)) continue;
    violations.push(
      `${rel}:${lineOf(m.index)}  —  JSX text "${val.slice(0, 70)}" is hardcoded (use a t.* key)`
    );
  }

  // 2b. Braced string literals in JSX children — checked on the RAW code (not
  // string-stripped) so `{'Text'}` (the standard escape for JSX-special
  // characters) is caught exactly like a plain text child.
  for (const m of bare.matchAll(BRACED_CHILD_RE)) {
    const val = m[1].trim();
    if (!/[\p{L}]/u.test(val)) continue;
    if (EXACT_WHITELIST.has(val)) continue;
    if (NUMERIC.test(val) || EMAIL.test(val) || DOTS.test(val) || PHONE.test(val)) continue;
    violations.push(
      `${rel}:${lineOf(m.index)}  —  braced JSX string "{'${val.slice(0, 60)}'}" is hardcoded (use a t.* key)`
    );
  }

  // 3. Hardcoded bilingual ternaries
  for (const m of bare.matchAll(BILINGUAL_TERNARY_RE)) {
    const [a, b] = [m[1], m[2]];
    if (ALLOWED_TERNARY_BRANCHES.has(a) && ALLOWED_TERNARY_BRANCHES.has(b)) continue;
    if (!/[\p{L}]/u.test(a) || !/[\p{L}]/u.test(b)) continue;
    violations.push(
      `${rel}:${lineOf(m.index)}  —  bilingual ternary '${a}' : '${b}' is hardcoded (add a t.* key)`
    );
  }
}

if (violations.length > 0) {
  console.error(`❌ Hardcoded visible JSX strings found (${violations.length}):`);
  for (const v of violations) console.error(`   ${v}`);
  console.error(
    '\n   Every visible label, placeholder, aria-label and text child must go through\n' +
    '   the central translations dictionary (t.*). Exceptions are documented in\n' +
    '   scripts/check-jsx-i18n.mjs — school branding, addresses, signatory names,\n' +
    '   document labels and input FORMAT EXAMPLES (sample placeholder data).\n' +
    '   To fix: replace the literal with {t.yourKey} and add the key to\n' +
    '   src/i18n/translations.ts in BOTH languages (en + fr, parity-checked).'
  );
  process.exit(1);
}
console.log('✅ No hardcoded visible JSX strings — all UI text goes through t.* (whitelist: branding/format examples).');
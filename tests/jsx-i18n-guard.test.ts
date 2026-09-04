/**
 * Static guard over scripts/check-jsx-i18n.mjs: the JSX visible-text i18n
 * gate must keep its three detectors (visible attributes, JSX text children,
 * braced `{'…'}` children) and its bilingual-ternary ban, and must stay
 * wired into `npm run lint`.
 *
 * Why: the detector set was the result of a full codebase sweep — dropping
 * any of the three detectors (or the lint wiring) would silently reopen the
 * door to hardcoded English/French UI copy that the l10n-verify key-parity
 * check cannot see (it only validates that referenced t.* keys exist, not
 * that visible literals went through them).
 *
 * Pure suite: no DOM, no React — plain node:test + fs (same discipline as
 * tests/pdf-i18n-guard.test.ts).
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const GUARD_SRC = readFileSync(join(ROOT, 'scripts/check-jsx-i18n.mjs'), 'utf8');
const PKG = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));

describe('jsx-i18n guard — the gate keeps all three detectors and stays wired', () => {
  it('scans visible string-literal attributes (placeholder/title/aria-label/label/alt)', () => {
    assert.match(GUARD_SRC, /aria-label\|label\|placeholder\|title\|alt/,
      'the visible-attribute detector must cover all five attributes');
  });

  it('scans JSX text children AND braced {\'…\'} children (the escape hatch)', () => {
    // Plain text children.
    assert.match(GUARD_SRC, /TEXT_CHILD_RE\s*=\s*\/>/,
      'the plain JSX text-child detector must exist');
    // Braced string literals: `{'Unpaid'}` is exactly as visible as `Unpaid`
    // and was the live escape hatch in the codebase (PS/MS/GS options etc.).
    assert.match(GUARD_SRC, /BRACED_CHILD_RE\s*=\s*\/\\{\\s\*'/,
      "the braced-literal child detector must exist (it caught real {'…'} hardcoded strings)");
  });

  it('bans hardcoded bilingual ternaries (lang === \'fr\' ? \'X\' : \'Y\')', () => {
    assert.match(GUARD_SRC, /BILINGUAL_TERNARY_RE/,
      'the bilingual-ternary detector must exist');
    // Locale pairs must stay allowed (fr-FR / en-US date formatting).
    assert.match(GUARD_SRC, /ALLOWED_TERNARY_BRANCHES/,
      'locale codes must remain explicitly allowed');
  });

  it('is wired into npm run lint', () => {
    assert.match(PKG.scripts.lint, /node scripts\/check-jsx-i18n\.mjs/,
      'the jsx-i18n gate must run inside npm run lint (pre-commit + CI)');
  });

  it('keeps the documented whitelist (branding / format examples)', () => {
    // School branding and input format examples are the two documented
    // exception families — the guard must still ship them.
    assert.match(GUARD_SRC, /COMPLEXE SCOLAIRE MAMA THERA/,
      'school branding stays whitelisted');
    assert.match(GUARD_SRC, /'Jane Doe'/,
      'input format examples stay whitelisted');
  });
});

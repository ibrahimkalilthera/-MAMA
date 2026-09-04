/**
 * Numeric WCAG lock for the light-theme contrast fixes (db70bc3 + the
 * light-theme remap layer in index.css) — with an AUTO-DERIVED manifest.
 *
 * Why numeric + static: the browser audit (scripts/theme-contrast-audit.mjs)
 * gates every theme at 3:1 for large/UI text, but small text (chips,
 * captions, pills: 9-12px) needs the WCAG AA 4.5:1 bar, and it only measures
 * whatever happens to be rendered with the ephemeral account's data. This
 * suite resolves the actual colors — base Tailwind palette, overridden by
 * each light theme's remap rules parsed from src/index.css — and asserts:
 *
 *   1. the light themes' remapped TEXT families (navy/emerald/bordeaux
 *      darken slate-400, emerald-500/600, rose-500/600, blue-500; cream
 *      remaps its own set) always clear 4.5:1 against the theme's light
 *      card; and their remapped solid-ACCENT backgrounds keep white text
 *      above 4.5:1 (the "white CTA on emerald-600" family);
 *   2. EVERY text-x / bg-x token pair that co-occurs in the same static segment of
 *      a className literal (manifest derived by tests/tailwind-pairs.ts —
 *      no hand-maintained list to go stale) resolves to >= 4.5:1 in ALL
 *      four light themes. A new low-contrast pair in any component fails
 *      here immediately, without anyone updating a manifest;
 *   3. every light fill (bg-*-50/100/200) carries a dark:bg-* counterpart
 *      in the same segment (the midnight white-chip defect class), modulo
 *      the documented fixed-light exemptions below;
 *   4. the DARK themes (slate: CSS !important remap layer; midnight:
 *      dark: variants alone) clear the same 4.5:1 bar: every remapped
 *      text family on the slate card, every accent-solid background
 *      against readable text, the :is() whiten-surface list staying in
 *      sync with the remap layer, and every derived text/bg pair as
 *      RESOLVED under each dark theme.
 *
 * Pure suite: no DOM, no React — plain node:test + fs + the shared scanner
 * (see tests/harness.ts "When NOT to use it").
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  LIGHT_THEMES,
  textOverrides,
  bgOverrides,
  extractColorPairs,
  extractMissingDarkBg,
  extractDarkColorPairs,
  resolve,
  resolveDark,
  contrast,
  composite,
  lum,
  hexRgb,
  rgbaToSolid,
  CARD,
  DARK_CARD,
  slateTextRemap,
  slateBgRemap,
  slateDarkSurfaces,
  whitenSurfaces,
  ROOT,
  type LightTheme,
} from './tailwind-pairs.ts';

const CSS = readFileSync(join(ROOT, 'src/index.css'), 'utf8');

/** The remapped accent families monitored in section 1 (bg tokens that carry white text). */
const ACCENT_SOLID = /^(blue|indigo|emerald|rose|amber|teal|purple|cyan)-(500|600|700)$/;

describe('light-theme remap layer — every remapped family clears WCAG AA 4.5:1', () => {
  it('parses a sane number of remap rules (guard against parser drift)', () => {
    assert.ok(textOverrides.size >= 8, `expected >= 8 light-theme text remaps, parsed ${textOverrides.size}`);
    assert.ok(bgOverrides.size >= 2, `expected >= 2 light-theme bg remaps, parsed ${bgOverrides.size}`);
  });

  it('remapped text families are >= 4.5:1 on their light card', () => {
    for (const theme of LIGHT_THEMES) {
      for (const [key, hex] of textOverrides) {
        const [t, token] = key.split(' ');
        if (t !== theme) continue;
        // Whitening rules (text-white on dark banners etc.) are not
        // dark-on-light families — skip them (they must stay light).
        if (lum(hexRgb(hex)) >= 0.5) continue;
        const ratio = contrast(hex, CARD[theme]);
        assert.ok(ratio >= 4.5,
          `${theme} remaps text-${token} to ${hex}: ${ratio.toFixed(2)}:1 on ${CARD[theme]} (< 4.5)`);
      }
    }
  });

  it('remapped solid accent backgrounds keep white text >= 4.5:1', () => {
    for (const theme of LIGHT_THEMES) {
      for (const [key, hex] of bgOverrides) {
        const [t, token] = key.split(' ');
        if (t !== theme || !ACCENT_SOLID.test(token)) continue;
        const ratio = contrast('#ffffff', hex);
        assert.ok(ratio >= 4.5,
          `${theme} remaps bg-${token} to ${hex}: white text is only ${ratio.toFixed(2)}:1 (< 4.5)`);
      }
    }
  });
});

describe('derived manifest: every co-occurring text/bg pair >= 4.5:1 in all light themes', () => {
  // The manifest IS the scan — nothing to maintain by hand. Known pairs
  // whose failure mode is "wrong branch pairing" (the text belongs to a
  // sibling element, not this bg) are impossible by construction: the
  // AST chunks guarantee same-segment co-occurrence. Tokens outside the
  // palette (arbitrary values, gradients) are surfaced as a coverage
  // warning, not silently skipped.
  const pairs = extractColorPairs();
  const unique = new Map<string, { text: string; bg: string; at: string[] }>();
  for (const p of pairs) {
    const key = `${p.text}|${p.bg}`;
    if (!unique.has(key)) unique.set(key, { text: p.text, bg: p.bg, at: [] });
    unique.get(key)!.at.push(`${p.file}:${p.line}`);
  }

  it('derives a sane manifest size (guard against scanner drift)', () => {
    assert.ok(unique.size >= 20, `expected >= 20 unique pairs, derived ${unique.size}`);
  });

  /**
   * Fixed-DARK surfaces — exempt from the light-card model by design
   * (the scanner cannot see ancestor context, so these are documented):
   *  - Sidebar.tsx CTA row: sits on the fixed-dark gradient sidebar
   *    (`app-sidebar`, text-white), emerald-300 on emerald-600/20 is the
   *    intended light-on-dark pairing;
   *  - DashboardView hero card (`card-hero`): a fixed-dark gradient with
   *    white headings — its emerald-400 accents are light-on-dark too
   *    (bg-emerald-500/[0.12] arbitrary alphas resolve to the 500 base
   *    token here, a conservative over-estimate of the real wash);
   *  - WelcomeBanner role badges: the banner is a fixed-dark gradient
   *    (white heading via inline style) — *-400 on *-500/20 is the
   *    intended light-on-dark pairing;
   *  - ExcelImportModal step indicator: the modal chrome is a fixed-dark
   *    slate-950 surface (bg-[#0F172A]/80) — emerald-400 "done" step chip
   *    is light-on-dark by design.
   */
  const FIXED_DARK_PAIRS = new Set([
    'emerald-300|emerald-600/20',
    'emerald-400|emerald-500',
    'emerald-400/80|emerald-500',
    'emerald-400|emerald-500/20',
    'cyan-400|cyan-500/20',
    'blue-400|blue-500/20',
    'purple-400|purple-500/20',
  ]);

  it('every derived token is in the palette or remapped (no silent skips)', () => {
    const unknown = new Set<string>();
    for (const { text, bg } of unique.values()) {
      const baseText = text.split('/')[0];
      const baseBg = bg.split('/')[0];
      for (const theme of LIGHT_THEMES) {
        if (resolve(theme, 'text', baseText) === undefined) unknown.add(`text-${baseText}`);
        if (resolve(theme, 'bg', baseBg) === undefined) unknown.add(`bg-${baseBg}`);
      }
    }
    assert.deepEqual([...unknown], [], 'tokens missing from tests/tailwind-pairs.ts PALETTE');
  });

  for (const [key, info] of [...unique.entries()].sort()) {
    const [text, bg] = key.split('|');
    it(`${key} (${info.at.length}×, e.g. ${info.at[0]})`, () => {
      if (FIXED_DARK_PAIRS.has(key)) return; // documented fixed-dark surface
      for (const theme of LIGHT_THEMES) {
        const fg = resolve(theme, 'text', text.split('/')[0]);
        const bgRaw = resolve(theme, 'bg', bg.split('/')[0]);
        const alpha = bg.includes('/') ? parseInt(bg.split('/')[1]) / 100 : 1;
        const bgHex = alpha === 1 ? bgRaw : composite(bgRaw, alpha, CARD[theme]);
        const ratio = contrast(fg, bgHex);
        assert.ok(ratio >= 4.5,
          `${info.at[0]}: text-${text} on bg-${bg} = ${ratio.toFixed(2)}:1 in ${theme} (< 4.5)`);
      }
    });
  }
});

/**
 * Midnight white-chip lock — light fills (bg-*-50/100/200) must each carry
 * a `dark:bg-*` counterpart in the same segment or they render as bright
 * chips on the midnight body. The old hand-listed DARK_PAIRS are subsumed:
 * any NEW light fill without a dark: counterpart fails here automatically.
 *
 * Documented exemptions (fixed-light surfaces by design):
 *  - print containers/headers: rendered ONLY for paper (white bg forced)
 *  - Login.tsx: the login screen is a fixed-light marketing surface
 *  - FloatingChat message history: fixed-light widget interior
 *  - SharedUi HighlightText <mark>: yellow highlight with explicit
 *    text-slate-900 (>= 10:1 on every theme)
 *  - ArchivesView close-out banner: 20%-alpha wash OVER the themed card
 *    (the card's own dark surface still shows through)
 */
describe('dark themes (slate + midnight): remap layers clear WCAG AA 4.5:1', () => {
  it('slate remapped text families are >= 4.5:1 on the slate card', () => {
    for (const [token, v] of slateTextRemap) {
      const hex = v.startsWith('rgba') ? rgbaToSolid(v, DARK_CARD.slate) : v;
      const ratio = contrast(hex, DARK_CARD.slate);
      assert.ok(ratio >= 4.5,
        `slate remaps text-${token} to ${v}: ${ratio.toFixed(2)}:1 on the slate card (< 4.5)`);
    }
  });

  it('slate accent-solid surfaces carry readable text (white or near-black, whichever fits)', () => {
    for (const [token, v] of slateBgRemap) {
      if (!ACCENT_SOLID.test(token)) continue;
      const hex = v.startsWith('rgba') ? rgbaToSolid(v, DARK_CARD.slate) : v;
      const white = contrast('#F8FAFC', hex);
      const dark = contrast('#0F172A', hex);
      assert.ok(Math.max(white, dark) >= 4.5,
        `slate remaps bg-${token} to ${v}: best text ratio is only ${Math.max(white, dark).toFixed(2)}:1 (< 4.5)`);
    }
  });

  it('the :is() whiten surfaces stay in sync with the bg remap layer', () => {
    assert.ok(whitenSurfaces.size >= 10, `parsed ${whitenSurfaces.size} :is() surfaces`);
    for (const s of whitenSurfaces) {
      assert.ok(slateDarkSurfaces.has(s), `:is() surface bg-${s} has no .theme-slate .bg-${s} remap`);
    }
  });
});

describe('derived dark manifest: every co-occurring text/bg pair >= 4.5:1 in slate + midnight', () => {
  const pairs = extractDarkColorPairs();
  const unique = new Map<string, { theme: string; text: string; bg: string; at: string[] }>();
  for (const p of pairs) {
    const key = `${p.theme} ${p.text}|${p.bg}`;
    if (!unique.has(key)) unique.set(key, { theme: p.theme, text: p.text, bg: p.bg, at: [] });
    unique.get(key)!.at.push(`${p.file}:${p.line}`);
  }

  it('derives a sane dark manifest size (guard against scanner drift)', () => {
    assert.ok(unique.size >= 20, `expected >= 20 unique dark pairs, derived ${unique.size}`);
  });

  /**
   * Documented exemptions, mirroring the light suite's FIXED_DARK_PAIRS:
   *  - DashboardView card-hero gradient (lines 66/71): fixed dark in EVERY
   *    theme — its emerald accents are light-on-dark by design;
   *  - Login (line 95): the login screen is a fixed-light marketing
   *    surface rendered before theming applies.
   */
  const DARK_EXEMPT = new Set([
    'slate emerald-400|emerald-500',
    'slate emerald-400/80|emerald-500',
    'midnight emerald-400|emerald-500',
    'midnight emerald-400/80|emerald-500',
    'midnight rose-600|rose-50',
  ]);

  for (const [key, info] of [...unique.entries()].sort()) {
    const [, rest] = key.split(' '); // first token is the theme
    const [text, bg] = rest.split('|');
    it(`${key} (${info.at.length}×, e.g. ${info.at[0]})`, () => {
      if (DARK_EXEMPT.has(key)) return;
      const p = pairs.find((q) => q.theme === info.theme && q.text === text && q.bg === bg)!;
      const ratio = contrast(p.fg, p.bgHex);
      assert.ok(ratio >= 4.5,
        `${info.at[0]} (${info.theme}): text-${text} on bg-${bg} = ${ratio.toFixed(2)}:1 (< 4.5)`);
    });
  }
});

describe('midnight lock: light fills carry a dark: counterpart', () => {
  const EXEMPT_FILES = [
    'components/PayrollView.tsx', // print header
    'components/StudentsView.tsx', // print header + divider
  ];
  const EXEMPT_LINES: Record<string, number[]> = {
    // print-student-file container internals (fixed print surface)
    // (line numbers updated after the StudentDetailsModal extraction, -410)
    'components/AppModals.tsx': [585, 706, 1415, 1571, 1631, 1643, 1664, 1667, 1690, 1694, 1698],
    'components/Login.tsx': [95, 110, 126],
    'components/FloatingChat.tsx': [115],
    'components/SharedUi.tsx': [18],
    // 20%-alpha rose wash OVER the themed card (dark surface shows through)
    'components/ExpensesView.tsx': [252],
  };

  const gaps = extractMissingDarkBg().filter(
    (g) => !EXEMPT_FILES.includes(g.file) && !(EXEMPT_LINES[g.file] ?? []).includes(g.line),
  );

  it('has no unexempted light fills without a dark: counterpart', () => {
    assert.deepEqual(
      gaps.map((g) => `${g.file}:${g.line} ${g.fill}`),
      [],
      'light fills missing a dark:bg-* counterpart (the midnight white-chip defect)',
    );
  });
});

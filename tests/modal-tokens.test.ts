/**
 * Structural lock for the semantic modal tokens (src/lib/modalTokens.ts).
 *
 * The repo's midnight-lock scanner (tests/theme-contrast-remap.test.ts)
 * only walks .tsx — fills that live in this .ts module are invisible to it,
 * so THIS suite is the enforcement point: every light fill defined here
 * must carry its `dark:` counterpart in the same string (the pairing is
 * structural, at the source, instead of an exemption-line entry).
 *
 * The payoff: as modal surfaces migrate onto tokens, their lines vanish
 * from the theme-contrast exemption list — a modal with a tokenized
 * scaffold needs NO exemption at all.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { modalTokens } from '../src/lib/modalTokens';
import type { CurrentTheme } from '../src/app/mainViewsProps';
import { contrast, DARK_CARD, DARK_THEMES, resolveDark } from './tailwind-pairs';

/** Any theme suffices — every token is theme-independent (panelSurface
 *  composes the caller's card/border). */
const fixture = {
  card: 'bg-white',
  border: 'border-slate-100',
  isDark: false,
} as CurrentTheme;

const LIGHT_FILL_RE = /(?:^|\s)(bg-[a-z]+-(?:50|100|200)(?:\/\d+)?)(?=\s|$)/;
const DARK_FILL_RE = /dark:bg-/;

describe('modal tokens — structural dark: pairing', () => {
  const tokens = modalTokens(fixture);

  it('every light fill carries a dark: counterpart in the same string', () => {
    const violations: string[] = [];
    for (const [key, value] of Object.entries(tokens)) {
      const m = value.match(LIGHT_FILL_RE);
      if (!m) continue;
      if (!DARK_FILL_RE.test(value)) {
        violations.push(`${key}: "${value}" has light fill ${m[1]} without a dark:bg- counterpart`);
        continue;
      }
      // The dark: counterpart must either restate the SAME fill (fixed-light
      // paper surfaces) or swap in an arbitrary dark value (disabled inset) —
      // never a different palette light fill (that would re-introduce the
      // white-chip class under a different name).
      const sameFill = value.includes(`dark:${m[1]}`);
      const arbitraryDark = /dark:bg-\[#/.test(value);
      if (!sameFill && !arbitraryDark) {
        violations.push(`${key}: dark: counterpart of ${m[1]} is neither the same fill nor an arbitrary dark value`);
      }
    }
    assert.deepEqual(violations, [], 'unpaired light fill(s) in modalTokens');
  });

  it('exposes exactly the documented token keys (renaming breaks consumers loudly)', () => {
    assert.deepEqual(
      Object.keys(tokens).sort(),
      ['backdrop', 'fieldDisabled', 'headerBar', 'headerClose', 'panelSurface', 'paperFillAlert', 'paperFillLight', 'paperFillMid'],
    );
  });

  /**
   * A token that repaints its surface dark (a `dark:bg-` that is NOT the
   * same-value paper pairing) is self-contained: nothing outside the token
   * can restore its contrast, so it MUST carry its own `dark:text-` and the
   * pair must clear WCAG AA 4.5:1 in both dark themes. This is the check
   * that caught fieldDisabled shipping with a dark bg but no dark text — an
   * <input>'s fieldtext stays black (inputs don't inherit color; midnight
   * has no input color rule). Uses the repo's own palette + WCAG math.
   */
  it('surface-changing dark fills carry a readable dark text in slate and midnight', () => {
    const failures: string[] = [];
    const darkPairRe = /dark:(bg|text)-\[([^\]]+)\]|dark:(bg|text)-([a-z]+-\d{2,3}(?:\/\d+)?)/g;
    for (const [key, value] of Object.entries(tokens)) {
      // Same-value paper pairing → fixed-light surface, text lives outside
      // the token (theme-fixed .tsx classes) — nothing to check here.
      const lightFill = value.match(LIGHT_FILL_RE)?.[1];
      const dark: { bg?: string; text?: string } = {};
      for (const m of value.matchAll(darkPairRe)) {
        const kind = (m[1] ?? m[3]) as 'bg' | 'text';
        dark[kind] = (m[2] ?? m[4]).toLowerCase();
      }
      const darkBg = dark.bg;
      const repaints = darkBg && (!lightFill || !value.includes(`dark:${lightFill}`));
      if (!repaints || !darkBg) continue;
      if (!dark.text) {
        failures.push(`${key}: dark:bg-${darkBg} repaints the surface without a dark:text — unreadable inherited/fieldtext color`);
        continue;
      }
      for (const theme of DARK_THEMES) {
        const bg = resolveDark(theme, 'bg', darkBg, DARK_CARD[theme]);
        const fg = resolveDark(theme, 'text', dark.text, DARK_CARD[theme]);
        if (!bg || !fg) {
          failures.push(`${key} (${theme}): unresolvable pair ${dark.text} on ${dark.bg}`);
          continue;
        }
        const ratio = contrast(fg, bg);
        if (ratio < 4.5) {
          failures.push(`${key} (${theme}): ${dark.text} on ${dark.bg} = ${ratio.toFixed(2)}:1 (< 4.5)`);
        }
      }
    }
    assert.deepEqual(failures, [], 'surface-changing dark token(s) without a readable text side');
  });

  it('panelSurface composes the caller\'s card and border (theme-faithful)', () => {
    const themed = modalTokens({ ...fixture, card: 'bg-[#111827]', border: 'border-[#1F2937]' } as CurrentTheme);
    assert.ok(themed.panelSurface.includes('bg-[#111827]'));
    assert.ok(themed.panelSurface.includes('border-[#1F2937]'));
  });
});
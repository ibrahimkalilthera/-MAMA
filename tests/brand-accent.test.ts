// Pure suite for src/lib/brandAccent: no DOM, no React — runs in plain node,
// like tests/utils.test.ts. The contrast rule is the reason this file exists:
// a logo can be ANY colour, so "white text on the accent" has to be a measured
// decision, not an assumption.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildAccentVars,
  contrastRatio,
  darken,
  lighten,
  parseColor,
  readableInk,
  relativeLuminance,
} from '../src/lib/brandAccent';

describe('parseColor', () => {
  it('reads the rgb() triple the logo reader stores', () => {
    assert.deepEqual(parseColor('rgb(30, 94, 58)'), [30, 94, 58]);
    assert.deepEqual(parseColor('rgb(255,0,0)'), [255, 0, 0]);
    assert.deepEqual(parseColor('rgba(30, 94, 58, 0.5)'), [30, 94, 58]);
  });

  it('reads #RRGGBB, which is what the theme table stores', () => {
    assert.deepEqual(parseColor('#1E5E3A'), [30, 94, 58]);
    assert.deepEqual(parseColor('#ffffff'), [255, 255, 255]);
  });

  it('returns null rather than NaN for anything else', () => {
    // The caller keeps the theme accent on null; a NaN channel would paint
    // `rgb(NaN,…)` into every button in the app.
    for (const bad of [null, undefined, '', 'red', '#FFF', 'rgb(300,0,0)', 'rgb(a,b,c)']) {
      assert.equal(parseColor(bad as string | null), null, `refused: ${String(bad)}`);
    }
  });
});

describe('readableInk — the rule amber used to need a hand-written comment for', () => {
  it('picks light ink on the dark theme accents', () => {
    assert.equal(readableInk([37, 99, 235]), '#FFFFFF', 'navy blue');
    assert.equal(readableInk([30, 94, 58]), '#FFFFFF', 'cream green');
    assert.equal(readableInk([0, 0, 0]), '#FFFFFF');
  });

  it('picks dark ink on the light theme accents', () => {
    // Cyber Minuit's amber: white ink is 2.15:1 — the exact pair the theme
    // files had to justify by comment. It must come out dark here.
    assert.equal(readableInk([245, 158, 11]), '#0B1220', 'midnight amber');
    assert.equal(readableInk([255, 255, 255]), '#0B1220');
  });

  it('keeps white whenever it clears the 3:1 bold-text bar, and never ships an unreadable pair', () => {
    const samples: Array<[number, number, number]> = [
      [0, 0, 0], [255, 255, 255], [245, 158, 11], [37, 99, 235],
      [30, 94, 58], [225, 29, 72], [2, 132, 199], [128, 128, 128], [5, 150, 105],
    ];
    for (const sample of samples) {
      const label = sample.join(',');
      const bg = relativeLuminance(sample);
      const white = contrastRatio(bg, relativeLuminance([255, 255, 255]));
      const dark = contrastRatio(bg, relativeLuminance([11, 18, 32]));
      const ink = readableInk(sample);

      if (white >= 3) {
        assert.equal(ink, '#FFFFFF', `white clears 3:1 on ${label} (${white.toFixed(2)}:1) so it stays`);
      } else {
        assert.equal(ink, '#0B1220', `white fails 3:1 on ${label} (${white.toFixed(2)}:1) so dark ink takes over`);
      }

      // Whichever wins, the pair that actually ships must be readable.
      const chosen = ink === '#FFFFFF' ? white : dark;
      assert.ok(chosen >= 3, `unreadable pair on ${label}: ${chosen.toFixed(2)}:1`);
    }
  });

  it('preserves the established design: white ink everywhere except the amber accent', () => {
    // These are the app's real theme accents. The rule must not "improve" slate
    // or emerald into dark-on-colour — that would be a redesign dressed up as a
    // fix, and it is exactly what a naive max-contrast rule does (5.0:1 and
    // 5.4:1 beat white's 4.2:1 and 3.9:1).
    assert.equal(readableInk([37, 99, 235]), '#FFFFFF', 'navy');
    assert.equal(readableInk([2, 132, 199]), '#FFFFFF', 'slate');
    assert.equal(readableInk([5, 150, 105]), '#FFFFFF', 'emerald');
    assert.equal(readableInk([225, 29, 72]), '#FFFFFF', 'bordeaux');
    assert.equal(readableInk([30, 94, 58]), '#FFFFFF', 'cream');
    assert.equal(readableInk([245, 158, 11]), '#0B1220', 'midnight amber — the one exception');
  });
});

describe('darken / lighten', () => {
  it('move toward black and white respectively, and stay in range', () => {
    assert.deepEqual(darken([100, 100, 100], 0.5), [50, 50, 50]);
    assert.deepEqual(lighten([0, 0, 0], 0.5), [128, 128, 128]);
    for (const amount of [0, 0.25, 1, 2, -1]) {
      for (const channel of [...darken([200, 100, 50], amount), ...lighten([200, 100, 50], amount)]) {
        assert.ok(channel >= 0 && channel <= 255, `out of range at amount=${amount}: ${channel}`);
      }
    }
  });
});

describe('buildAccentVars', () => {
  it('emits the full accent variable set from a logo colour', () => {
    const vars = buildAccentVars('rgb(30, 94, 58)', false);
    assert.ok(vars);
    assert.equal(vars['--accent-primary'], 'rgb(30,94,58)');
    assert.equal(vars['--accent-ink'], '#FFFFFF');
    assert.match(vars['--accent-primary-muted'], /^rgb\(30,94,58,0\.12\)$/);
    assert.match(vars['--accent-primary-shadow'], /^rgb\(30,94,58,0\.22\)$/);
    // The border tone is deliberately stronger than the muted wash (0.12): it
    // has to survive as a 1px hairline on a tinted chip, not as a surface.
    assert.match(vars['--accent-primary-border'], /^rgb\(30,94,58,0\.32\)$/);
    // Every key the CSS utilities read must be present, or a chip renders
    // transparent: the utilities have no fallback for the muted pair.
    for (const key of ['--accent-primary-hover', '--accent-primary-muted-hover', '--accent-soft-ink', '--accent-soft-ink-lifted']) {
      assert.ok(vars[key as keyof typeof vars], `missing ${key}`);
    }
  });

  it('returns null for an unparseable colour so the caller keeps the theme accent', () => {
    assert.equal(buildAccentVars(null), null);
    assert.equal(buildAccentVars(''), null);
    assert.equal(buildAccentVars('not-a-colour'), null);
  });

  it('lifts the soft-chip ink on a dark theme and keeps it deep on a light one', () => {
    const onLight = buildAccentVars('#F59E0B', false);
    const onDark = buildAccentVars('#F59E0B', true);
    assert.ok(onLight && onDark);
    assert.notEqual(onLight['--accent-soft-ink'], onDark['--accent-soft-ink']);

    // And the lifted variant is always the light one, because the sidebar rail
    // is dark in every theme.
    assert.equal(onLight['--accent-soft-ink-lifted'], onDark['--accent-soft-ink-lifted']);
  });
});

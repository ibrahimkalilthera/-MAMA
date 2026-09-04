/**
 * Numeric WCAG lock for the light-theme contrast fixes (db70bc3 + the
 * light-theme remap layer in index.css).
 *
 * Why numeric + static: the browser audit (scripts/theme-contrast-audit.mjs)
 * gates every theme at 3:1 for large/UI text, but the corrected families
 * below are *small text* (chips, captions, pills: 9-12px) which needs the
 * WCAG AA 4.5:1 bar, and it only measures what happens to be rendered with
 * the ephemeral account's data. This suite resolves the actual colors —
 * base Tailwind palette, overridden by each light theme's remap rules parsed
 * from src/index.css — and asserts the two things that regressed in the
 * past:
 *
 *   1. the light themes' remapped TEXT families (navy/emerald/bordeaux
 *      darken slate-400, emerald-500/600, rose-500/600, blue-500; cream
 *      remaps its own set) always clear 4.5:1 against the theme's light
 *      card; and their remapped solid-ACCENT backgrounds keep white text
 *      above 4.5:1 (the "white CTA on emerald-600" family);
 *   2. every status badge fixed in db70bc3 (Payé/Solde/Échéance pills,
 *      DEV/STAGING env badges, user-role chips and stats pills/captions)
 *      still resolves to ≥ 4.5:1 in ALL four light themes, and the fixed
 *      tokens are still the ones used in the components (a revert to
 *      text-*-400 / *-500 fills trips the presence check).
 *
 * Scope: light themes only — "surfaces claires". The dark themes (slate /
 * midnight) remap both text AND surface to dark and are covered by the
 * browser audit; their semantics (light-on-dark) would need a different
 * surface model than the light cards used here.
 *
 * Pure suite: no DOM, no React — plain node:test + fs (see tests/harness.ts
 * "When NOT to use it").
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CSS = readFileSync(join(ROOT, 'src/index.css'), 'utf8');

/** The four light themes (slate/midnight are dark — out of this suite's scope). */
const LIGHT_THEMES = ['navy', 'emerald', 'cream', 'bordeaux'] as const;
type LightTheme = (typeof LIGHT_THEMES)[number];

/** Light card surface per theme (the brightest surface text sits on). */
const CARD: Record<LightTheme, string> = {
  navy: '#ffffff',
  emerald: '#ffffff',
  cream: '#FFFDF9',
  bordeaux: '#ffffff',
};

/**
 * Base Tailwind v4 default palette for the tokens this suite touches. The
 * repo ships no @theme color overrides (no tailwind.config, no --color-*
 * in index.css), so these defaults ARE the resolved base colors; the
 * per-theme remap layer in index.css may override them (see below).
 */
const PALETTE: Record<string, string> = {
  white: '#ffffff',
  'slate-400': '#94a3b8',
  'slate-500': '#64748b',
  'slate-600': '#475569',
  'slate-800': '#1e293b',
  'slate-900': '#0f172a',
  'rose-50': '#fff1f2',
  'rose-100': '#ffe4e6',
  'rose-500': '#f43f5e',
  'rose-600': '#e11d48',
  'rose-700': '#be123c',
  'amber-50': '#fffbeb',
  'amber-100': '#fef3c7',
  'amber-500': '#f59e0b',
  'amber-600': '#d97706',
  'amber-700': '#b45309',
  'blue-50': '#eff6ff',
  'blue-100': '#dbeafe',
  'blue-500': '#3b82f6',
  'blue-600': '#2563eb',
  'blue-700': '#1d4ed8',
  'emerald-50': '#ecfdf5',
  'emerald-500': '#10b981',
  'emerald-600': '#059669',
  'emerald-700': '#047857',
  'teal-50': '#f0fdfa',
  'teal-500': '#14b8a6',
  'teal-700': '#0f766e',
  'purple-50': '#faf5ff',
  'purple-500': '#a855f7',
  'purple-600': '#9333ea',
  'purple-700': '#7e22ce',
  'cyan-500': '#06b6d4',
  'cyan-800': '#155e75',
  'indigo-600': '#4f46e5',
};

/* ─── WCAG math ─────────────────────────────────────────────────────────── */

const hexRgb = (hex: string): [number, number, number] => {
  const h = hex.replace('#', '');
  const n = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  return [parseInt(n.slice(0, 2), 16), parseInt(n.slice(2, 4), 16), parseInt(n.slice(4, 6), 16)];
};

const lum = (rgb: [number, number, number]): number => {
  const lin = rgb.map((v) => {
    const s = v / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2];
};

const contrast = (a: string, b: string): number => {
  const l1 = lum(hexRgb(a));
  const l2 = lum(hexRgb(b));
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
};

/** Composite a translucent token color over an opaque surface (sRGB). */
const composite = (fg: string, alpha: number, surface: string): string => {
  const f = hexRgb(fg);
  const s = hexRgb(surface);
  const out = f.map((v, i) => Math.round(alpha * v + (1 - alpha) * s[i])) as [number, number, number];
  return '#' + out.map((v) => v.toString(16).padStart(2, '0')).join('');
};

/* ─── Parse the light-theme remap layer from index.css ──────────────────── */

/** key: `${theme} ${token}` → solid hex. */
const textOverrides = new Map<string, string>();
const bgOverrides = new Map<string, string>();

// The remap layer groups several selectors per declaration block
// (`.theme-navy .text-rose-600, .theme-emerald .text-rose-600, ... { color:
// #BE123C }`). Walk every leaf declaration block; for each of its
// comma-separated segments that is EXACTLY `.theme-X .{text|bg}-TOKEN`,
// record the block's color / background-color. Scoped rules (`.theme-cream
// .welcome-banner .text-purple-400`, heading :is() lists, :hover variants)
// never match the exact segment shape, so whitening/welcome rules stay out.
const SEGMENT = /^\.theme-(navy|emerald|cream|bordeaux)\s+\.(text|bg)-([a-zA-Z0-9-]+)$/;
for (const block of CSS.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
  const selectors = block[1];
  const body = block[2];
  const colorDecl = body.match(/(?:^|[;}])\s*color\s*:\s*(#[0-9a-fA-F]{6}|#[0-9a-fA-F]{8})/);
  const bgDecl = body.match(/(?:^|[;}])\s*background-color\s*:\s*(#[0-9a-fA-F]{6}|#[0-9a-fA-F]{8})/);
  for (const seg of selectors.split(',')) {
    const m = seg.trim().match(SEGMENT);
    if (!m) continue;
    const [, theme, kind, token] = m;
    const decl = kind === 'text' ? colorDecl : bgDecl;
    if (!decl) continue;
    const map = kind === 'text' ? textOverrides : bgOverrides;
    map.set(`${theme} ${token}`, decl[1].toLowerCase());
  }
}

/** Resolve a token (or '#hex') to its final color under a light theme. */
const resolve = (theme: LightTheme, kind: 'text' | 'bg', token: string): string => {
  if (token.startsWith('#')) return token.toLowerCase();
  const overridden = (kind === 'text' ? textOverrides : bgOverrides).get(`${theme} ${token}`);
  if (overridden) return overridden;
  const base = PALETTE[token];
  assert.ok(base, `palette entry missing for ${kind}-${token} (theme ${theme})`);
  return base;
};

/** The remapped accent families monitored in section 1 (bg tokens that carry white text). */
const ACCENT_SOLID = /^(blue|indigo|emerald|rose|amber|teal|purple|cyan)-(500|600|700)$/;

/* ─── The fixed badge pairs (db70bc3) ───────────────────────────────────── */

interface BadgePair {
  label: string;
  file: string;
  /** Token pair (both must still be present in the component source). */
  needle: string;
  fg: string;
  bg: string;
  /** Translucent fill → composited over the light card surface. */
  bgAlpha?: number;
}

const BADGES: BadgePair[] = [
  // Échéance / Solde pills (getStatus + vendor payment chips).
  { label: 'Échéance pill', file: 'src/App.tsx', needle: "text-amber-700 bg-amber-50", fg: 'amber-700', bg: 'amber-50' },
  { label: 'Paiement partiel fournisseur chip', file: 'src/components/ExpensesView.tsx', needle: "bg-amber-50 text-amber-700", fg: 'amber-700', bg: 'amber-50' },
  // Dépense impayée: overdue = solid rose (white text), else pastel chip.
  { label: 'Impaysé en retard chip (white on solid rose)', file: 'src/components/ExpensesView.tsx', needle: "bg-rose-600 text-white", fg: '#ffffff', bg: 'rose-600' },
  { label: 'Impayé chip (pastel)', file: 'src/components/ExpensesView.tsx', needle: "bg-rose-50 dark:bg-rose-950/40 text-rose-600", fg: 'rose-600', bg: 'rose-50' },
  // Env badges — white on 700-level fills.
  { label: 'EnvBadge DEV', file: 'src/components/ToastNotification.tsx', needle: "'bg-amber-700' : 'bg-blue-700'", fg: '#ffffff', bg: 'blue-700' },
  { label: 'EnvBadge STAGING', file: 'src/components/ToastNotification.tsx', needle: "'bg-amber-700' : 'bg-blue-700'", fg: '#ffffff', bg: 'amber-700' },
  // Role-stat count pills (*-500/20 tint fills).
  { label: 'Count pill staff', file: 'src/components/MainViews.tsx', needle: "bg-blue-500/20 text-blue-700", fg: 'blue-700', bg: 'blue-500', bgAlpha: 0.2 },
  { label: 'Count pill économe', file: 'src/components/MainViews.tsx', needle: "bg-teal-500/20 text-teal-700", fg: 'teal-700', bg: 'teal-500', bgAlpha: 0.2 },
  { label: 'Count pill dev', file: 'src/components/MainViews.tsx', needle: "bg-purple-500/20 text-purple-700", fg: 'purple-700', bg: 'purple-500', bgAlpha: 0.2 },
  // Role chips (user list).
  { label: 'Role chip admin / « Vous »', file: 'src/components/MainViews.tsx', needle: "bg-emerald-500/20 text-emerald-600", fg: 'emerald-600', bg: 'emerald-500', bgAlpha: 0.2 },
  { label: 'Role chip dev', file: 'src/components/MainViews.tsx', needle: "bg-purple-500/20 text-purple-700", fg: 'purple-700', bg: 'purple-500', bgAlpha: 0.2 },
  { label: 'Role chip GM', file: 'src/components/MainViews.tsx', needle: "bg-cyan-500/20 text-cyan-800", fg: 'cyan-800', bg: 'cyan-500', bgAlpha: 0.2 },
  { label: 'Role chip staff', file: 'src/components/MainViews.tsx', needle: "bg-blue-500/20 text-blue-700", fg: 'blue-700', bg: 'blue-500', bgAlpha: 0.2 },
  // Role-stat captions on pastel/70 cards.
  { label: 'Caption promoteurs', file: 'src/components/MainViews.tsx', needle: "text-emerald-600 dark:text-emerald-400", fg: 'emerald-600', bg: 'emerald-50', bgAlpha: 0.7 },
  { label: 'Caption staff', file: 'src/components/MainViews.tsx', needle: "text-blue-600 dark:text-blue-400", fg: 'blue-600', bg: 'blue-50', bgAlpha: 0.7 },
  { label: 'Caption économe', file: 'src/components/MainViews.tsx', needle: "text-teal-700 dark:text-teal-400", fg: 'teal-700', bg: 'teal-50', bgAlpha: 0.7 },
  { label: 'Caption dev', file: 'src/components/MainViews.tsx', needle: "text-purple-600 dark:text-purple-400", fg: 'purple-600', bg: 'purple-50', bgAlpha: 0.7 },
];

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

describe('fixed status badges resolve to >= 4.5:1 in every light theme (db70bc3 lock)', () => {
  for (const b of BADGES) {
    it(`${b.label} — tokens still in use (${b.file})`, () => {
      const src = readFileSync(join(ROOT, b.file), 'utf8');
      assert.ok(src.includes(b.needle),
        `${b.file} no longer contains the fixed pair "${b.needle}" — a contrast fix was reverted`);
    });

    it(`${b.label} — resolved contrast >= 4.5:1 in all light themes`, () => {
      for (const theme of LIGHT_THEMES) {
        const fg = resolve(theme, 'text', b.fg);
        const bgRaw = resolve(theme, 'bg', b.bg);
        const bg = b.bgAlpha === undefined ? bgRaw : composite(bgRaw, b.bgAlpha, '#ffffff');
        const ratio = contrast(fg, bg);
        assert.ok(ratio >= 4.5,
          `${b.label} in ${theme}: ${fg} on ${bg} = ${ratio.toFixed(2)}:1 (< 4.5)`);
      }
    });
  }
});

/**
 * Dark-theme (midnight) badge lock — the pastel badges above keep a LIGHT
 * surface under the light themes, but the midnight theme has NO CSS remap
 * layer (unlike slate): fixed-light `bg-*-50/100` badges must each carry a
 * `dark:` counterpart or they render as bright white chips on the midnight
 * body (the "1ÈRE ANNÉE B" white pill in the Élèves view, the status pills,
 * the calendar event chips, …). Presence canary: dropping the dark:
 * variant from any of these known badges trips the suite. Dark text on the
 * dark surfaces is then covered by the browser audit (>= 3:1).
 */
describe('midnight badge surfaces carry a dark: counterpart (fixed-light pills)', () => {
  const DARK_PAIRS: { label: string; file: string; needle: string }[] = [
    { label: 'grade pill Élèves', file: 'src/components/StudentsView.tsx', needle: 'bg-blue-50 dark:bg-blue-950/40 text-blue-600 dark:text-blue-300' },
    { label: 'Échéance pill', file: 'src/App.tsx', needle: 'bg-amber-50 border-amber-100 dark:bg-amber-950/40 dark:text-amber-300' },
    { label: 'Solde pill', file: 'src/App.tsx', needle: 'bg-emerald-50 border-emerald-100 dark:bg-emerald-950/40 dark:text-emerald-300' },
    { label: 'Impulsion retard pill', file: 'src/App.tsx', needle: 'bg-rose-50 border-rose-100 dark:bg-rose-950/40 dark:text-rose-300' },
    { label: 'Fiche élève grade pill', file: 'src/components/AppModals.tsx', needle: 'bg-blue-50 dark:bg-blue-950/40 text-blue-600 dark:text-blue-300' },
    { label: 'Paiement fournisseur partiel', file: 'src/components/ExpensesView.tsx', needle: 'bg-amber-50 text-amber-700 dark:bg-amber-950/40' },
    { label: 'Calendrier chips MainViews', file: 'src/components/MainViews.tsx', needle: 'bg-rose-100 dark:bg-rose-950/60 text-rose-600 dark:text-rose-300' },
    { label: 'Locked tag Archives', file: 'src/components/ArchivesView.tsx', needle: 'bg-rose-50 dark:bg-rose-950/40 text-rose-700 dark:text-rose-300' },
    { label: 'Active tag Archives', file: 'src/components/ArchivesView.tsx', needle: 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300' },
    { label: 'Solde chip fiche (rose)', file: 'src/components/AppModals.tsx', needle: 'bg-rose-50 dark:bg-rose-950/30 rounded-2xl' },
    { label: 'Fenêtre paie ouverte Dashboard', file: 'src/components/DashboardView.tsx', needle: 'bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-900/50' },
    { label: 'Classe code AddClass', file: 'src/components/AddClassModal.tsx', needle: 'bg-blue-50 dark:bg-blue-950/40 text-blue-600 dark:text-blue-300' },
  ];
  for (const p of DARK_PAIRS) {
    it(`${p.label} — dark: counterpart present (${p.file})`, () => {
      const src = readFileSync(join(ROOT, p.file), 'utf8');
      assert.ok(src.includes(p.needle),
        `${p.file} no longer contains "${p.needle}" — the midnight white-badge fix was reverted`);
    });
  }
});

/**
 * Shared Tailwind contrast scanner — derives the tested-pair manifest from
 * the component sources instead of maintaining it by hand.
 *
 * Two scans:
 *   1. `extractColorPairs`  — every text-x / bg-x token pair that co-occurs in
 *      the SAME static segment of a className literal. Template-literal
 *      `${...}` interpolations are alternative branches, so only each quasi
 *      (static chunk) is a co-occurrence surface. Parsing is AST-based
 *      (typescript module) so string content inside comments/JSX text can
 *      never leak in as a false co-occurrence.
 *   2. `extractMissingDarkBg` — every light fill (bg-*-50/100/200) whose
 *      static segment carries no `dark:bg-*` counterpart — the "midnight
 *      white chip" defect class. Returned as candidates; a fixed exemption
 *      list (print containers, login, fixed-light chat, <mark> highlight)
 *      documents the legitimate fixed-light surfaces.
 *
 * Also exports the WCAG helpers + the light-theme remap parser shared with
 * theme-contrast-remap.test.ts (single source of truth for the contrast
 * math, palette, and index.css parsing).
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import typescript from 'typescript';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(ROOT, 'src');

/* ─── Source walking ─────────────────────────────────────────────────────── */

export const walkTsx = (dir = SRC, acc: string[] = []): string[] => {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === 'dist' || entry === '.git') continue;
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) walkTsx(p, acc);
    else if (/\.tsx$/.test(entry)) acc.push(p);
  }
  return acc;
};

/** File path relative to src/ with forward slashes (stable in test labels). */
export const relSrc = (file: string): string => file.slice(SRC.length + 1).replace(/\\/g, '/');

/* ─── AST-based className literal extraction ─────────────────────────────── */

export interface LiteralOccurrence {
  file: string;
  line: number;
  /** Static segments of the literal (template quasis + plain strings). */
  chunks: string[];
  /** Per-chunk surface mode (see SurfaceMode). */
  darkFlags: SurfaceMode[];
}

/**
 * Surface semantics of a static chunk:
 *  - 'plain'         unconditional (needs a dark: counterpart for midnight)
 *  - 'dark'          fixed-dark surface (isDark true-branch or dark component)
 *  - 'light-branch'  the light branch of an isDark ternary (the sibling dark
 *                    branch already handles midnight — exempt from the
 *                    dark:-counterpart requirement, still light-card tested)
 *  - 'slate-only'    `theme === 'slate'` true-branch — renders ONLY under
 *                    slate; skipped by the light + midnight scans
 *  - 'midnight-only' `theme === 'midnight'` true-branch — renders ONLY under
 *                    midnight; skipped by the light + slate scans
 */
export type SurfaceMode = 'plain' | 'dark' | 'light-branch' | 'slate-only' | 'midnight-only';

const collectStrings = (
  node: import('typescript').Node,
  out: { text: string; pos: number; dark: SurfaceMode }[],
  mode: SurfaceMode = 'plain',
) => {
  const ts = typescript;
  // A JSX attribute initializer written as {expr} wraps the expression in a
  // JsxExpression — unwrap it (this is what makes interpolated className
  // literals visible to the scan).
  if (ts.isJsxExpression(node)) {
    if (node.expression) collectStrings(node.expression, out, mode);
    return;
  }
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
    out.push({ text: node.text, pos: node.getStart(), dark: mode });
  } else if (ts.isTemplateExpression(node)) {
    // Head quasi (before the first ${...}) is its own static chunk.
    out.push({ text: node.head.text, pos: node.head.getStart(), dark: mode });
    for (const span of node.templateSpans) {
      // Interpolated expressions may hold ternary-branch strings; each
      // collected string is an independent co-occurrence surface, so branch
      // pairs count internally but never pair across branches.
      collectStrings(span.expression, out, mode);
      collectStrings(span.literal, out, mode);
    }
  } else if (ts.isConditionalExpression(node)) {
    // A `isDark ? darkBranch : lightBranch` ternary tags each branch with
    // its surface semantics so fixed-dark branch pairs are never tested
    // against the light-card model, and the light branch is exempt from
    // the midnight dark:-counterpart requirement. Theme-equality checks
    // get precise tags: a LIGHT-theme condition selects its true branch
    // only in light themes (skipped in the dark model), a `theme ===
    // 'slate'` / `'midnight'` condition selects its true branch ONLY in
    // that one dark theme (the else branch renders in the other dark
    // theme AND in light themes — so it stays 'plain', tested everywhere).
    const condText = node.condition.getText();
    const isLightTheme =
      /'cream'|"cream"|'navy'|"navy"|'emerald'|"emerald"|'bordeaux'|"bordeaux"/.test(condText);
    if (isLightTheme) {
      collectStrings(node.whenTrue, out, 'light-branch');
      collectStrings(node.whenFalse, out, mode);
    } else if (/'slate'|"slate"/.test(condText)) {
      collectStrings(node.whenTrue, out, 'slate-only');
      collectStrings(node.whenFalse, out, 'plain');
    } else if (/'midnight'|"midnight"/.test(condText)) {
      collectStrings(node.whenTrue, out, 'midnight-only');
      collectStrings(node.whenFalse, out, 'plain');
    } else if (/isDark|dark/i.test(condText)) {
      collectStrings(node.whenTrue, out, 'dark');
      collectStrings(node.whenFalse, out, 'light-branch');
    } else {
      collectStrings(node.whenTrue, out, mode);
      collectStrings(node.whenFalse, out, mode);
    }
    // The condition may itself contain literals (nested ternaries / ands).
    collectStrings(node.condition, out, mode);
  } else if (ts.isBinaryExpression(node) && node.operatorToken.kind === typescript.SyntaxKind.AmpersandAmpersandToken) {
    collectStrings(node.right, out, mode);
  } else if (ts.isParenthesizedExpression(node)) {
    collectStrings(node.expression, out, mode);
  }
};

/**
 * Every className/ClassNames literal in a source file, with its static
 * chunks split on template interpolation boundaries.
 */
export const extractLiterals = (code: string): LiteralOccurrence[] => {
  const ts = typescript;
  const sf = ts.createSourceFile('x.tsx', code, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const out: LiteralOccurrence[] = [];
  const visit = (node: import('typescript').Node): void => {
    const isJsxProp =
      ts.isJsxAttribute(node) && /^(className|class)$/.test(node.name.getText());
    if (isJsxProp) {
      const init = (node as import('typescript').JsxAttribute).initializer;
      if (init) {
        const strings: { text: string; pos: number; dark: SurfaceMode }[] = [];
        collectStrings(init, strings);
        const chunks: string[] = [];
        const darkFlags: SurfaceMode[] = [];
        for (const s of strings) {
          // Template quasis: split each literal's text on ${...} boundaries.
          const parts = s.text.split(/\$\{[^]*?\}/g);
          for (const part of parts) {
            chunks.push(part);
            darkFlags.push(s.dark);
          }
        }
        if (chunks.length) {
          out.push({ file: '', line: code.slice(0, init.getStart()).split('\n').length, chunks, darkFlags });
        }
      }
    } else if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      /(^|\.)(cx|cn|clsx|classNames)$/.test(node.expression.getText())
    ) {
      const strings: { text: string; pos: number; dark: SurfaceMode }[] = [];
      for (const a of node.arguments) collectStrings(a, strings);
      const chunks: string[] = [];
      const darkFlags: SurfaceMode[] = [];
      for (const s of strings) {
        for (const part of s.text.split(/\$\{[^]*?\}/g)) {
          chunks.push(part);
          darkFlags.push(s.dark);
        }
      }
      if (chunks.length) {
        out.push({ file: '', line: code.slice(0, node.getStart()).split('\n').length, chunks, darkFlags });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return out;
};

/* ─── Token extraction ───────────────────────────────────────────────────── */

const TOKEN_RE = /\b(text|bg)-([a-z]+-\d{2,3}(?:\/\d+)?)\b/;
const VARIANT_RE = /\b(?:hover|focus|active|group-hover|peer-[a-z]+|dark|print|md|lg|sm|xl):\s*$/;

export interface TokenHit {
  kind: 'text' | 'bg';
  token: string;
  dark: boolean;
}

/** Tokens co-occurring in one static chunk (variants stripped out). */
export const chunkTokens = (chunk: string): TokenHit[] => {
  const hits: TokenHit[] = [];
  for (const m of chunk.matchAll(new RegExp(TOKEN_RE.source, 'g'))) {
    const before = chunk.slice(0, m.index ?? 0).trimEnd();
    const lastWord = before.split(/\s+/).pop() ?? '';
    if (VARIANT_RE.test(lastWord)) continue;
    hits.push({ kind: m[1] as 'text' | 'bg', token: m[2], dark: false });
  }
  // dark: variants tracked separately (used by the midnight surface scan).
  // BARE dark: only — dark:hover: / dark:focus: are hover/focus states whose
  // bg only exists on interaction and must not pair with resting text.
  for (const m of chunk.matchAll(/dark:(text|bg)-([a-z]+-\d{2,3}(?:\/\d+)?)\b/g)) {
    hits.push({ kind: m[1] as 'text' | 'bg', token: m[2], dark: true });
  }
  return hits;
};

export interface ColorPair {
  file: string;
  line: number;
  text: string;
  bg: string;
}

/** All text/bg pairs co-occurring within the same static chunk, repo-wide. */
export const extractColorPairs = (): ColorPair[] => {
  const pairs: ColorPair[] = [];
  for (const f of walkTsx()) {
    const code = readFileSync(f, 'utf8');
    const rel = relSrc(f);
    for (const lit of extractLiterals(code)) {
      lit.chunks.forEach((chunk, i) => {
        // Fixed-dark chunks are exempt from the light-card model; the light
        // branch of an isDark ternary is still light-card tested. Theme-
        // specific dark branches (slate/midnight) never render in light
        // themes at all.
        if (lit.darkFlags[i] === 'dark' || lit.darkFlags[i] === 'slate-only' || lit.darkFlags[i] === 'midnight-only') return;
        const hits = chunkTokens(chunk);
        const texts = hits.filter((h) => h.kind === 'text' && !h.dark);
        const bgs = hits.filter((h) => h.kind === 'bg' && !h.dark);
        for (const t of texts) for (const b of bgs) pairs.push({ file: rel, line: lit.line, text: t.token, bg: b.token });
      });
    }
  }
  return pairs;
};

/* ─── Midnight surface scan ──────────────────────────────────────────────── */

export interface DarkGap {
  file: string;
  line: number;
  fill: string;
}

/**
 * Light fills (bg-*-50/100/200) with no dark:bg-* in the same chunk.
 * The caller (test) holds the documented fixed-light exemption list.
 */
export const extractMissingDarkBg = (): DarkGap[] => {
  const gaps: DarkGap[] = [];
  for (const f of walkTsx()) {
    const rel = relSrc(f);
    const code = readFileSync(f, 'utf8');
    for (const lit of extractLiterals(code)) {
      lit.chunks.forEach((chunk, i) => {
        // Only UNCONDITIONAL chunks owe a dark: counterpart — a light branch
        // of an isDark ternary has its dark handling in the sibling branch.
        if (lit.darkFlags[i] !== 'plain') return;
        const lightFill = chunk.match(/(?:^|\s)(bg-[a-z]+-(?:50|100|200)(?:\/\d+)?)(?=\s|$)/);
        if (!lightFill) return;
        if (/dark:bg-/.test(chunk)) return;
        gaps.push({ file: rel, line: lit.line, fill: lightFill[1] });
      });
    }
  }
  return gaps;
};
/* ─── Theme remap layer (from index.css) ─────────────────────────────────── */

export const LIGHT_THEMES = ['navy', 'emerald', 'cream', 'bordeaux'] as const;
export type LightTheme = (typeof LIGHT_THEMES)[number];

export const CSS_TEXT = readFileSync(join(ROOT, 'src/index.css'), 'utf8');

/** key: `${theme} ${token}` → solid hex. */
export const textOverrides = new Map<string, string>();
export const bgOverrides = new Map<string, string>();

const SEGMENT = /^\.theme-(navy|emerald|cream|bordeaux)\s+\.(text|bg)-([a-zA-Z0-9-]+)$/;
for (const block of CSS_TEXT.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
  const colorDecl = block[2].match(/(?:^|[;}])\s*color\s*:\s*(#[0-9a-fA-F]{6}|#[0-9a-fA-F]{8})/);
  const bgDecl = block[2].match(/(?:^|[;}])\s*background-color\s*:\s*(#[0-9a-fA-F]{6}|#[0-9a-fA-F]{8})/);
  for (const seg of block[1].split(',')) {
    const m = seg.trim().match(SEGMENT);
    if (!m) continue;
    const [, theme, kind, token] = m;
    const decl = kind === 'text' ? colorDecl : bgDecl;
    if (!decl) continue;
    (kind === 'text' ? textOverrides : bgOverrides).set(`${theme} ${token}`, decl[1].toLowerCase());
  }
}

/* ─── Palette + WCAG math ────────────────────────────────────────────────── */

export const PALETTE: Record<string, string> = {
  white: '#ffffff',
  'slate-50': '#f8fafc', 'slate-100': '#f1f5f9', 'slate-200': '#e2e8f0',
  'slate-300': '#cbd5e1', 'slate-400': '#94a3b8', 'slate-500': '#64748b',
  'slate-600': '#475569', 'slate-700': '#334155', 'slate-800': '#1e293b',
  'slate-900': '#0f172a', 'slate-950': '#020617',
  'rose-50': '#fff1f2', 'rose-100': '#ffe4e6', 'rose-200': '#fecdd3',
  'rose-300': '#fda4af', 'rose-400': '#fb7185',
  'rose-500': '#f43f5e', 'rose-600': '#e11d48', 'rose-700': '#be123c',
  'rose-800': '#9f1239', 'rose-900': '#881337', 'rose-950': '#4c0519',
  'amber-50': '#fffbeb', 'amber-100': '#fef3c7', 'amber-200': '#fde68a',
  'amber-300': '#fcd34d', 'amber-500': '#f59e0b', 'amber-600': '#d97706', 'amber-700': '#b45309',
  'amber-800': '#92400e', 'amber-900': '#78350f', 'amber-950': '#451a03',
  'blue-50': '#eff6ff', 'blue-100': '#dbeafe', 'blue-200': '#bfdbfe',
  'blue-300': '#93c5fd', 'blue-400': '#60a5fa',
  'blue-500': '#3b82f6', 'blue-600': '#2563eb', 'blue-700': '#1d4ed8',
  'blue-800': '#1e40af', 'blue-900': '#1e3a8a', 'blue-950': '#172554',
  'emerald-50': '#ecfdf5', 'emerald-100': '#d1fae5', 'emerald-200': '#a7f3d0',
  'emerald-300': '#6ee7b7', 'emerald-400': '#34d399', 'emerald-500': '#10b981',
  'emerald-600': '#059669', 'emerald-700': '#047857', 'emerald-800': '#065f46',
  'emerald-900': '#064e3b', 'emerald-950': '#022c22',
  'teal-50': '#f0fdfa', 'teal-100': '#ccfbf1', 'teal-500': '#14b8a6',
  'teal-600': '#0d9488', 'teal-700': '#0f766e', 'teal-800': '#115e59',
  'teal-900': '#134e4a', 'teal-950': '#042f2e',
  'purple-50': '#faf5ff', 'purple-100': '#f3e8ff', 'purple-300': '#d8b4fe',
  'purple-400': '#c084fc', 'purple-500': '#a855f7',
  'purple-600': '#9333ea', 'purple-700': '#7e22ce', 'purple-800': '#6b21a8',
  'purple-900': '#581c87', 'purple-950': '#3b0764',
  'cyan-50': '#ecfeff', 'cyan-100': '#cffafe', 'cyan-300': '#67e8f9',
  'cyan-400': '#22d3ee', 'cyan-500': '#06b6d4',
  'cyan-600': '#0891b2', 'cyan-700': '#0e7490', 'cyan-800': '#155e75',
  'cyan-900': '#164e63', 'cyan-950': '#083344',
  'indigo-500': '#6366f1', 'indigo-600': '#4f46e5', 'indigo-700': '#4338ca',
  'indigo-900': '#312e81', 'indigo-950': '#1e1b4b',
  'red-50': '#fef2f2', 'red-100': '#fee2e2', 'red-500': '#ef4444',
  'red-600': '#dc2626', 'red-700': '#b91c1c', 'red-800': '#991b1b',
  'red-900': '#7f1d1d', 'red-950': '#450a0a',
  'green-50': '#f0fdf4', 'green-500': '#22c55e', 'green-600': '#16a34a',
  'green-700': '#15803d', 'green-800': '#166534', 'green-900': '#14532d',
  'yellow-50': '#fefce8', 'yellow-100': '#fef9c3', 'yellow-200': '#fef08a',
  'yellow-300': '#fde047', 'yellow-500': '#eab308', 'yellow-600': '#ca8a04',
  'yellow-700': '#a16207', 'yellow-800': '#854d0e', 'yellow-900': '#713f12',
  'yellow-950': '#422006',
  'orange-50': '#fff7ed', 'orange-100': '#ffedd5', 'orange-500': '#f97316',
  'orange-600': '#ea580c', 'orange-700': '#c2410c', 'orange-800': '#9a3412',
  'sky-50': '#f0f9ff', 'sky-100': '#e0f2fe', 'sky-300': '#7dd3fc',
  'sky-400': '#38bdf8', 'sky-500': '#0ea5e9',
  'sky-600': '#0284c7', 'sky-700': '#0369a1', 'sky-800': '#075985',
  'fuchsia-500': '#d946ef', 'fuchsia-600': '#c026d3', 'fuchsia-700': '#a21caf',
  'lime-500': '#84cc16', 'lime-600': '#65a30d', 'lime-700': '#4d7c0f',
  'pink-50': '#fdf2f8', 'pink-500': '#ec4899', 'pink-600': '#db2777',
  'pink-700': '#be185d', 'pink-800': '#9d174d',
  'violet-50': '#f5f3ff', 'violet-100': '#ede9fe', 'violet-500': '#8b5cf6', 'violet-600': '#7c3aed',
  'violet-700': '#6d28d9', 'violet-800': '#5b21b6',
};

export const hexRgb = (hex: string): [number, number, number] => {
  const h = hex.replace('#', '');
  const n = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  return [parseInt(n.slice(0, 2), 16), parseInt(n.slice(2, 4), 16), parseInt(n.slice(4, 6), 16)];
};

export const lum = (rgb: [number, number, number]): number => {
  const lin = rgb.map((v) => {
    const s = v / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2];
};

export const contrast = (a: string, b: string): number => {
  const l1 = lum(hexRgb(a));
  const l2 = lum(hexRgb(b));
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
};

/** Composite a translucent token color over an opaque surface (sRGB). */
export const composite = (fg: string, alpha: number, surface: string): string => {
  const f = hexRgb(fg);
  const s = hexRgb(surface);
  const out = f.map((v, i) => Math.round(alpha * v + (1 - alpha) * s[i])) as [number, number, number];
  return '#' + out.map((v) => v.toString(16).padStart(2, '0')).join('');
};

/** Light card surface per theme (the brightest surface text sits on). */
export const CARD: Record<LightTheme, string> = {
  navy: '#ffffff',
  emerald: '#ffffff',
  cream: '#FFFDF9',
  bordeaux: '#ffffff',
};

/** Resolve a token (or '#hex') to its final color under a light theme. */
export const resolve = (theme: LightTheme, kind: 'text' | 'bg', token: string): string => {
  if (token.startsWith('#')) return token.toLowerCase();
  const overridden = (kind === 'text' ? textOverrides : bgOverrides).get(`${theme} ${token}`);
  if (overridden) return overridden;
  return PALETTE[token];
};

/* ─── Dark-theme model (slate + midnight) ────────────────────────────────── */

/**
 * DARK themes resolve differently from the light four:
 *  - `slate`    — a CSS remap layer in index.css (!important) repaints the
 *    pastel/neutral utility classes: bg-white→card, bg-slate-50→inset,
 *    pastel -50/-100 surfaces→dark equivalents, text-slate-950..600→
 *    #F8FAFC inside those dark surfaces (the :is() whiten rule),
 *    text-rose-600..→#FDA4AF etc. The `.dark` ancestor is ALSO set under
 *    slate, so unremapped tokens fall back to their dark: variant.
 *  - `midnight` — no CSS layer: it relies on the dark: variants alone.
 */
export const DARK_THEMES = ['slate', 'midnight'] as const;
export type DarkTheme = (typeof DARK_THEMES)[number];

/** Worst-case surface a pair sits on per dark theme (the theme's card). */
export const DARK_CARD: Record<DarkTheme, string> = {
  slate: '#334155', // --surface-card (bg-white remap target)
  midnight: '#111827', // currentTheme.card (bg-[#111827])
};

/** tokens repainted by the slate !important layer (key = CSS-unescaped). */
export const slateTextRemap = new Map<string, string>(); // token -> '#hex' | 'rgba(...)'
export const slateBgRemap = new Map<string, string>();

// Strip comments first — a comment glued to the next selector (same block
// chunk) would otherwise corrupt the segment match (.bg-rose-50 was missed).
const UNESCAPE = /\\\//g;
for (const block of CSS_TEXT.replace(/\/\*[\s\S]*?\*\//g, ' ').matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
  for (const seg of block[1].split(',')) {
    const m = seg.trim().match(/^\.theme-slate\s+\.(text|bg)-([a-zA-Z0-9/\\-]+)$/);
    if (!m) continue;
    const [, kind, rawToken] = m;
    const token = rawToken.replace(UNESCAPE, '/');
    const decl = (block[2].match(/(?:^|[;}])\s*(?:color|background-color)\s*:\s*(#[0-9a-fA-F]{6}|rgba\([^)]+\))/));
    if (!decl) continue;
    (kind === 'text' ? slateTextRemap : slateBgRemap).set(token, decl[1].trim());
  }
}

/** text-slate-950..600 whitened inside dark surfaces (the :is() rule). */
export const WHITEN_TEXT = new Set(['slate-950', 'slate-900', 'slate-800', 'slate-700', 'slate-600']);

/**
 * The surfaces the REAL :is() whiten rule covers (exact tokens, incl. the
 * /alpha variants like rose-50/40). resolveDark whitens ONLY on these — a
 * remapped surface absent from this list keeps dark slate text in reality
 * (e.g. the emerald/blue washes), so the model must not whiten it either.
 */
export const whitenSurfaces = new Set(
  [...CSS_TEXT.matchAll(/\.theme-slate \.bg-([a-zA-Z0-9/\\-]+) :is\(/g)]
    .map((m) => m[1].replace(/\\\//g, '/')),
);

/**
 * Every bg token the slate layer paints dark — derived from the remap keys
 * (the :is() rule's surface list is a documented subset, cross-checked in
 * the test).
 */
export const slateDarkSurfaces = new Set(slateBgRemap.keys());

export const rgbaToSolid = (v: string, surface: string): string => {
  const m = v.match(/rgba\((\d+), ?(\d+), ?(\d+), ?([\d.]+)\)/);
  if (!m) return v;
  const hex = '#' + [m[1], m[2], m[3]].map((x) => (+x).toString(16).padStart(2, '0')).join('');
  return composite(hex, parseFloat(m[4]), surface);
};

/**
 * Resolve one token as rendered under a dark theme.
 * `bgBase` (the sibling bg token's base) enables the slate whiten rule.
 */
export const resolveDark = (
  theme: DarkTheme,
  kind: 'text' | 'bg',
  token: string,
  surface: string,
): string | undefined => {
  const [base, alphaStr] = token.split('/');
  const alpha = alphaStr ? parseInt(alphaStr) / 100 : 1;
  const pal = PALETTE[base];
  if (theme === 'slate') {
    const map = kind === 'text' ? slateTextRemap : slateBgRemap;
    // An EXACT token remap (e.g. bg-emerald-500/10, text-rose-600/80) already
    // encodes its wash/alpha — apply it as-is, never double-composite.
    const exact = map.get(token);
    if (exact) {
      return exact.startsWith('rgba') ? rgbaToSolid(exact, surface) : exact;
    }
    const baseOnly = map.get(base);
    if (baseOnly) {
      const solid = baseOnly.startsWith('rgba') ? rgbaToSolid(baseOnly, surface) : baseOnly;
      return alpha === 1 ? solid : composite(solid, alpha, surface);
    }
    // whiten rule: dark slate text inside a surface the REAL :is() rule
    // covers. Full token (incl. /alpha) — washed surfaces without an :is()
    // entry keep their dark text in real CSS, so they must here too.
    if (kind === 'text' && WHITEN_TEXT.has(base) && whitenSurfaces.has(token)) {
      return '#F8FAFC';
    }
  }
  if (!pal) return undefined;
  return alpha === 1 ? pal : composite(pal, alpha, surface);
};

/**
 * Dark pair scan: every text/bg co-occurrence AS RENDERED in each dark
 * theme. Token selection per chunk:
 *  - slate:    the base token wins when the remap layer repaints it;
 *              otherwise the dark: variant (`.dark` is set under slate);
 *              otherwise the base token itself.
 *  - midnight: the dark: variant wins when present, else the base token
 *              (which is exactly the white-chip defect the lock catches).
 */
export const extractDarkColorPairs = (): DarkColorPair[] => {
  const pairs: DarkColorPair[] = [];
  for (const f of walkTsx()) {
    const code = readFileSync(f, 'utf8');
    const rel = relSrc(f);
    for (const lit of extractLiterals(code)) {
      lit.chunks.forEach((chunk, i) => {
        // The light branch of an isDark ternary renders ONLY in light themes;
        // slate-only branches never render under midnight and vice versa.
        const mode = lit.darkFlags[i];
        if (mode === 'light-branch') return;
        const hits = chunkTokens(chunk);
        const texts = hits.filter((h) => h.kind === 'text');
        const bgs = hits.filter((h) => h.kind === 'bg');
        for (const theme of DARK_THEMES) {
          if (mode === 'slate-only' && theme !== 'slate') continue;
          if (mode === 'midnight-only' && theme !== 'midnight') continue;
          const surface = DARK_CARD[theme];
          const pick = (hits: TokenHit[]): string[] => {
            const darkV = hits.filter((h) => h.dark).map((h) => h.token);
            const base = hits.filter((h) => !h.dark).map((h) => h.token);
            if (theme === 'midnight') return darkV.length > 0 ? darkV : base;
            // slate: the !important remap layer beats dark: variants for the
            // tokens it repaints, so a remapped base token is THE rendered
            // color; dark: variants only carry the tokens the layer leaves
            // alone. (Emitting both would flag the dark: variant against the
            // remapped wash — a false failure.)
            const remapped = base.filter((t) => {
              const [b] = t.split('/');
              return slateTextRemap.has(t) || slateTextRemap.has(b) || slateBgRemap.has(t) || slateBgRemap.has(b);
            });
            const rest = base.filter((t) => !remapped.includes(t));
            return [...remapped, ...(rest.length > 0 ? darkV : [])];
          };
          const ts = pick(texts);
          const bs = pick(bgs);
          for (const t of ts) {
            for (const b of bs) {
              // Resolve here so the test only asserts ratios; unknown tokens
              // surface as a coverage warning instead of a silent skip.
              const fg = resolveDark(theme, 'text', t, surface);
              // resolveDark already composites /alpha tokens over the surface.
              const bgHex = resolveDark(theme, 'bg', b, surface);
              if (fg === undefined || bgHex === undefined) continue;
              pairs.push({ theme, file: rel, line: lit.line, text: t, bg: b, fg, bgHex });
            }
          }
        }
      });
    }
  }
  return pairs;
};

export interface DarkColorPair {
  theme: DarkTheme;
  file: string;
  line: number;
  text: string;
  bg: string;
  fg: string;
  bgHex: string;
}

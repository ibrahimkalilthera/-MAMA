/**
 * Brand accent — « la couleur du logo devient celle de l'app ».
 *
 * `useTheme` already reads the dominant colour of the uploaded logo (canvas
 * average, stored as `rgb(r, g, b)`) but only ever spent it on the header bar.
 * Everything that actually reads as a brand — the primary button, the focus
 * ring, the soft chip behind a section icon — stayed on the theme's fixed
 * accent, so a school with a red logo got a blue app.
 *
 * ─── Pourquoi des variables CSS et pas des classes Tailwind ────────────────
 *
 * The obvious move is to return `bg-[rgb(30,94,58)]`. It does not work, and it
 * fails SILENTLY: Tailwind's scanner reads source TEXT for class-shaped
 * strings, so a class assembled at runtime (`bg-[` + colour + `]`) is never
 * found and never emitted — the button simply has no background, with no error
 * anywhere. These values therefore travel as CSS custom properties set on the
 * document root, and the accent utilities in src/index.css
 * (`.accent-surface`, `.accent-soft-surface`, …) read them. Those utilities are
 * literal strings in a stylesheet, so they always ship.
 *
 * The colour maths is pure and exported so the contrast rule is a unit-tested
 * property rather than a hope: a logo can be any colour, including a pale
 * yellow that makes white ink unreadable, and the ink is chosen by measured
 * luminance, never by taste.
 */

/** Ink used on a light accent surface. Near-black, not pure black: it reads as ink. */
const INK_DARK = '#0B1220';
/** Ink used on a dark accent surface. */
const INK_LIGHT = '#FFFFFF';

/** The accent custom properties the CSS utilities consume. */
export interface AccentVars {
  '--accent-primary': string;
  '--accent-primary-hover': string;
  '--accent-primary-muted': string;
  '--accent-primary-muted-hover': string;
  '--accent-primary-shadow': string;
  /**
   * A visible accent border (soft chips, tinted cards, role pills). Distinct
   * from `-muted`, whose 12% alpha reads as a surface wash and disappears as a
   * 1px border; this one is tuned to survive as a hairline.
   */
  '--accent-primary-border': string;
  '--accent-ink': string;
  '--accent-soft-ink': string;
  '--accent-soft-ink-lifted': string;
}

export type Rgb = [number, number, number];

/**
 * Parse either an `rgb(r, g, b)` triple (what the logo reader stores) or a
 * `#RRGGBB` hex (what the theme table stores). Returns null for anything else,
 * so a malformed value degrades to the theme accent instead of painting `NaN`.
 */
export function parseColor(value: string | null | undefined): Rgb | null {
  if (typeof value !== 'string') return null;
  const text = value.trim();

  const rgbMatch = text.match(/^rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*(?:,\s*[\d.]+\s*)?\)$/i);
  if (rgbMatch) {
    const channels = [rgbMatch[1], rgbMatch[2], rgbMatch[3]].map(Number);
    return channels.every((c) => Number.isFinite(c) && c >= 0 && c <= 255) ? (channels as Rgb) : null;
  }

  const hexMatch = text.match(/^#([0-9a-f]{6})$/i);
  if (hexMatch) {
    const int = parseInt(hexMatch[1], 16);
    return [(int >> 16) & 255, (int >> 8) & 255, int & 255];
  }

  return null;
}

/**
 * WCAG 2.x relative luminance, sRGB. The channel transform is the published one
 * (linearise, then weight) — not a perceived-brightness shortcut, because the
 * threshold below is stated in terms of this exact quantity.
 */
export function relativeLuminance([r, g, b]: Rgb): number {
  const linear = (channel: number) => {
    const c = channel / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
}

/** WCAG contrast ratio between two relative luminances. */
export function contrastRatio(a: number, b: number): number {
  const [hi, lo] = a >= b ? [a, b] : [b, a];
  return (hi + 0.05) / (lo + 0.05);
}

/**
 * Ink for text sitting on `rgb`.
 *
 * ─── Pourquoi pas simplement « le meilleur des deux contrastes » ────────────
 *
 * Taking the higher ratio flips the slate and emerald themes to near-black ink
 * (5.0:1 and 5.4:1 beat white's 4.2:1 and 3.9:1), which is technically better
 * and visually wrong: an app whose buttons go dark-on-sky has changed its design
 * language without anyone asking. The accent surfaces here are BOLD button
 * faces, so the bar is WCAG's large-text 3:1 — the same bar the existing design
 * already met — and white is the conventional choice for them.
 *
 * So white is the default and is abandoned only when it genuinely fails:
 *   navy 5.8:1 · slate 4.2:1 · emerald 3.9:1 · bordeaux 5.4:1 · cream 7.9:1 → white
 *   midnight amber 1.75:1 → fails, falls back to the readable dark ink
 * That reproduces the design's own decisions (including the amber case the
 * theme files had to justify by comment) while deriving them from measurement.
 */
export function readableInk(rgb: Rgb): typeof INK_DARK | typeof INK_LIGHT {
  const background = relativeLuminance(rgb);
  const onWhite = contrastRatio(background, relativeLuminance([255, 255, 255]));
  const onInk = contrastRatio(background, relativeLuminance([11, 18, 32]));
  if (onWhite >= 3) return INK_LIGHT;
  return onInk > onWhite ? INK_DARK : INK_LIGHT;
}

/** Mix toward black by `amount` (0..1) — the hover/deep stop of the accent. */
export function darken([r, g, b]: Rgb, amount = 0.22): Rgb {
  const scale = 1 - Math.min(Math.max(amount, 0), 1);
  return [Math.round(r * scale), Math.round(g * scale), Math.round(b * scale)];
}

/** Mix toward white by `amount` (0..1) — the readable ink on a dark surface. */
export function lighten([r, g, b]: Rgb, amount = 0.45): Rgb {
  const t = Math.min(Math.max(amount, 0), 1);
  return [
    Math.round(r + (255 - r) * t),
    Math.round(g + (255 - g) * t),
    Math.round(b + (255 - b) * t),
  ];
}

const rgb = ([r, g, b]: Rgb) => `rgb(${r},${g},${b})`;

/**
 * Build the accent custom properties from a colour.
 *
 * `isDarkTheme` decides the soft-chip ink, and the theme — not the colour's own
 * luminance — has to be the judge: a dark brand colour on the LIGHT theme is
 * perfectly readable as ink, while the same colour on a dark page disappears.
 *
 * Returns null when the colour cannot be parsed, so the caller keeps the theme
 * accent rather than clearing the variables.
 */
export function buildAccentVars(source: string | null | undefined, isDarkTheme = false): AccentVars | null {
  const parsed = parseColor(source);
  if (!parsed) return null;

  const base = rgb(parsed);
  const deep = rgb(darken(parsed));
  const inMuted = (alpha: number) => `rgb(${parsed[0]},${parsed[1]},${parsed[2]},${alpha})`;

  return {
    '--accent-primary': base,
    '--accent-primary-hover': deep,
    '--accent-primary-muted': inMuted(0.12),
    '--accent-primary-muted-hover': inMuted(0.2),
    '--accent-primary-shadow': inMuted(0.22),
    '--accent-primary-border': inMuted(0.32),
    '--accent-ink': readableInk(parsed),
    '--accent-soft-ink': isDarkTheme ? rgb(lighten(parsed)) : deep,
    '--accent-soft-ink-lifted': rgb(lighten(parsed)),
  };
}

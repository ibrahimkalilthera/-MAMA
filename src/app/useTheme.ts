/**
 * Theme/branding domain hook — extracted verbatim from App.tsx.
 *
 * Owns the school theme and branding: the theme id, the logo and its derived
 * accent color, the localStorage persistence (the legacy `modern`→`cream`
 * rename and the one-time adoption of a new default theme), the `currentTheme`
 * token map consumed by the whole shell, the logo file input ref and the logo
 * upload handler (base64 save + dominant-color extraction via canvas). Fully
 * self-contained — no external deps.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import type { ChangeEvent } from 'react';
import type { ThemeId, CurrentTheme } from './mainViewsProps';
import { buildAccentVars, darken, parseColor } from '../lib/brandAccent';

/**
 * The accent each theme uses when no logo is set. Single source of truth: the
 * `accentHex`/`accentHexDeep` tokens below read from it, and so does the CSS
 * variable writer — previously they were two parallel ternaries that had to be
 * kept in step by hand.
 */
const THEME_ACCENT: Record<ThemeId, { base: string; deep: string }> = {
  navy: { base: '#2563EB', deep: '#1D4ED8' },
  slate: { base: '#0284C7', deep: '#075985' },
  midnight: { base: '#F59E0B', deep: '#B45309' },
  emerald: { base: '#059669', deep: '#047857' },
  bordeaux: { base: '#E11D48', deep: '#BE123C' },
  cream: { base: '#1E5E3A', deep: '#15462B' },
};

/**
 * The theme every browser starts on — Cyber Minuit (the `midnight` id).
 *
 * Changing this constant is a one-time REPRISE, not a silent wipe of everyone's
 * preference: the value is recorded per browser in `THEME_DEFAULT_KEY` by the
 * persist effect, so a browser that has already adopted the current default
 * keeps whatever theme its user picked afterwards (see the lazy initializer).
 */
export const DEFAULT_THEME: ThemeId = 'midnight';

/** Where the active theme id is remembered. */
const THEME_KEY = 'school-finance-theme';

/**
 * Which default theme this browser has already adopted. Held separately from
 * `THEME_KEY` on purpose: the saved theme alone cannot tell an explicit choice
 * (a user who picked Navy) apart from the old default (the same value, written
 * by the persist effect on first load), and only the marker can.
 */
const THEME_DEFAULT_KEY = 'school-finance-theme-default';


export function useTheme() {
  // The theme is read lazily in the state initializer, NOT in a read effect:
  // with a read-effect + persist-effect pair, React StrictMode's double
  // invoke made the persist effect run with the still-initial (pre-read)
  // theme BEFORE the read effect's setTheme committed — silently resetting
  // the saved theme on every dev reload (and leaving html/body painted with
  // the wrong background). Lazy init removes the race entirely, and it is
  // also where the one-time default reprise is resolved.
  const [theme, setTheme] = useState<ThemeId>(() => {
    const savedTheme = localStorage.getItem(THEME_KEY);
    // One-time reprise: a browser that has not adopted the current default yet
    // (marker absent, or naming an older default) gets it now. Every load after
    // that honours `savedTheme`, so the theme a user picks — before or after the
    // default changed — survives.
    if (localStorage.getItem(THEME_DEFAULT_KEY) !== DEFAULT_THEME) return DEFAULT_THEME;
    // `modern` → `cream` is a genuine legacy rename (no `modern` theme id
    // exists). `midnight` must NOT be migrated — it is a real picker theme
    // (Cyber Minuit) distinct from slate; converting it silently flipped
    // Cyber Minuit back to Ardoise Sombre on every reload.
    if (savedTheme === 'modern') return 'cream';
    return (savedTheme as ThemeId) || DEFAULT_THEME;
  });
  const [schoolLogo, setSchoolLogo] = useState<string | null>(null);
  const [logoColor, setLogoColor] = useState<string | null>(null);
  const logoInputRef = useRef<HTMLInputElement>(null);

  // --- Theme Logic (logo reads stay in an effect; the theme is lazy-inited) ---
  useEffect(() => {
    const savedLogo = localStorage.getItem('school-finance-logo');
    const savedLogoColor = localStorage.getItem('school-finance-logo-color');
    if (savedLogo) setSchoolLogo(savedLogo);
    if (savedLogoColor) setLogoColor(savedLogoColor);
  }, []);

  useEffect(() => {
    localStorage.setItem(THEME_KEY, theme);
    // Adopting a default is a ONE-TIME event, and this effect is its only
    // writer: recording the marker here is what stops the reprise above from
    // firing again on the next load (and from overwriting a later choice).
    localStorage.setItem(THEME_DEFAULT_KEY, DEFAULT_THEME);
  }, [theme]);

  // ── html/body background follows the active theme ────────────────────────
  // The app shell div carries the theme bg classes (currentTheme.bg), but
  // html/body themselves are unstyled — so any horizontal overflow (e.g. the
  // old 218 px gutter) or overscroll bounce revealed the raw white body behind
  // the content. Paint html+body with the same hex as currentTheme.bg so a
  // future overflow gutter can never flash white in dark themes.
  useEffect(() => {
    const hex =
      theme === 'midnight' ? '#090D16'
      : theme === 'slate' ? '#1E293B'
      : theme === 'emerald' ? '#F0FDF4'
      : theme === 'bordeaux' ? '#FFF1F2'
      : theme === 'cream' ? '#FDFBF7'
      : '#F8FAFC'; // navy
    document.documentElement.style.backgroundColor = hex;
    document.body.style.backgroundColor = hex;
    return () => {
      document.documentElement.style.backgroundColor = '';
      document.body.style.backgroundColor = '';
    };
  }, [theme]);

  useEffect(() => {
    if (schoolLogo) {
      localStorage.setItem('school-finance-logo', schoolLogo);
    } else {
      localStorage.removeItem('school-finance-logo');
    }
    if (logoColor) {
      localStorage.setItem('school-finance-logo-color', logoColor);
    } else {
      localStorage.removeItem('school-finance-logo-color');
    }
  }, [schoolLogo, logoColor]);

  const currentTheme = useMemo<CurrentTheme>(() => {
    const isCream = theme === 'cream';
    const isSlate = theme === 'slate';
    const isEmerald = theme === 'emerald';
    const isBordeaux = theme === 'bordeaux';
    const isMidnight = theme === 'midnight';

    const isDark = isSlate || isMidnight;

    // The two raw-colour tokens (gradient banners, the sidebar's logo tile) must
    // follow the brand too — otherwise a school gets brand-coloured buttons and
    // a THEME-coloured hero gradient on the very same screen. Same source as
    // `accentVars` below: the logo when it parses, the theme table otherwise.
    const brand = parseColor(logoColor);
    const accentHex = brand ? `rgb(${brand.join(',')})` : THEME_ACCENT[theme].base;
    const accentHexDeep = brand ? `rgb(${darken(brand).join(',')})` : THEME_ACCENT[theme].deep;

    return {
      bg: isMidnight 
        ? 'bg-[#090D16]' 
        : isSlate 
        ? 'bg-[#1E293B]' 
        : isEmerald 
        ? 'bg-[#F0FDF4]' 
        : isBordeaux 
        ? 'bg-[#FFF1F2]' 
        : isCream 
        ? 'bg-[#FDFBF7]' 
        : 'bg-[#F8FAFC]',

      card: isMidnight 
        ? 'bg-[#111827]' 
        : isSlate 
        ? 'bg-[#334155]' 
        : 'bg-white',

      text: isMidnight 
        ? 'text-[#F9FAFB]' 
        : isSlate 
        ? 'text-[#F8FAFC]' 
        : isEmerald 
        ? 'text-[#064E3B]' 
        : isBordeaux 
        ? 'text-[#881337]' 
        : isCream 
        ? 'text-[#1A1A1A]' 
        : 'text-slate-900',

      muted: isMidnight 
        ? 'text-[#A9B4C4]' 
        : isSlate 
        ? 'text-[#9FB0C7]' 
        : isEmerald 
        ? 'text-[#047857]' 
        : isBordeaux 
        ? 'text-[#9F1239]' 
        : isCream 
        ? 'text-[#6B6659]' 
        : 'text-slate-400',

      border: isMidnight 
        ? 'border-[#243047]' 
        : isSlate 
        ? 'border-[#475569]' 
        : isEmerald 
        ? 'border-[#BBF7D0]' 
        : isBordeaux 
        ? 'border-[#FECDD3]' 
        : isCream 
        ? 'border-[#E5DEC9]' 
        : 'border-slate-100',

      header: logoColor || (isMidnight ? '#030712' : isSlate ? '#0F172A' : isEmerald ? '#064E3B' : isBordeaux ? '#881337' : isCream ? '#1E5E3A' : '#0F172A'),

      sidebar: isMidnight ? 'bg-[#030712]' : isSlate ? 'bg-[#1E293B]' : isEmerald ? 'bg-[#064E3B]' : isBordeaux ? 'bg-[#881337]' : isCream ? 'bg-[#1B2D1D]' : 'bg-[#0F172A]',

      accent: isMidnight ? 'amber-400' : isSlate ? 'sky-400' : isEmerald ? 'emerald-600' : isBordeaux ? 'rose-600' : isCream ? '[#1E5E3A]' : 'blue-600',

      // Accent surfaces are CSS-variable driven, so the same class pair serves
      // every theme AND a school's brand colour (see `accentVars` below). The
      // ink used to be chosen by hand per theme (amber needed dark brown at
      // 2.15:1); it is now derived from measured luminance.
      accentBg: 'accent-surface',

      accentText: 'accent-surface-text',

      accentHover: 'accent-surface-hover',

      accentGroupHover: 'accent-group-hover',

      accentShadow: 'accent-shadow',

      /**
       * Soft accent surface — icon chips, section headings, quiet secondary
       * buttons. These were authored per-view as `bg-emerald-50 text-emerald-600`
       * (and the `dark:` pair beside them), which is why a view could look
       * on-theme in Navy and off-theme everywhere else. They are tokens now, so
       * "follow the theme" is one class away instead of a per-view decision.
       * `accentSoftText` is the readable ink for that surface (>= 4.5:1).
       */
      accentSoft: 'accent-soft-surface',

      accentSoftText: 'accent-soft-text',

      accentSoftHover: 'accent-soft-hover',

      /** Accent ink on hover — the hover counterpart of `accentSoftText`; a
       *  quiet control (dismiss button, inline link) lights up to the accent. */
      accentSoftTextHover: 'accent-soft-text-hover',

      /**
       * Solid accent without the surface colour — for gradient banners that
       * pair the accent with a second stop, and for icon ink on a coloured
       * banner. Kept as a hex/rgb value (not a utility class) so it can feed
       * both `style` and `color-mix`-free gradients.
       */
      accentHex,

      /** Darker stop of `accentHex` — the second half of accent gradients. */
      accentHexDeep,

      /** Focus ring on inputs/search fields — follows the accent. */
      accentRing: 'accent-ring',

      /** Accent-tinted hairline border for chips, role pills and soft cards. */
      accentBorder: 'accent-border',

      /**
       * Neutral inset surface (fields, avatars, chips, panel headers). Driven by
       * the `--surface-inset` variable, so it is the same neutral on every theme
       * instead of the green the dark branch used to paint a neutral surface.
       */
      surfaceInset: 'surface-inset',

      /** Solid accent border on hover — the logo dropzone's "drop here" state. */
      accentBorderHover: 'accent-border-hover',

      /**
       * Neutral strong ink for body/label text. On dark themes it is a neutral
       * near-white (slate-200); on light themes it is slate-800 — the same
       * value the old `isDark ? 'text-emerald-500' : 'text-slate-800'` gave on
       * light themes, so light rendering is unchanged while green stops being
       * used as ordinary text ink on dark themes.
       */
      inkStrong: isDark ? 'text-[#E2E8F0]' : 'text-slate-800',

      /**
       * Accent surfaces for the always-dark sidebar rail.
       *
       * They share the `accentSoft` surface (the muted variable is low-alpha, so
       * it reads on a dark rail as well as on a page) but NOT its ink: the soft
       * ink is the DEEP stop on a light theme, which on the dark rail would be
       * the least readable choice available. Hence the separate lifted ink.
       */
      accentSoftDark: 'accent-soft-surface',

      accentSoftDarkHover: 'accent-soft-hover',

      accentSoftDarkText: 'accent-on-dark-text',

      tableHeader: isMidnight ? 'bg-[#141C2C] text-[#F3F6FB]' : isSlate ? 'bg-[#2A3650] text-[#E6ECF5]' : isEmerald ? 'bg-[#DCFCE7] text-[#065F46]' : isBordeaux ? 'bg-[#FFE4E6] text-[#9F1239]' : isCream ? 'bg-[#F4EFE0] text-[#5C5647]' : 'bg-slate-50/50 text-slate-400',

      rowHover: isMidnight ? 'hover:bg-white/[0.04]' : isSlate ? 'hover:bg-white/[0.06]' : isEmerald ? 'hover:bg-[#F0FDF4]' : isBordeaux ? 'hover:bg-[#FFF1F2]' : isCream ? 'hover:bg-[#FAF7F0]' : 'hover:bg-slate-50/80',

      input: isMidnight ? 'bg-[#111827] border-[#2C3950] text-white' : isSlate ? 'bg-[#253248] border-[#475569] text-[#F8FAFC]' : isEmerald ? 'bg-[#F0FDF4] border-[#A7F3D0] text-[#064E3B]' : isBordeaux ? 'bg-[#FFF1F2] border-[#FECDD3] text-[#881337]' : isCream ? 'bg-[#FCFAF2] border-[#DCD3B6] text-[#1A1A1A]' : 'bg-slate-50 border-slate-200 text-slate-900',

      isDark
    };
  }, [theme, logoColor]);

  /**
   * The accent colour, resolved once per (theme, logo) pair and written to the
   * document root as CSS custom properties.
   *
   * Brand wins: `logoColor` is the dominant colour of the uploaded logo — the
   * school already told us what its colour is by uploading it, and until now
   * only the header bar listened. When it parses, the whole accent follows it;
   * when it does not (no logo, or a value that is neither rgb() nor #hex) the
   * theme accent stands, so a bad value degrades rather than clearing the
   * accent. The surfaces are never touched — a logo colour can recolour the
   * app but cannot make a card unreadable.
   */
  const accentVars = useMemo(() => {
    const isDarkTheme = theme === 'slate' || theme === 'midnight';
    return (
      buildAccentVars(logoColor, isDarkTheme) ??
      buildAccentVars(THEME_ACCENT[theme].base, isDarkTheme)
    );
  }, [theme, logoColor]);

  useEffect(() => {
    const root = document.documentElement;
    if (!accentVars) return;
    for (const [name, value] of Object.entries(accentVars)) root.style.setProperty(name, value);
    return () => {
      for (const name of Object.keys(accentVars)) root.style.removeProperty(name);
    };
  }, [accentVars]);

  const handleLogoUpload = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const base64 = event.target?.result as string;
      setSchoolLogo(base64);
      try {
        localStorage.setItem('school-finance-logo', base64);
      } catch (err) {
        console.warn('Failed to save logo to localStorage:', err);
      }

      // Extract color
      const img = new Image();
      img.src = base64;
      img.onload = () => {
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        canvas.width = img.width;
        canvas.height = img.height;
        ctx.drawImage(img, 0, 0);
        const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
        
        let r = 0, g = 0, b = 0;
        let count = 0;
        // Sample pixels
        for (let i = 0; i < data.length; i += 40) {
          r += data[i];
          g += data[i + 1];
          b += data[i + 2];
          count++;
        }
        r = Math.floor(r / count);
        g = Math.floor(g / count);
        b = Math.floor(b / count);
        setLogoColor(`rgb(${r}, ${g}, ${b})`);
      };
    };
    reader.readAsDataURL(file);
  };

  return {
    theme, setTheme,
    schoolLogo, setSchoolLogo,
    logoColor, setLogoColor,
    logoInputRef,
    currentTheme,
    handleLogoUpload,
  };
}

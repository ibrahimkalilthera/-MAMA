/**
 * Theme/branding domain hook — extracted verbatim from App.tsx.
 *
 * Owns the school theme and branding: the theme id, the logo and its derived
 * accent color, the localStorage persistence (including the legacy
 * `midnight`→`slate` / `modern`→`cream` migrations), the `currentTheme` token
 * map consumed by the whole shell, the logo file input ref and the logo
 * upload handler (base64 save + dominant-color extraction via canvas). Fully
 * self-contained — no external deps.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import type { ChangeEvent } from 'react';
import type { ThemeId, CurrentTheme } from './mainViewsProps';

export function useTheme() {
  const [theme, setTheme] = useState<ThemeId>('navy');
  const [schoolLogo, setSchoolLogo] = useState<string | null>(null);
  const [logoColor, setLogoColor] = useState<string | null>(null);
  const logoInputRef = useRef<HTMLInputElement>(null);

  // --- Theme Logic ---
  useEffect(() => {
    const savedTheme = localStorage.getItem('school-finance-theme');
    const savedLogo = localStorage.getItem('school-finance-logo');
    const savedLogoColor = localStorage.getItem('school-finance-logo-color');
    if (savedTheme) {
      if (savedTheme === 'midnight') setTheme('slate');
      else if (savedTheme === 'modern') setTheme('cream');
      else setTheme(savedTheme as ThemeId);
    }
    if (savedLogo) setSchoolLogo(savedLogo);
    if (savedLogoColor) setLogoColor(savedLogoColor);
  }, []);

  useEffect(() => {
    localStorage.setItem('school-finance-theme', theme);
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
        ? 'text-[#9CA3AF]' 
        : isSlate 
        ? 'text-[#94A3B8]' 
        : isEmerald 
        ? 'text-[#047857]' 
        : isBordeaux 
        ? 'text-[#9F1239]' 
        : isCream 
        ? 'text-[#6B6659]' 
        : 'text-slate-400',

      border: isMidnight 
        ? 'border-[#1F2937]' 
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

      accentBg: isMidnight ? 'bg-amber-600' : isSlate ? 'bg-sky-600' : isEmerald ? 'bg-emerald-600' : isBordeaux ? 'bg-rose-600' : isCream ? 'bg-[#1E5E3A]' : 'bg-blue-600',

      accentHover: isMidnight ? 'hover:bg-amber-700' : isSlate ? 'hover:bg-sky-700' : isEmerald ? 'hover:bg-emerald-700' : isBordeaux ? 'hover:bg-rose-700' : isCream ? 'hover:bg-[#15462B]' : 'hover:bg-blue-700',

      accentShadow: isMidnight ? 'shadow-amber-500/20' : isSlate ? 'shadow-sky-500/20' : isEmerald ? 'shadow-emerald-600/20' : isBordeaux ? 'shadow-rose-600/20' : isCream ? 'shadow-emerald-700/20' : 'shadow-blue-500/20',

      tableHeader: isDark ? 'bg-[#1E293B]/50 text-[#F8FAFC]' : isEmerald ? 'bg-[#DCFCE7] text-[#065F46]' : isBordeaux ? 'bg-[#FFE4E6] text-[#9F1239]' : isCream ? 'bg-[#F4EFE0] text-[#5C5647]' : 'bg-slate-50/50 text-slate-400',

      rowHover: isDark ? 'hover:bg-[#475569]/50' : isEmerald ? 'hover:bg-[#F0FDF4]' : isBordeaux ? 'hover:bg-[#FFF1F2]' : isCream ? 'hover:bg-[#FAF7F0]' : 'hover:bg-slate-50/80',

      input: isMidnight ? 'bg-[#111827] border-[#374151] text-white' : isSlate ? 'bg-[#1E293B] border-[#475569] text-[#F8FAFC]' : isEmerald ? 'bg-[#F0FDF4] border-[#A7F3D0] text-[#064E3B]' : isBordeaux ? 'bg-[#FFF1F2] border-[#FECDD3] text-[#881337]' : isCream ? 'bg-[#FCFAF2] border-[#DCD3B6] text-[#1A1A1A]' : 'bg-slate-50 border-slate-200 text-slate-900',

      isDark
    };
  }, [theme, logoColor]);

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

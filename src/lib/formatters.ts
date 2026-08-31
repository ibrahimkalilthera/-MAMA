/**
 * Pure formatting helpers extracted from App.tsx.
 *
 * All functions are pure: they take the translation dictionary and language
 * as explicit parameters instead of closing over component state.
 */

import type { TranslationDict, Language } from '../i18n/translations';

export type T = TranslationDict;

export const formatCurrency = (amount: any) => {
  const val = Number(amount);
  if (isNaN(val)) return '0 XOF';
  // fr-FR may emit a narrow no-break space (U+202F) or a no-break space (U+00A0)
  // depending on the runtime's ICU; normalize both to a plain space.
  return val.toLocaleString('fr-FR').replace(/[\u00a0\u202f]/g, ' ') + ' XOF';
};

export const formatDate = (dateStr: string) => {
  if (!dateStr) return '';
  const date = new Date(dateStr);
  if (isNaN(date.getTime())) return dateStr;
  return date.toLocaleDateString('en-US', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric'
  });
};

export const formatDateLang = (dateStr: string, lang: Language) => {
  if (!dateStr) return '';
  const date = new Date(dateStr);
  if (isNaN(date.getTime())) return dateStr;
  return date.toLocaleDateString(lang === 'en' ? 'en-US' : 'fr-FR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric'
  });
};

export const getGradeDisplay = (
  grade: string | undefined,
  availableClasses: { id: string; nameEn: string; nameFr: string }[],
  t: T,
  currentLang: Language,
) => {
  if (!grade) return 'N/A';
  const trimmed = grade.trim();

  // Check if found in availableClasses
  const found = availableClasses.find(c => c.id.toLowerCase() === trimmed.toLowerCase());
  if (found) {
    return currentLang === 'en' ? found.nameEn : found.nameFr;
  }

  // Pattern match standard codes like 1A, 1B, 1C, 2D, 7C, etc.
  const match = trimmed.match(/^(\d+)\s*([A-Za-z]+)?$/);
  if (match) {
    const yearNum = parseInt(match[1]);
    const section = (match[2] || '').toUpperCase();
    const yearLabel = currentLang === 'en'
      ? (yearNum === 1 ? t.year1st : yearNum === 2 ? t.year2nd : yearNum === 3 ? t.year3rd : t.yearNth.replace('{n}', String(yearNum)))
      : (yearNum === 1 ? t.year1st : t.yearNth.replace('{n}', String(yearNum)));
    return section ? `${yearLabel} ${section} (${trimmed.toUpperCase()})` : `${yearLabel} (${trimmed.toUpperCase()})`;
  }

  return grade;
};

export const getMonthName = (monthIndex: number, t: T) => {
  const months = [t.jan, t.feb, t.mar, t.apr, t.may, t.jun, t.jul, t.aug, t.sep, t.oct, t.nov, t.dec];
  return months[monthIndex];
};

export const getDayName = (dayIndex: number, t: T) => {
  const days = [t.mon, t.tue, t.wed, t.thu, t.fri, t.sat, t.sun];
  return days[dayIndex];
};

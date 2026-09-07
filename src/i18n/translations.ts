/**
 * UI translations (EN + FR dictionaries), split into per-domain modules.
 *
 * The domain fragments in ./domains export en/fr pairs; this barrel merges
 * them in historical order so both dictionaries keep the original key order.
 * Both languages share the same key set — scripts/l10n-verify.mjs guards
 * parity and that every t.<key> usage resolves in en + fr.
 *
 * Shape: translations.en / translations.fr — consumers import { translations }
 * and the TranslationDict type from THIS file (unchanged contract).
 */
import { en as commonEn, fr as commonFr } from './domains/common';
import { en as calendarEn, fr as calendarFr } from './domains/calendar';
import { en as studentsEn, fr as studentsFr } from './domains/students';
import { en as financeEn, fr as financeFr } from './domains/finance';
import { en as studentProfileEn, fr as studentProfileFr } from './domains/studentProfile';
import { en as parentsEn, fr as parentsFr } from './domains/parents';
import { en as adminEn, fr as adminFr } from './domains/admin';
import { en as pdfEn, fr as pdfFr } from './domains/pdf';

export const translations = {
  en: { ...commonEn, ...calendarEn, ...studentsEn, ...financeEn, ...studentProfileEn, ...parentsEn, ...adminEn, ...pdfEn },
  fr: { ...commonFr, ...calendarFr, ...studentsFr, ...financeFr, ...studentProfileFr, ...parentsFr, ...adminFr, ...pdfFr },
};

export type TranslationDict = typeof translations.en;
export type Language = 'en' | 'fr';

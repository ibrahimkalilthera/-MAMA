/**
 * statusHelpers — view-level formatting helpers for the shell wiring.
 *
 * Extracted from src/app/viewsWiring.ts (split campaign, no behavior
 * change): buildShellProps used to inline formatDate / getGradeDisplay /
 * getStatus; they now live here as a small factory so viewsWiring stays
 * under the line budget while keeping the exact same closure deps.
 */
import { createElement } from 'react';
import { AlertCircle, Calendar, CheckCircle2, Clock } from 'lucide-react';
import { formatDateLang, getGradeDisplay as getGradeDisplayImpl, type T } from '../lib/formatters';
import { getStudentStanding } from '../lib/classes';
import type { ManagedClass } from './mainViewsProps';
import type { Student } from './types';

export interface StatusHelpersDeps {
  lang: 'en' | 'fr';
  availableClasses: ManagedClass[];
  t: T;
  today: string;
}

export function makeStatusHelpers({ lang, availableClasses, t, today }: StatusHelpersDeps) {
  const formatDate = (dateStr: string) => formatDateLang(dateStr, lang);
  const getGradeDisplay = (grade: string | undefined, currentLang: 'en' | 'fr' = lang) =>
    getGradeDisplayImpl(grade, availableClasses, t, currentLang);
  const getStatus = (student: Student) => {
    const standing = getStudentStanding(student, today);

    if (standing.key === 'settled') {
      return {
        label: t.settle,
        color: 'text-emerald-600 bg-emerald-50 border-emerald-100 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-900/60',
        icon: createElement(CheckCircle2, { size: 14 }),
        standing: t.goodStanding
      };
    }

    if (standing.key === 'overdue') {
      return {
        label: `${standing.daysOverdue} ${t.daysOverdue}`,
        color: 'text-rose-600 bg-rose-50 border-rose-100 dark:bg-rose-950/40 dark:text-rose-300 dark:border-rose-900/60 animate-badge-pulse',
        icon: createElement(Clock, { size: 14 }),
        standing: t.overdue
      };
    }

    if (standing.key === 'dueSoon') {
      return {
        label: t.dueSoon,
        color: 'text-amber-700 bg-amber-50 border-amber-100 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-900/60',
        icon: createElement(AlertCircle, { size: 14 }),
        standing: t.partial
      };
    }

    return {
      label: t.partial,
      color: 'text-blue-600 bg-blue-50 border-blue-100 dark:bg-blue-950/40 dark:text-blue-300 dark:border-blue-900/60',
      icon: createElement(Calendar, { size: 14 }),
      standing: t.partial
    };
  };

  return { formatDate, getGradeDisplay, getStatus };
}
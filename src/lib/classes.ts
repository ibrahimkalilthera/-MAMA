/**
 * Pure class-code and calendar helpers extracted from App.tsx.
 */

import type { SchoolClass } from '../app/types';
import type { T } from './formatters';

/** Form fields shared by the add-class and edit-class modals. */
export interface ClassFormFields {
  cycle: SchoolClass['cycle'];
  year: string;
  section: string;
  customName: string;
}

export interface BuiltClassCode {
  code: string;
  nameFr: string;
  nameEn: string;
}

/**
 * Build the class code + localized display names from the modal form fields.
 * Extracted verbatim from the duplicated logic in handleCreateClassSubmit
 * and handleEditClassSubmit.
 */
export const buildClassCode = (form: ClassFormFields): BuiltClassCode => {
  if (form.cycle === 'other' && form.customName.trim()) {
    const name = form.customName.trim();
    return { code: name, nameFr: name, nameEn: name };
  }

  const yearStr = form.year;
  const yearNum = parseInt(yearStr);
  const section = form.section.trim().toUpperCase() || 'A';
  const code = `${yearStr}${section}`;

  let yearFr = '';
  let yearEn = '';
  if (!isNaN(yearNum)) {
    yearFr = yearNum === 1 ? '1ère Année' : `${yearNum}ème Année`;
    yearEn = yearNum === 1 ? '1st Year' : yearNum === 2 ? '2nd Year' : yearNum === 3 ? '3rd Year' : `${yearNum}th Year`;
  } else {
    yearFr = yearStr;
    yearEn = yearStr;
  }

  return {
    code,
    nameFr: `${yearFr} ${section} (${code})`,
    nameEn: `${yearEn} ${section} (${code})`,
  };
};

export interface CalendarDay {
  date: Date;
  isCurrentMonth: boolean;
}

/**
 * Build the 6-week (42-day) Monday-first calendar grid for the month
 * containing `date`, with leading/trailing month padding.
 * Extracted verbatim from App.tsx getDaysInMonth.
 */
export const getCalendarDays = (date: Date): CalendarDay[] => {
  const year = date.getFullYear();
  const month = date.getMonth();
  const firstDay = new Date(year, month, 1);
  const lastDay = new Date(year, month + 1, 0);
  const days: CalendarDay[] = [];

  // Previous month padding
  const firstDayOfWeek = firstDay.getDay(); // 0 (Sun) to 6 (Sat)
  const prevMonthLastDay = new Date(year, month, 0).getDate();
  const padding = firstDayOfWeek === 0 ? 6 : firstDayOfWeek - 1; // Adjust for Mon-Sun

  for (let i = padding - 1; i >= 0; i--) {
    days.push({
      date: new Date(year, month - 1, prevMonthLastDay - i),
      isCurrentMonth: false
    });
  }

  // Current month days
  for (let i = 1; i <= lastDay.getDate(); i++) {
    days.push({
      date: new Date(year, month, i),
      isCurrentMonth: true
    });
  }

  // Next month padding
  const remaining = 42 - days.length;
  for (let i = 1; i <= remaining; i++) {
    days.push({
      date: new Date(year, month + 1, i),
      isCurrentMonth: false
    });
  }

  return days;
};

/** Outstanding balance for a student after scholarship discount. */
export const getStudentBalance = (student: {
  totalDue: number;
  amountPaid: number;
  scholarshipDiscount?: number;
}): number => {
  const discount = student.scholarshipDiscount || 0;
  const discountedTotal = student.totalDue * (1 - discount / 100);
  return discountedTotal - student.amountPaid;
};

/** Days until the student's due date relative to `today` (negative = overdue). */
export const daysUntilDue = (dueDate: string, today: string): number => {
  const due = new Date(dueDate);
  const now = new Date(today);
  const diffTime = due.getTime() - now.getTime();
  return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
};

/** Student payment standing derived from balance and due date. */
export interface StudentStanding {
  key: 'settled' | 'overdue' | 'dueSoon' | 'current';
  daysOverdue: number;
}

export const getStudentStanding = (
  student: { totalDue: number; amountPaid: number; scholarshipDiscount?: number; dueDate: string },
  today: string,
): StudentStanding => {
  const balance = getStudentBalance(student);
  const diffDays = daysUntilDue(student.dueDate, today);

  if (balance <= 0) {
    return { key: 'settled', daysOverdue: 0 };
  }
  if (diffDays < 0) {
    return { key: 'overdue', daysOverdue: Math.abs(diffDays) };
  }
  if (diffDays <= 3) {
    return { key: 'dueSoon', daysOverdue: 0 };
  }
  return { key: 'current', daysOverdue: 0 };
};

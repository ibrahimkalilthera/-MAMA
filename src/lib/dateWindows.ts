/**
 * Date-window helpers — the single place that decides "same month/year" and
 * academic-year windows.
 *
 * History: month-only comparisons (`date.getMonth() === currentMonth`) silently
 * mixed years — a salary paid in September 2025 counted as "paid this month" in
 * September 2026, and monthly charts bucketed several years into one axis.
 * Every date-window decision should go through these helpers so the year is
 * never forgotten. A lint guard (scripts/check-date-windows.mjs) rejects raw
 * `.getMonth()` comparisons that are not paired with a `.getFullYear()`.
 */

/** Parse a Date-like value (ISO string or Date) into a Date. */
function toDate(date: Date | string): Date {
  return typeof date === 'string' ? new Date(date) : date;
}

/**
 * True when `date` falls in the given calendar year+month. The year check is
 * the whole point: `sameYearMonth(p.date, 2026, 8)` matches August 2026 only,
 * never August of another year.
 */
export function sameYearMonth(date: Date | string, year: number, month: number): boolean {
  const d = toDate(date);
  return d.getFullYear() === year && d.getMonth() === month;
}

/** The current calendar { year, month } — always read the pair together. */
export function currentYearMonth(): { year: number; month: number } {
  const now = new Date();
  return { year: now.getFullYear(), month: now.getMonth() };
}

/**
 * The [start, end] window of a Malian academic year ("2026-2027" runs from
 * September 2026 through August 2027). Returns null for unparsable values.
 */
export function academicYearWindow(
  academicYear: string
): { start: Date; end: Date } | null {
  const m = academicYear.match(/(\d{4})[-/](\d{4})/);
  if (!m) return null;
  const startYear = parseInt(m[1], 10);
  return {
    start: new Date(startYear, 8, 1), // September 1
    end: new Date(startYear + 1, 7, 31, 23, 59, 59, 999), // August 31
  };
}

/** True when `date` falls inside the given academic year's window. */
export function inAcademicYear(date: Date | string, academicYear: string): boolean {
  const window = academicYearWindow(academicYear);
  if (!window) return false;
  const d = toDate(date);
  return d >= window.start && d <= window.end;
}

/**
 * The academic year ("2025-2026") containing the given date — September start.
 * The reverse of academicYearWindow: what window does this date belong to?
 */
export function academicYearOf(date: Date | string): string {
  const d = toDate(date);
  const start = d.getMonth() >= 8 ? d.getFullYear() : d.getFullYear() - 1;
  return `${start}-${start + 1}`;
}
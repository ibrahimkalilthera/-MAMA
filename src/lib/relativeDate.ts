/**
 * Relative-date labels for the notification dropdown ("today", "yesterday",
 * "N days ago", falling back to the plain date beyond a week).
 *
 * Pure: the reference "today" is injected, so tests are deterministic.
 *
 * Timezone safety: date-only strings (`YYYY-MM-DD`, the format stored by the
 * app's forms) are parsed as LOCAL calendar days — never as UTC midnight —
 * and differences are computed between calendar-day keys, so the labels are
 * identical whatever the machine's timezone or the time of day.
 */

export type RelativeDateLabel =
  | { kind: 'today' }
  | { kind: 'yesterday' }
  | { kind: 'daysAgo'; days: number }
  | { kind: 'date'; date: string };

const DAY_MS = 1000 * 60 * 60 * 24;

/** Parse a date string as a local calendar day when it is date-only. */
function parseLocal(dateStr: string): Date {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(dateStr);
  if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return new Date(dateStr);
}

/** UTC-midnight reference of the date's LOCAL calendar day. */
function dayKey(d: Date): number {
  return Date.UTC(d.getFullYear(), d.getMonth(), d.getDate());
}

/** Calendar-day difference `today - date` (0 = same day). Machine-tz safe. */
export function daysBetween(dateStr: string, today: Date): number {
  const date = parseLocal(dateStr);
  if (Number.isNaN(date.getTime())) return Number.NaN;
  return Math.round((dayKey(today) - dayKey(date)) / DAY_MS);
}

/** Bucket a date string into a relative label; invalid dates fall back to 'date'. */
export function relativeDateLabel(dateStr: string, today: Date): RelativeDateLabel {
  const diff = daysBetween(dateStr, today);
  if (Number.isNaN(diff)) return { kind: 'date', date: dateStr };
  if (diff <= 0) return { kind: 'today' }; // future dates read as today too
  if (diff === 1) return { kind: 'yesterday' };
  if (diff <= 6) return { kind: 'daysAgo', days: diff };
  return { kind: 'date', date: dateStr };
}
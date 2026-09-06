/**
 * Unit tests for src/lib/dateWindows.ts — the shared year+month window helpers.
 *
 * The whole point is the YEAR: month-only comparisons used to mix years (a
 * September 2025 salary counted as "paid this month" in September 2026). These
 * tests lock the year boundary behaviour.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  sameYearMonth,
  currentYearMonth,
  academicYearWindow,
  inAcademicYear,
  academicYearOf,
} from '../src/lib/dateWindows';

describe('sameYearMonth', () => {
  it('matches the same month of the same year', () => {
    assert.equal(sameYearMonth('2026-09-15', 2026, 8), true);
  });

  it('rejects the same month of a DIFFERENT year (the bug class)', () => {
    assert.equal(sameYearMonth('2025-09-15', 2026, 8), false);
    assert.equal(sameYearMonth('2027-09-15', 2026, 8), false);
  });

  it('rejects a different month of the same year', () => {
    assert.equal(sameYearMonth('2026-10-01', 2026, 8), false);
  });

  it('accepts Date objects as well as strings', () => {
    assert.equal(sameYearMonth(new Date(2026, 8, 1), 2026, 8), true);
  });

  it('treats the year boundary around January correctly', () => {
    // January 2026 vs January 2025 — same month, different year.
    assert.equal(sameYearMonth('2026-01-05', 2025, 0), false);
    assert.equal(sameYearMonth('2025-01-05', 2025, 0), true);
  });
});

describe('currentYearMonth', () => {
  it('returns the live calendar year and month as a pair', () => {
    const now = new Date();
    const { year, month } = currentYearMonth();
    assert.equal(year, now.getFullYear());
    assert.equal(month, now.getMonth());
  });
});

describe('academicYearWindow (September start)', () => {
  it('parses "2026-2027" as Sep 1 2026 → Aug 31 2027', () => {
    const w = academicYearWindow('2026-2027');
    assert.ok(w);
    assert.equal(w.start.getFullYear(), 2026);
    assert.equal(w.start.getMonth(), 8); // September
    assert.equal(w.end.getFullYear(), 2027);
    assert.equal(w.end.getMonth(), 7); // August
  });

  it('returns null for unparsable values', () => {
    assert.equal(academicYearWindow(''), null);
    assert.equal(academicYearWindow('2026'), null);
    assert.equal(academicYearWindow('foo-bar'), null);
  });
});

describe('inAcademicYear', () => {
  it('accepts dates inside the window', () => {
    assert.equal(inAcademicYear('2026-09-01', '2026-2027'), true);
    assert.equal(inAcademicYear('2027-08-31', '2026-2027'), true);
    assert.equal(inAcademicYear('2026-12-24', '2026-2027'), true);
  });

  it('rejects dates outside the window — the year-boundary bug class', () => {
    // July 2026 belongs to 2025-2026, NOT 2026-2027.
    assert.equal(inAcademicYear('2026-07-15', '2026-2027'), false);
    // September 2027 belongs to 2027-2028.
    assert.equal(inAcademicYear('2027-09-01', '2026-2027'), false);
    assert.equal(inAcademicYear('2025-09-01', '2026-2027'), false);
  });
});

describe('academicYearOf', () => {
  it('maps a date to its September-start academic year', () => {
    assert.equal(academicYearOf('2026-09-15'), '2026-2027');
    assert.equal(academicYearOf('2027-08-31'), '2026-2027');
    // Before September, the year is the previous one.
    assert.equal(academicYearOf('2027-01-15'), '2026-2027');
    assert.equal(academicYearOf('2026-08-31'), '2025-2026');
  });
});
// Pure-formatter suite (src/lib/formatters, src/lib/classes): no DOM, no
// React — runs in plain node by design, see tests/harness.ts "When NOT to
// use it".
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { formatCurrency, formatDate, formatDateLang } from '../src/lib/formatters';
import { buildClassCode, daysUntilDue, getStudentStanding } from '../src/lib/classes';

describe('formatCurrency', () => {
  it('formats amounts with XOF suffix', () => {
    assert.equal(formatCurrency(150000), '150 000 XOF');
    assert.equal(formatCurrency(0), '0 XOF');
  });

  it('never renders "undefined" or NaN', () => {
    assert.equal(formatCurrency(undefined), '0 XOF');
    assert.equal(formatCurrency(NaN), '0 XOF');
  });
});

describe('formatDate / formatDateLang', () => {
  it('formats dates without crashing on empty input', () => {
    assert.equal(formatDate(''), '');
    assert.equal(formatDateLang('', 'fr'), '');
  });

  it('returns the raw string when the date is unparseable', () => {
    assert.equal(formatDate('pas-une-date'), 'pas-une-date');
  });
});

describe('buildClassCode', () => {
  it('builds standard class codes with localized names', () => {
    const code = buildClassCode({ cycle: 'cycle1', year: '1', section: 'a', customName: '' });
    assert.equal(code.code, '1A');
    assert.equal(code.nameFr, '1ère Année A (1A)');
    assert.equal(code.nameEn, '1st Year A (1A)');
  });

  it('uses the custom name for custom classes', () => {
    const code = buildClassCode({ cycle: 'other', year: '', section: '', customName: 'CP1' });
    assert.equal(code.code, 'CP1');
    assert.equal(code.nameFr, 'CP1');
  });
});

describe('daysUntilDue — year-boundary correctness', () => {
  // Fixed dates on purpose: daysUntilDue takes `today` as a parameter, so the
  // suite is deterministic (no new Date() anywhere in the code under test).
  const today = '2026-09-05';

  it('counts whole years: same date last/next year is ±365 days, not "same month"', () => {
    // The month-only failure mode would compare "September == September" and
    // treat a due date from last September as due NOW. The real answer is a
    // full year of overdue — the day math must cross the year boundary.
    assert.equal(daysUntilDue('2025-09-05', today), -365);
    assert.equal(daysUntilDue('2027-09-05', today), 365);
  });

  it('is exact at the boundary: today is 0, tomorrow 1, yesterday -1', () => {
    assert.equal(daysUntilDue('2026-09-05', today), 0);
    assert.equal(daysUntilDue('2026-09-06', today), 1);
    assert.equal(daysUntilDue('2026-09-04', today), -1);
  });

  it('crosses the New Year without drifting (Dec 31 vs Jan 1)', () => {
    assert.equal(daysUntilDue('2027-01-01', '2026-12-31'), 1);
    assert.equal(daysUntilDue('2026-12-31', '2027-01-01'), -1);
  });
});

describe('getStudentStanding — overdue must cross year boundaries', () => {
  const student = (dueDate: string, totalDue = 120000, amountPaid = 0) => ({
    totalDue,
    amountPaid,
    dueDate,
  });

  it('flags a due date from the SAME MONTH of last year as overdue, not dueSoon', () => {
    // The month-only failure mode: getMonth() === getMonth() would put this
    // student in the "dueSoon" (<= 3 days) bucket instead of "overdue".
    const standing = getStudentStanding(student('2025-09-10'), '2026-09-05');
    assert.equal(standing.key, 'overdue');
    assert.equal(standing.daysOverdue, 360);
  });

  it('keeps the due-soon window within the current year', () => {
    assert.equal(getStudentStanding(student('2026-09-06'), '2026-09-05').key, 'dueSoon');
    assert.equal(getStudentStanding(student('2026-09-05'), '2026-09-05').key, 'dueSoon');
  });

  it('reports current for a next-year due date and settled for paid balances', () => {
    assert.equal(getStudentStanding(student('2027-09-01'), '2026-09-05').key, 'current');
    const paid = getStudentStanding(student('2025-09-10', 120000, 120000), '2026-09-05');
    assert.equal(paid.key, 'settled');
    assert.equal(paid.daysOverdue, 0);
  });
});

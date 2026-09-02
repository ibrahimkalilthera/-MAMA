/**
 * Pure unit tests for the relative-date labels (no DOM, no React — see
 * tests/harness.ts "When NOT to use it").
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { daysBetween, relativeDateLabel } from '../src/lib/relativeDate';

// A fixed local "today" (Sep 3, 10:00 local) — results must not depend on
// the machine's timezone or the time of day.
const TODAY = new Date(2026, 8, 3, 10, 0, 0);

describe('daysBetween', () => {
  it('is 0 for the same day', () => {
    assert.equal(daysBetween('2026-09-03', TODAY), 0);
  });

  it('counts whole calendar days back', () => {
    assert.equal(daysBetween('2026-09-02', TODAY), 1);
    assert.equal(daysBetween('2026-08-31', TODAY), 3);
    assert.equal(daysBetween('2026-08-20', TODAY), 14);
  });

  it('handles full ISO timestamps too', () => {
    assert.equal(daysBetween('2026-09-01T15:00:00', TODAY), 2);
  });

  it('is NaN for unparseable input', () => {
    assert.ok(Number.isNaN(daysBetween('garbage', TODAY)));
  });
});

describe('relativeDateLabel', () => {
  it('labels today (and future dates) as today', () => {
    assert.deepEqual(relativeDateLabel('2026-09-03', TODAY), { kind: 'today' });
    assert.deepEqual(relativeDateLabel('2026-09-10', TODAY), { kind: 'today' });
  });

  it('labels yesterday', () => {
    assert.deepEqual(relativeDateLabel('2026-09-02', TODAY), { kind: 'yesterday' });
  });

  it('labels a few days ago with the count', () => {
    assert.deepEqual(relativeDateLabel('2026-08-31', TODAY), { kind: 'daysAgo', days: 3 });
    assert.deepEqual(relativeDateLabel('2026-08-28', TODAY), { kind: 'daysAgo', days: 6 });
  });

  it('falls back to the plain date beyond a week', () => {
    assert.deepEqual(relativeDateLabel('2026-08-27', TODAY), { kind: 'date', date: '2026-08-27' });
  });

  it('falls back to the plain date for invalid input', () => {
    assert.deepEqual(relativeDateLabel('garbage', TODAY), { kind: 'date', date: 'garbage' });
  });
});
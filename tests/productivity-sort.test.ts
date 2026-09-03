// Pure-logic suite for the Productivity panel's task ordering
// (sortTodosByDate): no DOM, no React — runs in plain node by design, see
// tests/harness.ts "When NOT to use it".
//
// Order contract: OVERDUE first (oldest = most urgent at the top), then
// today, then upcoming (ascending), then undated — ISO strings compare
// chronologically.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { groupTodosByDate, sortTodosByDate, todoGroupKey } from '../src/lib/todoSort';
import type { Todo } from '../src/lib/useSupabaseData';

const todo = (id: string, date?: string): Todo => ({ id, text: `task-${id}`, completed: false, date });

describe('sortTodosByDate', () => {
  const TODAY = '2026-09-02';

  it('puts overdue tasks on top (oldest = most urgent first), then today, then upcoming', () => {
    const sorted = sortTodosByDate([
      todo('next-week', '2026-09-14'),
      todo('late-old', '2026-08-20'),
      todo('today', TODAY),
      todo('late-recent', '2026-09-01'),
      todo('tomorrow', '2026-09-03'),
    ], TODAY);
    assert.deepEqual(sorted.map((t) => t.id), ['late-old', 'late-recent', 'today', 'tomorrow', 'next-week']);
  });

  it('keeps today before upcoming dates in ascending order', () => {
    const sorted = sortTodosByDate([
      todo('next-week', '2026-09-14'),
      todo('tomorrow', '2026-09-03'),
      todo('today', TODAY),
      todo('month-end', '2026-09-30'),
    ], TODAY);
    assert.deepEqual(sorted.map((t) => t.id), ['today', 'tomorrow', 'next-week', 'month-end']);
  });

  it('sends undated tasks to the bottom, preserving their relative order', () => {
    const sorted = sortTodosByDate([
      todo('undated-2'),
      todo('today', TODAY),
      todo('undated-1'),
      todo('future', '2026-09-09'),
    ], TODAY);
    assert.deepEqual(sorted.map((t) => t.id), ['today', 'future', 'undated-2', 'undated-1']);
  });

  it('does not mutate the input array', () => {
    const input = [todo('a', '2026-09-10'), todo('b', TODAY)];
    const snapshot = [...input];
    sortTodosByDate(input, TODAY);
    assert.deepEqual(input, snapshot, 'input untouched');
  });

  it('is stable for tasks with the same date', () => {
    const input = [todo('first', '2026-09-05'), todo('second', '2026-09-05'), todo('third', TODAY)];
    // 09-05 is UPCOMING here (after TODAY): today still outranks it, and the
    // two same-date upcoming tasks keep their insertion order.
    const sorted = sortTodosByDate(input, TODAY);
    assert.deepEqual(sorted.map((t) => t.id), ['third', 'first', 'second']);
  });
});

describe('todoGroupKey', () => {
  const TODAY = '2026-09-02';

  it('classifies each bucket boundary', () => {
    assert.equal(todoGroupKey(undefined, TODAY), 'undated');
    assert.equal(todoGroupKey('', TODAY), 'undated');
    assert.equal(todoGroupKey(TODAY, TODAY), 'today');
    assert.equal(todoGroupKey('2026-09-03', TODAY), 'upcoming');
    assert.equal(todoGroupKey('2026-09-01', TODAY), 'overdue');
  });
});

describe('groupTodosByDate', () => {
  const TODAY = '2026-09-02';

  it('buckets tasks with counters, each bucket ascending by date', () => {
    const groups = groupTodosByDate([
      todo('late-old', '2026-08-20'),
      todo('undated-2'),
      todo('tomorrow', '2026-09-03'),
      todo('today', TODAY),
      todo('late-recent', '2026-09-01'),
      todo('undated-1'),
      todo('later', '2026-09-30'),
    ], TODAY);
    assert.deepEqual(groups.today.map((t) => t.id), ['today']);
    assert.deepEqual(groups.upcoming.map((t) => t.id), ['tomorrow', 'later']);
    assert.deepEqual(groups.overdue.map((t) => t.id), ['late-old', 'late-recent']);
    assert.deepEqual(groups.undated.map((t) => t.id), ['undated-2', 'undated-1'], 'stable for undated');
    assert.deepEqual(
      [groups.today.length, groups.upcoming.length, groups.overdue.length, groups.undated.length],
      [1, 2, 2, 2],
      'counters reflect each bucket',
    );
  });

  it('empty groups are empty arrays (panel hides them)', () => {
    const groups = groupTodosByDate([todo('today', TODAY)], TODAY);
    assert.deepEqual(groups.upcoming, []);
    assert.deepEqual(groups.overdue, []);
    assert.deepEqual(groups.undated, []);
  });

  it('does not mutate the input array', () => {
    const input = [todo('a', '2026-09-10'), todo('b', TODAY)];
    const snapshot = [...input];
    groupTodosByDate(input, TODAY);
    assert.deepEqual(input, snapshot, 'input untouched');
  });
});
// Pure-logic suite for the Productivity panel's task ordering
// (sortTodosByDate): no DOM, no React — runs in plain node by design, see
// tests/harness.ts "When NOT to use it".
//
// Order contract: today first, then upcoming (ascending), then overdue
// (ascending), then undated — ISO strings compare chronologically.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { sortTodosByDate } from '../src/lib/todoSort';
import type { Todo } from '../src/lib/useSupabaseData';

const todo = (id: string, date?: string): Todo => ({ id, text: `task-${id}`, completed: false, date });

describe('sortTodosByDate', () => {
  const TODAY = '2026-09-02';

  it('puts today first, then upcoming dates in ascending order', () => {
    const sorted = sortTodosByDate([
      todo('next-week', '2026-09-14'),
      todo('tomorrow', '2026-09-03'),
      todo('today', TODAY),
      todo('month-end', '2026-09-30'),
    ], TODAY);
    assert.deepEqual(sorted.map((t) => t.id), ['today', 'tomorrow', 'next-week', 'month-end']);
  });

  it('keeps overdue tasks after upcoming, oldest due first', () => {
    const sorted = sortTodosByDate([
      todo('future', '2026-09-10'),
      todo('late-old', '2026-08-20'),
      todo('late-recent', '2026-09-01'),
    ], TODAY);
    assert.deepEqual(sorted.map((t) => t.id), ['future', 'late-old', 'late-recent']);
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
    const sorted = sortTodosByDate(input, TODAY);
    assert.deepEqual(sorted.map((t) => t.id), ['third', 'first', 'second']);
  });
});
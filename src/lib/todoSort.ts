/**
 * Task date ordering for the Productivité panel (and any future task list):
 * OVERDUE first (oldest = most urgent at the top), then today, then upcoming
 * (ascending), then undated. ISO dates (YYYY-MM-DD) compare lexicographically,
 * so ascending string order is chronological.
 *
 * Pure and DOM-free — locked by tests/productivity-sort.test.ts (no harness,
 * see tests/harness.ts "When NOT to use it").
 */
import type { Todo } from './useSupabaseData';

export type TodoGroupKey = 'today' | 'upcoming' | 'overdue' | 'undated';

export interface TodoGroups {
  today: Todo[];
  upcoming: Todo[];
  overdue: Todo[];
  undated: Todo[];
}

/** Bucket a task by its calendar date relative to `today`. */
export const todoGroupKey = (date: string | undefined, today: string): TodoGroupKey => {
  if (!date) return 'undated';
  if (date === today) return 'today';
  return date > today ? 'upcoming' : 'overdue';
};

/**
 * Group tasks into En retard / Aujourd'hui / À venir / Sans date buckets, each
 * bucket sorted by the same contract as sortTodosByDate (ascending dates;
 * stable, so insertion order survives for equal dates). The panel renders the
 * buckets in that order: overdue on top, undated at the bottom.
 */
export function groupTodosByDate(todos: Todo[], today: string): TodoGroups {
  const groups: TodoGroups = { today: [], upcoming: [], overdue: [], undated: [] };
  for (const todo of todos) {
    groups[todoGroupKey(todo.date, today)].push(todo);
  }
  for (const key of Object.keys(groups) as TodoGroupKey[]) {
    groups[key].sort((a, b) => (a.date ?? '').localeCompare(b.date ?? ''));
  }
  return groups;
}

export function sortTodosByDate(todos: Todo[], today: string): Todo[] {
  const rank = (date: string | undefined): number => {
    if (!date) return 3;
    if (date === today) return 1;
    return date > today ? 2 : 0;
  };
  return [...todos].sort(
    (a, b) => rank(a.date) - rank(b.date) || (a.date ?? '').localeCompare(b.date ?? '')
  );
}
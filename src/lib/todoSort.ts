/**
 * Task date ordering for the Productivité panel (and any future task list):
 * today first, then upcoming (ascending), then overdue (ascending), then
 * undated. ISO dates (YYYY-MM-DD) compare lexicographically, so ascending
 * string order is chronological.
 *
 * Pure and DOM-free — locked by tests/productivity-sort.test.ts (no harness,
 * see tests/harness.ts "When NOT to use it").
 */
import type { Todo } from './useSupabaseData';

export function sortTodosByDate(todos: Todo[], today: string): Todo[] {
  const rank = (date: string | undefined): number => {
    if (!date) return 3;
    if (date === today) return 0;
    return date > today ? 1 : 2;
  };
  return [...todos].sort(
    (a, b) => rank(a.date) - rank(b.date) || (a.date ?? '').localeCompare(b.date ?? '')
  );
}
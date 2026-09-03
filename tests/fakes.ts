/**
 * Shared test fakes.
 *
 * Currently: one fake Supabase client (`makeFakeDb`) that satisfies the
 * ReplayDb contract (src/lib/offlineReplay) and is shared by the two offline
 * suites (offline-replay, offline-sync) — historically each defined its own
 * near-identical copy.
 *
 * Keep fakes here ONLY when at least two suites need the same shape. Fakes
 * used by a single suite (focus-stack's FakeFocusable/FakeContainer,
 * payroll's FakeJsPDF, notification-sound's FakeGain, ...) stay in their
 * suite on purpose — hoisting them here would add indirection without reuse.
 */
import type { ReplayDb } from '../src/lib/offlineReplay';

type OkResult = { data: Record<string, unknown>; error: null };
type ErrResult = { data: null; error: { message: string } };

/** A thenable that also exposes the chainable Supabase builder methods. */
interface FakeBuilder extends Promise<OkResult | ErrResult> {
  insert(): FakeBuilder;
  update(): FakeBuilder;
  delete(): FakeBuilder;
  eq(): FakeBuilder;
  select(): FakeBuilder;
  single(): FakeBuilder;
}

export interface FakeReplayDbOptions {
  /** Tables whose operations resolve with an error (default: none). */
  failTables?: string[];
  /** Every operation resolves with an error (the offline-replay errorMode). */
  allFail?: boolean;
  /** `from()` throws synchronously — exercises the drain's stop-on-throw branch. */
  throwOnFrom?: boolean;
}

export interface FakeReplayDb {
  db: ReplayDb;
  /** Table names in call order, as recorded by `from()`. */
  queries: string[];
}

/**
 * Fake ReplayDb: records every queried table in call order, succeeds by
 * default, fails only for `failTables` (or everything with `allFail`), and
 * can throw synchronously from `from()`.
 */
export function makeFakeDb(opts: FakeReplayDbOptions = {}): FakeReplayDb {
  const queries: string[] = [];
  const ok: OkResult = { data: {}, error: null };
  const bad: ErrResult = { data: null, error: { message: 'boom' } };

  const mk = (fail: boolean): FakeBuilder => {
    const p = Promise.resolve<OkResult | ErrResult>(fail ? bad : ok);
    return Object.assign(p, {
      insert: () => mk(fail),
      update: () => mk(fail),
      delete: () => mk(fail),
      eq: () => mk(fail),
      select: () => mk(fail),
      single: () => mk(fail),
    }) as unknown as FakeBuilder;
  };

  const from = (table: string): FakeBuilder => {
    if (opts.throwOnFrom) throw new Error('network down');
    queries.push(table);
    return mk(opts.allFail || Boolean(opts.failTables?.includes(table)));
  };

  return { db: { from } as unknown as ReplayDb, queries };
}
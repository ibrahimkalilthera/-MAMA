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

type OkResult = { data: Array<Record<string, unknown>>; error: null };
type ErrResult = { data: null; error: { message: string } };

/**
 * A thenable that also exposes the chainable Supabase builder methods.
 *
 * `data` is an ARRAY on purpose: the replays that UPDATE or DELETE ask for
 * `.select('id')` and treat « zero rows » as a refusal (an RLS-filtered write
 * answers 200 with an empty body) — a fake that always answered a non-empty
 * object could not tell those two outcomes apart.
 */
interface FakeBuilder extends Promise<OkResult | ErrResult> {
  insert(row?: unknown): FakeBuilder;
  update(): FakeBuilder;
  delete(): FakeBuilder;
  eq(): FakeBuilder;
  neq(): FakeBuilder;
  select(): FakeBuilder;
  single(): FakeBuilder;
}

/** One captured `insert()`, with the table it was sent to. */
export interface CapturedRow {
  table: string;
  row: Record<string, unknown>;
}

export interface FakeReplayDbOptions {
  /** Tables whose operations resolve with an error (default: none). */
  failTables?: string[];
  /** Every operation resolves with an error (the offline-replay errorMode). */
  allFail?: boolean;
  /** `from()` throws synchronously — exercises the drain's stop-on-throw branch. */
  throwOnFrom?: boolean;
  /**
   * Tables whose update/delete match ZERO rows: the write came back 200 with an
   * empty body, which is how a policy removes every target row. The replay must
   * read that as a refusal, not as a success.
   */
  emptyWrites?: string[];
}

export interface FakeReplayDb {
  db: ReplayDb;
  /** Table names in call order, as recorded by `from()`. */
  queries: string[];
  /**
   * Every row passed to `insert()`, in call order. Needed to assert WHAT the
   * replay sent — chiefly the id of a row created offline, which is the
   * difference between the queued follow-up actions landing on that row and
   * pointing at an id no database ever had.
   */
  rows: CapturedRow[];
}

/**
 * Fake ReplayDb: records every queried table in call order, succeeds by
 * default, fails only for `failTables` (or everything with `allFail`), and
 * can throw synchronously from `from()`.
 */
export function makeFakeDb(opts: FakeReplayDbOptions = {}): FakeReplayDb {
  const queries: string[] = [];
  const rows: CapturedRow[] = [];
  const ok: OkResult = { data: [{ id: 'fake-row' }], error: null };
  const empty: OkResult = { data: [], error: null };
  const bad: ErrResult = { data: null, error: { message: 'boom' } };
  const writeEmpty = (table: string) => Boolean(opts.emptyWrites?.includes(table));

  const mk = (fail: boolean, table: string, zeroRows = false): FakeBuilder => {
    const result: OkResult | ErrResult = fail ? bad : zeroRows ? empty : ok;
    const p = Promise.resolve<OkResult | ErrResult>(result);
    return Object.assign(p, {
      insert: (row?: unknown) => {
        if (row) rows.push({ table, row: row as Record<string, unknown> });
        return mk(fail, table);
      },
      // update/delete on an `emptyWrites` table answer 200 with NO row — the
      // case the honesty checks exist for (an RLS-filtered write). It is not an
      // error: nothing failed, nothing happened.
      update: () => mk(fail, table, writeEmpty(table)),
      delete: () => mk(fail, table, writeEmpty(table)),
      eq: () => mk(fail, table, zeroRows),
      neq: () => mk(fail, table, zeroRows),
      select: () => mk(fail, table, zeroRows),
      single: () => mk(fail, table, zeroRows),
    }) as unknown as FakeBuilder;
  };

  const from = (table: string): FakeBuilder => {
    if (opts.throwOnFrom) throw new Error('network down');
    queries.push(table);
    return mk(opts.allFail || Boolean(opts.failTables?.includes(table)), table);
  };

  return { db: { from } as unknown as ReplayDb, queries, rows };
}
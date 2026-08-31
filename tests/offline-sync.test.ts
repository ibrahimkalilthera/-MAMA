// Full-behaviour test for the offline sync pass — what `useSupabaseData`'s
// syncOfflineQueue does on the hook side, exercised through its extracted
// core (drainOfflineQueue) with the REAL queue module (enqueue/get/remove via
// the in-memory storage backend — no DOM needed) and a ReplayDb-compatible
// fake Supabase client.
//
// Covered end-to-end:
//   1. enqueueOfflineAction → getOfflineQueue round-trip through the store
//   2. healthy drain: every item replayed (FIFO), every item removed
//   3. removeOfflineAction removes exactly one item, keeps the others
//   4. a failing replay STAYS queued while the rest of the queue still syncs
//   5. a thrown replay STOPS the drain, later items keep their order
//   6. empty queue: no-op, returns 0, queries nothing
//   7. addPayment hits both tables (payments, then students) and drains
//   8. contract: the hook drives this exact function (no inline loop left)
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { drainOfflineQueue } from '../src/lib/offlineSync';
import {
  enqueueOfflineAction,
  getOfflineQueue,
  getOfflineQueueCount,
  removeOfflineAction,
  clearOfflineQueue,
} from '../src/lib/offlineQueue';
import type { ReplayDb } from '../src/lib/offlineReplay';

// ─── Fake Supabase client ────────────────────────────────────────────────────

type OkResult = { data: Record<string, unknown>; error: null };
type ErrResult = { data: null; error: { message: string } };
interface FakeBuilder extends Promise<OkResult | ErrResult> {
  insert(): FakeBuilder;
  update(): FakeBuilder;
  delete(): FakeBuilder;
  eq(): FakeBuilder;
  select(): FakeBuilder;
  single(): FakeBuilder;
}

/**
 * Fake ReplayDb: records every queried table in call order, succeeds by
 * default, fails only for `failTables`, and (optionally) throws synchronously
 * from `from()` to exercise the drain's stop-on-throw branch.
 */
function makeFakeDb(opts: { failTables?: string[]; throwOnFrom?: boolean } = {}) {
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
    return mk(Boolean(opts.failTables?.includes(table)));
  };

  return { db: { from } as unknown as ReplayDb, queries };
}

// ─── Seeds (real enqueueOfflineAction calls with typed payloads) ─────────────

const seedExpense = () =>
  enqueueOfflineAction('addExpense', { category: 'stationery', description: 'desk', amount: 10, date: '2026-01-01' });
const seedTodo = () => enqueueOfflineAction('addTodo', { text: 'Call parent', completed: false });
const seedStaff = () =>
  enqueueOfflineAction('addStaff', { name: 'T', position: 'teacher', salary: 150000, email: '', phone: '111', bankDetails: '', emergencyContact: '' });
const seedPayment = () => enqueueOfflineAction('addPayment', { studentId: 's1', payment: { date: '2026-01-01', amount: 500 } });

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('offline sync (drainOfflineQueue — the full syncOfflineQueue behaviour)', () => {
  it('round-trips enqueueOfflineAction → getOfflineQueue through the real store', () => {
    clearOfflineQueue();
    assert.deepEqual(getOfflineQueue(), [], 'the store starts empty');

    const item = seedTodo();
    const queue = getOfflineQueue();
    assert.equal(queue.length, 1);
    assert.equal(getOfflineQueueCount(), 1);
    assert.equal(queue[0].id, item.id);
    assert.equal(queue[0].type, 'addTodo');
    assert.equal(queue[0].attempts, 0);
  });

  it('drains a healthy queue completely: FIFO replay order, every item removed', async () => {
    clearOfflineQueue();
    seedExpense();
    seedTodo();
    seedStaff();

    const { db, queries } = makeFakeDb();
    const synced = await drainOfflineQueue(db);

    assert.equal(synced, 3);
    assert.deepEqual(getOfflineQueue(), [], 'a fully healthy drain must empty the queue');
    assert.equal(getOfflineQueueCount(), 0);
    assert.deepEqual(queries, ['expenses', 'todos', 'staff'], 'items must replay in enqueue order');
  });

  it('removeOfflineAction removes exactly one item and keeps the others', () => {
    clearOfflineQueue();
    const first = seedTodo();
    const second = seedStaff();

    removeOfflineAction(first.id);

    const queue = getOfflineQueue();
    assert.equal(queue.length, 1);
    assert.equal(queue[0].id, second.id);
  });

  it('keeps a failing item queued and still syncs the rest of the queue', async () => {
    clearOfflineQueue();
    const failed = seedExpense(); // the 'expenses' table will fail below
    seedTodo();
    seedStaff();

    const { db, queries } = makeFakeDb({ failTables: ['expenses'] });
    const synced = await drainOfflineQueue(db);

    assert.equal(synced, 2, 'only the healthy items count as synced');
    const left = getOfflineQueue();
    assert.equal(left.length, 1, 'a failed item must stay queued for the next sync pass');
    assert.equal(left[0].id, failed.id);
    assert.deepEqual(queries, ['expenses', 'todos', 'staff'], 'the drain continues past a reported failure');
  });

  it('stops the whole drain when a replay throws, later items keep their order', async () => {
    clearOfflineQueue();
    seedTodo();
    seedStaff();

    // The drain logs the stop-on-throw through console.error — silence it so
    // the intentional throw does not pollute the test/CI output.
    const realConsoleError = console.error;
    console.error = () => {};
    try {
      const { db, queries } = makeFakeDb({ throwOnFrom: true });
      const synced = await drainOfflineQueue(db);

      assert.equal(synced, 0);
      assert.equal(getOfflineQueue().length, 2, 'nothing is removed when the drain stops');
      assert.equal(queries.length, 0, 'the throw happens before any table is queried');
    } finally {
      console.error = realConsoleError;
    }
  });

  it('is a no-op on an empty queue (returns 0, queries nothing)', async () => {
    clearOfflineQueue();
    const { db, queries } = makeFakeDb();

    const synced = await drainOfflineQueue(db);

    assert.equal(synced, 0);
    assert.deepEqual(queries, []);
    assert.deepEqual(getOfflineQueue(), []);
  });

  it("replays 'addPayment' against both tables (payments, then students) and drains", async () => {
    clearOfflineQueue();
    seedPayment();

    const { db, queries } = makeFakeDb();
    const synced = await drainOfflineQueue(db);

    assert.equal(synced, 1);
    assert.deepEqual(queries, ['payments', 'students'], 'a payment updates the student too');
    assert.deepEqual(getOfflineQueue(), []);
  });

  it('the hook drives this exact function — useSupabaseData has no inline replay loop left', () => {
    const hook = readFileSync('src/lib/useSupabaseData.ts', 'utf8');
    assert.match(hook, /import \{ drainOfflineQueue \} from '\.\/offlineSync';/);
    assert.match(hook, /await drainOfflineQueue\(supabase\)/);
    assert.ok(
      !/replayOfflineItem\(supabase, item\)/.test(hook),
      'the inline replay loop must be gone from the hook',
    );
  });
});

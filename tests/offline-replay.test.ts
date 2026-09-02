// Pure replay-core suite: no DOM/React (see tests/harness.ts "When NOT to
// use it") — replayOfflineItem is exercised against a plain fake ReplayDb.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { replayOfflineItem } from '../src/lib/offlineReplay';
import type { ReplayDb } from '../src/lib/offlineReplay';
import type { OfflineActionType, OfflinePayload, QueueItem } from '../src/lib/offlineQueue';

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Build a typed QueueItem whose `type` and `payload` are correlated. */
function itemOf<T extends OfflineActionType>(
  type: T,
  payload: Extract<OfflinePayload, { type: T }>['payload'],
): QueueItem {
  // Same single-boundary assertion as enqueueOfflineAction: TS cannot verify the
  // correlation between the generic `type` and `payload` at this narrow spot.
  return { id: `q_${type}`, createdAt: '2026-01-01T00:00:00.000Z', attempts: 0, type, payload } as QueueItem;
}

type OkResult = { data: Record<string, unknown>; error: null };
/** A Promise that also exposes the count-of-key builder chain used by Supabase. */
interface FakeBuilder extends Promise<OkResult> {
  insert(): FakeBuilder;
  update(): FakeBuilder;
  delete(): FakeBuilder;
  eq(): FakeBuilder;
  select(): FakeBuilder;
  single(): FakeBuilder;
}

/**
 * Build a fake Supabase client that records every queried table and resolves
 * every operation with no error (`data` stays truthy so `.select().single()`
 * branches report success). Pass `errorMode` to exercise the failure path.
 */
function makeFakeDb(errorMode = false) {
  const tables: string[] = [];
  const result: OkResult = errorMode
    ? { data: null as unknown as Record<string, unknown>, error: { message: 'boom' } as never }
    : { data: {}, error: null };

  const mk = (): FakeBuilder => {
    const p = Promise.resolve<OkResult>(result as never);
    return Object.assign(p, {
      insert: mk, update: mk, delete: mk, eq: mk, select: mk, single: mk,
    }) as unknown as FakeBuilder;
  };
  const from = (table: string): FakeBuilder => {
    tables.push(table);
    return mk();
  };
  const db = { from } as unknown as ReplayDb;
  return { db, tables };
}

/** The player with the full typed payloads, and the table each one should hit. */
const CASES: { type: OfflineActionType; build: () => QueueItem; table: string }[] = [
  { type: 'addPayment', build: () => itemOf('addPayment', { studentId: 's1', payment: { date: '2026-01-01', amount: 500, receiptNumber: 'R1' } }), table: 'payments' },
  { type: 'addExpense', build: () => itemOf('addExpense', { category: 'stationery', description: 'desk', amount: 10, date: '2026-01-01' }), table: 'expenses' },
  { type: 'addVendorExpense', build: () => itemOf('addVendorExpense', { vendorName: 'Vendor', category: 'electricity', amount: 50, dueDate: '2026-02-01', paymentStatus: 'paid', amountPaid: 50 }), table: 'vendor_expenses' },
  { type: 'updateVendorExpense', build: () => itemOf('updateVendorExpense', { id: 'v1', updates: { amount: 60 } }), table: 'vendor_expenses' },
  { type: 'deleteVendorExpense', build: () => itemOf('deleteVendorExpense', { id: 'v1' }), table: 'vendor_expenses' },
  { type: 'addStudent', build: () => itemOf('addStudent', { name: 'Ada', parentName: 'Parent', parentEmail: 'p@x.com', parentPhone: '123', totalDue: 100, amountPaid: 0, dueDate: '2026-09-01', notes: '' }), table: 'students' },
  { type: 'updateStudent', build: () => itemOf('updateStudent', { id: 's1', updates: { name: 'Ada B.' } }), table: 'students' },
  { type: 'deleteStudent', build: () => itemOf('deleteStudent', { id: 's1' }), table: 'students' },
  { type: 'addStaff', build: () => itemOf('addStaff', { name: 'T', position: 'teacher', salary: 150000, email: '', phone: '111', bankDetails: '', emergencyContact: '' }), table: 'staff' },
  { type: 'updateStaff', build: () => itemOf('updateStaff', { id: 't1', updates: { salary: 160000 } }), table: 'staff' },
  { type: 'deleteStaff', build: () => itemOf('deleteStaff', { id: 't1' }), table: 'staff' },
  { type: 'addSalaryPayment', build: () => itemOf('addSalaryPayment', { staffId: 't1', amount: 150000, date: '2026-01-31' }), table: 'salary_payments' },
  { type: 'addParent', build: () => itemOf('addParent', { fullName: 'Mme X', phones: ['123'], address: 'A', occupation: 'O', relationship: 'Mother' }), table: 'parents' },
  { type: 'updateParent', build: () => itemOf('updateParent', { id: 'p1', updates: { address: 'B' } }), table: 'parents' },
  { type: 'deleteParent', build: () => itemOf('deleteParent', { id: 'p1' }), table: 'parents' },
  { type: 'addTodo', build: () => itemOf('addTodo', { text: 'Call parent', completed: false }), table: 'todos' },
  { type: 'updateTodo', build: () => itemOf('updateTodo', { id: 't1', updates: { completed: true } }), table: 'todos' },
  { type: 'deleteTodo', build: () => itemOf('deleteTodo', { id: 't1' }), table: 'todos' },
];

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('offline queue replay (replayOfflineItem)', () => {
  it('covers every OfflineActionType (guard against a newly added action)', () => {
    // Keep this list in sync with OfflineActionType so an added action forces a
    // deliberate test-case here instead of silently replaying into `false`.
    const all: OfflineActionType[] = [
      'addPayment', 'addExpense', 'addVendorExpense', 'updateVendorExpense', 'deleteVendorExpense',
      'addStudent', 'updateStudent', 'deleteStudent',
      'addStaff', 'updateStaff', 'deleteStaff', 'addSalaryPayment',
      'addParent', 'updateParent', 'deleteParent',
      'addTodo', 'updateTodo', 'deleteTodo',
    ];
    assert.equal(CASES.length, all.length, 'expected one test case per action type');
    assert.deepEqual(
      CASES.map((c) => c.type).sort(),
      all.slice().sort(),
    );
  });

  for (const { type, build, table } of CASES) {
    it(`replays '${type}' without error and queries '${table}'`, async () => {
      const { db, tables } = makeFakeDb();
      const ok = await replayOfflineItem(db, build());
      assert.equal(ok, true, `${type} should report success on a healthy db`);
      assert.ok(tables.includes(table), `${type} should hit table '${table}' (got ${tables.join(', ')})`);
    });
  }

  it('reports failure (success=false) when the db returns an error', async () => {
    const { db } = makeFakeDb(true);
    const ok = await replayOfflineItem(db, itemOf('addExpense', { category: 'stationery', description: 'd', amount: 5, date: '2026-01-01' }));
    assert.equal(ok, false, 'an errored insert must not count as synced');
  });
});
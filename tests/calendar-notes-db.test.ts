// Suite for src/lib/calendarNotes.ts — the team-wide day-notes persistence.
//
// supabaseClient is module-mocked (node:test --experimental-test-module-mocks)
// BEFORE the import: the real client module cannot be loaded under the test
// runner because import.meta.env does not exist there. No DOM needed — this
// stays a plain-node suite (see tests/harness.ts "When NOT to use it").
import { beforeEach, describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';

interface Call {
  op: 'select' | 'insert' | 'delete';
  table: string;
  payload?: Record<string, unknown>;
  eqColumn?: string;
  eqValue?: unknown;
}

let calls: Call[] = [];
let selectResult: { data: unknown; error: unknown };
let insertResult: { data: unknown; error: unknown };
let deleteResult: { error: unknown };
let currentTable = '';
let currentOp: 'select' | 'delete' = 'select';

/** A Promise-based builder resolving with the current select/insert result. */
function makeBuilder(resolveWith: () => { data: unknown; error: unknown }): PromiseLike<{ data: unknown; error: unknown }> & {
  order: () => ReturnType<typeof makeBuilder>;
  select: () => ReturnType<typeof makeBuilder>;
  eq: () => ReturnType<typeof makeBuilder>;
  single: () => Promise<{ data: unknown; error: unknown }>;
} {
  const p = Promise.resolve().then(resolveWith) as unknown as PromiseLike<{ data: unknown; error: unknown }> & {
    order: () => ReturnType<typeof makeBuilder>;
    select: () => ReturnType<typeof makeBuilder>;
    eq: () => ReturnType<typeof makeBuilder>;
    single: () => Promise<{ data: unknown; error: unknown }>;
  };
  return Object.assign(p, {
    order: () => makeBuilder(resolveWith),
    select: () => makeBuilder(resolveWith),
    eq: () => makeBuilder(resolveWith),
    single: () => Promise.resolve().then(resolveWith),
  });
}

const fakeSupabase = {
  from: (table: string) => {
    currentTable = table;
    return {
      select: () => {
        calls.push({ op: 'select', table: currentTable });
        return makeBuilder(() => selectResult);
      },
      insert: (payload: Record<string, unknown>) => {
        currentOp = 'select';
        calls.push({ op: 'insert', table, payload });
        return makeBuilder(() => insertResult);
      },
      delete: () => {
        currentOp = 'delete';
        return {
          eq: (column: string, value: unknown) => {
            calls.push({ op: 'delete', table, eqColumn: column, eqValue: value });
            return Promise.resolve(deleteResult);
          },
        };
      },
    };
  },
};

mock.module('../src/lib/supabaseClient', {
  namedExports: {
    supabase: fakeSupabase,
  },
});

const { fetchCalendarDayNotes, saveCalendarDayNote, deleteCalendarDayNote } =
  await import('../src/lib/calendarNotes');

describe('fetchCalendarDayNotes', () => {
  beforeEach(() => {
    calls = [];
    selectResult = { data: null, error: null };
  });

  it('reads all notes from calendar_notes ordered by created_at', async () => {
    selectResult = {
      data: [
        { id: 'n1', note_date: '2026-09-03', text: 'Réunion parents' },
        { id: 'n2', note_date: '2026-09-05', text: 'Examen 9e' },
      ],
      error: null,
    };
    const notes = await fetchCalendarDayNotes();
    assert.ok(notes);
    assert.equal(notes.length, 2);
    assert.deepEqual(notes[0], { id: 'n1', date: '2026-09-03', text: 'Réunion parents' });
    assert.equal(calls[0].table, 'calendar_notes', 'the team table is queried');
  });

  it('returns null when the read fails (caller falls back to its cache)', async () => {
    selectResult = { data: null, error: { message: 'relation does not exist' } };
    assert.equal(await fetchCalendarDayNotes(), null);
  });
});

describe('saveCalendarDayNote', () => {
  beforeEach(() => {
    calls = [];
    insertResult = { data: null, error: null };
  });

  it('inserts the note with its date and returns the created row', async () => {
    insertResult = { data: { id: 'db-1', note_date: '2026-09-03', text: 'Paiement Mme Diallo' }, error: null };
    const saved = await saveCalendarDayNote('2026-09-03', 'Paiement Mme Diallo');
    const insert = calls.find(c => c.op === 'insert');
    assert.ok(insert, 'an insert happened');
    assert.equal(insert.table, 'calendar_notes');
    assert.equal(insert.payload?.note_date, '2026-09-03');
    assert.equal(insert.payload?.text, 'Paiement Mme Diallo');
    assert.ok(saved);
    assert.equal(saved.id, 'db-1', 'the real DB id is returned (not a temp id)');
  });

  it('returns null when the write fails (RLS denial, offline, …)', async () => {
    insertResult = { data: null, error: { message: 'permission denied' } };
    assert.equal(await saveCalendarDayNote('2026-09-03', 'x'), null);
  });
});

describe('deleteCalendarDayNote', () => {
  beforeEach(() => {
    calls = [];
    deleteResult = { error: null };
  });

  it('deletes by id and reports success', async () => {
    assert.equal(await deleteCalendarDayNote('db-1'), true);
    const del = calls.find(c => c.op === 'delete');
    assert.ok(del);
    assert.equal(del.table, 'calendar_notes');
    assert.equal(del.eqColumn, 'id');
    assert.equal(del.eqValue, 'db-1');
  });

  it('returns false when the delete fails', async () => {
    deleteResult = { error: { message: 'boom' } };
    assert.equal(await deleteCalendarDayNote('db-1'), false);
  });
});

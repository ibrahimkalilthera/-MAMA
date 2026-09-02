// Suite for src/lib/teamSettings.ts — the app_settings persistence layer.
//
// supabaseClient is module-mocked (node:test --experimental-test-module-mocks)
// BEFORE the import: the real client module cannot be loaded under the test
// runner because import.meta.env does not exist there. No DOM needed — this
// stays a plain-node suite (see tests/harness.ts "When NOT to use it").
import { beforeEach, describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';

interface UpsertCall {
  table: string;
  payload: Record<string, unknown>;
}
const upsertCalls: UpsertCall[] = [];
let fetchResult: { data: { value: unknown } | null; error: unknown };
let saveResult: { error: unknown };

const fakeSupabase = {
  from: (table: string) => ({
    select: () => ({
      eq: () => ({
        maybeSingle: async () => fetchResult,
      }),
    }),
    upsert: async (payload: Record<string, unknown>) => {
      upsertCalls.push({ table, payload });
      return saveResult;
    },
  }),
};

mock.module('../src/lib/supabaseClient', {
  namedExports: {
    supabase: fakeSupabase,
  },
});

const { fetchInactivityMinutes, saveInactivityMinutes, INACTIVITY_SETTINGS_KEY } =
  await import('../src/lib/teamSettings');

describe('fetchInactivityMinutes', () => {
  it('returns the team window stored as a number', async () => {
    fetchResult = { data: { value: 15 }, error: null };
    assert.equal(await fetchInactivityMinutes(), 15);
  });

  it('returns null when the row is missing', async () => {
    fetchResult = { data: null, error: null };
    assert.equal(await fetchInactivityMinutes(), null);
  });

  it('returns null when the read fails (degraded: caller keeps its cache)', async () => {
    fetchResult = { data: null, error: { message: 'relation does not exist' } };
    assert.equal(await fetchInactivityMinutes(), null);
  });
});

describe('saveInactivityMinutes', () => {
  beforeEach(() => {
    upsertCalls.length = 0;
    saveResult = { error: null };
  });

  it('upserts the team window with the fixed key and a timestamp', async () => {
    assert.equal(await saveInactivityMinutes(20), true);
    assert.equal(upsertCalls.length, 1);
    const call = upsertCalls[0];
    assert.equal(call.table, 'app_settings');
    assert.equal(call.payload.key, INACTIVITY_SETTINGS_KEY);
    assert.equal(call.payload.value, 20);
    assert.equal(typeof call.payload.updated_at, 'string');
    assert.equal(Number.isNaN(Date.parse(call.payload.updated_at as string)), false, 'updated_at is a real date');
  });

  it('returns false when the write fails (RLS denial, offline, …)', async () => {
    saveResult = { error: { message: 'permission denied' } };
    assert.equal(await saveInactivityMinutes(20), false);
    assert.equal(upsertCalls.length, 1, 'the attempt still happened');
  });
});
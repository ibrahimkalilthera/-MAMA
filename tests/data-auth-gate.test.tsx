/**
 * Auth-gate regression test for the initial data load (useSupabaseData).
 *
 * The mount fetch used to be unconditional — the login screen fired anon
 * reads on every business table. The gate now:
 *   1. skips the fetch while there is no session (no table read fires);
 *   2. fetches when an existing session is found at mount (getSession);
 *   3. fetches on a SIGNED_IN event (fresh login, no reload);
 *   4. clears the loaded domain rows on SIGNED_OUT (shared computers never
 *      show the previous account's data to the next sign-in).
 *
 * The supabase client module is mocked before the hook is imported so the
 * fetch chain is observable (per-table `.from()` calls) and the auth events
 * are scriptable.
 */
import { describe, it, mock, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { act } from 'react';
import { installDomGlobals, renderHook } from './harness';

installDomGlobals();

// ── fake supabase client ─────────────────────────────────────────────────────
type TableName = 'parents' | 'students' | 'payments' | 'staff' | 'salary_payments'
  | 'expenses' | 'vendor_expenses' | 'todos' | 'custom_classes';

const rowsByTable: Partial<Record<TableName, Record<string, unknown>[]>> = {};
const fromCalls: Record<string, number> = {};
let currentSession: { user: { id: string } } | null = null;
let authListener: ((event: string, session: { user: { id: string } } | null) => void) | null = null;

const fakeSupabase = {
  auth: {
    getSession: async () => ({ data: { session: currentSession }, error: null }),
    onAuthStateChange: (cb: (event: string, session: { user: { id: string } } | null) => void) => {
      authListener = cb;
      return { data: { subscription: { unsubscribe: () => { authListener = null; } } } };
    },
  },
  from: (table: string) => {
    fromCalls[table] = (fromCalls[table] ?? 0) + 1;
    const rows = rowsByTable[table as TableName] ?? [];
    return {
      select: () => ({
        order: async () => ({ data: rows, error: null }),
      }),
    };
  },
  rpc: async () => ({ data: null, error: null }),
};

mock.module('../src/lib/supabaseClient', {
  namedExports: { supabase: fakeSupabase },
});

const { useSupabaseData } = await import('../src/lib/useSupabaseData');

// ── helpers ──────────────────────────────────────────────────────────────────
const flush = async () => {
  for (let i = 0; i < 10; i++) {
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
  }
};
const emitSignedIn = () => {
  act(() => {
    const session = { user: { id: 'u1' } };
    currentSession = session;
    authListener?.('SIGNED_IN', session);
  });
};
const emitSignedOut = () => {
  act(() => {
    currentSession = null;
    authListener?.('SIGNED_OUT', null);
  });
};
const totalFromCalls = () => Object.values(fromCalls).reduce((a, b) => a + b, 0);

describe('useSupabaseData initial load is auth-gated', () => {
  beforeEach(() => {
    currentSession = null;
    authListener = null;
    for (const k of Object.keys(fromCalls)) delete fromCalls[k];
    for (const k of Object.keys(rowsByTable)) delete rowsByTable[k as TableName];
  });

  it('fires NO table read while signed out (login screen)', async () => {
    renderHook(useSupabaseData, undefined);
    await flush();
    assert.equal(totalFromCalls(), 0, 'no business-table read may fire without a session');
  });

  it('fetches on SIGNED_IN after a fresh login', async () => {
    const r = renderHook(useSupabaseData, undefined);
    await flush();
    assert.equal(fromCalls.students ?? 0, 0);
    emitSignedIn();
    await flush();
    assert.equal(fromCalls.students, 1, 'SIGNED_IN must trigger the full fetch');
    assert.equal(fromCalls.parents, 1);
    assert.equal(fromCalls.payments, 1);
    assert.equal(r.api.current?.loading, false, 'fetch completed → loading cleared');
    r.unmount();
  });

  it('fetches at mount when a session already exists (refresh with tab session)', async () => {
    currentSession = { user: { id: 'u1' } };
    const r = renderHook(useSupabaseData, undefined);
    await flush();
    assert.equal(fromCalls.students, 1, 'existing session at mount must fetch without SIGNED_IN');
    assert.equal(r.api.current?.loading, false);
    r.unmount();
  });

  it('clears the loaded rows on SIGNED_OUT (shared computer) without a refetch', async () => {
    rowsByTable.students = [{ id: 's1', name: 'Ada' }];
    currentSession = { user: { id: 'u1' } };
    const r = renderHook(useSupabaseData, undefined);
    await flush();
    assert.equal(r.api.current?.students.length, 1, 'fetch populated the rows');
    const callsAfterLoad = totalFromCalls();
    emitSignedOut();
    await flush();
    assert.equal(r.api.current?.students.length, 0, 'SIGNED_OUT must clear the domain rows');
    assert.equal(totalFromCalls(), callsAfterLoad, 'sign-out itself must not read tables');
    r.unmount();
  });
});

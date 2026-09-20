/**
 * Offline data path of useSupabaseData.
 *
 * Three properties decide whether a station can actually WORK without a
 * network, and each is asserted here:
 *
 *   1. an offline session (or no network at all) fires NO table read — the
 *      screen is served from the snapshot this station kept, not from a
 *      database it cannot reach;
 *   2. a successful load WRITES that snapshot, per account;
 *   3. a state that was never loaded (login screen, or a load that failed)
 *      never overwrites a good snapshot with emptiness — the failure mode that
 *      would leave the station with nothing exactly when it needs it most.
 */
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { act } from 'react';
import { installDomGlobals, renderHook } from './harness';
import { mockModule } from './module-mock';

const win = installDomGlobals();

// ── fake supabase client ─────────────────────────────────────────────────────
const readTables: string[] = [];
let currentSession: { user: { id: string } } | null = null;

const rowsByTable: Record<string, Record<string, unknown>[]> = {
  students: [{ id: 's1', name: 'Sidi COULIBALY', total_due: 90000, amount_paid: 0 }],
};

const fakeSupabase = {
  auth: {
    getSession: async () => ({ data: { session: currentSession }, error: null }),
    getUser: async () => ({ data: { user: null }, error: null }),
    onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }),
    signOut: async () => ({ error: null }),
    refreshSession: async () => ({ data: { session: null }, error: null }),
  },
  from: (table: string) => {
    readTables.push(table);
    return {
      select: () => ({
        order: async () => ({ data: rowsByTable[table] ?? [], error: null }),
      }),
    };
  },
  rpc: async () => ({ data: null, error: null }),
};

mockModule('../src/lib/supabaseClient', { supabase: fakeSupabase });

const { useSupabaseData } = await import('../src/lib/useSupabaseData');
const { loadOfflineSnapshot, saveOfflineSnapshot } = await import('../src/lib/offlineSnapshot');
type SupabaseDataOptions = import('../src/lib/useSupabaseData').SupabaseDataOptions;
type SnapshotData = import('../src/lib/offlineSnapshot').OfflineSnapshotData;

// ── helpers ──────────────────────────────────────────────────────────────────
let hookOptions: SupabaseDataOptions = {};
/** The hook under test, with the options of the current case. */
const useDataUnderTest = () => useSupabaseData(undefined, hookOptions);

const flush = async () => {
  for (let i = 0; i < 10; i++) {
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
  }
};

const cachedStudent = (name: string, id = 's-local') => ({
  id,
  name,
  parentName: 'Parent',
  parentEmail: '',
  parentPhone: '83040998',
  totalDue: 90000,
  amountPaid: 0,
  dueDate: '2026-09-30',
  payments: [],
  notes: '',
});

function dataset(students: SnapshotData['students'] = [cachedStudent('Sidi COULIBALY')]): SnapshotData {
  return {
    parents: [], students, staff: [], salaryPayments: [], expenses: [], vendorExpenses: [], todos: [], customClasses: [],
  };
}

/** Set the browser's connectivity for the length of one case. */
function setOnline(value: boolean) {
  Object.defineProperty(win.navigator, 'onLine', { value, configurable: true });
}

describe('useSupabaseData — le poste hors ligne travaille sur ses données', () => {
  const realOnLine = win.navigator.onLine;

  beforeEach(() => {
    setOnline(true);
    currentSession = null;
    readTables.length = 0;
    localStorage.clear();
    hookOptions = {};
  });

  it('session hors ligne : sert l’instantané du poste sans toucher à la base', async () => {
    saveOfflineSnapshot('u1', dataset([cachedStudent('Sidi COULIBALY')]));
    saveOfflineSnapshot('u2', dataset([cachedStudent('Autre Élève', 's-other')]));
    hookOptions = { userId: 'u1', offlineSession: true };

    const r = renderHook(useDataUnderTest, undefined);
    await flush();

    assert.deepEqual(readTables, [], 'aucune lecture réseau : la session n’a pas de jeton');
    assert.equal(r.api.current?.loading, false);
    assert.equal(r.api.current?.students[0]?.name, 'Sidi COULIBALY', 'l’école s’affiche depuis l’instantané');
    assert.ok(r.api.current?.cacheSavedAt, 'le bandeau peut dire d’où viennent les données affichées');
    r.unmount();
  });

  it('sans réseau du tout : même chose, instantané compris', async () => {
    saveOfflineSnapshot('u1', dataset([cachedStudent('Sidibé')]));
    setOnline(false);
    hookOptions = { userId: 'u1' };
    currentSession = { user: { id: 'u1' } };

    const r = renderHook(useDataUnderTest, undefined);
    await flush();

    assert.deepEqual(readTables, [], 'inutile de tenter la base sans réseau');
    assert.equal(r.api.current?.students[0]?.name, 'Sidibé');
    r.unmount();
    setOnline(realOnLine);
  });

  it('en ligne : écrit l’instantané du compte connecté après un chargement réussi', async () => {
    currentSession = { user: { id: 'u1' } };
    hookOptions = { userId: 'u1' };

    const r = renderHook(useDataUnderTest, undefined);
    await flush();

    assert.ok(readTables.includes('students'), 'le chargement réel a bien eu lieu');
    const saved = await waitForSnapshot('u1');
    assert.equal(saved.data.students[0].name, 'Sidi COULIBALY');
    assert.ok(!loadOfflineSnapshot('u2'), 'l’instantané ne vaut que pour son compte');
    r.unmount();
  });

  it('un état JAMAIS chargé (écran de connexion) ne remplace pas un bon instantané', async () => {
    const savedAt = saveOfflineSnapshot('u1', dataset([cachedStudent('Sidi COULIBALY')]));
    hookOptions = { userId: 'u1' }; // pas de session : rien ne sera chargé

    const r = renderHook(useDataUnderTest, undefined);
    await flush();

    assert.deepEqual(readTables, []);
    assert.equal(r.api.current?.students.length, 0, 'aucune donnée en mémoire');
    const after = loadOfflineSnapshot('u1');
    assert.ok(after, 'l’instantané du poste est toujours là');
    assert.equal(after.savedAt, savedAt, 'et il n’a pas été réécrit avec du vide');
    r.unmount();
  });
});

/** The snapshot is written on a debounce — wait for the write, not a fixed time. */
async function waitForSnapshot(userId: string, timeoutMs = 4000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const snapshot = loadOfflineSnapshot(userId);
    if (snapshot) return snapshot;
    await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
  }
  assert.fail(`instantané jamais écrit pour ${userId}`);
}

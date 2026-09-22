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

type WriteResult = { data: Record<string, unknown>[] | null; error: { message: string } | null };

/** Écritures acceptées : la file doit pouvoir se vider POUR DE VRAI. */
const insertedRows: { table: string; row: Record<string, unknown> }[] = [];

/**
 * Builder thenable, comme celui de Supabase : lecture ET écriture.
 *
 * `data` est un TABLEAU : les rejeux qui mettent à jour ou suppriment lisent
 * « zéro ligne » comme un refus (une écriture filtrée par la policy répond 200
 * avec un corps vide), donc un faux client doit pouvoir distinguer les deux.
 */
interface FakeBuilder extends Promise<WriteResult> {
  insert(row?: unknown): Promise<WriteResult>;
  update(): FakeBuilder;
  delete(): FakeBuilder;
  eq(): FakeBuilder;
  neq(): FakeBuilder;
  select(): FakeBuilder;
  single(): Promise<{ data: Record<string, unknown> | null; error: null }>;
  order(): Promise<WriteResult>;
  limit(): Promise<WriteResult>;
}

function builder(table: string, result: WriteResult): FakeBuilder {
  const read: WriteResult = { data: rowsByTable[table] ?? [], error: null };
  const touched: WriteResult = { data: [{ id: 'fake-row' }], error: null };
  return Object.assign(Promise.resolve(result), {
    insert: async (row?: unknown) => {
      if (row) insertedRows.push({ table, row: row as Record<string, unknown> });
      return { data: null, error: null } as WriteResult;
    },
    update: () => builder(table, touched),
    delete: () => builder(table, touched),
    eq: () => builder(table, result),
    neq: () => builder(table, result),
    select: () => builder(table, result),
    single: async () => ({ data: (result.data ?? [])[0] ?? null, error: null }),
    order: async () => read,
    limit: async () => read,
  }) as FakeBuilder;
}

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
    return builder(table, { data: [{ id: 'fake-row' }], error: null });
  },
  rpc: async () => ({ data: null, error: null }),
};

mockModule('../src/lib/supabaseClient', { supabase: fakeSupabase });

const { useSupabaseData } = await import('../src/lib/useSupabaseData');
const { loadOfflineSnapshot, saveOfflineSnapshot } = await import('../src/lib/offlineSnapshot');
const { enqueueOfflineAction, getOfflineQueue, clearOfflineQueue } = await import('../src/lib/offlineQueue');
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
    insertedRows.length = 0;
    localStorage.clear();
    clearOfflineQueue();
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

  // ── Le retour de la ligne : la file part toute seule ─────────────────────
  //
  // WHY THIS EXISTS
  // ---------------
  // L'événement « online » ne peut PAS être le déclencheur, pour une raison
  // d'ORDRE : il part avant que le mot de passe gardé en mémoire soit rejoué,
  // donc avant qu'un jeton existe. `syncOfflineQueue` le voit, s'arrête (à juste
  // titre : sans jeton, l'envoi ne produirait qu'un refus de policy et des
  // saisies valides seraient marquées « refusées »), et plus rien ne repassait —
  // la connexion silencieuse réussie ne redéclenche ni l'événement ni un
  // drainage. La saisie de la journée restait dans la file jusqu'au prochain
  // démarrage. L'observation juste est la TRANSITION de la session.
  it('le retour de la ligne vide la file tout seul : la saisie hors ligne part sans redémarrer', async () => {
    saveOfflineSnapshot('u1', dataset());
    // Ce que l'utilisateur a fait sans réseau.
    enqueueOfflineAction('addTodo', { text: 'Appeler le parent', completed: false });
    assert.equal(getOfflineQueue().length, 1);

    // Il travaille hors ligne : session sans jeton.
    hookOptions = { userId: 'u1', offlineSession: true };
    const r = renderHook(useDataUnderTest, undefined);
    await flush();
    assert.equal(getOfflineQueue().length, 1, 'rien ne part tant qu’il n’y a pas de jeton');

    // La reconnexion silencieuse a réussi : la session hors ligne se referme.
    // L'événement « online », lui, est déjà passé et a été vu sans jeton.
    hookOptions = { userId: 'u1', offlineSession: false };
    await act(async () => { r.rerender(undefined); });
    await flush();

    assert.equal(getOfflineQueue().length, 0, 'la file doit être vidée quand la ligne revient');
    assert.ok(
      insertedRows.some((w) => w.table === 'todos'),
      'la saisie doit avoir réellement atteint la base',
    );
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

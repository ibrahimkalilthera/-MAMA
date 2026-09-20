// Offline dataset snapshot — persistence against a real localStorage
// (happy-dom), which is the point of the module: the station must find its data
// again after a restart.
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { installDomGlobals } from './harness';

installDomGlobals();

const {
  MAX_SNAPSHOT_CHARS,
  OFFLINE_SNAPSHOT_VERSION,
  clearOfflineSnapshot,
  loadOfflineSnapshot,
  offlineSnapshotKey,
  saveOfflineSnapshot,
} = await import('../src/lib/offlineSnapshot');
type SnapshotData = import('../src/lib/offlineSnapshot').OfflineSnapshotData;

// ─── Fixtures ────────────────────────────────────────────────────────────────

const student = (over: Partial<SnapshotData['students'][number]> = {}): SnapshotData['students'][number] => ({
  id: 's-1',
  name: 'Sidi COULIBALY',
  parentName: 'Cheick Tahirou COULIBALY',
  parentEmail: '',
  parentPhone: '83040998',
  totalDue: 90000,
  amountPaid: 0,
  dueDate: '2026-09-30',
  payments: [],
  notes: '',
  grade: '9B',
  academicYear: '2026-2027',
  ...over,
});

function dataset(over: Partial<SnapshotData> = {}): SnapshotData {
  return {
    parents: [],
    students: [student()],
    staff: [],
    salaryPayments: [],
    expenses: [],
    vendorExpenses: [],
    todos: [],
    customClasses: [],
    ...over,
  };
}

beforeEach(() => {
  localStorage.clear();
});

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('offline snapshot (the dataset this station last received)', () => {
  it('round-trips a dataset through localStorage', () => {
    const savedAt = saveOfflineSnapshot('user-1', dataset());
    assert.ok(savedAt, 'the save must report its time');

    const snapshot = loadOfflineSnapshot('user-1');
    assert.ok(snapshot);
    assert.equal(snapshot.version, OFFLINE_SNAPSHOT_VERSION);
    assert.equal(snapshot.userId, 'user-1');
    assert.equal(snapshot.savedAt, savedAt);
    assert.equal(snapshot.data.students[0].name, 'Sidi COULIBALY');
    assert.equal(snapshot.data.students[0].totalDue, 90000);
  });

  it('keeps one snapshot PER ACCOUNT — a shared computer never leaks the previous one', () => {
    saveOfflineSnapshot('user-1', dataset());
    saveOfflineSnapshot('user-2', dataset({ students: [student({ id: 's-2', name: 'Autre Élève' })] }));

    assert.equal(loadOfflineSnapshot('user-1')?.data.students[0].name, 'Sidi COULIBALY');
    assert.equal(loadOfflineSnapshot('user-2')?.data.students[0].name, 'Autre Élève');

    clearOfflineSnapshot('user-1');
    assert.equal(loadOfflineSnapshot('user-1'), null);
    assert.ok(loadOfflineSnapshot('user-2'), 'clearing one account leaves the other alone');
  });

  it('ignores a snapshot written by another account under this key', () => {
    localStorage.setItem(
      offlineSnapshotKey('user-1'),
      JSON.stringify({ version: OFFLINE_SNAPSHOT_VERSION, userId: 'user-9', savedAt: 'x', data: dataset() }),
    );
    assert.equal(loadOfflineSnapshot('user-1'), null);
  });

  it('ignores a snapshot from another shape version (a migrated station reloads)', () => {
    localStorage.setItem(
      offlineSnapshotKey('user-1'),
      JSON.stringify({ version: OFFLINE_SNAPSHOT_VERSION + 1, userId: 'user-1', savedAt: 'x', data: dataset() }),
    );
    assert.equal(loadOfflineSnapshot('user-1'), null);
  });

  it('survives corrupt storage instead of throwing', () => {
    localStorage.setItem(offlineSnapshotKey('user-1'), '{ truncated');
    assert.equal(loadOfflineSnapshot('user-1'), null);
    localStorage.setItem(offlineSnapshotKey('user-1'), '"a string, not a snapshot"');
    assert.equal(loadOfflineSnapshot('user-1'), null);
  });

  it('answers null for an unknown account, and for no account at all', () => {
    assert.equal(loadOfflineSnapshot('never-seen'), null);
    assert.equal(loadOfflineSnapshot(''), null);
    assert.equal(saveOfflineSnapshot('', dataset()), null);
  });

  it('refuses an oversized dataset rather than filling the whole localStorage quota', () => {
    const huge = dataset({ students: [student({ notes: 'x'.repeat(MAX_SNAPSHOT_CHARS) })] });
    const realWarn = console.warn;
    console.warn = () => {};
    try {
      assert.equal(saveOfflineSnapshot('user-1', huge), null);
      assert.equal(loadOfflineSnapshot('user-1'), null);
    } finally {
      console.warn = realWarn;
    }

    // …and the station keeps the dataset it already had.
    const first = saveOfflineSnapshot('user-1', dataset());
    assert.ok(first);
    console.warn = () => {};
    try {
      assert.equal(saveOfflineSnapshot('user-1', huge), null);
    } finally {
      console.warn = realWarn;
    }
    assert.equal(loadOfflineSnapshot('user-1')?.savedAt, first, 'the previous snapshot is intact');
  });

  it('writes the payload under the documented versioned key', () => {
    saveOfflineSnapshot('user-1', dataset());
    const raw = localStorage.getItem('mama_thera_offline_snapshot_v1:user-1');
    assert.ok(raw, 'the key is versioned so a shape change cannot be read as the new one');
    assert.equal(JSON.parse(raw).version, OFFLINE_SNAPSHOT_VERSION);
  });
});

/**
 * Unit tests for the full backup/restore feature (src/lib/backup.ts +
 * src/app/useBackup.ts).
 *
 * Two layers:
 *  1. PURE LIB (no DOM, no supabase mock): an in-memory BackupDb fake drives
 *     export → JSON round-trip → validation → restore; the whitelist, the
 *     version gate and row-count reporting are locked here.
 *  2. HOOK (happy-dom + renderHook, supabase client mocked): role gating,
 *     toast feedback, audit-log events (EXPORT_BACKUP / RESTORE_BACKUP) and
 *     the restore flow through a synthetic file event.
 */
import { describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';
import { act } from 'react';

import type { BackupDb } from '../src/lib/backup';
import {
  BACKUP_SCHEMA_VERSION,
  BACKUP_TABLES,
  backupFileName,
  exportBackup,
  parseBackupFile,
  restoreBackup,
  validateSnapshot,
} from '../src/lib/backup';

// ── module mock: supabase client + audit logger (before importing the hook) ─
interface AuditCall {
  action: string;
  targetType?: string;
  targetId?: string | null;
  details?: string;
  user?: unknown;
}
const auditCalls: AuditCall[] = [];
let restoreShouldFail = false;

mock.module('../src/lib/supabaseClient', {
  namedExports: {
    supabase: {
      from: (table: string) => {
        const chain = {
          select: () => Promise.resolve({ data: [], error: null }),
          upsert: () =>
            Promise.resolve(
              restoreShouldFail
                ? { data: null, error: { message: 'RLS violation' } }
                : { data: null, error: null },
            ),
        };
        void table;
        return chain;
      },
    },
  },
});

mock.module('../src/lib/auditLogger', {
  namedExports: {
    logAuditEvent: (entry: AuditCall) => {
      auditCalls.push(entry);
      return Promise.resolve(true);
    },
  },
});

const { useBackup } = await import('../src/app/useBackup');

// ── in-memory BackupDb fake (pure lib layer) ─────────────────────────────────

interface MemoryDbState {
  tables: Record<string, Record<string, unknown>[]>;
  reads: string[];
  upserts: Array<{ table: string; rows: Record<string, unknown>[] }>;
  failOn?: string;
}

function makeMemoryDb(initial: Record<string, Record<string, unknown>[]> = {}): {
  db: BackupDb;
  state: MemoryDbState;
} {
  const state: MemoryDbState = { tables: { ...initial }, reads: [], upserts: [] };
  const db = {
    from: (table: string) => ({
      select: () => {
        state.reads.push(table);
        return Promise.resolve({ data: state.tables[table] ?? [], error: null });
      },
      upsert: (rows: Record<string, unknown>[]) => {
        if (state.failOn === table) {
          return Promise.resolve({ data: null, error: { message: `upsert failed for ${table}` } });
        }
        state.upserts.push({ table, rows: [...rows] });
        state.tables[table] = rows.map((r) => ({ ...r }));
        return Promise.resolve({ data: null, error: null });
      },
    }),
  } as unknown as BackupDb;
  return { db, state };
}

const parent = { id: 'p1', full_name: 'M. Diallo', phones: ['+223'], address: 'Bamako', occupation: '', relationship: 'father' };
const student = { id: 's1', parent_id: 'p1', name: 'Ali Diallo', parent_phone: '+223', total_due: 150000, amount_paid: 50000 };
const payment = { id: 'y1', student_id: 's1', amount: 50000, date: '2026-09-01' };

describe('backup — export', () => {
  it('reads every whitelisted table in dependency order', async () => {
    const { db, state } = makeMemoryDb({ parents: [parent] });
    const snapshot = await exportBackup(db, 'awa@x.org');

    assert.deepEqual(state.reads, [...BACKUP_TABLES], 'reads follow BACKUP_TABLES order');
    assert.deepEqual(snapshot.tables.parents, [parent]);
    assert.equal(snapshot.app, 'mama-thera-finance');
    assert.equal(snapshot.schemaVersion, BACKUP_SCHEMA_VERSION);
    assert.equal(snapshot.exportedBy, 'awa@x.org');
    assert.ok(!Number.isNaN(Date.parse(snapshot.exportedAt)));
  });

  it('produces a JSON round-trip that validates and restores identically', async () => {
    const { db, state } = makeMemoryDb({
      parents: [parent],
      students: [student],
      payments: [payment],
    });
    const snapshot = await exportBackup(db, null);
    const text = JSON.stringify(snapshot, null, 2);
    const parsed: unknown = JSON.parse(text);

    const validation = validateSnapshot(parsed);
    assert.equal(validation.valid, true, `expected valid: ${validation.errors.join('; ')}`);
    assert.equal(validation.counts.parents, 1);
    assert.equal(validation.counts.students, 1);
    assert.equal(validation.counts.payments, 1);

    const fresh = makeMemoryDb();
    const result = await restoreBackup(fresh.db, parsed as Parameters<typeof restoreBackup>[1]);
    assert.equal(result.ok, true);
    assert.deepEqual(fresh.state.tables.students, [student], 'student row round-trips byte-faithful');
    assert.deepEqual(fresh.state.tables.parents, [parent]);
  });

  it('generates a dated file name', () => {
    assert.equal(backupFileName(new Date('2026-09-04T12:00:00Z')), 'mama-thera-backup-2026-09-04.json');
  });
});

describe('backup — validation gates', () => {
  it('rejects unknown tables (tampering or a future format)', () => {
    const v = validateSnapshot({
      app: 'mama-thera-finance',
      schemaVersion: BACKUP_SCHEMA_VERSION,
      exportedAt: new Date().toISOString(),
      tables: { parents: [], users: [{ id: 'u1' }], evil_table: [{}] },
    });
    assert.equal(v.valid, false);
    assert.ok(v.errors.some((e) => e.includes('users')));
    assert.ok(v.errors.some((e) => e.includes('evil_table')));
    assert.equal(v.counts.parents, 0, 'known tables still counted');
  });

  it('rejects a newer schemaVersion but accepts an older one', () => {
    const header = { app: 'mama-thera-finance', exportedAt: new Date().toISOString() };
    const newer = validateSnapshot({ ...header, schemaVersion: BACKUP_SCHEMA_VERSION + 1, tables: {} });
    assert.equal(newer.valid, false);
    assert.ok(newer.errors.some((e) => e.includes('newer')));

    const older = validateSnapshot({ ...header, schemaVersion: BACKUP_SCHEMA_VERSION - 1, tables: {} });
    assert.equal(older.valid, true, 'older snapshots restore forward');
  });

  it('rejects a wrong app marker, missing header fields and non-object rows', () => {
    const bad = validateSnapshot({ app: 'something-else', schemaVersion: 1, exportedAt: 'nope', tables: {} });
    assert.equal(bad.valid, false);
    assert.ok(bad.errors.some((e) => e.includes('app')));
    assert.ok(bad.errors.some((e) => e.includes('exportedAt')));

    assert.equal(validateSnapshot(null).valid, false);
    assert.equal(validateSnapshot([1, 2]).valid, false);
    assert.equal(validateSnapshot({ app: 'mama-thera-finance', schemaVersion: 1, exportedAt: new Date().toISOString(), tables: [] }).valid, false);

    const badRows = validateSnapshot({
      app: 'mama-thera-finance',
      schemaVersion: 1,
      exportedAt: new Date().toISOString(),
      tables: { parents: 'not-an-array', students: [[1, 2]] },
    });
    assert.equal(badRows.valid, false);
    assert.ok(badRows.errors.some((e) => e.includes('must be an array')));
    assert.ok(badRows.errors.some((e) => e.includes('row 0')));
  });

  it('never touches auth.users or user_profiles through the whitelist', () => {
    assert.ok(!BACKUP_TABLES.includes('user_profiles' as never), 'user_profiles excluded');
    assert.ok(!BACKUP_TABLES.includes('auth.users' as never));
    assert.ok(BACKUP_TABLES.includes('audit_logs'), 'audit_logs included (fidelity over log integrity)');
  });
});

describe('backup — restore', () => {
  it('upserts with explicit ids and reports per-table row counts', async () => {
    const { db, state } = makeMemoryDb();
    const snapshot = {
      app: 'mama-thera-finance' as const,
      schemaVersion: BACKUP_SCHEMA_VERSION,
      exportedAt: new Date().toISOString(),
      exportedBy: null,
      tables: { parents: [parent], students: [student, { ...student, id: 's2' }] } as Record<string, Record<string, unknown>[]>,
    };
    const result = await restoreBackup(db, snapshot);
    assert.equal(result.ok, true);
    assert.equal(result.counts.parents, 1);
    assert.equal(result.counts.students, 2);
    assert.ok(state.upserts.every((u) => u.rows.every((r) => typeof r.id === 'string')), 'every upserted row carries an explicit id');
  });

  it('refuses a structurally invalid snapshot without touching the db', async () => {
    const { db, state } = makeMemoryDb();
    const snapshot = {
      app: 'mama-thera-finance' as const,
      schemaVersion: 999,
      exportedAt: new Date().toISOString(),
      exportedBy: null,
      tables: {},
    };
    const result = await restoreBackup(db, snapshot as unknown as Parameters<typeof restoreBackup>[1]);
    assert.equal(result.ok, false);
    assert.deepEqual(state.upserts, [], 'no write attempted');
    assert.ok(result.error && result.error.includes('newer'));
  });

  it('stops at the first failing table and reports it', async () => {
    const { db, state } = makeMemoryDb();
    state.failOn = 'students';
    const snapshot = {
      app: 'mama-thera-finance' as const,
      schemaVersion: BACKUP_SCHEMA_VERSION,
      exportedAt: new Date().toISOString(),
      exportedBy: null,
      tables: { parents: [parent], students: [student], payments: [payment] } as Record<string, Record<string, unknown>[]>,
    };
    const result = await restoreBackup(db, snapshot);
    assert.equal(result.ok, false);
    assert.ok(result.error && result.error.includes('students'));
    assert.equal(result.counts.parents, 1, 'parents (before the failure) written');
    assert.equal(result.counts.payments, undefined, 'payments (after the failure) untouched');
  });
});

describe('backup — file parsing', () => {
  it('parses a valid file and rejects broken JSON with errors (never throws)', async () => {
    const good = new File([JSON.stringify({
      app: 'mama-thera-finance',
      schemaVersion: BACKUP_SCHEMA_VERSION,
      exportedAt: new Date().toISOString(),
      tables: {},
    })], 'backup.json');
    const ok = await parseBackupFile(good);
    assert.ok('snapshot' in ok);

    const badJson = new File(['{not json'], 'backup.json');
    const bad = await parseBackupFile(badJson);
    assert.ok('errors' in bad);
    assert.ok(bad.errors[0].includes('JSON'));
  });
});

// ── hook layer (useBackup with the mocked supabase + audit logger) ───────────

const win = (await import('./harness')).installDomGlobals();
const { renderHook } = await import('./harness');
const { translations } = await import('../src/i18n/translations');
import type { TranslationDict } from '../src/i18n/translations';
import type { UserProfile as Profile } from '../src/lib/useAuth';
const t = translations.fr as TranslationDict;

interface ToastCapture {
  toasts: Array<{ kind: 'success' | 'error'; msg: string }>;
}
function render(profile: Profile | null, isAdmin: boolean) {
  const capture: ToastCapture = { toasts: [] };
  const { api, unmount } = renderHook(useBackup, {
    t,
    profile,
    isAdmin,
    toast: {
      success: (msg: string): string => { capture.toasts.push({ kind: 'success' as const, msg }); return msg; },
      error: (msg: string): string => { capture.toasts.push({ kind: 'error' as const, msg }); return msg; },
    },
  });
  return { api, unmount, capture };
}

const admin: Profile = { id: 'u1', email: 'awa@x.org', fullName: 'Awa Ndiaye', role: 'admin' };
const staffProfile: Profile = { id: 'u2', email: 'sekou@x.org', fullName: 'Sékou', role: 'staff' };

describe('useBackup — role gate', () => {
  it('blocks export and restore-picker for a non-admin with an error toast', async () => {
    auditCalls.length = 0;
    const { api, unmount, capture } = render(staffProfile, false);

    await act(async () => {
      await api.current!.handleExportBackup();
    });
    assert.equal(capture.toasts.length, 1);
    assert.equal(capture.toasts[0].kind, 'error');
    assert.equal(auditCalls.length, 0, 'no audit entry for a blocked export');

    act(() => {
      api.current!.openRestorePicker();
    });
    assert.equal(auditCalls.length, 0);
    unmount();
  });

  it('exports a snapshot, toasts success and logs EXPORT_BACKUP', async () => {
    auditCalls.length = 0;
    const { api, unmount, capture } = render(admin, true);

    await act(async () => {
      await api.current!.handleExportBackup();
    });
    assert.ok(capture.toasts.some((x) => x.kind === 'success'));
    assert.equal(auditCalls.length, 1);
    assert.equal(auditCalls[0].action, 'EXPORT_BACKUP');
    assert.equal(auditCalls[0].targetType, 'database');
    assert.deepEqual(auditCalls[0].user, {
      id: admin.id, email: admin.email, full_name: admin.fullName, role: admin.role,
    });
    unmount();
  });

  it('restores a picked file after confirmation, toasts and logs RESTORE_BACKUP', async () => {
    auditCalls.length = 0;
    restoreShouldFail = false;
    const { api, unmount, capture } = render(admin, true);

    const payload = JSON.stringify({
      app: 'mama-thera-finance',
      schemaVersion: BACKUP_SCHEMA_VERSION,
      exportedAt: new Date().toISOString(),
      tables: { parents: [parent] },
    });
    const file = new win.File([payload], 'backup.json');
    const input = win.document.createElement('input');
    Object.defineProperty(input, 'files', { value: [file], configurable: true });
    const fakeEvent = { currentTarget: input } as unknown as Parameters<
      ReturnType<typeof useBackup>['handleRestoreFileSelected']
    >[0];

    await act(async () => {
      await api.current!.handleRestoreFileSelected(fakeEvent, true);
    });
    assert.ok(capture.toasts.some((x) => x.kind === 'success' && x.msg.includes('1')), 'toast names the record count');
    assert.equal(auditCalls.length, 1);
    assert.equal(auditCalls[0].action, 'RESTORE_BACKUP');
    const details = JSON.parse(auditCalls[0].details ?? '{}');
    assert.equal(details.counts.parents, 1);
    unmount();
  });

  it('refuses to restore when confirmed=false (belt-and-braces gate)', async () => {
    auditCalls.length = 0;
    const { api, unmount } = render(admin, true);

    const file = new win.File(['{}'], 'backup.json');
    const input = win.document.createElement('input');
    Object.defineProperty(input, 'files', { value: [file], configurable: true });
    const fakeEvent = { currentTarget: input } as unknown as Parameters<
      ReturnType<typeof useBackup>['handleRestoreFileSelected']
    >[0];

    await act(async () => {
      await api.current!.handleRestoreFileSelected(fakeEvent, false);
    });
    assert.equal(auditCalls.length, 0, 'nothing ran without the confirmation flag');
    unmount();
  });

  it('surfaces validation errors from a tampered file and logs nothing', async () => {
    auditCalls.length = 0;
    const { api, unmount, capture } = render(admin, true);

    const payload = JSON.stringify({
      app: 'mama-thera-finance',
      schemaVersion: BACKUP_SCHEMA_VERSION,
      exportedAt: new Date().toISOString(),
      tables: { not_in_whitelist: [{}] },
    });
    const file = new win.File([payload], 'backup.json');
    const input = win.document.createElement('input');
    Object.defineProperty(input, 'files', { value: [file], configurable: true });
    const fakeEvent = { currentTarget: input } as unknown as Parameters<
      ReturnType<typeof useBackup>['handleRestoreFileSelected']
    >[0];

    await act(async () => {
      await api.current!.handleRestoreFileSelected(fakeEvent, true);
    });
    assert.ok(capture.toasts.some((x) => x.kind === 'error'), 'validation errors surfaced as a toast');
    assert.equal(auditCalls.length, 0, 'a rejected restore is not audited as a restore');
    unmount();
  });

  it('toasts a failure when the restore write fails', async () => {
    auditCalls.length = 0;
    restoreShouldFail = true;
    const { api, unmount, capture } = render(admin, true);

    const payload = JSON.stringify({
      app: 'mama-thera-finance',
      schemaVersion: BACKUP_SCHEMA_VERSION,
      exportedAt: new Date().toISOString(),
      tables: { parents: [parent] },
    });
    const file = new win.File([payload], 'backup.json');
    const input = win.document.createElement('input');
    Object.defineProperty(input, 'files', { value: [file], configurable: true });
    const fakeEvent = { currentTarget: input } as unknown as Parameters<
      ReturnType<typeof useBackup>['handleRestoreFileSelected']
    >[0];

    await act(async () => {
      await api.current!.handleRestoreFileSelected(fakeEvent, true);
    });
    assert.ok(capture.toasts.some((x) => x.kind === 'error' && x.msg.includes('RLS')), 'server error surfaced');
    assert.equal(auditCalls.length, 0, 'a failed restore is not logged as RESTORE_BACKUP');
    restoreShouldFail = false;
    unmount();
  });
});

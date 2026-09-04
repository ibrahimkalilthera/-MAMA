/**
 * Full DB backup & restore — versioned JSON snapshots.
 *
 * One-click "download the entire database" (Settings, admin/dev only) plus a
 * restore wizard that validates the payload before touching a single row.
 * The Excel workbook export (useExports) stays the human-readable report;
 * THIS is the machine-fidelity backup: every whitelisted table, every column,
 * explicit ids, restorable via upsert.
 *
 * Safety rails (locked by tests/backup.test.ts):
 *  - a strict table whitelist — unknown tables are refused, `auth.users` and
 *    secrets never enter a snapshot;
 *  - the snapshot header (schemaVersion/exportedAt/app) is validated on
 *    restore — a wrong schema version is rejected loudly;
 *  - restore upserts with EXPLICIT ids (idempotent, preserves relations);
 *  - the caller gates restore behind a typed confirmation and audit-logs both
 *    operations (EXPORT_BACKUP / RESTORE_BACKUP).
 *
 * Pure module: the Supabase surface is abstracted behind `BackupDb`
 * (`from(table).select()` / `from(table).upsert(rows)`), so the whole flow is
 * unit-testable with an in-memory fake.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from './database.types';

/** The surface of the Supabase client that backup/restore touches. */
export type BackupDb = Pick<SupabaseClient<Database>, 'from'>;

/** Bump when the whitelisted table set or the payload shape changes. */
export const BACKUP_SCHEMA_VERSION = 1;

/** Marker string the typed-confirmation input must match exactly. */
export const RESTORE_CONFIRM_WORD = 'RESTAURER';

/** Header prepended to every snapshot; validated on restore. */
export interface BackupHeader {
  app: 'mama-thera-finance';
  schemaVersion: number;
  exportedAt: string;
  exportedBy: string | null;
}

/** A versioned, per-table JSON snapshot of the whole database. */
export interface BackupSnapshot extends BackupHeader {
  tables: Record<string, Record<string, unknown>[]>;
}

/**
 * The tables a snapshot covers — the app's data domain, in dependency order
 * (parents before students before payments). Deliberately EXCLUDED:
 *  - `user_profiles`: roles are identity data; restoring them could lock the
 *    team out (documented decision — re-add only with a dedicated policy);
 *  - anything under `auth.` (never readable through the anon client anyway).
 * `audit_logs` IS included: fidelity over log integrity — the restore event
 * itself is appended on top of the restored history.
 */
export const BACKUP_TABLES = [
  'app_settings',
  'academic_years',
  'custom_classes',
  'parents',
  'students',
  'payments',
  'staff',
  'salary_payments',
  'expenses',
  'vendor_expenses',
  'todos',
  'calendar_notes',
  'audit_logs',
] as const;

export type BackupTable = (typeof BACKUP_TABLES)[number];

const TABLE_SET: ReadonlySet<string> = new Set<string>(BACKUP_TABLES);

export const isBackupTable = (name: string): name is BackupTable =>
  TABLE_SET.has(name);

// ─── Export ──────────────────────────────────────────────────────────────────

/** Read every whitelisted table (dependency order) into a snapshot object. */
export async function exportBackup(
  db: BackupDb,
  exportedBy: string | null,
): Promise<BackupSnapshot> {
  const tables: Record<string, Record<string, unknown>[]> = {};
  for (const table of BACKUP_TABLES) {
    const { data, error } = await db.from(table).select('*');
    if (error) throw new Error(`backup: read failed for ${table}: ${error.message}`);
    tables[table] = (data ?? []) as Record<string, unknown>[];
  }
  return {
    app: 'mama-thera-finance',
    schemaVersion: BACKUP_SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    exportedBy,
    tables,
  };
}

/** Filename for a snapshot download: mama-thera-backup-YYYY-MM-DD.json */
export function backupFileName(now: Date = new Date()): string {
  const iso = now.toISOString().slice(0, 10);
  return `mama-thera-backup-${iso}.json`;
}

// ─── Validation ──────────────────────────────────────────────────────────────

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  /** Row counts per table for the confirm dialog / toast. */
  counts: Partial<Record<BackupTable, number>>;
}

/**
 * Structural validation of a parsed snapshot file. Rejects:
 *  - a non-object payload / missing or wrong header fields;
 *  - a schemaVersion newer than the app knows (older ones restore forward);
 *  - unknown table keys (typo, tampering, or a future format);
 *  - non-array table values; rows that are not plain objects.
 */
export function validateSnapshot(parsed: unknown): ValidationResult {
  const errors: string[] = [];
  const counts: Partial<Record<BackupTable, number>> = {};

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return { valid: false, errors: ['backup: payload is not a JSON object'], counts };
  }
  const obj = parsed as Record<string, unknown>;

  if (obj.app !== 'mama-thera-finance') {
    errors.push('backup: header.app must be "mama-thera-finance"');
  }
  if (typeof obj.schemaVersion !== 'number' || !Number.isFinite(obj.schemaVersion)) {
    errors.push('backup: header.schemaVersion must be a number');
  } else if (obj.schemaVersion > BACKUP_SCHEMA_VERSION) {
    errors.push(
      `backup: schemaVersion ${obj.schemaVersion} is newer than this app knows (${BACKUP_SCHEMA_VERSION}) — update the app first`,
    );
  }
  if (typeof obj.exportedAt !== 'string' || Number.isNaN(Date.parse(obj.exportedAt))) {
    errors.push('backup: header.exportedAt must be an ISO date string');
  }

  if (typeof obj.tables !== 'object' || obj.tables === null || Array.isArray(obj.tables)) {
    errors.push('backup: tables must be an object keyed by table name');
    return { valid: false, errors, counts };
  }

  for (const [name, rows] of Object.entries(obj.tables as Record<string, unknown>)) {
    if (!isBackupTable(name)) {
      errors.push(`backup: unknown table "${name}"`);
      continue;
    }
    if (!Array.isArray(rows)) {
      errors.push(`backup: table "${name}" must be an array of rows`);
      continue;
    }
    const badRow = rows.findIndex(
      (r) => typeof r !== 'object' || r === null || Array.isArray(r),
    );
    if (badRow >= 0) {
      errors.push(`backup: table "${name}" row ${badRow} is not an object`);
      continue;
    }
    counts[name] = rows.length;
  }

  return { valid: errors.length === 0, errors, counts };
}

// ─── Restore ─────────────────────────────────────────────────────────────────

export interface RestoreResult {
  ok: boolean;
  /** Rows upserted per table, in dependency order (only attempted tables). */
  counts: Partial<Record<BackupTable, number>>;
  error?: string;
}

/**
 * Upsert every table from a validated snapshot, in BACKUP_TABLES dependency
 * order, with explicit ids. Rows carry their original created_at/updated_at
 * columns — a restore is a time-faithful rewind, not a re-creation.
 */
export async function restoreBackup(
  db: BackupDb,
  snapshot: BackupSnapshot,
): Promise<RestoreResult> {
  const validation = validateSnapshot(snapshot);
  if (!validation.valid) {
    return { ok: false, counts: {}, error: validation.errors.join('; ') };
  }

  const counts: Partial<Record<BackupTable, number>> = {};
  for (const table of BACKUP_TABLES) {
    const rows = snapshot.tables[table];
    if (!rows || rows.length === 0) {
      counts[table] = 0;
      continue;
    }
    const { error } = await db
      .from(table)
      // Snapshot rows are read back verbatim from the same tables (select '*'),
      // so their shape matches the generated Insert types; the loose
      // Record<string, unknown> capture is bridged with a cast because a
      // per-table literal union is not expressible generically here.
      .upsert(rows as never, {
        onConflict: 'id',
      });
    if (error) {
      return {
        ok: false,
        counts,
        error: `restore failed at ${table}: ${error.message}`,
      };
    }
    counts[table] = rows.length;
  }
  return { ok: true, counts };
}

// ─── Parse helper (browser File → validated snapshot) ───────────────────────

/**
 * Read + JSON.parse + validate a user-selected backup file. Returns either
 * the parsed snapshot or the validation errors (never throws on bad JSON).
 */
export async function parseBackupFile(
  file: File,
): Promise<{ snapshot: BackupSnapshot } | { errors: string[] }> {
  let text: string;
  try {
    text = await file.text();
  } catch (err) {
    return { errors: [`backup: cannot read file: ${String(err)}`] };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { errors: ['backup: file is not valid JSON'] };
  }
  const validation = validateSnapshot(parsed);
  if (!validation.valid) return { errors: validation.errors };
  return { snapshot: parsed as BackupSnapshot };
}

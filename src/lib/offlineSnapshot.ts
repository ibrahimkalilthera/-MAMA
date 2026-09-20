import type { CustomClass, Expense, Parent, SalaryPayment, Staff, Student, Todo, VendorExpense } from './domainTypes';

/**
 * Offline data snapshot — the last dataset this station actually received.
 *
 * WHY THIS EXISTS
 * An offline sign-in opens the application, but the application itself reads
 * the database at startup: without a snapshot the school would be signed in
 * and looking at an empty school. This module keeps the last successfully
 * loaded dataset so a station that loses its line can keep WORKING on real
 * data instead of on nothing.
 *
 * Scope and rules:
 *   • one snapshot PER ACCOUNT (keyed by user id) — a shared computer must
 *     never show the previous account's data, exactly like the session;
 *   • written after a successful load and after every local change, so the
 *     snapshot always describes what the user last saw;
 *   • size-capped: past MAX_SNAPSHOT_CHARS the snapshot is skipped with a
 *     warning (and the previous one is kept) rather than blowing the quota and
 *     taking every other local state down with it;
 *   • reads never throw: a corrupt or absent snapshot simply means "no data
 *     from this station yet".
 */

/** Shape version — a mismatch is treated as "no snapshot". */
export const OFFLINE_SNAPSHOT_VERSION = 1;

/**
 * Ceiling on the serialized snapshot (~4 M characters, roughly 4 MB). Payments
 * and pupils grow year after year; past this size the station stops caching
 * instead of risking the whole localStorage quota.
 */
export const MAX_SNAPSHOT_CHARS = 4_000_000;

export interface OfflineSnapshotData {
  parents: Parent[];
  students: Student[];
  staff: Staff[];
  salaryPayments: SalaryPayment[];
  expenses: Expense[];
  vendorExpenses: VendorExpense[];
  todos: Todo[];
  customClasses: CustomClass[];
}

export interface OfflineSnapshot {
  version: number;
  userId: string;
  savedAt: string;
  data: OfflineSnapshotData;
}

export function offlineSnapshotKey(userId: string): string {
  return `mama_thera_offline_snapshot_v1:${userId}`;
}

/**
 * Persist the dataset. Returns the save time on success, null when it was
 * refused (no user id, too large, storage unavailable) — the caller only needs
 * to know whether a station would have data to fall back on.
 */
export function saveOfflineSnapshot(userId: string, data: OfflineSnapshotData): string | null {
  if (!userId) return null;
  const savedAt = new Date().toISOString();
  const payload: OfflineSnapshot = { version: OFFLINE_SNAPSHOT_VERSION, userId, savedAt, data };
  let serialized: string;
  try {
    serialized = JSON.stringify(payload);
  } catch (err) {
    console.warn('[MAMA THERA] Instantané hors ligne non sérialisable :', err);
    return null;
  }
  if (serialized.length > MAX_SNAPSHOT_CHARS) {
    console.warn(
      `[MAMA THERA] Instantané hors ligne ignoré : ${serialized.length} caractères > ${MAX_SNAPSHOT_CHARS}. ` +
      "L'instantané précédent est conservé ; l'application reste utilisable en ligne.",
    );
    return null;
  }
  try {
    localStorage.setItem(offlineSnapshotKey(userId), serialized);
    return savedAt;
  } catch (err) {
    console.warn('[MAMA THERA] Instantané hors ligne non enregistré :', err);
    return null;
  }
}

/** The snapshot stored for this account, or null (absent / corrupt / stale). */
export function loadOfflineSnapshot(userId: string): OfflineSnapshot | null {
  if (!userId) return null;
  if (typeof localStorage === 'undefined') return null;
  try {
    const raw = localStorage.getItem(offlineSnapshotKey(userId));
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    const snapshot = parsed as OfflineSnapshot;
    if (snapshot.version !== OFFLINE_SNAPSHOT_VERSION) return null;
    if (snapshot.userId !== userId) return null;
    if (!snapshot.data || typeof snapshot.data !== 'object') return null;
    return snapshot;
  } catch {
    return null;
  }
}

/** Forget this account's snapshot (sign-out, or a station being handed over). */
export function clearOfflineSnapshot(userId: string): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.removeItem(offlineSnapshotKey(userId));
  } catch {
    // nothing to clean
  }
}

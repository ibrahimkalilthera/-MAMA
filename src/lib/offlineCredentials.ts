/**
 * Offline sign-in — the verifier a station keeps so an account can be opened
 * without any network.
 *
 * WHY THIS EXISTS
 * Supabase's `signInWithPassword` is a network call: a station whose line is
 * down could not open the application at all, so a school working through an
 * outage was locked out of its own data. What makes an offline sign-in possible
 * is a record written ONCE, at a successful ONLINE sign-in, and stored here:
 *
 *   • the account's identity and profile (id, e-mail, name, role), so the UI
 *     knows who is connected and what they may see;
 *   • a PBKDF2-SHA256 verifier of the password — salt + derived key, never the
 *     password itself. The plain password exists only in memory, for the
 *     duration of the session, so the silent re-authentication on reconnect can
 *     use it (see src/lib/useAuth.ts).
 *
 * WHAT IT DOES NOT DO
 * It is not a fifth account: only accounts that already signed in on THIS
 * station are known here, and the verifier is checked against the record — a
 * stranger's credentials cannot open the app. It is also honest about its own
 * limits: an offline verifier on disk can be attacked offline, so the
 * derivation is deliberately slow (PBKDF2, 210 000 iterations) and a record
 * stops answering after MAX_OFFLINE_ATTEMPTS wrong passwords — the station then
 * asks for a connection instead of continuing to guess.
 *
 * Storage: localStorage (the station's accounts must survive a restart), with
 * an in-memory fallback so this module stays usable without a DOM.
 */

import type { AppRole } from './useAuth';

/** Software-version of the stored shape; a mismatch simply re-asks online. */
export const OFFLINE_ACCOUNT_VERSION = 1;

/** PBKDF2 cost. Deliberately slow: this is what protects the verifier at rest. */
export const OFFLINE_PBKDF2_ITERATIONS = 210_000;

/** Wrong passwords tolerated per account before the station demands a network. */
export const MAX_OFFLINE_ATTEMPTS = 10;

/** Records kept (most recent first) — one per account used on this station. */
const MAX_OFFLINE_ACCOUNTS = 10;

const STORAGE_KEY = 'mama_thera_offline_accounts_v1';

const SALT_BYTES = 16;
const KEY_BITS = 256;

/** Sentinel error strings — the login screen maps them to translated text. */
export const OFFLINE_UNKNOWN_ACCOUNT = 'OFFLINE_UNKNOWN_ACCOUNT';
export const OFFLINE_WRONG_PASSWORD = 'OFFLINE_WRONG_PASSWORD';
export const OFFLINE_ACCOUNT_LOCKED = 'OFFLINE_ACCOUNT_LOCKED';
export const OFFLINE_CRYPTO_UNAVAILABLE = 'OFFLINE_CRYPTO_UNAVAILABLE';

export interface OfflineAccount {
  /** Normalized (trimmed, lower-cased) e-mail — the lookup key. */
  email: string;
  userId: string;
  fullName: string;
  role: AppRole;
  /** Base64 salt, unique per account. */
  salt: string;
  /** Base64 PBKDF2 output — the password is never stored. */
  hash: string;
  iterations: number;
  failedAttempts: number;
  savedAt: string;
}

export type OfflineVerifyResult =
  | { status: 'ok'; account: OfflineAccount }
  | { status: 'unknown' }
  | { status: 'wrong-password'; remaining: number }
  | { status: 'locked' }
  | { status: 'unavailable' };

/** The slice of the Storage API this module needs (localStorage, or a test double). */
export interface OfflineStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

const memoryStore = new Map<string, string>();

/**
 * localStorage when the environment has one, an in-memory map otherwise (SSR
 * and the node test runner). Browser behaviour is unchanged.
 */
function defaultStore(): OfflineStore {
  if (typeof localStorage === 'undefined') {
    return {
      getItem: (key) => memoryStore.get(key) ?? null,
      setItem: (key, value) => { memoryStore.set(key, value); },
      removeItem: (key) => { memoryStore.delete(key); },
    };
  }
  return localStorage;
}

/** WebCrypto, or null when the environment has none (never a weak fallback). */
function getSubtle(): SubtleCrypto | null {
  const cryptoObj = (globalThis as { crypto?: Crypto }).crypto;
  return cryptoObj && typeof cryptoObj.subtle?.deriveBits === 'function' ? cryptoObj.subtle : null;
}

/** True when this station CAN offer an offline sign-in at all. */
export function offlineCredentialsAvailable(): boolean {
  return getSubtle() !== null && typeof btoa === 'function' && typeof atob === 'function';
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function base64ToBytes(text: string): Uint8Array {
  const binary = atob(text);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/**
 * Compare two base64 digests without an early exit: the time taken must not
 * depend on how many leading characters matched.
 */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function derive(password: string, salt: Uint8Array, iterations: number): Promise<string> {
  const subtle = getSubtle();
  if (!subtle) throw new Error(OFFLINE_CRYPTO_UNAVAILABLE);
  const material = await subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt: new Uint8Array(salt), iterations },
    material,
    KEY_BITS,
  );
  return bytesToBase64(new Uint8Array(bits));
}

// ─── Read / write the record store ──────────────────────────────────────────

/** Every account remembered on this station, most recent first. Never throws. */
export function listOfflineAccounts(store: OfflineStore = defaultStore()): OfflineAccount[] {
  try {
    const raw = store.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((entry): entry is OfflineAccount =>
      Boolean(entry) && typeof entry === 'object' &&
      typeof (entry as OfflineAccount).email === 'string' &&
      typeof (entry as OfflineAccount).salt === 'string' &&
      typeof (entry as OfflineAccount).hash === 'string');
  } catch {
    return [];
  }
}

function saveAccounts(accounts: OfflineAccount[], store: OfflineStore): void {
  try {
    store.setItem(STORAGE_KEY, JSON.stringify(accounts.slice(0, MAX_OFFLINE_ACCOUNTS)));
  } catch {
    // Storage full / private mode — no offline sign-in on this station, and the
    // online path keeps working exactly as before.
  }
}

export function findOfflineAccount(email: string, store: OfflineStore = defaultStore()): OfflineAccount | null {
  const wanted = normalizeEmail(email);
  return listOfflineAccounts(store).find(account => normalizeEmail(account.email) === wanted) ?? null;
}

/**
 * Remember (or refresh) the account that just signed in ONLINE. Called after a
 * successful network sign-in, so the password is verified by Supabase itself —
 * this only stores the verifier. Never throws, never blocks the sign-in.
 */
export async function rememberOfflineAccount(
  input: { email: string; password: string; userId: string; fullName: string; role: AppRole },
  store: OfflineStore = defaultStore(),
  iterations: number = OFFLINE_PBKDF2_ITERATIONS,
): Promise<OfflineAccount | null> {
  const subtle = getSubtle();
  const cryptoObj = (globalThis as { crypto?: Crypto }).crypto;
  if (!subtle || !cryptoObj || !input.password) return null;

  try {
    const salt = new Uint8Array(SALT_BYTES);
    cryptoObj.getRandomValues(salt);
    const hash = await derive(input.password, salt, iterations);
    const record: OfflineAccount = {
      email: normalizeEmail(input.email),
      userId: input.userId,
      fullName: input.fullName,
      role: input.role,
      salt: bytesToBase64(salt),
      hash,
      iterations,
      failedAttempts: 0,
      savedAt: new Date().toISOString(),
    };
    const others = listOfflineAccounts(store).filter(
      account => normalizeEmail(account.email) !== record.email && account.userId !== record.userId,
    );
    saveAccounts([record, ...others], store);
    return record;
  } catch (err) {
    console.warn('[MAMA THERA] Compte hors ligne non enregistré :', err);
    return null;
  }
}

/**
 * Check a password against the record for this e-mail, without any network.
 * A wrong password is counted; past MAX_OFFLINE_ATTEMPTS the record stops
 * answering until the account signs in online again.
 */
export async function verifyOfflineAccount(
  email: string,
  password: string,
  store: OfflineStore = defaultStore(),
): Promise<OfflineVerifyResult> {
  if (!offlineCredentialsAvailable()) return { status: 'unavailable' };
  const wanted = normalizeEmail(email);
  const accounts = listOfflineAccounts(store);
  const account = accounts.find(a => normalizeEmail(a.email) === wanted);
  if (!account) return { status: 'unknown' };
  if (account.failedAttempts >= MAX_OFFLINE_ATTEMPTS) return { status: 'locked' };

  let derived: string;
  try {
    derived = await derive(password, base64ToBytes(account.salt), account.iterations);
  } catch {
    return { status: 'unavailable' };
  }

  if (timingSafeEqual(derived, account.hash)) {
    const refreshed: OfflineAccount = { ...account, failedAttempts: 0 };
    saveAccounts(accounts.map(a => (a === account ? refreshed : a)), store);
    return { status: 'ok', account: refreshed };
  }

  const failedAttempts = account.failedAttempts + 1;
  saveAccounts(accounts.map(a => (a === account ? { ...a, failedAttempts } : a)), store);
  if (failedAttempts >= MAX_OFFLINE_ATTEMPTS) return { status: 'locked' };
  return { status: 'wrong-password', remaining: MAX_OFFLINE_ATTEMPTS - failedAttempts };
}

/** Drop one account (it can sign in again online and be remembered anew). */
export function forgetOfflineAccount(email: string, store: OfflineStore = defaultStore()): void {
  const wanted = normalizeEmail(email);
  saveAccounts(listOfflineAccounts(store).filter(a => normalizeEmail(a.email) !== wanted), store);
}

/** Drop every remembered account — the station offers no offline sign-in left. */
export function clearOfflineAccounts(store: OfflineStore = defaultStore()): void {
  try {
    store.removeItem(STORAGE_KEY);
  } catch {
    // nothing to clean
  }
}

// Offline sign-in verifier — pure suite: no DOM and no React (see
// tests/harness.ts "When NOT to use it"). The storage is injected, so each case
// gets its own station instead of sharing the module-level memory fallback.
//
// What carries the weight here is NOT that the round trip works (that is the
// easy half): it is that the plain password is never written anywhere, that a
// refusal is counted and eventually becomes a refusal to answer at all, and
// that a station with no WebCrypto says so instead of falling back to a weaker
// check.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  MAX_OFFLINE_ATTEMPTS,
  OFFLINE_PBKDF2_ITERATIONS,
  clearOfflineAccounts,
  findOfflineAccount,
  forgetOfflineAccount,
  listOfflineAccounts,
  normalizeEmail,
  offlineCredentialsAvailable,
  rememberOfflineAccount,
  verifyOfflineAccount,
} from '../src/lib/offlineCredentials';
import type { OfflineStore } from '../src/lib/offlineCredentials';

// ─── A station to ourselves ──────────────────────────────────────────────────

/** A Storage-shaped double whose raw content stays readable for inspection. */
function memoryStation(): OfflineStore & { raw(): string } {
  const data = new Map<string, string>();
  return {
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => { data.set(key, value); },
    removeItem: (key) => { data.delete(key); },
    raw: () => [...data.values()].join('\n'),
  };
}

/** Cheap cost for most cases: 210 000 iterations would dominate the suite. */
const FAST = 1000;

const account = (over: Partial<Parameters<typeof rememberOfflineAccount>[0]> = {}) => ({
  email: 'aggee@mamathera.org',
  password: 'Bamako-2026!',
  userId: 'user-1',
  fullName: 'Aggee Diarra',
  role: 'staff' as const,
  ...over,
});

async function remember(store: OfflineStore, over: Partial<Parameters<typeof rememberOfflineAccount>[0]> = {}) {
  return rememberOfflineAccount(account(over), store, FAST);
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('offline credentials (sign-in without a network)', () => {
  it('says whether this station can offer an offline sign-in at all', () => {
    // The node test runner has WebCrypto and base64 globals, like the browser.
    assert.equal(offlineCredentialsAvailable(), true);
  });

  it('remembers an account after an ONLINE success and verifies it offline', async () => {
    const store = memoryStation();
    const record = await remember(store);
    assert.ok(record, 'the account must be remembered');
    assert.equal(record.email, normalizeEmail(account().email));

    const result = await verifyOfflineAccount('aggee@mamathera.org', 'Bamako-2026!', store);
    assert.equal(result.status, 'ok');
    if (result.status !== 'ok') return;
    assert.equal(result.account.userId, 'user-1');
    assert.equal(result.account.fullName, 'Aggee Diarra');
    assert.equal(result.account.role, 'staff');
  });

  it('finds the account whatever the CASE and the surrounding spaces of the e-mail', async () => {
    const store = memoryStation();
    await remember(store, { email: 'Aggee@MamaThera.org' });

    const result = await verifyOfflineAccount('  aggee@mamathera.ORG ', 'Bamako-2026!', store);
    assert.equal(result.status, 'ok');
    assert.equal(listOfflineAccounts(store).length, 1, 'one account, not two spellings of it');
  });

  it('NEVER stores the password itself', async () => {
    const store = memoryStation();
    await remember(store);

    const raw = store.raw();
    assert.ok(!raw.includes('Bamako-2026!'), 'the plain password must not appear in storage');
    assert.ok(raw.includes('salt') && raw.includes('hash'), 'only the salt and the derived key are kept');
    assert.ok(!/password/i.test(raw), 'not even a `password` field name');
  });

  it('uses the slow, announced PBKDF2 cost unless a test asks otherwise', async () => {
    const store = memoryStation();
    await rememberOfflineAccount(account(), store); // default cost
    const [saved] = listOfflineAccounts(store);
    assert.equal(saved.iterations, OFFLINE_PBKDF2_ITERATIONS);
    assert.ok(OFFLINE_PBKDF2_ITERATIONS >= 200_000, 'the cost that protects the verifier at rest');
  });

  it('counts a wrong password and reports what is left before the station stops answering', async () => {
    const store = memoryStation();
    await remember(store);

    const first = await verifyOfflineAccount('aggee@mamathera.org', 'wrong', store);
    assert.equal(first.status, 'wrong-password');
    if (first.status !== 'wrong-password') return;
    assert.equal(first.remaining, MAX_OFFLINE_ATTEMPTS - 1);
    assert.equal(findOfflineAccount('aggee@mamathera.org', store)?.failedAttempts, 1);

    // A correct password still works after a mistake — and clears the count.
    const good = await verifyOfflineAccount('aggee@mamathera.org', 'Bamako-2026!', store);
    assert.equal(good.status, 'ok');
    assert.equal(findOfflineAccount('aggee@mamathera.org', store)?.failedAttempts, 0);
  });

  it('stops answering after too many wrong passwords, even for the right one', async () => {
    const store = memoryStation();
    await remember(store);

    for (let i = 0; i < MAX_OFFLINE_ATTEMPTS; i++) {
      const step = await verifyOfflineAccount('aggee@mamathera.org', `guess-${i}`, store);
      assert.equal(step.status, i === MAX_OFFLINE_ATTEMPTS - 1 ? 'locked' : 'wrong-password');
    }

    const afterLock = await verifyOfflineAccount('aggee@mamathera.org', 'Bamako-2026!', store);
    assert.equal(afterLock.status, 'locked', 'a locked record answers nothing until an online sign-in');
  });

  it("answers 'unknown' for an account this station has never seen", async () => {
    const store = memoryStation();
    await remember(store);

    const result = await verifyOfflineAccount('someone.else@mamathera.org', 'Bamako-2026!', store);
    assert.equal(result.status, 'unknown');
  });

  it('refreshes the record of an account that signs in again (no duplicate rows)', async () => {
    const store = memoryStation();
    await remember(store, { password: 'first-password' });
    await remember(store, { password: 'second-password' });

    assert.equal(listOfflineAccounts(store).length, 1);
    assert.equal((await verifyOfflineAccount('aggee@mamathera.org', 'second-password', store)).status, 'ok');
    assert.equal((await verifyOfflineAccount('aggee@mamathera.org', 'first-password', store)).status, 'wrong-password');
  });

  it('keeps at most ten stations accounts and drops the oldest', async () => {
    const store = memoryStation();
    for (let i = 0; i < 12; i++) {
      await remember(store, { email: `staff${i}@mamathera.org`, userId: `user-${i}` });
    }
    const emails = listOfflineAccounts(store).map((a) => a.email);
    assert.equal(emails.length, 10);
    assert.equal(emails[0], 'staff11@mamathera.org', 'most recent first');
    assert.ok(!emails.includes('staff0@mamathera.org'), 'the eleventh and twelfth pushes pushed it out');
  });

  it('forgets one account, or all of them', async () => {
    const store = memoryStation();
    await remember(store);
    await remember(store, { email: 'other@mamathera.org', userId: 'user-2' });

    forgetOfflineAccount('AGGEE@mamathera.org', store);
    assert.deepEqual(listOfflineAccounts(store).map((a) => a.email), ['other@mamathera.org']);

    clearOfflineAccounts(store);
    assert.deepEqual(listOfflineAccounts(store), []);
    assert.equal((await verifyOfflineAccount('other@mamathera.org', 'Bamako-2026!', store)).status, 'unknown');
  });

  it('survives corrupt storage instead of throwing', async () => {
    const store = memoryStation();
    store.setItem('mama_thera_offline_accounts_v1', '{ not json');
    assert.deepEqual(listOfflineAccounts(store), []);
    assert.equal((await verifyOfflineAccount('aggee@mamathera.org', 'Bamako-2026!', store)).status, 'unknown');
  });

  it('says UNAVAILABLE — never a weaker check — when WebCrypto is missing', async () => {
    const store = memoryStation();
    await remember(store);

    const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
    Object.defineProperty(globalThis, 'crypto', { value: {}, configurable: true, writable: true });
    try {
      assert.equal(offlineCredentialsAvailable(), false);
      assert.equal((await verifyOfflineAccount('aggee@mamathera.org', 'Bamako-2026!', store)).status, 'unavailable');
      assert.equal(await remember(store), null, 'nothing is remembered without a real derivation');
    } finally {
      if (descriptor) Object.defineProperty(globalThis, 'crypto', descriptor);
    }
    // …and the station is exactly as it was, verifier intact.
    assert.equal((await verifyOfflineAccount('aggee@mamathera.org', 'Bamako-2026!', store)).status, 'ok');
  });
});

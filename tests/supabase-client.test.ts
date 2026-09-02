/**
 * Unit tests locking the Supabase client setup, with `@supabase/supabase-js`
 * mocked (node:test --experimental-test-module-mocks):
 *   1. the `createClient` config is locked — url/key passthrough,
 *      persistSession / autoRefreshToken / detectSessionInUrl all true, and
 *      the storage is the exact tab-scoped sessionStorage instance;
 *   2. the legacy localStorage token (`sb-<projectRef>-auth-token`) is
 *      removed for matching supabase.co URLs — and only for those;
 *   3. missing/placeholder credentials throw loudly with zero `createClient`
 *      calls and zero cleanup (no silent fallback);
 *   4. the env wiring in `supabaseClient.ts` (which cannot be imported under
 *      the test runner because `import.meta.env` does not exist there) is
 *      locked by source assertion: env vars in, sessionStorage out.
 */
import { describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { installDomGlobals } from './harness';

// ── happy-dom globals: real sessionStorage + spyable localStorage ───────────
const win = installDomGlobals();
const removedKeys: string[] = [];
const realRemoveItem = win.localStorage.removeItem.bind(win.localStorage);
Object.defineProperty(globalThis, 'localStorage', {
  value: {
    removeItem: (key: string): void => {
      removedKeys.push(key);
      realRemoveItem(key);
    },
  },
  configurable: true,
  writable: true,
});
Object.defineProperty(globalThis, 'sessionStorage', {
  value: win.sessionStorage,
  configurable: true,
  writable: true,
});

// ── module mock: @supabase/supabase-js (registered BEFORE the import) ───────
interface ClientCall {
  url: unknown;
  key: unknown;
  config: unknown;
}
const createCalls: ClientCall[] = [];

mock.module('@supabase/supabase-js', {
  namedExports: {
    createClient: (url: unknown, key: unknown, config: unknown) => {
      createCalls.push({ url, key, config });
      return {};
    },
  },
});

const { createAppSupabaseClient, MISSING_CONFIG_MESSAGE } =
  await import('../src/lib/supabaseClientCore');

interface AuthConfig {
  persistSession: boolean;
  autoRefreshToken: boolean;
  detectSessionInUrl: boolean;
  storage: unknown;
}

const lastAuth = (): AuthConfig =>
  (createCalls[createCalls.length - 1].config as { auth: AuthConfig }).auth;

describe('Supabase client config', () => {
  it('forwards url/key and locks the tab-scoped session config', () => {
    const before = createCalls.length;
    const storage = globalThis.sessionStorage;

    createAppSupabaseClient('https://abc123.supabase.co', 'anon-key-1', storage);

    assert.equal(createCalls.length, before + 1, 'createClient called exactly once');
    assert.equal(createCalls[before].url, 'https://abc123.supabase.co');
    assert.equal(createCalls[before].key, 'anon-key-1');
    const auth = lastAuth();
    assert.equal(auth.persistSession, true, 'session persists across refresh');
    assert.equal(auth.autoRefreshToken, true, 'token auto-refreshes');
    assert.equal(auth.detectSessionInUrl, true, 'OAuth redirects detected');
    assert.equal(auth.storage, storage, 'config uses the exact storage instance passed');
    assert.equal(auth.storage, globalThis.sessionStorage, 'the wired storage is sessionStorage');
  });

  it('removes the legacy localStorage token for the URL project ref', () => {
    removedKeys.length = 0;
    createAppSupabaseClient('https://abc123.supabase.co', 'k', globalThis.sessionStorage);
    assert.deepEqual(removedKeys, ['sb-abc123-auth-token']);

    removedKeys.length = 0;
    createAppSupabaseClient('https://my-proj.supabase.co', 'k', globalThis.sessionStorage);
    assert.deepEqual(removedKeys, ['sb-my-proj-auth-token'], 'project refs with dashes work');
  });

  it('never touches localStorage for a non-supabase.co URL', () => {
    removedKeys.length = 0;
    createAppSupabaseClient('https://app.example.com', 'k', globalThis.sessionStorage);
    assert.deepEqual(removedKeys, [], 'no project ref → no cleanup');
  });

  it('throws loudly on missing credentials without calling createClient or cleaning up', () => {
    const callsBefore = createCalls.length;
    const keysBefore = removedKeys.length;

    assert.throws(() => createAppSupabaseClient(undefined, 'k', globalThis.sessionStorage),
      { message: MISSING_CONFIG_MESSAGE });
    assert.throws(() => createAppSupabaseClient('https://abc123.supabase.co', undefined, globalThis.sessionStorage),
      { message: MISSING_CONFIG_MESSAGE });
    assert.throws(() => createAppSupabaseClient(undefined, undefined, globalThis.sessionStorage),
      { message: MISSING_CONFIG_MESSAGE });

    assert.equal(createCalls.length, callsBefore, 'guard runs before createClient');
    assert.equal(removedKeys.length, keysBefore, 'guard runs before the legacy cleanup');
  });

  it('throws on placeholder credentials (no silent fallback)', () => {
    const callsBefore = createCalls.length;
    const badUrls = ['https://your-project.supabase.co', 'https://your-production-project.supabase.co'];
    const badKeys = ['your-anon-key', 'your-production-anon-key'];

    for (const url of badUrls) {
      assert.throws(() => createAppSupabaseClient(url, 'k', globalThis.sessionStorage),
        { message: MISSING_CONFIG_MESSAGE });
    }
    for (const key of badKeys) {
      assert.throws(() => createAppSupabaseClient('https://abc123.supabase.co', key, globalThis.sessionStorage),
        { message: MISSING_CONFIG_MESSAGE });
    }
    assert.equal(createCalls.length, callsBefore, 'no client built for placeholder credentials');
  });

  it('wires the real module: env vars in, sessionStorage out', () => {
    // supabaseClient.ts cannot be imported under the test runner
    // (import.meta.env is undefined there, so the guard would throw) — the
    // wiring contract is locked against its source instead.
    const source = fs.readFileSync(
      fileURLToPath(new URL('../src/lib/supabaseClient.ts', import.meta.url)),
      'utf8'
    );
    assert.match(source, /import\.meta\.env\?\.VITE_SUPABASE_URL/);
    assert.match(source, /import\.meta\.env\?\.VITE_SUPABASE_ANON_KEY/);
    assert.match(source, /createAppSupabaseClient\(\s*rawUrl,\s*rawKey,\s*sessionStorage\s*\)/);
  });
});
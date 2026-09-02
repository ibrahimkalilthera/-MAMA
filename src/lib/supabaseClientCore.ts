/**
 * Supabase client factory — the pure, environment-free core of the client
 * setup, extracted from `supabaseClient.ts` so the config can be unit-tested
 * (the wrapper module reads `import.meta.env`, which does not exist under the
 * test runner).
 *
 * Locked by `tests/supabase-client.test.ts`:
 *   • the exact `createClient` config (tab-scoped `storage`, session flags);
 *   • the legacy `localStorage` token cleanup (`sb-<projectRef>-auth-token`);
 *   • the loud failure on missing/placeholder credentials (no silent fallback).
 */
import { createClient } from '@supabase/supabase-js';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from './database.types';

const isPlaceholder = (v: string | undefined): boolean =>
  !v ||
  v.includes('your-project') ||
  v.includes('your-anon-key') ||
  v.includes('your-production-project') ||
  v.includes('your-production-anon-key');

export const MISSING_CONFIG_MESSAGE =
  'Configuration Supabase manquante : définissez VITE_SUPABASE_URL et VITE_SUPABASE_ANON_KEY ' +
  "(variables d'environnement). Aucun fallback n'est appliqué — l'application s'arrête volontairement.";

/**
 * Build the app client. `storage` is injected (the wrapper passes
 * `sessionStorage`) so tests can lock the tab-scoped behavior.
 *
 * Legacy cleanup: sessions used to live in localStorage (supabase default).
 * Since the switch to tab-scoped sessionStorage, remove any stale token so it
 * never resurfaces (e.g. on a future config rollback).
 */
export function createAppSupabaseClient(
  url: string | undefined,
  anonKey: string | undefined,
  storage: Storage
): SupabaseClient<Database> {
  // No hardcoded fallback: if the credentials are missing or still
  // placeholders, fail loudly instead of silently connecting to the
  // production database.
  if (isPlaceholder(url) || isPlaceholder(anonKey)) {
    throw new Error(MISSING_CONFIG_MESSAGE);
  }

  try {
    const projectRef = url!.match(/^https:\/\/([^.]+)\.supabase\.co/)?.[1];
    if (projectRef) localStorage.removeItem(`sb-${projectRef}-auth-token`);
  } catch {
    /* storage unavailable — nothing to clean */
  }

  return createClient<Database>(url!, anonKey!, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
      // Session tied to the TAB (sessionStorage): closing the page logs out
      // automatically, while a simple refresh (F5) keeps the session. This is
      // deliberate for shared-computer usage — nobody stays logged in after
      // leaving the app.
      storage,
    },
  });
}
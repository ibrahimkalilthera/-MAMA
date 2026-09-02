import { createClient } from '@supabase/supabase-js';
import type { Database } from './database.types';

const rawUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const rawKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

const isPlaceholder = (v: string | undefined): boolean =>
  !v ||
  v.includes('your-project') ||
  v.includes('your-anon-key') ||
  v.includes('your-production-project') ||
  v.includes('your-production-anon-key');

// No hardcoded fallback: if the env vars are missing or still placeholders,
// fail loudly instead of silently connecting to the production database.
if (isPlaceholder(rawUrl) || isPlaceholder(rawKey)) {
  throw new Error(
    'Configuration Supabase manquante : définissez VITE_SUPABASE_URL et VITE_SUPABASE_ANON_KEY ' +
      "(variables d'environnement). Aucun fallback n'est appliqué — l'application s'arrête volontairement."
  );
}

// Legacy cleanup: sessions used to live in localStorage (supabase default).
// Since the switch to tab-scoped sessionStorage below, remove any stale token
// so it never resurfaces (e.g. on a future config rollback).
try {
  const projectRef = rawUrl!.match(/^https:\/\/([^.]+)\.supabase\.co/)?.[1];
  if (projectRef) localStorage.removeItem(`sb-${projectRef}-auth-token`);
} catch {
  /* storage unavailable — nothing to clean */
}

export const supabase = createClient<Database>(rawUrl!, rawKey!, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
    // Session tied to the TAB (sessionStorage): closing the page logs out
    // automatically, while a simple refresh (F5) keeps the session. This is
    // deliberate for shared-computer usage — nobody stays logged in after
    // leaving the app.
    storage: sessionStorage,
  },
});

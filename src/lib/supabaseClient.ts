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

export const supabase = createClient<Database>(rawUrl!, rawKey!, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
});

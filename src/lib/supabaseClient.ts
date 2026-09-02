import type { SupabaseClient } from '@supabase/supabase-js';
import { createAppSupabaseClient } from './supabaseClientCore';
import type { Database } from './database.types';

const rawUrl = import.meta.env?.VITE_SUPABASE_URL as string | undefined;
const rawKey = import.meta.env?.VITE_SUPABASE_ANON_KEY as string | undefined;

// The factory throws on missing/placeholder credentials (loud failure, no
// fallback), performs the legacy localStorage token cleanup, and builds the
// client with the tab-scoped sessionStorage config — all locked by
// tests/supabase-client.test.ts.
export const supabase: SupabaseClient<Database> = createAppSupabaseClient(
  rawUrl,
  rawKey,
  sessionStorage
);
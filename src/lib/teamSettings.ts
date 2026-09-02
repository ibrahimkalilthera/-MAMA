/**
 * Team-wide settings persistence (app_settings table).
 *
 * The inactivity auto-logout window is a TEAM decision: one DB row shared by
 * every account and browser, instead of a per-browser localStorage value.
 * Anyone authenticated can READ it (every client applies the window at
 * login); only admin/dev can WRITE (RLS re-checks server-side via
 * is_admin()).
 *
 * Locked by tests/team-settings.test.ts (mock.module on supabaseClient —
 * the real client module cannot be imported under the test runner because
 * import.meta.env does not exist there).
 */
import { supabase } from './supabaseClient';

export const INACTIVITY_SETTINGS_KEY = 'inactivity_minutes';

/**
 * Read the team window. Returns null when the row is missing or the read
 * failed (caller falls back to its local cache).
 */
export async function fetchInactivityMinutes(): Promise<number | null> {
  const { data, error } = await supabase
    .from('app_settings')
    .select('value')
    .eq('key', INACTIVITY_SETTINGS_KEY)
    .maybeSingle();
  if (error || !data) return null;
  const raw = (data as { value: unknown }).value;
  const parsed = typeof raw === 'number' ? raw : Number(raw);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Persist the team window (admin/dev only — RLS enforces it server-side).
 * Returns false when the write failed (caller keeps the session value).
 */
export async function saveInactivityMinutes(minutes: number): Promise<boolean> {
  const { error } = await supabase
    .from('app_settings')
    .upsert(
      {
        key: INACTIVITY_SETTINGS_KEY,
        value: minutes,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'key' }
    );
  if (error) {
    console.error('[MAMA THERA] Failed to save team setting:', error.message);
    return false;
  }
  return true;
}
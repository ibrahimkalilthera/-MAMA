import { supabase } from './supabaseClient';

export interface AuditLogEntry {
  id: string;
  userId?: string;
  userEmail?: string;
  userName?: string;
  userRole?: string;
  action: string;
  targetType?: string;
  targetId?: string;
  details?: string;
  createdAt: string;
}

export interface LogAuditParams {
  action: string;
  targetType?: string;
  targetId?: string;
  details?: string;
  user?: {
    id?: string;
    email?: string;
    full_name?: string;
    role?: string;
  } | null;
}

// ─── Actor resolution ────────────────────────────────────────────────────────
// Most call sites live in the data layer and don't know the current user.
// Resolve it once per page-load from the session + user_profiles, so the
// trail records WHO acted instead of a generic "system".
let cachedActor: LogAuditParams['user'] | undefined;

async function resolveActor(): Promise<LogAuditParams['user']> {
  if (cachedActor !== undefined) return cachedActor;
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      cachedActor = null;
      return null;
    }
    const { data: profile } = await supabase
      .from('user_profiles')
      .select('full_name, role')
      .eq('id', user.id)
      .maybeSingle();
    cachedActor = {
      id: user.id,
      email: user.email || 'system',
      full_name: profile?.full_name || (user.user_metadata?.full_name as string) || 'System Staff',
      role: profile?.role || 'staff',
    };
    return cachedActor;
  } catch {
    cachedActor = null;
    return null;
  }
}

/**
 * Persists an audit log entry in Supabase audit_logs table.
 */
export async function logAuditEvent({
  action,
  targetType,
  targetId,
  details,
  user,
}: LogAuditParams): Promise<boolean> {
  const actor = user ?? (await resolveActor());
  try {
    const { error } = await supabase.from('audit_logs').insert({
      user_id: actor?.id || null,
      user_email: actor?.email || 'system',
      user_name: actor?.full_name || actor?.email || 'System Staff',
      user_role: actor?.role || 'staff',
      action,
      target_type: targetType || null,
      target_id: targetId || null,
      details: details || null,
    });

    if (error) {
      console.warn('Failed to persist audit log entry:', error.message);
      return false;
    }
    return true;
  } catch (err) {
    console.warn('Audit logging exception:', err);
    return false;
  }
}

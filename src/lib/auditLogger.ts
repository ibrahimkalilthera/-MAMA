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
  try {
    const { error } = await supabase.from('audit_logs').insert({
      user_id: user?.id || null,
      user_email: user?.email || 'system',
      user_name: user?.full_name || user?.email || 'System Staff',
      user_role: user?.role || 'staff',
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

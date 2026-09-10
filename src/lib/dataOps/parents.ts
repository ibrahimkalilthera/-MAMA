/**
 * Parent CRUD operations — built from the shared SupabaseDataCtx.
 * Extracted from useSupabaseData.ts during the per-domain split.
 */
import { supabase } from '../supabaseClient';
import type { SupabaseDataCtx } from '../dataOpsContext';
import type { Parent } from '../domainTypes';
import type { DbUpdate } from '../database.types';
import { mapParentRow, createTempId } from '../rowMappers';
import { parentToRow } from '../offlineReplay';
import { logAuditEvent } from '../auditLogger';

export function createParentOps(ctx: SupabaseDataCtx) {
  const { parents, setParents, notifySuccess, notifyError, isOffline, enqueueOffline } = ctx;

  const addParent = async (parent: Omit<Parent, 'id'>): Promise<Parent | null> => {
    if (isOffline()) {
      const tempId = createTempId('parent');
      const local: Parent = { id: tempId, ...parent };
      setParents(prev => [...prev, local]);
      enqueueOffline('addParent', parent);
      notifySuccess('addParent');
      return local;
    }
    const { data, error } = await supabase
      .from('parents')
      .insert(parentToRow(parent))
      .select()
      .single();
    if (error) { console.error('addParent error:', error.message); notifyError('addParent', error.message); return null; }
    const mapped = mapParentRow(data);
    setParents(prev => [...prev, mapped]);
    void logAuditEvent({
      action: 'ADD_PARENT',
      targetType: 'parent',
      targetId: mapped.id,
      details: mapped.fullName,
    });
    notifySuccess('addParent');
    return mapped;
  };

  const updateParent = async (id: string, updates: Partial<Parent>): Promise<boolean> => {
    if (isOffline()) {
      setParents(prev => prev.map(p => p.id === id ? { ...p, ...updates } : p));
      enqueueOffline('updateParent', { id, updates });
      notifySuccess('updateParent');
      return true;
    }
    const row: DbUpdate<'parents'> = {};
    if (updates.fullName !== undefined) row.full_name = updates.fullName;
    if (updates.phones !== undefined) row.phones = updates.phones;
    if ('email' in updates) row.email = updates.email || null;
    if (updates.address !== undefined) row.address = updates.address;
    if (updates.occupation !== undefined) row.occupation = updates.occupation;
    if (updates.relationship !== undefined) row.relationship = updates.relationship;
    if (updates.notes !== undefined) row.notes = updates.notes;

    const { error } = await supabase.from('parents').update(row).eq('id', id);
    if (error) { console.error('updateParent error:', error.message); notifyError('updateParent', error.message); return false; }
    setParents(prev => prev.map(p => p.id === id ? { ...p, ...updates } : p));
    notifySuccess('updateParent');
    return true;
  };

  const deleteParent = async (id: string): Promise<boolean> => {
    if (isOffline()) {
      setParents(prev => prev.filter(p => p.id !== id));
      enqueueOffline('deleteParent', { id });
      notifySuccess('deleteParent');
      return true;
    }
    const { error } = await supabase.from('parents').delete().eq('id', id);
    if (error) { console.error('deleteParent error:', error.message); notifyError('deleteParent', error.message); return false; }
    const deleted = parents.find(p => p.id === id);
    void logAuditEvent({
      action: 'DELETE_PARENT',
      targetType: 'parent',
      targetId: id,
      details: deleted?.fullName,
    });
    setParents(prev => prev.filter(p => p.id !== id));
    notifySuccess('deleteParent');
    return true;
  };

  return { addParent, updateParent, deleteParent };
}
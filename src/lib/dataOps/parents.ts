/**
 * Parent CRUD operations — built from the shared SupabaseDataCtx.
 * Extracted from useSupabaseData.ts during the per-domain split.
 */
import { supabase } from '../supabaseClient';
import type { SupabaseDataCtx } from '../dataOpsContext';
import type { Parent } from '../domainTypes';
import type { DbUpdate } from '../database.types';
import { mapParentRow, createRowId } from '../rowMappers';
import { parentToRow, rowIdColumn } from '../offlineReplay';
import { logAuditEvent } from '../auditLogger';

export function createParentOps(ctx: SupabaseDataCtx) {
  const { parents, setParents, notifySuccess, notifyError, isOffline, enqueueOffline } = ctx;

  const addParent = async (parent: Omit<Parent, 'id'> & { id?: string }): Promise<Parent | null> => {
    // L'id du GESTE — minté par l'écran (une fois par fiche ouverte) ou ici à
    // défaut. C'est lui qui rend l'écriture IDEMPOTENTE : le même geste rejoué
    // (double clic, reprise après coupure) retombe sur la MÊME clé primaire au
    // lieu de créer une seconde ligne. Même règle que `addStudent`.
    const rowId = parent.id ?? createRowId();
    if (isOffline()) {
      const local: Parent = { ...parent, id: rowId };
      setParents(prev => prev.some(p => p.id === rowId) ? prev : [...prev, local]);
      enqueueOffline('addParent', parent, rowId);
      notifySuccess('addParent');
      return local;
    }
    const { data, error } = await supabase
      .from('parents')
      .insert({ ...rowIdColumn(rowId), ...parentToRow(parent) })
      .select()
      .single();
    if (error) {
      // `23505` : la clé primaire existe DÉJÀ — c'est le même geste, déjà
      // enregistré. On rend la ligne en base, sans erreur et sans seconde entrée
      // de journal (un parent, un geste, une ligne d'audit).
      if (error.code === '23505' && rowIdColumn(rowId).id) {
        const existing = await supabase.from('parents').select().eq('id', rowId).single();
        if (existing.data) {
          const already = mapParentRow(existing.data);
          setParents(prev => prev.some(p => p.id === already.id) ? prev : [...prev, already]);
          return already;
        }
      }
      console.error('addParent error:', error.message); notifyError('addParent', error.message); return null;
    }
    const mapped = mapParentRow(data);
    setParents(prev => prev.some(p => p.id === mapped.id) ? prev : [...prev, mapped]);
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

    // `.select('id')` + the empty check below is what makes this write HONEST —
    // the same rule as staff.ts and students.ts. PostgREST answers 200 with an
    // EMPTY body when the RLS `USING` clause removes every target row: the
    // request succeeded, changed nothing, and used to report success — the
    // parent list then showed a value the database does not have.
    const { data, error } = await supabase.from('parents').update(row).eq('id', id).select('id');
    if (error) { console.error('updateParent error:', error.message); notifyError('updateParent', error.message); return false; }
    if (!data || data.length === 0) {
      console.error('updateParent: aucune ligne modifiée — cible filtrée par la policy RLS');
      notifyError('updateParent', 'Aucune ligne modifiée — droits insuffisants sur ce parent.');
      return false;
    }
    const prevParent = parents.find(p => p.id === id);
    const changes: string[] = [];
    if (prevParent && updates.fullName !== undefined && updates.fullName !== prevParent.fullName) changes.push(`nom ${prevParent.fullName}→${updates.fullName}`);
    if (prevParent && updates.phones !== undefined && JSON.stringify(updates.phones) !== JSON.stringify(prevParent.phones)) changes.push('téléphones modifiés');
    if (prevParent && updates.occupation !== undefined && updates.occupation !== prevParent.occupation) changes.push(`profession ${prevParent.occupation}→${updates.occupation}`);
    void logAuditEvent({
      action: 'UPDATE_PARENT',
      targetType: 'parent',
      targetId: id,
      details: `${prevParent?.fullName || id}${changes.length ? ` — ${changes.join(', ')}` : ''}`,
    });
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
    // Same honesty rule as deleteStaff/deleteStudent: an RLS-filtered DELETE
    // removes zero rows and answers 200, so « Parent supprimé » could be shown
    // for a parent still in the table — and their pupils' links with them.
    // `.select('id')` tells us what really went.
    const { data, error } = await supabase.from('parents').delete().eq('id', id).select('id');
    if (error) { console.error('deleteParent error:', error.message); notifyError('deleteParent', error.message); return false; }
    if (!data || data.length === 0) {
      console.error('deleteParent: aucune ligne supprimée — cible filtrée par la policy RLS');
      notifyError('deleteParent', 'Aucune ligne supprimée — droits insuffisants sur ce parent.');
      return false;
    }
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
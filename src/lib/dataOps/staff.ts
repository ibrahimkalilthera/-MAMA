/**
 * Staff CRUD operations — built from SupabaseDataCtx.
 * Extracted from useSupabaseData.ts during the per-domain split.
 */
import { supabase } from '../supabaseClient';
import type { SupabaseDataCtx } from '../dataOpsContext';
import type { Staff } from '../domainTypes';
import type { DbUpdate } from '../database.types';
import { mapStaffRow, createTempId } from '../rowMappers';
import { staffToRow } from '../offlineReplay';
import { logAuditEvent } from '../auditLogger';

export function createStaffOps(ctx: SupabaseDataCtx) {
  const { staff, setStaff, notifySuccess, notifyError, isOffline, enqueueOffline } = ctx;

  const addStaff = async (s: Omit<Staff, 'id'>): Promise<Staff | null> => {
    if (isOffline()) {
      const tempId = createTempId('staff');
      const local: Staff = { id: tempId, ...s };
      setStaff(prev => [...prev, local]);
      enqueueOffline('addStaff', s);
      notifySuccess('addStaff');
      return local;
    }
    const { data, error } = await supabase
      .from('staff')
      .insert(staffToRow(s))
      .select()
      .single();
    if (error) { console.error('addStaff error:', error.message); notifyError('addStaff', error.message); return null; }
    const mapped = mapStaffRow(data);
    setStaff(prev => [...prev, mapped]);
    void logAuditEvent({
      action: 'ADD_STAFF',
      targetType: 'staff',
      targetId: mapped.id,
      details: s.position ? `${s.name} (${s.position})` : s.name,
    });
    notifySuccess('addStaff');
    return mapped;
  };

  const updateStaff = async (id: string, updates: Partial<Staff>): Promise<boolean> => {
    if (isOffline()) {
      setStaff(prev => prev.map(s => s.id === id ? { ...s, ...updates } : s));
      enqueueOffline('updateStaff', { id, updates });
      notifySuccess('updateStaff');
      return true;
    }
    const row: DbUpdate<'staff'> = {};
    if (updates.name !== undefined) row.name = updates.name;
    if (updates.position !== undefined) row.position = updates.position;
    if (updates.salary !== undefined) row.salary = updates.salary;
    if ('email' in updates) row.email = updates.email || null;
    if (updates.phone !== undefined) row.phone = updates.phone;
    if (updates.bankDetails !== undefined) row.bank_details = updates.bankDetails;
    if (updates.emergencyContact !== undefined) row.emergency_contact = updates.emergencyContact;
    if ('inpsNumber' in updates) row.inps_number = updates.inpsNumber || null;
    if ('hireDate' in updates) row.hire_date = updates.hireDate || null;
    if ('familyStatus' in updates) row.family_status = updates.familyStatus || null;
    if (updates.childrenCount !== undefined) row.children_count = updates.childrenCount;
    if (updates.travelAllowance !== undefined) row.travel_allowance = updates.travelAllowance;
    if (updates.communicationAllowance !== undefined) row.communication_allowance = updates.communicationAllowance;
    if (updates.housingAllowance !== undefined) row.housing_allowance = updates.housingAllowance;

    const { error } = await supabase.from('staff').update(row).eq('id', id);
    if (error) { console.error('updateStaff error:', error.message); notifyError('updateStaff', error.message); return false; }
    setStaff(prev => prev.map(s => s.id === id ? { ...s, ...updates } : s));
    notifySuccess('updateStaff');
    return true;
  };

  const deleteStaff = async (id: string): Promise<boolean> => {
    if (isOffline()) {
      setStaff(prev => prev.filter(s => s.id !== id));
      enqueueOffline('deleteStaff', { id });
      notifySuccess('deleteStaff');
      return true;
    }
    const { error } = await supabase.from('staff').delete().eq('id', id);
    if (error) { console.error('deleteStaff error:', error.message); notifyError('deleteStaff', error.message); return false; }
    const deleted = staff.find(x => x.id === id);
    void logAuditEvent({
      action: 'DELETE_STAFF',
      targetType: 'staff',
      targetId: id,
      details: deleted?.name,
    });
    setStaff(prev => prev.filter(s => s.id !== id));
    notifySuccess('deleteStaff');
    return true;
  };

  return { addStaff, updateStaff, deleteStaff };
}
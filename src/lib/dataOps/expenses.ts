/**
 * Expense + vendor expense operations — built from SupabaseDataCtx.
 * Extracted from useSupabaseData.ts during the per-domain split.
 */
import { supabase } from '../supabaseClient';
import type { SupabaseDataCtx } from '../dataOpsContext';
import type { Expense, VendorExpense } from '../domainTypes';
import type { DbUpdate } from '../database.types';
import { mapExpenseRow, mapVendorExpenseRow, createTempId } from '../rowMappers';

export function createExpenseOps(ctx: SupabaseDataCtx) {
  const { setExpenses, setVendorExpenses, notifySuccess, notifyError, isOffline, enqueueOffline } = ctx;

  const addExpense = async (exp: Omit<Expense, 'id'>): Promise<Expense | null> => {
    if (isOffline()) {
      const tempId = createTempId('expense');
      const local: Expense = { id: tempId, ...exp };
      setExpenses(prev => [...prev, local]);
      enqueueOffline('addExpense', exp);
      notifySuccess('addExpense');
      return local;
    }
    const { data, error } = await supabase
      .from('expenses')
      .insert({
        category: exp.category,
        description: exp.description,
        amount: exp.amount,
        date: exp.date,
        academic_year: exp.academicYear || null,
      })
      .select()
      .single();
    if (error) { console.error('addExpense error:', error.message); notifyError('addExpense', error.message); return null; }
    const mapped = mapExpenseRow(data);
    setExpenses(prev => [...prev, mapped]);
    notifySuccess('addExpense');
    return mapped;
  };

  const addVendorExpense = async (ve: Omit<VendorExpense, 'id'>): Promise<VendorExpense | null> => {
    if (isOffline()) {
      const tempId = createTempId('vendor');
      const local: VendorExpense = { id: tempId, ...ve };
      setVendorExpenses(prev => [...prev, local]);
      enqueueOffline('addVendorExpense', ve);
      notifySuccess('addVendorExpense');
      return local;
    }
    const { data, error } = await supabase
      .from('vendor_expenses')
      .insert({
        vendor_name: ve.vendorName,
        category: ve.category,
        amount: ve.amount,
        due_date: ve.dueDate,
        payment_status: ve.paymentStatus,
        amount_paid: ve.amountPaid,
        description: ve.description || null,
        academic_year: ve.academicYear || null,
        aid_type: ve.aidType || null,
        beneficiary_student_name: ve.beneficiaryStudentName || null,
        beneficiary_student_grade: ve.beneficiaryStudentGrade || null,
      })
      .select()
      .single();
    if (error) { console.error('addVendorExpense error:', error.message); notifyError('addVendorExpense', error.message); return null; }
    const mapped = mapVendorExpenseRow(data);
    setVendorExpenses(prev => [...prev, mapped]);
    notifySuccess('addVendorExpense');
    return mapped;
  };

  const updateVendorExpense = async (id: string, updates: Partial<VendorExpense>): Promise<boolean> => {
    if (isOffline()) {
      setVendorExpenses(prev => prev.map(v => v.id === id ? { ...v, ...updates } : v));
      enqueueOffline('updateVendorExpense', { id, updates });
      notifySuccess('updateVendorExpense');
      return true;
    }
    const row: DbUpdate<'vendor_expenses'> = {};
    if (updates.vendorName !== undefined) row.vendor_name = updates.vendorName;
    if (updates.category !== undefined) row.category = updates.category;
    if (updates.amount !== undefined) row.amount = updates.amount;
    if (updates.dueDate !== undefined) row.due_date = updates.dueDate;
    if (updates.paymentStatus !== undefined) row.payment_status = updates.paymentStatus;
    if (updates.amountPaid !== undefined) row.amount_paid = updates.amountPaid;
    if (updates.description !== undefined) row.description = updates.description;
    if (updates.aidType !== undefined) row.aid_type = updates.aidType;
    if (updates.beneficiaryStudentName !== undefined) row.beneficiary_student_name = updates.beneficiaryStudentName;
    if (updates.beneficiaryStudentGrade !== undefined) row.beneficiary_student_grade = updates.beneficiaryStudentGrade;

    const { error } = await supabase.from('vendor_expenses').update(row).eq('id', id);
    if (error) { console.error('updateVendorExpense error:', error.message); notifyError('updateVendorExpense', error.message); return false; }
    setVendorExpenses(prev => prev.map(v => v.id === id ? { ...v, ...updates } : v));
    notifySuccess('updateVendorExpense');
    return true;
  };

  const deleteVendorExpense = async (id: string): Promise<boolean> => {
    if (isOffline()) {
      setVendorExpenses(prev => prev.filter(v => v.id !== id));
      enqueueOffline('deleteVendorExpense', { id });
      notifySuccess('deleteVendorExpense');
      return true;
    }
    const { error } = await supabase.from('vendor_expenses').delete().eq('id', id);
    if (error) { console.error('deleteVendorExpense error:', error.message); notifyError('deleteVendorExpense', error.message); return false; }
    setVendorExpenses(prev => prev.filter(v => v.id !== id));
    notifySuccess('deleteVendorExpense');
    return true;
  };

  return { addExpense, addVendorExpense, updateVendorExpense, deleteVendorExpense };
}
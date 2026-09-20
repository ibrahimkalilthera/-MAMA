/**
 * Expense + vendor expense operations — built from SupabaseDataCtx.
 * Extracted from useSupabaseData.ts during the per-domain split.
 */
import { supabase } from '../supabaseClient';
import type { SupabaseDataCtx } from '../dataOpsContext';
import type { Expense, VendorExpense } from '../domainTypes';
import type { DbUpdate } from '../database.types';
import { mapExpenseRow, mapVendorExpenseRow, createRowId } from '../rowMappers';
import { logAuditEvent } from '../auditLogger';

export function createExpenseOps(ctx: SupabaseDataCtx) {
  const { vendorExpenses, expenses, setExpenses, setVendorExpenses, notifySuccess, notifyError, isOffline, enqueueOffline } = ctx;

  const addExpense = async (exp: Omit<Expense, 'id'>): Promise<Expense | null> => {
    if (isOffline()) {
      const rowId = createRowId();
      const local: Expense = { id: rowId, ...exp };
      setExpenses(prev => [...prev, local]);
      enqueueOffline('addExpense', exp, rowId);
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
    void logAuditEvent({
      action: 'ADD_EXPENSE',
      targetType: 'expense',
      targetId: mapped.id,
      details: `${exp.description} (${exp.category}) — ${exp.amount} FCFA`,
    });
    notifySuccess('addExpense');
    return mapped;
  };

  const addVendorExpense = async (ve: Omit<VendorExpense, 'id'>): Promise<VendorExpense | null> => {
    if (isOffline()) {
      const rowId = createRowId();
      const local: VendorExpense = { id: rowId, ...ve };
      setVendorExpenses(prev => [...prev, local]);
      enqueueOffline('addVendorExpense', ve, rowId);
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
    void logAuditEvent({
      action: 'ADD_VENDOR_EXPENSE',
      targetType: 'vendor_expense',
      targetId: mapped.id,
      details: `${ve.vendorName} — ${ve.category} — ${ve.amount} FCFA`,
    });
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

    // Même règle honnête que staff/students/parents : une requête filtrée par la
    // policy RLS revient en 200 avec un corps VIDE — 0 ligne n'est pas un succès.
    const { data, error } = await supabase.from('vendor_expenses').update(row).eq('id', id).select('id');
    if (error) { console.error('updateVendorExpense error:', error.message); notifyError('updateVendorExpense', error.message); return false; }
    if (!data || data.length === 0) {
      console.error('updateVendorExpense: aucune ligne modifiée — cible filtrée par la policy RLS');
      notifyError('updateVendorExpense', 'Aucune ligne modifiée — droits insuffisants sur cette dépense.');
      return false;
    }
    const prev = vendorExpenses.find(v => v.id === id);
    const changes: string[] = [];
    if (prev && updates.amount !== undefined && updates.amount !== prev.amount) changes.push(`montant ${prev.amount}→${updates.amount}`);
    if (prev && updates.paymentStatus !== undefined && updates.paymentStatus !== prev.paymentStatus) changes.push(`statut ${prev.paymentStatus}→${updates.paymentStatus}`);
    void logAuditEvent({
      action: 'UPDATE_VENDOR_EXPENSE',
      targetType: 'vendor_expense',
      targetId: id,
      details: `${prev?.vendorName || id}${changes.length ? ` — ${changes.join(', ')}` : ''}`,
    });
    setVendorExpenses(prev => prev.map(v => v.id === id ? { ...v, ...updates } : v));
    notifySuccess('updateVendorExpense');
    return true;
  };

  /**
   * Modifie une dépense existante — symétrique de `updateVendorExpense`, et
   * utilisé par l'import Excel (stratégie « mettre à jour »), qui doit pouvoir
   * traverser une coupure de réseau comme le reste de la saisie.
   */
  const updateExpense = async (id: string, updates: Partial<Expense>): Promise<boolean> => {
    if (isOffline()) {
      setExpenses(prev => prev.map(e => e.id === id ? { ...e, ...updates } : e));
      enqueueOffline('updateExpense', { id, updates });
      notifySuccess('updateExpense');
      return true;
    }
    const row: DbUpdate<'expenses'> = {};
    if (updates.category !== undefined) row.category = updates.category;
    if (updates.description !== undefined) row.description = updates.description;
    if (updates.amount !== undefined) row.amount = updates.amount;
    if (updates.date !== undefined) row.date = updates.date;
    if (updates.academicYear !== undefined) row.academic_year = updates.academicYear;

    // Même règle honnête que les autres domaines : une requête filtrée par la
    // policy RLS revient en 200 avec un corps VIDE — 0 ligne n'est pas un succès.
    const { data, error } = await supabase.from('expenses').update(row).eq('id', id).select('id');
    if (error) { console.error('updateExpense error:', error.message); notifyError('updateExpense', error.message); return false; }
    if (!data || data.length === 0) {
      console.error('updateExpense: aucune ligne modifiée — cible filtrée par la policy RLS');
      notifyError('updateExpense', 'Aucune ligne modifiée — droits insuffisants sur cette dépense.');
      return false;
    }
    const prev = expenses.find(e => e.id === id);
    const changes: string[] = [];
    if (prev && updates.amount !== undefined && updates.amount !== prev.amount) changes.push(`montant ${prev.amount}→${updates.amount}`);
    if (prev && updates.description !== undefined && updates.description !== prev.description) changes.push(`libellé ${prev.description}→${updates.description}`);
    void logAuditEvent({
      action: 'UPDATE_EXPENSE',
      targetType: 'expense',
      targetId: id,
      details: `${prev?.description || id}${changes.length ? ` — ${changes.join(', ')}` : ''}`,
    });
    setExpenses(prev => prev.map(e => e.id === id ? { ...e, ...updates } : e));
    notifySuccess('updateExpense');
    return true;
  };

  const deleteExpense = async (id: string): Promise<boolean> => {
    if (isOffline()) {
      setExpenses(prev => prev.filter(e => e.id !== id));
      enqueueOffline('deleteExpense', { id });
      notifySuccess('deleteExpense');
      return true;
    }
    const { data, error } = await supabase.from('expenses').delete().eq('id', id).select('id');
    if (error) { console.error('deleteExpense error:', error.message); notifyError('deleteExpense', error.message); return false; }
    if (!data || data.length === 0) {
      console.error('deleteExpense: aucune ligne supprimée — cible filtrée par la policy RLS');
      notifyError('deleteExpense', 'Aucune ligne supprimée — droits insuffisants sur cette dépense.');
      return false;
    }
    const deleted = expenses.find(e => e.id === id);
    void logAuditEvent({
      action: 'DELETE_EXPENSE',
      targetType: 'expense',
      targetId: id,
      details: deleted ? `${deleted.description} (${deleted.category}) — ${deleted.amount} FCFA` : id,
    });
    setExpenses(prev => prev.filter(e => e.id !== id));
    notifySuccess('deleteExpense');
    return true;
  };

  const deleteVendorExpense = async (id: string): Promise<boolean> => {
    if (isOffline()) {
      setVendorExpenses(prev => prev.filter(v => v.id !== id));
      enqueueOffline('deleteVendorExpense', { id });
      notifySuccess('deleteVendorExpense');
      return true;
    }
    const { data, error } = await supabase.from('vendor_expenses').delete().eq('id', id).select('id');
    if (error) { console.error('deleteVendorExpense error:', error.message); notifyError('deleteVendorExpense', error.message); return false; }
    if (!data || data.length === 0) {
      console.error('deleteVendorExpense: aucune ligne supprimée — cible filtrée par la policy RLS');
      notifyError('deleteVendorExpense', 'Aucune ligne supprimée — droits insuffisants sur cette dépense.');
      return false;
    }
    const deleted = vendorExpenses.find(v => v.id === id);
    void logAuditEvent({
      action: 'DELETE_VENDOR_EXPENSE',
      targetType: 'vendor_expense',
      targetId: id,
      details: deleted?.vendorName,
    });
    setVendorExpenses(prev => prev.filter(v => v.id !== id));
    notifySuccess('deleteVendorExpense');
    return true;
  };

  return { addExpense, updateExpense, deleteExpense, addVendorExpense, updateVendorExpense, deleteVendorExpense };
}
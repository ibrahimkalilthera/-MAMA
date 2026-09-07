/**
 * Payment + salary payment operations — built from SupabaseDataCtx.
 * Extracted from useSupabaseData.ts during the per-domain split.
 */
import { supabase } from '../supabaseClient';
import type { SupabaseDataCtx } from '../dataOpsContext';
import type { Payment, SalaryPayment } from '../domainTypes';
import { mapSalaryPaymentRow, createTempId } from '../rowMappers';
import { enqueueOfflineAction } from '../offlineQueue';
import { logAuditEvent } from '../auditLogger';

export function createPaymentOps(ctx: SupabaseDataCtx) {
  const { setStudents, setSalaryPayments, notifySuccess, notifyError, isOffline, enqueueOffline, updateQueueCount } = ctx;

  const addPayment = async (studentId: string, payment: Omit<Payment, 'receiptNumber'> & { receiptNumber?: string }): Promise<boolean> => {
    const isOnline = navigator.onLine;

    let optimisticAmountPaid: number | null = null;
    setStudents(prev => prev.map(s => {
      if (s.id === studentId) {
        const newPayments = [...s.payments, payment];
        optimisticAmountPaid = s.amountPaid + payment.amount;
        return {
          ...s,
          payments: newPayments,
          amountPaid: optimisticAmountPaid,
          lastPaymentDate: payment.date,
        };
      }
      return s;
    }));

    if (!isOnline) {
      enqueueOfflineAction('addPayment', { studentId, payment });
      updateQueueCount();
      notifySuccess('addPayment');
      return true;
    }

    try {
      const { error } = await supabase.from('payments').insert({
        student_id: studentId,
        date: payment.date,
        amount: payment.amount,
        academic_year: payment.academicYear || null,
        receipt_number: payment.receiptNumber || null,
      });

      if (error) {
        console.error('addPayment error:', error.message);
        enqueueOfflineAction('addPayment', { studentId, payment });
        updateQueueCount();
        notifySuccess('addPayment');
        return true;
      }

      if (optimisticAmountPaid != null) {
        await supabase.from('students').update({
          amount_paid: optimisticAmountPaid,
          last_payment_date: payment.date,
        }).eq('id', studentId);
      }

      logAuditEvent({
        action: 'RECORD_PAYMENT',
        targetType: 'payment',
        targetId: studentId,
        details: `Payment of ${payment.amount} FCFA recorded (Receipt: ${payment.receiptNumber || 'N/A'})`,
      });

      notifySuccess('addPayment');
      return true;
    } catch (err) {
      enqueueOfflineAction('addPayment', { studentId, payment });
      updateQueueCount();
      notifySuccess('addPayment');
      return true;
    }
  };

  const addSalaryPayment = async (sp: Omit<SalaryPayment, 'id'>): Promise<SalaryPayment | null> => {
    if (isOffline()) {
      const tempId = createTempId('salary');
      const local: SalaryPayment = { id: tempId, ...sp };
      setSalaryPayments(prev => [...prev, local]);
      enqueueOffline('addSalaryPayment', sp);
      notifySuccess('addSalaryPayment');
      return local;
    }
    const { data, error } = await supabase
      .from('salary_payments')
      .insert({
        staff_id: sp.staffId,
        amount: sp.amount,
        date: sp.date,
        academic_year: sp.academicYear || null,
      })
      .select()
      .single();
    if (error) { console.error('addSalaryPayment error:', error.message); notifyError('addSalaryPayment', error.message); return null; }
    const mapped = mapSalaryPaymentRow(data);
    setSalaryPayments(prev => [...prev, mapped]);
    notifySuccess('addSalaryPayment');
    return mapped;
  };

  return { addPayment, addSalaryPayment };
}
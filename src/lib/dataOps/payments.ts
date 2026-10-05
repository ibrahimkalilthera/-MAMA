/**
 * Payment + salary payment operations — built from SupabaseDataCtx.
 * Extracted from useSupabaseData.ts during the per-domain split.
 */
import { supabase } from '../supabaseClient';
import type { SupabaseDataCtx } from '../dataOpsContext';
import type { Payment, SalaryPayment, Student } from '../domainTypes';
import { mapSalaryPaymentRow, createRowId } from '../rowMappers';
import { rowIdColumn } from '../offlineReplay';
import { enqueueOfflineAction } from '../offlineQueue';
import { logAuditEvent } from '../auditLogger';

export function createPaymentOps(ctx: SupabaseDataCtx) {
  const { students, setStudents, setSalaryPayments, notifySuccess, notifyError, isOffline, enqueueOffline, updateQueueCount } = ctx;

  const addPayment = async (studentId: string, payment: Omit<Payment, 'receiptNumber'> & { receiptNumber?: string }): Promise<boolean> => {
    // « En ligne » veut dire « un aller-retour serveur est possible » : sans
    // réseau OU sans session utilisable (connexion hors ligne pas encore
    // rouverte), le paiement est mis en file — jamais tenté puis perdu.
    const isOnline = !isOffline();

    // L'id du GESTE — porté par le paiement (l'écran le minte une fois par
    // saisie) ou minté ici à défaut. Un double envoi retombe sur la MÊME clé
    // primaire : la base refuse (23505) au lieu d'écrire un second reçu.
    const rowId = payment.id ?? createRowId();
    const paymentWithId: Payment = { ...payment, id: rowId };

    let optimisticAmountPaid: number | null = null;
    setStudents(prev => prev.map(s => {
      if (s.id === studentId) {
        // Idempotent : ce geste est DÉJÀ appliqué localement → on ne l'ajoute
        // pas une seconde fois (ni le paiement, ni le solde).
        if (s.payments.some(p => p.id === rowId)) return s;
        optimisticAmountPaid = s.amountPaid + payment.amount;
        return {
          ...s,
          payments: [...s.payments, paymentWithId],
          amountPaid: optimisticAmountPaid,
          lastPaymentDate: payment.date,
        };
      }
      return s;
    }));

    if (!isOnline) {
      enqueueOfflineAction('addPayment', { studentId, payment }, rowId);
      updateQueueCount();
      notifySuccess('addPayment');
      return true;
    }

    try {
      const { error } = await supabase.from('payments').insert({
        ...rowIdColumn(rowId),
        student_id: studentId,
        date: payment.date,
        amount: payment.amount,
        academic_year: payment.academicYear || null,
        receipt_number: payment.receiptNumber || null,
      });

      if (error) {
        // `23505` : le même geste est DÉJÀ enregistré (double envoi, reprise) —
        // ce n'est PAS une panne : la remettre en file la ferait rejouer pour
        // toujours. On rend « enregistré », sans erreur ni doublon local.
        if (error.code === '23505') {
          notifySuccess('addPayment');
          return true;
        }
        console.error('addPayment error:', error.message);
        enqueueOfflineAction('addPayment', { studentId, payment }, rowId);
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
        // Français, et c'est le choix du journal : les autres détails de ce
        // domaine le sont déjà (`nom X→Y`, `classe`, `statut`) — un journal
        // d'école se lit par l'école. La phrase anglaise homologue reste lisible :
        // les entrées écrites avant le 2026-09-13 sont traduites à l'AFFICHAGE
        // (`src/lib/auditDisplay.ts`), jamais réécrites en base.
        details: `Paiement de ${payment.amount} FCFA (reçu ${payment.receiptNumber || 'N/A'})`,
      });

      notifySuccess('addPayment');
      return true;
    } catch (err) {
      enqueueOfflineAction('addPayment', { studentId, payment }, rowId);
      updateQueueCount();
      notifySuccess('addPayment');
      return true;
    }
  };

  /**
   * SUPPRIMER un paiement enregistré par erreur.
   *
   * Le geste existe parce qu'une caisse se trompe : un montant saisi deux fois,
   * un mauvais élève, un reçu annulé. Jusqu'ici, le seul recours était de
   * supprimer l'ÉLÈVE ENTIER (`ON DELETE CASCADE` emportait alors tous ses
   * reçus) — disproportionné. On retire donc la SEULE ligne fautive.
   *
   * Trois choses suivent la suppression, et aucune n'est cosmétique :
   *   • la ligne part de `payments` (`.select('id')` : zéro ligne = la policy
   *     « Admin delete payments » a refusé, et l'écran le DIT — la suppression
   *     est réservée aux administrateurs, voir `src/lib/deleteRights.ts`) ;
   *   • `students.amount_paid` redescend du montant annulé, jamais sous zéro ;
   *     `last_payment_date` redescend sur le paiement le plus récent QUI RESTE ;
   *   • une entrée `DELETE_PAYMENT` est écrite dans le journal d'audit, avec le
   *     montant, le reçu et l'élève — c'est la trace que l'école relit.
   *
   * Hors ligne, le geste est mis en file (aucun octet perdu) et le rejeu
   * l'audite comme les autres suppressions. Limite, dite : le rejeu supprime la
   * ligne mais ne réécrit PAS `students.amount_paid` (même partage que
   * `addPayment`, dont le rejeu ne touche pas non plus à ce solde) — la colonne
   * y reste donc en avance tant que la page n'a pas rechargé ses élèves.
   */
  const deletePayment = async (studentId: string, payment: Payment): Promise<boolean> => {
    const paymentId = payment.id;
    if (!paymentId) {
      notifyError('deletePayment', 'Ce paiement n’a pas d’identifiant — suppression impossible.');
      return false;
    }
    const studentName = students.find(s => s.id === studentId)?.name ?? studentId;

    /** Retire le paiement du listing local et RECALCULE solde + dernière date. */
    const applyLocally = (list: Student[]): Student[] => list.map(s => {
      if (s.id !== studentId) return s;
      const remaining = s.payments.filter(p => p.id !== paymentId);
      const dates = remaining.map(p => p.date).filter(Boolean).sort();
      return {
        ...s,
        payments: remaining,
        // Un solde payé ne peut pas être négatif : on borne à 0 plutôt que
        // d'écrire une dette qui n'existe pas.
        amountPaid: Math.max(0, s.amountPaid - payment.amount),
        lastPaymentDate: dates.length ? dates[dates.length - 1] : undefined,
      };
    });

    if (isOffline()) {
      setStudents(prev => applyLocally(prev));
      enqueueOffline('deletePayment', {
        studentId,
        paymentId,
        amount: payment.amount,
        receiptNumber: payment.receiptNumber,
        date: payment.date,
      });
      updateQueueCount();
      notifySuccess('deletePayment');
      return true;
    }

    const { data, error } = await supabase.from('payments').delete().eq('id', paymentId).select('id');
    if (error) {
      console.error('deletePayment error:', error.message);
      notifyError('deletePayment', error.message);
      return false;
    }
    if (!data || data.length === 0) {
      console.error('deletePayment: aucune ligne supprimée — cible filtrée par la policy RLS');
      notifyError('deletePayment', 'Aucune ligne supprimée — droits insuffisants sur ce paiement.');
      return false;
    }

    setStudents(prev => applyLocally(prev));

    // Le solde est réécrit depuis la liste DÉJÀ corrigée (la valeur que l'écran
    // montre), pas soustrait en aveugle côté serveur.
    const student = students.find(s => s.id === studentId);
    if (student) {
      const remaining = student.payments.filter(p => p.id !== paymentId);
      const dates = remaining.map(p => p.date).filter(Boolean).sort();
      await supabase.from('students').update({
        amount_paid: Math.max(0, student.amountPaid - payment.amount),
        last_payment_date: dates.length ? dates[dates.length - 1] : null,
      }).eq('id', studentId);
    }

    void logAuditEvent({
      action: 'DELETE_PAYMENT',
      targetType: 'payment',
      targetId: studentId,
      // Même forme que `RECORD_PAYMENT` (montant + reçu), plus l'élève : le
      // journal doit dire QUEL reçu a été retiré et de qui.
      details: `Paiement de ${payment.amount} FCFA (reçu ${payment.receiptNumber || 'N/A'}) du ${payment.date} supprimé — élève ${studentName}`,
    });

    notifySuccess('deletePayment');
    return true;
  };

  const addSalaryPayment = async (sp: Omit<SalaryPayment, 'id'> & { id?: string }): Promise<SalaryPayment | null> => {
    // L'id du GESTE — minté par l'écran (une fois par paiement ouvert) ou ici à
    // défaut. Un double envoi paie le salaire UNE fois, pas deux.
    const rowId = sp.id ?? createRowId();
    if (isOffline()) {
      const local: SalaryPayment = { ...sp, id: rowId };
      setSalaryPayments(prev => prev.some(p => p.id === rowId) ? prev : [...prev, local]);
      enqueueOffline('addSalaryPayment', sp, rowId);
      notifySuccess('addSalaryPayment');
      return local;
    }
    const { data, error } = await supabase
      .from('salary_payments')
      .insert({
        ...rowIdColumn(rowId),
        staff_id: sp.staffId,
        amount: sp.amount,
        date: sp.date,
        academic_year: sp.academicYear || null,
      })
      .select()
      .single();
    if (error) {
      // `23505` : le même salaire est déjà enregistré — la ligne est rendue sans
      // erreur ni seconde entrée de journal.
      if (error.code === '23505' && rowIdColumn(rowId).id) {
        const existing = await supabase.from('salary_payments').select().eq('id', rowId).single();
        if (existing.data) {
          const already = mapSalaryPaymentRow(existing.data);
          setSalaryPayments(prev => prev.some(p => p.id === already.id) ? prev : [...prev, already]);
          return already;
        }
      }
      console.error('addSalaryPayment error:', error.message); notifyError('addSalaryPayment', error.message); return null;
    }
    const mapped = mapSalaryPaymentRow(data);
    setSalaryPayments(prev => prev.some(p => p.id === mapped.id) ? prev : [...prev, mapped]);
    void logAuditEvent({
      action: 'RECORD_SALARY_PAYMENT',
      targetType: 'salary_payment',
      targetId: mapped.id,
      details: `${sp.amount} FCFA (${sp.date})`,
    });
    notifySuccess('addSalaryPayment');
    return mapped;
  };

  return { addPayment, deletePayment, addSalaryPayment };
}
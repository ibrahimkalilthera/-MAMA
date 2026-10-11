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
import { archivedPaymentFrom, paymentSnapshotMetadata } from '../paymentUndo';
import type { ArchivedPayment } from '../paymentUndo';
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
        // Les mois couverts — `[]` quand rien n'est précisé, jamais `null` :
        // la colonne est NOT NULL, et un reçu relu y lit « rien de renseigné ».
        months: payment.months ?? [],
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
        // L'instantané STRUCTURÉ du geste — la même forme qu'à la suppression et
        // à la restauration. C'est lui, et rien d'autre, qui donne à l'Historique
        // des paiements un montant CHIFFRÉ et un élève lié : découper le montant
        // dans la phrase ci-dessus ferait lire de la prose comme des données.
        metadata: paymentSnapshotMetadata(archivedPaymentFrom(
          studentId,
          students.find(s => s.id === studentId)?.name,
          paymentWithId,
        )),
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
   * l'audite comme les autres suppressions ET réconcilie le même solde : il
   * retire le montant de `students.amount_paid` (borné à 0) et recale
   * `last_payment_date` sur le paiement le plus récent QUI RESTE (voir
   * `reconcileStudentBalance`, `src/lib/offlineReplay.ts`). Le solde ne dérive
   * donc plus après un drainage.
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
        // L'année ET l'élève voyagent aussi : sans eux, le rejeu ne pourrait pas
        // écrire l'instantané complet, et la suppression ne serait pas annulable.
        academicYear: payment.academicYear,
        studentName,
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
      // `target_id` est l'ID DU PAIEMENT (pas l'élève) : c'est lui qui relie
      // l'entrée à son instantané, donc à une éventuelle restauration.
      targetId: paymentId,
      // Même forme que `RECORD_PAYMENT` (montant + reçu), plus l'élève : le
      // journal doit dire QUEL reçu a été retiré et de qui.
      details: `Paiement de ${payment.amount} FCFA (reçu ${payment.receiptNumber || 'N/A'}) du ${payment.date} supprimé — élève ${studentName}`,
      // L'instantané qui rend le geste ANNULABLE : la ligne entière, de quoi la
      // réinsérer à l'identique (voir `restorePayment`).
      metadata: paymentSnapshotMetadata(archivedPaymentFrom(studentId, studentName, payment)),
    });

    notifySuccess('deletePayment');
    return true;
  };

  /**
   * RESTAURER un paiement supprimé — l'annulation, depuis le journal d'audit.
   *
   * L'instantané (`ArchivedPayment`) vient du `metadata` de l'entrée
   * `DELETE_PAYMENT` : la vue Audit le relit et le passe ici. On réinsère la ligne
   * avec son ID D'ORIGINE — le reçu retrouve son identité, et une restau-
   * ration rejouée retombe sur la même ligne (23505 = « déjà revenu ») au lieu
   * d'en créer une seconde.
   *
   * Deux choses suivent, comme à la suppression mais à l'envers :
   *   • `students.amount_paid` REMONTE du montant restauré, et `last_payment_date`
   *     repart sur le paiement le plus récent ;
   *   • une entrée `RESTORE_PAYMENT` est écrite — le journal garde les DEUX gestes,
   *     la suppression et sa réparation, dans l'ordre.
   *
   * Limite dite : la restauration demande le RÉSEAU. L'instantané vit dans le
   * journal de la base ; hors ligne on ne peut ni le relire de source sûre ni
   * garantir la réinsertion, donc on refuse au lieu de faire semblant.
   */
  const restorePayment = async (archived: ArchivedPayment): Promise<boolean> => {
    if (!archived.paymentId || !archived.studentId) {
      notifyError('restorePayment', 'Instantané incomplet — restauration impossible.');
      return false;
    }
    if (isOffline()) {
      notifyError('restorePayment', 'La restauration demande le réseau : l’instantané est relu dans le journal de la base.');
      return false;
    }
    const studentName = archived.studentName
      ?? students.find(s => s.id === archived.studentId)?.name
      ?? archived.studentId;

    const { error } = await supabase.from('payments').insert({
      id: archived.paymentId,
      student_id: archived.studentId,
      date: archived.date,
      amount: archived.amount,
      academic_year: archived.academicYear ?? null,
      receipt_number: archived.receiptNumber ?? null,
      // Les mois reviennent avec le reste : une restauration qui les perdrait
      // rendrait un reçu amputé — le contraire du geste annulé.
      months: archived.months ?? [],
    });
    if (error && error.code !== '23505') {
      console.error('restorePayment error:', error.message);
      notifyError('restorePayment', error.message);
      return false;
    }
    // `23505` : la ligne est déjà revenue (seconde restauration, ou rejeu). On ne
    // crie pas et on n'ajoute pas le montant deux fois — l'état local est calculé
    // à partir de ce que l'écran montre DÉJÀ.
    const student = students.find(s => s.id === archived.studentId);
    if (student) {
      const already = student.payments.some(p => p.id === archived.paymentId);
      const restored: Payment = {
        id: archived.paymentId,
        date: archived.date,
        amount: archived.amount,
        academicYear: archived.academicYear,
        receiptNumber: archived.receiptNumber,
        months: archived.months,
      };
      const payments = already ? student.payments : [...student.payments, restored];
      const dates = payments.map(p => p.date).filter(Boolean).sort();
      const amountPaid = already ? student.amountPaid : student.amountPaid + archived.amount;
      setStudents(prev => prev.map(s => s.id === archived.studentId
        ? { ...s, payments, amountPaid, lastPaymentDate: dates.length ? dates[dates.length - 1] : undefined }
        : s));
      await supabase.from('students').update({
        amount_paid: amountPaid,
        last_payment_date: dates.length ? dates[dates.length - 1] : null,
      }).eq('id', archived.studentId);
    }

    void logAuditEvent({
      action: 'RESTORE_PAYMENT',
      targetType: 'payment',
      targetId: archived.paymentId,
      details: `Paiement de ${archived.amount} FCFA (reçu ${archived.receiptNumber || 'N/A'}) du ${archived.date} restauré — élève ${studentName}`,
      metadata: paymentSnapshotMetadata(archived),
    });

    notifySuccess('restorePayment');
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

  return { addPayment, deletePayment, restorePayment, addSalaryPayment };
}
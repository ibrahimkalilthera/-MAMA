/**
 * Student CRUD + batch promotion operations — built from SupabaseDataCtx.
 * Extracted from useSupabaseData.ts during the per-domain split.
 */
import { supabase } from '../supabaseClient';
import type { SupabaseDataCtx } from '../dataOpsContext';
import type { Student } from '../domainTypes';
import { mapStudentRow, createRowId } from '../rowMappers';
import { rowIdColumn, studentToRow, studentUpdatesToRow } from '../offlineReplay';
import { studentMatricule } from '../studentIdentifiers';
import { logAuditEvent } from '../auditLogger';
import { localIsoDate, systemClock } from '../dateWindows';
import {
  deleteAuditDetails,
  mergeAuditDetails,
  mergeSnapshotMetadata,
  mergedLedger,
  mergedNotes,
  studentSnapshotMetadata,
} from '../studentMerge';

export function createStudentOps(ctx: SupabaseDataCtx) {
  const { students, setStudents, notifySuccess, notifyError, isOffline, enqueueOffline } = ctx;

  const addStudent = async (student: Omit<Student, 'id' | 'payments'> & { id?: string }): Promise<Student | null> => {
    const normalizedStudent = {
      ...student,
      studentId: studentMatricule(student.studentId),
    };
    // L'id du GESTE — minté par l'écran (une fois par fiche ouverte) ou ici à
    // défaut. C'est lui qui rend l'écriture IDEMPOTENTE : le même geste rejoué
    // (double clic, reprise après coupure) retombe sur la MÊME clé primaire.
    const rowId = student.id ?? createRowId();
    if (isOffline()) {
      const local: Student = { id: rowId, ...normalizedStudent, payments: [] };
      setStudents(prev => prev.some(s => s.id === rowId) ? prev : [...prev, local]);
      enqueueOffline('addStudent', normalizedStudent, rowId);
      notifySuccess('addStudent');
      return local;
    }
    const { data, error } = await supabase
      .from('students')
      .insert({ ...rowIdColumn(rowId), ...studentToRow(normalizedStudent) })
      .select()
      .single();
    if (error) {
      // `23505` : la clé primaire existe DÉJÀ — c'est le même geste, déjà
      // enregistré (double envoi, reprise). On rend la ligne telle qu'elle est en
      // base, et on n'écrit PAS une seconde entrée de journal : un élève, un
      // geste, une ligne d'audit. C'est ce qui a créé des doublons le
      // 2026-10-05 (« Mahamadou DJIRE » ×7) — et c'est ici que ça s'arrête.
      if (error.code === '23505' && rowIdColumn(rowId).id) {
        const existing = await supabase.from('students').select().eq('id', rowId).single();
        if (existing.data) {
          const already = mapStudentRow(existing.data, []);
          setStudents(prev => prev.some(s => s.id === already.id) ? prev : [...prev, already]);
          return already;
        }
      }
      console.error('addStudent error:', error.message);
      notifyError('addStudent', error.message);
      return null;
    }
    const mapped = mapStudentRow(data, []);
    setStudents(prev => prev.some(s => s.id === mapped.id) ? prev : [...prev, mapped]);
    void logAuditEvent({
      action: 'ADD_STUDENT',
      targetType: 'student',
      targetId: mapped.id,
      details: mapped.name,
    });
    notifySuccess('addStudent');
    return mapped;
  };

  const updateStudent = async (id: string, updates: Partial<Student>): Promise<boolean> => {
    const currentStudent = students.find(s => s.id === id);
    // Le matricule n'est plus normalisé ici : il ne dépend plus de la classe, et
    // il ne se vide plus (c'est la BASE qui l'attribue, à l'insertion). `updates`
    // traverse donc tel quel, et `studentUpdatesToRow` n'écrit `student_id` que
    // lorsqu'une valeur non vide est fournie.
    const normalizedUpdates = updates;
    if (isOffline()) {
      setStudents(prev => prev.map(s => s.id === id ? { ...s, ...normalizedUpdates } : s));
      enqueueOffline('updateStudent', { id, updates: normalizedUpdates });
      notifySuccess('updateStudent');
      return true;
    }
    const row = studentUpdatesToRow(normalizedUpdates);
    // `.select('id')` + the empty check is what makes this write HONEST — the
    // same rule as staff.ts. PostgREST answers 200 with an EMPTY body when the
    // RLS `USING` clause removes every target row (a non-admin editing a pupil,
    // for instance): the request "succeeded", changed nothing, and used to be
    // reported as success — the screen then showed a value the database does
    // not have. Zero rows is a failure and says so.
    const { data, error } = await supabase.from('students').update(row).eq('id', id).select('id');
    if (error) { console.error('updateStudent error:', error.message); notifyError('updateStudent', error.message); return false; }
    if (!data || data.length === 0) {
      console.error('updateStudent: aucune ligne modifiée — cible filtrée par la policy RLS');
      notifyError('updateStudent', 'Aucune ligne modifiée — droits insuffisants sur cet élève.');
      return false;
    }
    const changes: string[] = [];
    if (currentStudent && normalizedUpdates.name !== undefined && normalizedUpdates.name !== currentStudent.name) changes.push(`nom ${currentStudent.name}→${normalizedUpdates.name}`);
    if (currentStudent && normalizedUpdates.grade !== undefined && normalizedUpdates.grade !== currentStudent.grade) changes.push(`classe ${currentStudent.grade}→${normalizedUpdates.grade}`);
    if (currentStudent && normalizedUpdates.totalDue !== undefined && normalizedUpdates.totalDue !== currentStudent.totalDue) changes.push(`total dû ${currentStudent.totalDue}→${normalizedUpdates.totalDue}`);
    if (currentStudent && normalizedUpdates.status !== undefined && normalizedUpdates.status !== currentStudent.status) changes.push(`statut ${currentStudent.status}→${normalizedUpdates.status}`);
    void logAuditEvent({
      action: 'UPDATE_STUDENT',
      targetType: 'student',
      targetId: id,
      details: `${currentStudent?.name || id}${changes.length ? ` — ${changes.join(', ')}` : ''}`,
    });
    setStudents(prev => prev.map(s => s.id === id ? { ...s, ...normalizedUpdates } : s));
    notifySuccess('updateStudent');
    return true;
  };

  const deleteStudent = async (id: string): Promise<boolean> => {
    if (isOffline()) {
      setStudents(prev => prev.filter(s => s.id !== id));
      enqueueOffline('deleteStudent', { id });
      notifySuccess('deleteStudent');
      return true;
    }
    // Same honesty rule as deleteStaff: an RLS-filtered DELETE removes zero
    // rows and answers 200, so « Élève supprimé(e) » could be shown for a pupil
    // still in the table — and their payments with them (ON DELETE CASCADE
    // never fires, because no row was deleted). `.select('id')` tells us what
    // really went.
    const { data, error } = await supabase.from('students').delete().eq('id', id).select('id');
    if (error) { console.error('deleteStudent error:', error.message); notifyError('deleteStudent', error.message); return false; }
    if (!data || data.length === 0) {
      console.error('deleteStudent: aucune ligne supprimée — cible filtrée par la policy RLS');
      notifyError('deleteStudent', 'Aucune ligne supprimée — droits insuffisants sur cet élève.');
      return false;
    }
    const deleted = students.find(s => s.id === id);
    void logAuditEvent({
      action: 'DELETE_STUDENT',
      targetType: 'student',
      targetId: id,
      // La phrase NOMME la fiche avec ce qui la DISTINGUE — matricule, classe,
      // parent, montants, reçus. Jusqu'ici elle n'écrivait que le nom : deux
      // homonymes produisaient deux entrées identiques, et le journal ne disait
      // pas laquelle était partie. Le `metadata` porte la fiche entière — c'est
      // la trace que l'outil de comparaison promet avant de laisser supprimer.
      details: deleted ? deleteAuditDetails(deleted) : undefined,
      metadata: deleted ? studentSnapshotMetadata(deleted) : null,
    });
    setStudents(prev => prev.filter(s => s.id !== id));
    notifySuccess('deleteStudent');
    return true;
  };

  /**
   * Passage de classe / réinscription d'un lot d'élèves.
   *
   * La promotion ne parle PLUS à Supabase directement : elle construit la mise
   * à jour dans la forme du DOMAINE (`Partial<Student>`) et la confie à
   * `updateStudent`, exactement comme le formulaire d'un élève. C'est ce qui la
   * rend capable de traverser une coupure de réseau comme le reste de la
   * saisie : hors ligne, chaque élève passe dans la file d'attente et l'écran
   * est mis à jour tout de suite, puis la base reçoit le lot au retour de la
   * ligne.
   *
   * Ce qui a changé au passage : l'ancienne version écrivait directement et
   * comptait un succès dès que la requête ne rendait PAS d'erreur. Hors ligne,
   * chaque appel échouait, `successCount` restait à 0… et la fonction rendait
   * quand même `true` — l'écran annonçait donc une promotion réussie pour zéro
   * élève promu. Le contrat est maintenant exact : `true` seulement si TOUS les
   * élèves du lot sont passés (écrits ou mis en file), et chaque échec est déjà
   * annoncé par `updateStudent` (toast d'erreur, ligne RLS filtrée).
   */
  const batchPromoteStudents = async (
    promotions: Array<{
      studentId: string;
      action: 'promote' | 'repeat' | 'graduate' | 'leave';
      targetGrade?: string;
      targetAcademicYear: string;
      newTotalDue?: number;
    }>
  ): Promise<boolean> => {
    try {
      let successCount = 0;
      for (const item of promotions) {
        const student = students.find(s => s.id === item.studentId);
        if (!student) continue;

        const updates: Partial<Student> = {};
        if (item.action === 'promote' || item.action === 'repeat') {
          updates.academicYear = item.targetAcademicYear;
          // Le matricule ne bouge PAS avec une promotion : il appartient à
          // l'élève, pas à sa classe (src/lib/studentIdentifiers.ts).
          if (item.targetGrade) updates.grade = item.targetGrade;
          if (item.newTotalDue !== undefined) updates.totalDue = item.newTotalDue;
          updates.amountPaid = 0;
          updates.status = 'Active';
        } else if (item.action === 'graduate') {
          updates.status = 'Graduated';
        } else if (item.action === 'leave') {
          updates.status = 'Left';
        }

        if (await updateStudent(item.studentId, updates)) successCount++;
      }

      logAuditEvent({
        action: 'PROMOTE_CLASS_BATCH',
        targetType: 'students',
        details: `Promotions/réinscriptions traitées pour ${successCount} élève(s)`,
      });

      notifySuccess(`Promoted ${successCount} student(s)`);
      return successCount === promotions.length;
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Promotion failed';
      console.error('batchPromoteStudents error:', err);
      notifyError('batchPromoteStudents', msg);
      return false;
    }
  };

  /**
   * FUSIONNER des fiches homonymes dans celle que l'école a gardée.
   *
   * Le geste de l'outil de comparaison (`DuplicateReviewModal`) : deux fiches
   * portent le même nom dans la même classe, l'école désigne la BONNE, et l'autre
   * disparaît — sans perdre ce qu'elle portait. Trois écritures, dans cet ordre,
   * et c'est l'ordre qui fait la sûreté :
   *   *   1. les REÇUS des fiches fusionnées sont RATTACHÉS à la fiche gardée
   *      (`payments.student_id`), par la FONCTION bornée de la base
   *      `public.reassign_payment_student` — le SEUL chemin d'écriture de cette
   *      colonne depuis le 2026-10-13
   *      (`supabase/migrations/20261013000001_payments_write_lock.sql`) : une
   *      policy borne des LIGNES, donc l'ouvrir pour ce geste aurait rouvert le
   *      MONTANT avec. Elle rend le NOMBRE de lignes écrites, et zéro n'est pas un
   *      succès — se croire « déplacé » sur un zéro laisserait la cascade qui suit
   *      DÉTRUIRE les reçus avec la fiche. Moins de lignes que prévu = refus ;
   *   2. le grand livre consolidé est écrit sur la fiche gardée : montant payé =
   *      SOMME des montants enregistrés (jamais recalculé depuis les lignes de
   *      reçus — un import historique peut avoir laissé un solde sans ligne, et la
   *      fiche est ce que l'école a validé), dernière date = la plus récente de
   *      toutes, et les notes des fiches retirées recopiées derrière un repère daté ;
   *   3. les fiches fusionnées sont supprimées d'UN SEUL geste (`.in()`) — elles ne
   *      portent plus aucun reçu, donc la cascade n'a rien à emporter.
   *
   * En cas de refus à l'étape 2 ou 3, les reçus sont REMIS sur leur fiche
   * d'origine et la fiche gardée retrouve ses valeurs d'avant. Un demi-geste qui
   * survivrait à l'écran (des reçus sur une fiche, un solde consolidé, deux fiches
   * encore là) serait pire qu'un refus : c'est exactement ce que l'école aurait le
   * plus de mal à défaire à la main.
   *
   * RÉSEAU REQUIS, et l'appelant le dit à l'utilisateur : la file hors ligne
   * connaît des gestes SUR UNE ligne (`deleteStudent`, `updateStudent`, …) ; une
   * fusion en déplace plusieurs avant d'en supprimer une, et un rejeu partiel
   * laisserait des reçus sur une fiche sans propriétaire. Même règle, et même
   * refus, que `restorePayment`.
   *
   * UNE entrée de journal : `MERGE_STUDENT`, avec l'instantané complet des fiches
   * — la gardée, les retirées, et les reçus déplacés. Le journal ne se réécrit
   * jamais ; l'entrée s'ajoute, et elle suffit à refaire le geste à la main.
   */
  const mergeStudents = async (survivorId: string, mergedIds: string[]): Promise<boolean> => {
    const survivor = students.find(s => s.id === survivorId);
    const removed = mergedIds
      .filter(id => id && id !== survivorId)
      .map(id => students.find(s => s.id === id))
      .filter((s): s is Student => Boolean(s));
    if (!survivor || removed.length === 0) {
      notifyError('mergeStudents', 'Fusion impossible : la fiche gardée ou les fiches à fusionner sont introuvables.');
      return false;
    }
    if (isOffline()) {
      notifyError('mergeStudents', 'La fusion demande le réseau : les reçus changent de fiche, et un demi-geste serait pire qu’un refus.');
      return false;
    }

    const movedReceipts = removed.flatMap(fiche => fiche.payments);    /**
     * Le rattachement borné d'un reçu — la SEULE écriture de `payments` de ce
     * dépôt. La fonction de la base
     * (`public.reassign_payment_student(uuid, uuid, uuid)`,
     * `20261013000001_payments_write_lock.sql`) est `SECURITY DEFINER`, gardée par
     * `public.is_admin()`, et sa requête ne nomme qu'UNE colonne : `student_id`.
     * Ni le montant, ni la date, ni le numéro du reçu n'y sont : c'est une borne
     * par CONSTRUCTION, celle qu'une policy ne pouvait pas donner.
     *
     * Elle EXIGE la fiche d'origine et rend le NOMBRE de lignes écrites : un reçu
     * qui n'est plus sur la fiche attendue rend 0, et zéro n'est pas un succès —
     * quelqu'un l'a rattaché ailleurs entre-temps, et partir de là ferait
     * supprimer une fiche en emportant par cascade des reçus qu'on croit déplacés.
     */
    const reassignReceipt = async (
      paymentId: string,
      fromStudentId: string,
      toStudentId: string,
    ): Promise<boolean> => {
      const { data, error } = await supabase.rpc('reassign_payment_student', {
        p_payment_id: paymentId,
        p_from_student_id: fromStudentId,
        p_to_student_id: toStudentId,
      });
      if (error) {
        console.error('mergeStudents: reçu non rattaché —', error.message);
        return false;
      }
      return data === 1;
    };
    /** Les reçus remis sur leur fiche d'origine — l'annulation d'un demi-geste. */
    const putReceiptsBack = async () => {
      for (const fiche of removed) {
        for (const payment of fiche.payments) {
          if (!payment.id) continue;
          await reassignReceipt(payment.id, survivorId, fiche.id);
        }
      }
    };
    /** La fiche gardée rendue à ses valeurs d'avant (mêmes colonnes que l'étape 2). */
    const restoreSurvivor = async () => {
      await supabase.from('students').update({
        amount_paid: survivor.amountPaid,
        last_payment_date: survivor.lastPaymentDate ?? null,
        notes: survivor.notes,
      }).eq('id', survivorId);
    };    // 1. Les reçus changent de fiche, UN PAR UN — et chacun est vérifié.
    for (const fiche of removed) {
      for (const payment of fiche.payments) {
        if (!payment.id) continue;
        if (!(await reassignReceipt(payment.id, fiche.id, survivorId))) {
          await putReceiptsBack();
          notifyError('mergeStudents', 'Reçus non rattachés — droits insuffisants, ou les reçus ont changé. Rien n’a été fusionné.');
          return false;
        }
      }
      // Et AUCUN reçu ne doit rester sous une fiche qu'on va supprimer : la
      // cascade `ON DELETE CASCADE` emporterait tout ce qui traîne — y compris un
      // reçu arrivé depuis que l'écran a lu la fiche, que la liste ci-dessus ne
      // connaît pas. C'est le compte exact que la mise à jour groupée faisait
      // autrefois (`data.length !== expected`).
      const { data: left, error: leftError } = await supabase
        .from('payments')
        .select('id')
        .eq('student_id', fiche.id);
      if (leftError || !left || left.length > 0) {
        console.error('mergeStudents: reçus restés sur la fiche —', leftError?.message ?? `${left?.length ?? 0} ligne(s)`);
        await putReceiptsBack();
        notifyError('mergeStudents', 'Reçus non rattachés — droits insuffisants, ou les reçus ont changé. Rien n’a été fusionné.');
        return false;
      }
    }

    // 2. Le grand livre consolidé + les notes recopiées, sur la fiche gardée.
    const ledger = mergedLedger(survivor, removed);
    const notes = mergedNotes(survivor, removed, localIsoDate(systemClock()));
    const { data: updated, error: updateError } = await supabase
      .from('students')
      .update(studentUpdatesToRow({ amountPaid: ledger.amountPaid, lastPaymentDate: ledger.lastPaymentDate, notes }))
      .eq('id', survivorId)
      .select('id');
    if (updateError || !updated || updated.length === 0) {
      console.error('mergeStudents: fiche gardée non mise à jour —', updateError?.message ?? 'aucune ligne');
      await putReceiptsBack();
      notifyError('mergeStudents', 'Aucune ligne modifiée — droits insuffisants sur la fiche gardée. Rien n’a été fusionné.');
      return false;
    }

    // 3. Les fiches fusionnées partent d'un seul geste (plus aucun reçu à elles :
    //    la cascade n'emporte rien).
    const removedIds = removed.map(fiche => fiche.id);
    const { data: deletedRows, error: deleteError } = await supabase
      .from('students')
      .delete()
      .in('id', removedIds)
      .select('id');
    if (deleteError || !deletedRows || deletedRows.length !== removedIds.length) {
      console.error('mergeStudents: fiches non supprimées —', deleteError?.message ?? `${deletedRows?.length ?? 0}/${removedIds.length} ligne(s)`);
      await putReceiptsBack();
      await restoreSurvivor();
      notifyError('mergeStudents', 'Fiches non supprimées — droits insuffisants. Rien n’a été fusionné.');
      return false;
    }

    setStudents(prev => prev
      .filter(s => !removedIds.includes(s.id))
      .map(s => s.id === survivorId
        ? { ...s, payments: ledger.payments, amountPaid: ledger.amountPaid, lastPaymentDate: ledger.lastPaymentDate, notes }
        : s));

    void logAuditEvent({
      action: 'MERGE_STUDENT',
      targetType: 'student',
      targetId: survivorId,
      details: mergeAuditDetails(survivor, removed, movedReceipts.length),
      metadata: mergeSnapshotMetadata(survivor, removed, movedReceipts),
    });

    notifySuccess('mergeStudents');
    return true;
  };

  return { addStudent, updateStudent, deleteStudent, mergeStudents, batchPromoteStudents };

}
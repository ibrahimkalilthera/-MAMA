/**
 * Student CRUD + batch promotion operations — built from SupabaseDataCtx.
 * Extracted from useSupabaseData.ts during the per-domain split.
 */
import { supabase } from '../supabaseClient';
import type { SupabaseDataCtx } from '../dataOpsContext';
import type { Student } from '../domainTypes';
import { mapStudentRow, createTempId } from '../rowMappers';
import { studentToRow, studentUpdatesToRow } from '../offlineReplay';
import { isNinthGradeClass, visibleStudentIdentifier } from '../studentIdentifiers';
import { logAuditEvent } from '../auditLogger';

export function createStudentOps(ctx: SupabaseDataCtx) {
  const { students, setStudents, notifySuccess, notifyError, isOffline, enqueueOffline } = ctx;

  const addStudent = async (student: Omit<Student, 'id' | 'payments'>): Promise<Student | null> => {
    const normalizedStudent = {
      ...student,
      studentId: visibleStudentIdentifier(student.grade, student.studentId),
    };
    if (isOffline()) {
      const tempId = createTempId('student');
      const local: Student = { id: tempId, ...normalizedStudent, payments: [] };
      setStudents(prev => [...prev, local]);
      enqueueOffline('addStudent', normalizedStudent);
      notifySuccess('addStudent');
      return local;
    }
    const { data, error } = await supabase
      .from('students')
      .insert(studentToRow(normalizedStudent))
      .select()
      .single();
    if (error) { console.error('addStudent error:', error.message); notifyError('addStudent', error.message); return null; }
    const mapped = mapStudentRow(data, []);
    setStudents(prev => [...prev, mapped]);
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
    const resultingGrade = updates.grade ?? currentStudent?.grade;
    const normalizedUpdates = !isNinthGradeClass(resultingGrade)
      ? { ...updates, studentId: '' }
      : updates.studentId !== undefined
        ? { ...updates, studentId: visibleStudentIdentifier(resultingGrade, updates.studentId) ?? '' }
        : updates.grade !== undefined
          ? { ...updates, studentId: visibleStudentIdentifier(resultingGrade, currentStudent?.studentId) ?? '' }
          : updates;
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
      details: deleted?.name,
    });
    setStudents(prev => prev.filter(s => s.id !== id));
    notifySuccess('deleteStudent');
    return true;
  };

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

        const rowUpdates: {
          academic_year?: string;
          grade?: string;
          student_id?: string | null;
          total_due?: number;
          amount_paid?: number;
          status?: 'Active' | 'Graduated' | 'Left';
        } = {};
        if (item.action === 'promote' || item.action === 'repeat') {
          rowUpdates.academic_year = item.targetAcademicYear;
          if (item.targetGrade) {
            rowUpdates.grade = item.targetGrade;
            rowUpdates.student_id = visibleStudentIdentifier(item.targetGrade, student.studentId) ?? null;
          }
          if (item.newTotalDue !== undefined) rowUpdates.total_due = item.newTotalDue;
          rowUpdates.amount_paid = 0;
          rowUpdates.status = 'Active';
        } else if (item.action === 'graduate') {
          rowUpdates.status = 'Graduated';
        } else if (item.action === 'leave') {
          rowUpdates.status = 'Left';
        }

        const { error } = await supabase
          .from('students')
          .update(rowUpdates)
          .eq('id', item.studentId);

        if (!error) {
          successCount++;
          setStudents(prev =>
            prev.map(s => {
              if (s.id !== item.studentId) return s;
              return {
                ...s,
                academicYear: rowUpdates.academic_year ?? s.academicYear,
                grade: rowUpdates.grade ?? s.grade,
                studentId: rowUpdates.student_id === undefined ? s.studentId : rowUpdates.student_id ?? undefined,
                totalDue: rowUpdates.total_due ?? s.totalDue,
                amountPaid: rowUpdates.amount_paid !== undefined ? rowUpdates.amount_paid : s.amountPaid,
                status: rowUpdates.status ?? s.status,
              };
            })
          );
        }
      }

      logAuditEvent({
        action: 'PROMOTE_CLASS_BATCH',
        targetType: 'students',
        details: `Promotions/réinscriptions traitées pour ${successCount} élève(s)`,
      });

      notifySuccess(`Promoted ${successCount} student(s)`);
      return true;
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Promotion failed';
      console.error('batchPromoteStudents error:', err);
      notifyError('batchPromoteStudents', msg);
      return false;
    }
  };

  return { addStudent, updateStudent, deleteStudent, batchPromoteStudents };
}
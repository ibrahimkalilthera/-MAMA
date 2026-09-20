/**
 * Offline queue replay — one item at a time.
 *
 * The per-action narrowing lives here as a pure function so it can be unit
 * tested with *each* `OfflineActionType` without needing a real Supabase
 * connection, React rendering, or a DOM. `useSupabaseData`'s `syncOfflineQueue`
 * drives the same function with the real client.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database, DbUpdate, Json } from './database.types';
import type { QueueItem } from './offlineQueue';
import type { Parent, Student, Staff } from '../app/types';
import { isNinthGradeClass, visibleStudentIdentifier } from './studentIdentifiers';
import { isUuid } from './rowMappers';
import type { LogAuditParams } from './auditLogger';

/** The surface of the Supabase client that replay touches. */
export type ReplayDb = Pick<SupabaseClient<Database>, 'from'>;

/**
 * The `id` to send for a row that was created while the station was offline.
 *
 * A pupil enrolled offline already carries a client-generated UUID (createRowId)
 * — the SAME id their receipt, their queued payment and every later edit point
 * at. Sending it is what makes the replay land on one row instead of creating a
 * second one and orphaning the rest.
 *
 * No UUID (WebCrypto missing, or an item queued by an older build): the column
 * is simply omitted and the database generates the id, exactly as before.
 */
export function rowIdColumn(localId: string | undefined): { id?: string } {
  return isUuid(localId) ? { id: localId } : {};
}

// ─── App type → Supabase insert mappers ──────────────────────────────────────

export function parentToRow(parent: Omit<Parent, 'id'>) {
  return {
    full_name: parent.fullName,
    phones: parent.phones,
    email: parent.email || null,
    address: parent.address,
    occupation: parent.occupation,
    relationship: parent.relationship,
    notes: parent.notes || null,
  };
}

export function studentToRow(student: Omit<Student, 'id' | 'payments'>) {
  return {
    parent_id: student.parentId || null,
    student_id: visibleStudentIdentifier(student.grade, student.studentId) || null,
    name: student.name,
    parent_name: student.parentName,
    parent_email: student.parentEmail || null,
    parent_phone: student.parentPhone,
    total_due: student.totalDue,
    amount_paid: student.amountPaid,
    scholarship_discount: student.scholarshipDiscount || 0,
    due_date: student.dueDate || null,
    last_payment_date: student.lastPaymentDate || null,
    notes: student.notes || null,
    last_note_date: student.lastNoteDate || null,
    note_entries: (student.noteEntries || []) as unknown as Json,
    flagged: student.flagged || false,
    academic_year: student.academicYear || null,
    grade: student.grade || null,
    photo: student.photo || null,
    emergency_contact_name: student.emergencyContactName || null,
    emergency_contact_relation: student.emergencyContactRelation || null,
    emergency_contact_phone: student.emergencyContactPhone || null,
    medical_notes: student.medicalNotes || null,
    enrollment_date: student.enrollmentDate || null,
    previous_school: student.previousSchool || null,
    status: student.status || 'Active',
  };
}

export function staffToRow(s: Omit<Staff, 'id'>) {
  return {
    name: s.name,
    position: s.position,
    salary: s.salary,
    email: s.email || null,
    phone: s.phone || null,
    bank_details: s.bankDetails || null,
    emergency_contact: s.emergencyContact || null,
    academic_year: s.academicYear || null,
    inps_number: s.inpsNumber || null,
    hire_date: s.hireDate || null,
    family_status: s.familyStatus || null,
    children_count: s.childrenCount ?? 0,
    travel_allowance: s.travelAllowance ?? 0,
    communication_allowance: s.communicationAllowance ?? 0,
    housing_allowance: s.housingAllowance ?? 0,
    // NOT NULL in the schema: a member queued offline before the category
    // existed is an employee, the same kind the app showed for them.
    category: s.category ?? 'employee',
  };
}

export function studentUpdatesToRow(updates: Partial<Student>): DbUpdate<'students'> {
  const row: DbUpdate<'students'> = {};
  if (updates.name !== undefined) row.name = updates.name;
  if ('parentId' in updates) row.parent_id = updates.parentId || null;
  if (updates.parentName !== undefined) row.parent_name = updates.parentName;
  if (updates.parentEmail !== undefined) row.parent_email = updates.parentEmail;
  if (updates.parentPhone !== undefined) row.parent_phone = updates.parentPhone;
  if (updates.totalDue !== undefined) row.total_due = updates.totalDue;
  if (updates.amountPaid !== undefined) row.amount_paid = updates.amountPaid;
  if (updates.scholarshipDiscount !== undefined) row.scholarship_discount = updates.scholarshipDiscount;
  if (updates.dueDate !== undefined) row.due_date = updates.dueDate;
  if (updates.lastPaymentDate !== undefined) row.last_payment_date = updates.lastPaymentDate;
  if (updates.notes !== undefined) row.notes = updates.notes;
  if (updates.lastNoteDate !== undefined) row.last_note_date = updates.lastNoteDate;
  if (updates.noteEntries !== undefined) row.note_entries = updates.noteEntries as unknown as Json;
  if (updates.flagged !== undefined) row.flagged = updates.flagged;
  if (updates.academicYear !== undefined) row.academic_year = updates.academicYear;
  if (updates.grade !== undefined) {
    row.grade = updates.grade;
    row.student_id = visibleStudentIdentifier(updates.grade, updates.studentId) ?? null;
  } else if (updates.studentId !== undefined) {
    row.student_id = updates.studentId.trim() || null;
  }
  if (updates.photo !== undefined) row.photo = updates.photo;
  if (updates.emergencyContactName !== undefined) row.emergency_contact_name = updates.emergencyContactName;
  if (updates.emergencyContactRelation !== undefined) row.emergency_contact_relation = updates.emergencyContactRelation;
  if (updates.emergencyContactPhone !== undefined) row.emergency_contact_phone = updates.emergencyContactPhone;
  if (updates.medicalNotes !== undefined) row.medical_notes = updates.medicalNotes;
  if (updates.enrollmentDate !== undefined) row.enrollment_date = updates.enrollmentDate;
  if (updates.previousSchool !== undefined) row.previous_school = updates.previousSchool;
  if (updates.status !== undefined) row.status = updates.status;
  return row;
}

// ─── Replay ──────────────────────────────────────────────────────────────────
// Mirrors the `if/else` chain previously inlined in useSupabaseData's
// `syncOfflineQueue`. Returns true when the action was applied without error.

export async function replayOfflineItem(db: ReplayDb, item: QueueItem): Promise<boolean> {
  let success = false;
  if (item.type === 'addPayment') {
    const { studentId, payment } = item.payload;
    const { error } = await db.from('payments').insert({
      student_id: studentId,
      date: payment.date,
      amount: payment.amount,
      academic_year: payment.academicYear || null,
      receipt_number: payment.receiptNumber || null,
    });
    if (!error) {
      await db.from('students').update({
        last_payment_date: payment.date,
      }).eq('id', studentId);
      success = true;
    }
  } else if (item.type === 'addExpense') {
    const { error } = await db.from('expenses').insert({
      ...rowIdColumn(item.localId),
      category: item.payload.category,
      description: item.payload.description,
      amount: item.payload.amount,
      date: item.payload.date,
      academic_year: item.payload.academicYear || null,
    });
    if (!error) success = true;
  } else if (item.type === 'updateExpense') {
    // Symétrique de `updateVendorExpense` : la modification d'une dépense
    // existante (import Excel en stratégie « mettre à jour ») devait pouvoir
    // attendre la ligne comme les autres écritures.
    const row: DbUpdate<'expenses'> = {};
    const u = item.payload.updates;
    if (u.category !== undefined) row.category = u.category;
    if (u.description !== undefined) row.description = u.description;
    if (u.amount !== undefined) row.amount = u.amount;
    if (u.date !== undefined) row.date = u.date;
    if (u.academicYear !== undefined) row.academic_year = u.academicYear;
    const { error } = await db.from('expenses').update(row).eq('id', item.payload.id);
    if (!error) success = true;
  } else if (item.type === 'deleteExpense') {
    const { error } = await db.from('expenses').delete().eq('id', item.payload.id);
    if (!error) success = true;
  } else if (item.type === 'addVendorExpense') {
    const { error } = await db.from('vendor_expenses').insert({
      ...rowIdColumn(item.localId),
      vendor_name: item.payload.vendorName,
      category: item.payload.category,
      amount: item.payload.amount,
      due_date: item.payload.dueDate,
      payment_status: item.payload.paymentStatus,
      amount_paid: item.payload.amountPaid,
      description: item.payload.description || null,
      academic_year: item.payload.academicYear || null,
      aid_type: item.payload.aidType || null,
      beneficiary_student_name: item.payload.beneficiaryStudentName || null,
      beneficiary_student_grade: item.payload.beneficiaryStudentGrade || null,
    });
    if (!error) success = true;
  } else if (item.type === 'addStudent') {
    const { error, data } = await db
      .from('students')
      .insert({ ...rowIdColumn(item.localId), ...studentToRow(item.payload) })
      .select()
      .single();
    if (!error && data) success = true;
  } else if (item.type === 'updateStudent') {
    const row = studentUpdatesToRow(item.payload.updates);
    const { error } = await db.from('students').update(row).eq('id', item.payload.id);
    if (!error) success = true;
  } else if (item.type === 'deleteStudent') {
    const { error } = await db.from('students').delete().eq('id', item.payload.id);
    if (!error) success = true;
  } else if (item.type === 'addStaff') {
    const { error } = await db.from('staff').insert({ ...rowIdColumn(item.localId), ...staffToRow(item.payload) });
    if (!error) success = true;
  } else if (item.type === 'updateStaff') {
    const row: DbUpdate<'staff'> = {};
    const u = item.payload.updates;
    if (u.name !== undefined) row.name = u.name;
    if (u.position !== undefined) row.position = u.position;
    if (u.salary !== undefined) row.salary = u.salary;
    if ('email' in u) row.email = u.email || null;
    if (u.phone !== undefined) row.phone = u.phone;
    if (u.bankDetails !== undefined) row.bank_details = u.bankDetails;
    if (u.emergencyContact !== undefined) row.emergency_contact = u.emergencyContact;
    const { error } = await db.from('staff').update(row).eq('id', item.payload.id);
    if (!error) success = true;
  } else if (item.type === 'deleteStaff') {
    const { error } = await db.from('staff').delete().eq('id', item.payload.id);
    if (!error) success = true;
  } else if (item.type === 'addSalaryPayment') {
    const { error } = await db.from('salary_payments').insert({
      ...rowIdColumn(item.localId),
      staff_id: item.payload.staffId,
      amount: item.payload.amount,
      date: item.payload.date,
      academic_year: item.payload.academicYear || null,
    });
    if (!error) success = true;
  } else if (item.type === 'addParent') {
    const { data, error } = await db
      .from('parents')
      .insert({ ...rowIdColumn(item.localId), ...parentToRow(item.payload) })
      .select()
      .single();
    if (!error && data) success = true;
  } else if (item.type === 'updateParent') {
    const row: DbUpdate<'parents'> = {};
    const u = item.payload.updates;
    if (u.fullName !== undefined) row.full_name = u.fullName;
    if (u.phones !== undefined) row.phones = u.phones;
    if ('email' in u) row.email = u.email || null;
    if (u.address !== undefined) row.address = u.address;
    if (u.occupation !== undefined) row.occupation = u.occupation;
    if (u.relationship !== undefined) row.relationship = u.relationship;
    if (u.notes !== undefined) row.notes = u.notes;
    const { error } = await db.from('parents').update(row).eq('id', item.payload.id);
    if (!error) success = true;
  } else if (item.type === 'deleteParent') {
    const { error } = await db.from('parents').delete().eq('id', item.payload.id);
    if (!error) success = true;
  } else if (item.type === 'addTodo') {
    const { error } = await db.from('todos').insert({
      ...rowIdColumn(item.localId),
      text: item.payload.text,
      completed: item.payload.completed,
      student_id: item.payload.studentId || null,
      due_date: item.payload.date || null,
    });
    if (!error) success = true;
  } else if (item.type === 'updateTodo') {
    const row: DbUpdate<'todos'> = {};
    if (item.payload.updates.text !== undefined) row.text = item.payload.updates.text;
    if (item.payload.updates.completed !== undefined) row.completed = item.payload.updates.completed;
    if (item.payload.updates.date !== undefined) row.due_date = item.payload.updates.date;
    const { error } = await db.from('todos').update(row).eq('id', item.payload.id);
    if (!error) success = true;
  } else if (item.type === 'deleteTodo') {
    const { error } = await db.from('todos').delete().eq('id', item.payload.id);
    if (!error) success = true;
  } else if (item.type === 'updateVendorExpense') {
    const row: DbUpdate<'vendor_expenses'> = {};
    const u = item.payload.updates;
    if (u.vendorName !== undefined) row.vendor_name = u.vendorName;
    if (u.category !== undefined) row.category = u.category;
    if (u.amount !== undefined) row.amount = u.amount;
    if (u.dueDate !== undefined) row.due_date = u.dueDate;
    if (u.paymentStatus !== undefined) row.payment_status = u.paymentStatus;
    if (u.amountPaid !== undefined) row.amount_paid = u.amountPaid;
    if (u.description !== undefined) row.description = u.description;
    if (u.aidType !== undefined) row.aid_type = u.aidType;
    if (u.beneficiaryStudentName !== undefined) row.beneficiary_student_name = u.beneficiaryStudentName;
    if (u.beneficiaryStudentGrade !== undefined) row.beneficiary_student_grade = u.beneficiaryStudentGrade;
    const { error } = await db.from('vendor_expenses').update(row).eq('id', item.payload.id);
    if (!error) success = true;
  } else if (item.type === 'deleteVendorExpense') {
    const { error } = await db.from('vendor_expenses').delete().eq('id', item.payload.id);
    if (!error) success = true;
  } else if (item.type === 'addClass') {
    const { error } = await db.from('custom_classes').insert({
      ...rowIdColumn(item.localId),
      code: item.payload.code,
      cycle: item.payload.cycle,
      year: item.payload.year,
      section: item.payload.section,
      name_fr: item.payload.nameFr,
      name_en: item.payload.nameEn,
    });
    // `23505` : le code (unique, insensible à la casse) est déjà dans la table —
    // la classe que l'école voulait créer EXISTE. La garder en file pour
    // toujours serait le mensonge inverse de celui qu'on répare ici, et le
    // chemin en ligne la traite déjà ainsi (il adopte la ligne existante).
    if (!error || error.code === '23505') success = true;
  } else if (item.type === 'updateClass') {
    // `.select('id')` + le contrôle de longueur : la MÊME règle honnête que le
    // chemin en ligne — une modification filtrée par la RLS revient en 200 avec
    // un corps vide, et la compter comme réussie ferait disparaître de la file
    // une modification que la base n'a jamais reçue.
    const { data, error } = await db.from('custom_classes').update({
      code: item.payload.updates.code,
      cycle: item.payload.updates.cycle,
      year: item.payload.updates.year,
      section: item.payload.updates.section,
      name_fr: item.payload.updates.nameFr,
      name_en: item.payload.updates.nameEn,
    }).eq('id', item.payload.id).select('id');
    if (!error && data && data.length > 0) success = true;
  } else if (item.type === 'deleteClass') {
    const { data, error } = await db.from('custom_classes').delete().eq('id', item.payload.id).select('id');
    if (!error && data && data.length > 0) success = true;
  } else if (item.type === 'addNote') {
    const { error } = await db.from('calendar_notes').insert({
      ...rowIdColumn(item.localId),
      note_date: item.payload.date,
      text: item.payload.text,
    });
    if (!error) success = true;
  } else if (item.type === 'deleteNote') {
    const { data, error } = await db.from('calendar_notes').delete().eq('id', item.payload.id).select('id');
    if (!error && data && data.length > 0) success = true;
  } else if (item.type === 'setCurrentYear') {
    // Même ordre que `keepAcademicYearCurrent` (la version en ligne) : la ligne
    // de l'année existe (ou est créée), puis le drapeau est déplacé dessus — et
    // l'ancienne le perd, sinon deux lignes se diraient courantes.
    const year = item.payload.year;
    const inserted = await db.from('academic_years').insert({ year_name: year, is_current: true });
    const existingRow = inserted.error?.code === '23505';
    if (!inserted.error || existingRow) {
      const cleared = await db.from('academic_years').update({ is_current: false }).neq('year_name', year);
      const flagged = await db.from('academic_years').update({ is_current: true }).eq('year_name', year);
      if (!cleared.error && !flagged.error) success = true;
    }
  } else if (item.type === 'updateUserRole') {
    // Le rôle d'un compte : la policy réserve la modification aux admins, et une
    // requête retirée par la RLS revient en 200 SANS ligne — d'où le
    // `.select('id')`, comme pour les classes et les notes. Sans lui, un rôle
    // refusé aurait disparu de la file en laissant croire qu'il était appliqué.
    const { data, error } = await db.from('user_profiles')
      .update({ role: item.payload.role })
      .eq('id', item.payload.id)
      .select('id');
    if (!error && data && data.length > 0) success = true;
  } else if (item.type === 'addAuditLog') {
    // L'entrée de journal écrite pendant la coupure : elle part telle quelle,
    // avec l'acteur FIGÉ au moment du geste (voir QueuedAuditEntry).
    const { error } = await db.from('audit_logs').insert({
      user_id: item.payload.userId || null,
      user_email: item.payload.userEmail || 'system',
      user_name: item.payload.userName || item.payload.userEmail || 'System Staff',
      user_role: item.payload.userRole || 'staff',
      action: item.payload.action,
      target_type: item.payload.targetType || null,
      target_id: item.payload.targetId || null,
      details: item.payload.details || null,
    });
    if (!error) success = true;
  }
  return success;
}

// ─── Audit mapping for replayed actions ─────────────────────────────────────
// Pure mapping from a queued item to the audit entry it should produce once
// replayed, so it can be unit tested like replayOfflineItem itself. Returns
// null for actions whose online equivalent is not audited (todos), keeping
// the replay trail consistent with the online one. Details carry a [replay]
// tag so AuditView can tell offline materialization from live actions.

export function offlineAuditInfo(item: QueueItem): Omit<LogAuditParams, 'user'> | null {
  const tag = ' [replay]';
  switch (item.type) {
    case 'addPayment':
      // Même forme que le chemin en ligne (dataOps/payments.ts) : un même fait
      // ne doit pas se lire de deux façons selon qu'il a été rejoué ou non.
      return { action: 'RECORD_PAYMENT', targetType: 'payment', targetId: item.payload.studentId, details: `Paiement de ${item.payload.payment.amount} FCFA (reçu ${item.payload.payment.receiptNumber || 'N/A'})${tag}` };
    case 'addExpense':
      return { action: 'ADD_EXPENSE', targetType: 'expense', targetId: null, details: `${item.payload.description} (${item.payload.category}) — ${item.payload.amount} FCFA${tag}` };
    case 'updateExpense':
      return { action: 'UPDATE_EXPENSE', targetType: 'expense', targetId: item.payload.id, details: `mise à jour dépense${tag}` };
    case 'deleteExpense':
      return { action: 'DELETE_EXPENSE', targetType: 'expense', targetId: item.payload.id, details: `suppression dépense${tag}` };
    case 'addVendorExpense':
      return { action: 'ADD_VENDOR_EXPENSE', targetType: 'vendor_expense', targetId: null, details: `${item.payload.vendorName} — ${item.payload.category} — ${item.payload.amount} FCFA${tag}` };
    case 'updateVendorExpense':
      return { action: 'UPDATE_VENDOR_EXPENSE', targetType: 'vendor_expense', targetId: item.payload.id, details: `mise à jour dépense fournisseur${tag}` };
    case 'deleteVendorExpense':
      return { action: 'DELETE_VENDOR_EXPENSE', targetType: 'vendor_expense', targetId: item.payload.id, details: `suppression dépense fournisseur${tag}` };
    case 'addStudent':
      return { action: 'ADD_STUDENT', targetType: 'student', targetId: null, details: `${item.payload.name}${tag}` };
    case 'updateStudent':
      return { action: 'UPDATE_STUDENT', targetType: 'student', targetId: item.payload.id, details: `mise à jour élève${tag}` };
    case 'deleteStudent':
      return { action: 'DELETE_STUDENT', targetType: 'student', targetId: item.payload.id, details: `suppression élève${tag}` };
    case 'addStaff':
      return { action: 'ADD_STAFF', targetType: 'staff', targetId: null, details: item.payload.position ? `${item.payload.name} (${item.payload.position})${tag}` : `${item.payload.name}${tag}` };
    case 'updateStaff':
      return { action: 'UPDATE_STAFF', targetType: 'staff', targetId: item.payload.id, details: `mise à jour membre${tag}` };
    case 'deleteStaff':
      return { action: 'DELETE_STAFF', targetType: 'staff', targetId: item.payload.id, details: `suppression membre${tag}` };
    case 'addSalaryPayment':
      return { action: 'RECORD_SALARY_PAYMENT', targetType: 'salary_payment', targetId: null, details: `${item.payload.amount} FCFA (${item.payload.date})${tag}` };
    case 'addParent':
      return { action: 'ADD_PARENT', targetType: 'parent', targetId: null, details: `${item.payload.fullName}${tag}` };
    case 'updateParent':
      return { action: 'UPDATE_PARENT', targetType: 'parent', targetId: item.payload.id, details: `mise à jour parent${tag}` };
    case 'deleteParent':
      return { action: 'DELETE_PARENT', targetType: 'parent', targetId: item.payload.id, details: `suppression parent${tag}` };
    default:
      // Geste dont l'équivalent EN LIGNE n'est pas audité — tâches, classes
      // personnalisées, notes du calendrier, déclaration d'année — donc le rejeu
      // ne l'est pas non plus : un même fait ne doit pas se lire de deux façons
      // selon qu'il a été rejoué ou non. Les entrées `addAuditLog` sont, elles,
      // le journal lui-même : les auditer bouclerait.
      return null;
  }
}
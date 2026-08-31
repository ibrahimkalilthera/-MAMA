/**
 * Offline queue replay — one item at a time.
 *
 * The per-action narrowing lives here as a pure function so it can be unit
 * tested with *each* `OfflineActionType` without needing a real Supabase
 * connection, React rendering, or a DOM. `useSupabaseData`'s `syncOfflineQueue`
 * drives the same function with the real client.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database, DbUpdate } from './database.types';
import type { QueueItem } from './offlineQueue';
import type { Parent, Student, Staff } from '../app/types';

/** The surface of the Supabase client that replay touches. */
export type ReplayDb = Pick<SupabaseClient<Database>, 'from'>;

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
    student_id: student.studentId || null,
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
  if (updates.flagged !== undefined) row.flagged = updates.flagged;
  if (updates.academicYear !== undefined) row.academic_year = updates.academicYear;
  if (updates.grade !== undefined) row.grade = updates.grade;
  if (updates.studentId !== undefined) row.student_id = updates.studentId;
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
      category: item.payload.category,
      description: item.payload.description,
      amount: item.payload.amount,
      date: item.payload.date,
      academic_year: item.payload.academicYear || null,
    });
    if (!error) success = true;
  } else if (item.type === 'addVendorExpense') {
    const { error } = await db.from('vendor_expenses').insert({
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
      .insert(studentToRow(item.payload))
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
    const { error } = await db.from('staff').insert(staffToRow(item.payload));
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
      staff_id: item.payload.staffId,
      amount: item.payload.amount,
      date: item.payload.date,
      academic_year: item.payload.academicYear || null,
    });
    if (!error) success = true;
  } else if (item.type === 'addParent') {
    const { data, error } = await db
      .from('parents')
      .insert(parentToRow(item.payload))
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
      text: item.payload.text,
      completed: item.payload.completed,
      student_id: item.payload.studentId || null,
    });
    if (!error) success = true;
  } else if (item.type === 'updateTodo') {
    const row: DbUpdate<'todos'> = {};
    if (item.payload.updates.text !== undefined) row.text = item.payload.updates.text;
    if (item.payload.updates.completed !== undefined) row.completed = item.payload.updates.completed;
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
  }
  return success;
}
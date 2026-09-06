/**
 * Supabase row → domain-type mappers (extracted from useSupabaseData.ts).
 */
import type { DbRow } from './database.types';
import type { Parent, Payment, SalaryPayment, Staff, Student, StudentNoteEntry, Todo, VendorExpense, Expense } from './domainTypes';
import { isNinthGradeClass, visibleStudentIdentifier } from './studentIdentifiers';

// ─── Unique temp IDs for offline-created records ──────────────────────────────
// `Date.now()` alone can collide when several records are created in the same
// millisecond (double-clicks, batch flows). Add a monotonic counter + random
// suffix so temp IDs are unique across entities and calls.
let tempIdCounter = 0;
export const createTempId = (prefix: string): string =>
  `off_${prefix}_${Date.now().toString(36)}_${(++tempIdCounter).toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

// ─── Supabase row → App type mappers ─────────────────────────────────────────

export function mapParentRow(row: DbRow<'parents'>): Parent {
  return {
    id: row.id,
    fullName: row.full_name,
    phones: row.phones,
    email: row.email ?? undefined,
    address: row.address,
    occupation: row.occupation,
    relationship: row.relationship,
    notes: row.notes ?? undefined,
  };
}

export function mapStudentRow(row: DbRow<'students'>, payments: Payment[]): Student {
  return {
    id: row.id,
    parentId: row.parent_id ?? undefined,
    name: row.name,
    parentName: row.parent_name ?? '',
    parentEmail: row.parent_email ?? '',
    parentPhone: row.parent_phone ?? '',
    totalDue: Number(row.total_due) || 0,
    amountPaid: Number(row.amount_paid) || 0,
    scholarshipDiscount: Number(row.scholarship_discount) || 0,
    dueDate: row.due_date ?? '',
    lastPaymentDate: row.last_payment_date ?? undefined,
    payments: payments,
    notes: row.notes ?? '',
    lastNoteDate: row.last_note_date ?? undefined,
    noteEntries: Array.isArray(row.note_entries) ? row.note_entries as unknown as StudentNoteEntry[] : undefined,
    flagged: Boolean(row.flagged),
    academicYear: row.academic_year ?? undefined,
    grade: row.grade ?? undefined,
    studentId: visibleStudentIdentifier(row.grade ?? undefined, row.student_id ?? undefined),
    photo: row.photo ?? undefined,
    emergencyContactName: row.emergency_contact_name ?? undefined,
    emergencyContactRelation: row.emergency_contact_relation ?? undefined,
    emergencyContactPhone: row.emergency_contact_phone ?? undefined,
    medicalNotes: row.medical_notes ?? undefined,
    enrollmentDate: row.enrollment_date ?? undefined,
    previousSchool: row.previous_school ?? undefined,
    status: (row.status as Student['status']) || 'Active',
  };
}

export function mapStaffRow(row: DbRow<'staff'>): Staff {
  return {
    id: row.id,
    name: row.name,
    position: row.position,
    salary: Number(row.salary) || 0,
    email: row.email ?? '',
    phone: row.phone ?? '',
    bankDetails: row.bank_details ?? '',
    emergencyContact: row.emergency_contact ?? '',
    academicYear: row.academic_year ?? undefined,
  };
}

export function mapSalaryPaymentRow(row: DbRow<'salary_payments'>): SalaryPayment {
  return {
    id: row.id,
    staffId: row.staff_id ?? '',
    amount: Number(row.amount) || 0,
    date: row.date,
    academicYear: row.academic_year ?? undefined,
  };
}

export function mapExpenseRow(row: DbRow<'expenses'>): Expense {
  return {
    id: row.id,
    category: row.category,
    description: row.description,
    amount: Number(row.amount) || 0,
    date: row.date,
    academicYear: row.academic_year ?? undefined,
  };
}

export function mapVendorExpenseRow(row: DbRow<'vendor_expenses'>): VendorExpense {
  return {
    id: row.id,
    vendorName: row.vendor_name,
    category: row.category,
    amount: Number(row.amount) || 0,
    dueDate: row.due_date,
    paymentStatus: row.payment_status as VendorExpense['paymentStatus'],
    amountPaid: Number(row.amount_paid) || 0,
    description: row.description ?? undefined,
    academicYear: row.academic_year ?? undefined,
    aidType: (row.aid_type as VendorExpense['aidType']) || undefined,
    beneficiaryStudentName: row.beneficiary_student_name ?? undefined,
    beneficiaryStudentGrade: row.beneficiary_student_grade ?? undefined,
  };
}

export function mapTodoRow(row: DbRow<'todos'>): Todo {
  return {
    id: row.id,
    text: row.text,
    completed: Boolean(row.completed),
    studentId: row.student_id ?? undefined,
    date: row.due_date ?? undefined,
  };
}


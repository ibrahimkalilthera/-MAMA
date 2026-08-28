/**
 * Supabase Data Hooks
 * 
 * Custom hooks for fetching and mutating data from Supabase.
 * These replace the hardcoded mock data in App.tsx with real database operations.
 * 
 * Features:
 * - Retry with exponential backoff for network resilience (Bamako connectivity)
 * - Notification callbacks for toast-based user feedback
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from './supabaseClient';
import { retryWithBackoff } from './networkUtils';
import { 
  enqueueOfflineAction, 
  getOfflineQueue, 
  removeOfflineAction, 
  getOfflineQueueCount 
} from './offlineQueue';
import { logAuditEvent, AuditLogEntry } from './auditLogger';

// ─── Type Definitions (matching App.tsx types) ───────────────────────────────

export interface Parent {
  id: string;
  fullName: string;
  phones: string[];
  email?: string;
  address: string;
  occupation: string;
  relationship: string;
  notes?: string;
}

export interface Payment {
  date: string;
  amount: number;
  academicYear?: string;
  receiptNumber?: string;
}

export interface Student {
  id: string;
  parentId?: string;
  name: string;
  parentName: string;
  parentEmail: string;
  parentPhone: string;
  totalDue: number;
  amountPaid: number;
  scholarshipDiscount?: number;
  dueDate: string;
  lastPaymentDate?: string;
  payments: Payment[];
  notes: string;
  lastNoteDate?: string;
  flagged?: boolean;
  academicYear?: string;
  grade?: string;
  studentId?: string;
  photo?: string;
  emergencyContactName?: string;
  emergencyContactRelation?: string;
  emergencyContactPhone?: string;
  medicalNotes?: string;
  enrollmentDate?: string;
  previousSchool?: string;
  status?: 'Active' | 'Graduated' | 'Left';
}

export interface Staff {
  id: string;
  name: string;
  position: string;
  salary: number;
  email: string;
  phone: string;
  bankDetails: string;
  emergencyContact: string;
  academicYear?: string;
}

export interface SalaryPayment {
  id: string;
  staffId: string;
  amount: number;
  date: string;
  academicYear?: string;
}

export interface Expense {
  id: string;
  category: string;
  description: string;
  amount: number;
  date: string;
  academicYear?: string;
}

export interface VendorExpense {
  id: string;
  vendorName: string;
  category: 'stationery' | 'solar_energy' | 'electricity' | 'water' | 'taxes' | 'insurance' | 'security_maintenance' | 'security_guarding' | 'facility_maintenance' | 'works_renovation' | 'machine_management' | 'reforestation' | 'catering' | 'training' | 'social_events' | 'exam_def' | 'exam_bac' | 'internet' | 'cleaning' | 'furniture' | 'social_cases' | string;
  amount: number;
  dueDate: string;
  paymentStatus: 'paid' | 'unpaid' | 'partial';
  amountPaid: number;
  description?: string;
  academicYear?: string;
  aidType?: 'prise_en_charge' | 'kits_fournitures' | 'aide_urgence';
  beneficiaryStudentName?: string;
  beneficiaryStudentGrade?: string;
}

export interface Todo {
  id: string;
  text: string;
  completed: boolean;
  studentId?: string;
}

export type ClassCycle = 'cycle1' | 'cycle2' | 'lycee' | 'maternelle' | 'other';

export interface CustomClass {
  id: string; // display code, e.g. '1D' or a custom name
  rowId: string; // Supabase uuid primary key
  cycle: ClassCycle;
  year: string;
  section: string;
  nameFr: string;
  nameEn: string;
  isCustom?: boolean;
}

// ─── Supabase row → App type mappers ─────────────────────────────────────────

function mapParentRow(row: any): Parent {
  return {
    id: row.id,
    fullName: row.full_name,
    phones: row.phones || [],
    email: row.email || undefined,
    address: row.address,
    occupation: row.occupation,
    relationship: row.relationship,
    notes: row.notes || undefined,
  };
}

function mapStudentRow(row: any, payments: Payment[]): Student {
  return {
    id: row.id,
    parentId: row.parent_id || undefined,
    name: row.name,
    parentName: row.parent_name || '',
    parentEmail: row.parent_email || '',
    parentPhone: row.parent_phone || '',
    totalDue: Number(row.total_due) || 0,
    amountPaid: Number(row.amount_paid) || 0,
    scholarshipDiscount: Number(row.scholarship_discount) || 0,
    dueDate: row.due_date || '',
    lastPaymentDate: row.last_payment_date || undefined,
    payments: payments,
    notes: row.notes || '',
    lastNoteDate: row.last_note_date || undefined,
    flagged: row.flagged || false,
    academicYear: row.academic_year || undefined,
    grade: row.grade || undefined,
    studentId: row.student_id || undefined,
    photo: row.photo || undefined,
    emergencyContactName: row.emergency_contact_name || undefined,
    emergencyContactRelation: row.emergency_contact_relation || undefined,
    emergencyContactPhone: row.emergency_contact_phone || undefined,
    medicalNotes: row.medical_notes || undefined,
    enrollmentDate: row.enrollment_date || undefined,
    previousSchool: row.previous_school || undefined,
    status: row.status || 'Active',
  };
}

function mapStaffRow(row: any): Staff {
  return {
    id: row.id,
    name: row.name,
    position: row.position,
    salary: Number(row.salary) || 0,
    email: row.email || '',
    phone: row.phone || '',
    bankDetails: row.bank_details || '',
    emergencyContact: row.emergency_contact || '',
    academicYear: row.academic_year || undefined,
  };
}

function mapSalaryPaymentRow(row: any): SalaryPayment {
  return {
    id: row.id,
    staffId: row.staff_id,
    amount: Number(row.amount) || 0,
    date: row.date,
    academicYear: row.academic_year || undefined,
  };
}

function mapExpenseRow(row: any): Expense {
  return {
    id: row.id,
    category: row.category,
    description: row.description,
    amount: Number(row.amount) || 0,
    date: row.date,
    academicYear: row.academic_year || undefined,
  };
}

function mapVendorExpenseRow(row: any): VendorExpense {
  return {
    id: row.id,
    vendorName: row.vendor_name,
    category: row.category,
    amount: Number(row.amount) || 0,
    dueDate: row.due_date,
    paymentStatus: row.payment_status,
    amountPaid: Number(row.amount_paid) || 0,
    description: row.description || undefined,
    academicYear: row.academic_year || undefined,
    aidType: row.aid_type || undefined,
    beneficiaryStudentName: row.beneficiary_student_name || undefined,
    beneficiaryStudentGrade: row.beneficiary_student_grade || undefined,
  };
}

function mapTodoRow(row: any): Todo {
  return {
    id: row.id,
    text: row.text,
    completed: row.completed || false,
    studentId: row.student_id || undefined,
  };
}

// ─── App type → Supabase insert mappers ──────────────────────────────────────

function parentToRow(parent: Omit<Parent, 'id'>) {
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

function studentToRow(student: Omit<Student, 'id' | 'payments'>) {
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

function staffToRow(s: Omit<Staff, 'id'>) {
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

function studentUpdatesToRow(updates: Partial<Student>): Record<string, unknown> {
  const row: Record<string, unknown> = {};
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

// ─── Main Data Hook ──────────────────────────────────────────────────────────

export interface SupabaseDataCallbacks {
  /** Called when any mutation (add/update/delete) succeeds */
  onMutationSuccess?: (operation: string) => void;
  /** Called when any mutation fails */
  onMutationError?: (operation: string, errorMessage: string) => void;
  /** Called when fetchAll retry is in progress */
  onRetry?: (attempt: number) => void;
}

export function useSupabaseData(callbacks?: SupabaseDataCallbacks) {
  const [parents, setParents] = useState<Parent[]>([]);
  const [students, setStudents] = useState<Student[]>([]);
  const [staff, setStaff] = useState<Staff[]>([]);
  const [salaryPayments, setSalaryPayments] = useState<SalaryPayment[]>([]);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [vendorExpenses, setVendorExpenses] = useState<VendorExpense[]>([]);
  const [todos, setTodos] = useState<Todo[]>([]);
  const [customClasses, setCustomClasses] = useState<CustomClass[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pendingQueueCount, setPendingQueueCount] = useState<number>(() => getOfflineQueueCount());
  const [isSyncing, setIsSyncing] = useState(false);
  const [auditLogs, setAuditLogs] = useState<AuditLogEntry[]>([]);

  const fetchAuditLogs = useCallback(async () => {
    try {
      const { data, error } = await supabase
        .from('audit_logs')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(100);

      if (error) {
        console.warn('fetchAuditLogs info/error:', error.message);
        return;
      }

      if (data) {
        const mapped: AuditLogEntry[] = data.map((row: any) => ({
          id: row.id,
          userId: row.user_id,
          userEmail: row.user_email,
          userName: row.user_name,
          userRole: row.user_role,
          action: row.action,
          targetType: row.target_type,
          targetId: row.target_id,
          details: row.details,
          createdAt: row.created_at,
        }));
        setAuditLogs(mapped);
      }
    } catch (err) {
      console.warn('fetchAuditLogs exception:', err);
    }
  }, []);

  const updateQueueCount = () => {
    setPendingQueueCount(getOfflineQueueCount());
  };

  // Store callbacks in ref to avoid re-creating memoized functions
  const callbacksRef = useRef(callbacks);
  callbacksRef.current = callbacks;

  const notifySuccess = (operation: string) => callbacksRef.current?.onMutationSuccess?.(operation);
  const notifyError = (operation: string, msg: string) => callbacksRef.current?.onMutationError?.(operation, msg);

  /**
   * Queue a mutation for later replay when offline instead of letting it fail.
   * Returns true when the action was queued so callers know to stop (we do NOT
   * return through the normal Supabase path).
   */
  const isOffline = () => typeof navigator !== 'undefined' && !navigator.onLine;
  const enqueueOffline = (type: any, payload: any) => {
    enqueueOfflineAction(type, payload);
    updateQueueCount();
  };

  // ── Offline Synchronization ─────────────────────────────────────────────

  const syncOfflineQueue = useCallback(async () => {
    const queue = getOfflineQueue();
    if (queue.length === 0) return;

    setIsSyncing(true);
    let syncedCount = 0;

    for (const item of queue) {
      try {
        let success = false;
        if (item.type === 'addPayment') {
          const { studentId, payment } = item.payload;
          const { error } = await supabase.from('payments').insert({
            student_id: studentId,
            date: payment.date,
            amount: payment.amount,
            academic_year: payment.academicYear || null,
            receipt_number: payment.receiptNumber || null,
          });
          if (!error) {
            await supabase.from('students').update({
              last_payment_date: payment.date,
            }).eq('id', studentId);
            success = true;
          }
        } else if (item.type === 'addExpense') {
          const { error } = await supabase.from('expenses').insert({
            category: item.payload.category,
            description: item.payload.description,
            amount: item.payload.amount,
            date: item.payload.date,
            academic_year: item.payload.academicYear || null,
          });
          if (!error) success = true;
        } else if (item.type === 'addVendorExpense') {
          const { error } = await supabase.from('vendor_expenses').insert({
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
          const { error, data } = await supabase
            .from('students')
            .insert(studentToRow(item.payload))
            .select()
            .single();
          if (!error && data) success = true;
        } else if (item.type === 'updateStudent') {
          const row = studentUpdatesToRow(item.payload.updates);
          const { error } = await supabase.from('students').update(row).eq('id', item.payload.id);
          if (!error) success = true;
        } else if (item.type === 'deleteStudent') {
          const { error } = await supabase.from('students').delete().eq('id', item.payload.id);
          if (!error) success = true;
        } else if (item.type === 'addStaff') {
          const { error } = await supabase.from('staff').insert(staffToRow(item.payload));
          if (!error) success = true;
        } else if (item.type === 'updateStaff') {
          const row: any = {};
          const u = item.payload.updates;
          if (u.name !== undefined) row.name = u.name;
          if (u.position !== undefined) row.position = u.position;
          if (u.salary !== undefined) row.salary = u.salary;
          if ('email' in u) row.email = u.email || null;
          if (u.phone !== undefined) row.phone = u.phone;
          if (u.bankDetails !== undefined) row.bank_details = u.bankDetails;
          if (u.emergencyContact !== undefined) row.emergency_contact = u.emergencyContact;
          const { error } = await supabase.from('staff').update(row).eq('id', item.payload.id);
          if (!error) success = true;
        } else if (item.type === 'deleteStaff') {
          const { error } = await supabase.from('staff').delete().eq('id', item.payload.id);
          if (!error) success = true;
        } else if (item.type === 'addSalaryPayment') {
          const { error } = await supabase.from('salary_payments').insert({
            staff_id: item.payload.staffId,
            amount: item.payload.amount,
            date: item.payload.date,
            academic_year: item.payload.academicYear || null,
          });
          if (!error) success = true;
        } else if (item.type === 'addParent') {
          const { data, error } = await supabase
            .from('parents')
            .insert(parentToRow(item.payload))
            .select()
            .single();
          if (!error && data) success = true;
        } else if (item.type === 'updateParent') {
          const row: any = {};
          const u = item.payload.updates;
          if (u.fullName !== undefined) row.full_name = u.fullName;
          if (u.phones !== undefined) row.phones = u.phones;
          if ('email' in u) row.email = u.email || null;
          if (u.address !== undefined) row.address = u.address;
          if (u.occupation !== undefined) row.occupation = u.occupation;
          if (u.relationship !== undefined) row.relationship = u.relationship;
          if (u.notes !== undefined) row.notes = u.notes;
          const { error } = await supabase.from('parents').update(row).eq('id', item.payload.id);
          if (!error) success = true;
        } else if (item.type === 'deleteParent') {
          const { error } = await supabase.from('parents').delete().eq('id', item.payload.id);
          if (!error) success = true;
        } else if (item.type === 'addTodo') {
          const { error } = await supabase.from('todos').insert({
            text: item.payload.text,
            completed: item.payload.completed,
            student_id: item.payload.studentId || null,
          });
          if (!error) success = true;
        } else if (item.type === 'updateTodo') {
          const row: any = {};
          if (item.payload.updates.text !== undefined) row.text = item.payload.updates.text;
          if (item.payload.updates.completed !== undefined) row.completed = item.payload.updates.completed;
          const { error } = await supabase.from('todos').update(row).eq('id', item.payload.id);
          if (!error) success = true;
        } else if (item.type === 'deleteTodo') {
          const { error } = await supabase.from('todos').delete().eq('id', item.payload.id);
          if (!error) success = true;
        } else if (item.type === 'updateVendorExpense') {
          const row: any = {};
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
          const { error } = await supabase.from('vendor_expenses').update(row).eq('id', item.payload.id);
          if (!error) success = true;
        } else if (item.type === 'deleteVendorExpense') {
          const { error } = await supabase.from('vendor_expenses').delete().eq('id', item.payload.id);
          if (!error) success = true;
        }

        if (success) {
          removeOfflineAction(item.id);
          syncedCount++;
        }
      } catch (err) {
        console.error('Offline sync failed for item:', item, err);
        break;
      }
    }

    updateQueueCount();
    setIsSyncing(false);
    if (syncedCount > 0) {
      notifySuccess(`Synced ${syncedCount} transaction(s)`);
    }
  }, []);

  // Auto-sync when internet comes back
  useEffect(() => {
    const handleOnline = () => {
      syncOfflineQueue();
    };
    window.addEventListener('online', handleOnline);
    return () => window.removeEventListener('online', handleOnline);
  }, [syncOfflineQueue]);

  // ── Fetch all data ──────────────────────────────────────────────────────

  const fetchAll = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      // Wrap in retry for network resilience (Bamako connectivity)
      await retryWithBackoff(async () => {
        // Fetch all tables in parallel
        const [
          parentsRes,
          studentsRes,
          paymentsRes,
          staffRes,
          salaryRes,
          expensesRes,
          vendorRes,
          todosRes,
          customClassesRes,
        ] = await Promise.all([
          supabase.from('parents').select('*').order('created_at', { ascending: true }),
          supabase.from('students').select('*').order('created_at', { ascending: true }),
          supabase.from('payments').select('*').order('date', { ascending: true }),
          supabase.from('staff').select('*').order('created_at', { ascending: true }),
          supabase.from('salary_payments').select('*').order('date', { ascending: true }),
          supabase.from('expenses').select('*').order('date', { ascending: true }),
          supabase.from('vendor_expenses').select('*').order('created_at', { ascending: true }),
          supabase.from('todos').select('*').order('created_at', { ascending: true }),
          supabase.from('custom_classes').select('*').order('created_at', { ascending: true }),
        ]);

        // Check for errors
        const errors = [parentsRes, studentsRes, paymentsRes, staffRes, salaryRes, expensesRes, vendorRes, todosRes, customClassesRes]
          .filter(r => r.error)
          .map(r => r.error?.message);
        
        if (errors.length > 0) {
          // Throw so retry logic can catch network-related errors
          throw new Error(`Database errors: ${errors.join(', ')}`);
        }

        // Group payments by student_id
        const paymentsByStudent: Record<string, Payment[]> = {};
        (paymentsRes.data || []).forEach((p: any) => {
          const sid = p.student_id;
          if (!paymentsByStudent[sid]) paymentsByStudent[sid] = [];
          paymentsByStudent[sid].push({
            date: p.date,
            amount: Number(p.amount),
            academicYear: p.academic_year || undefined,
            receiptNumber: p.receipt_number || undefined,
          });
        });

        // Map rows to app types
        setParents((parentsRes.data || []).map(mapParentRow));
        setStudents((studentsRes.data || []).map((row: any) => 
          mapStudentRow(row, paymentsByStudent[row.id] || [])
        ));
        setStaff((staffRes.data || []).map(mapStaffRow));
        setSalaryPayments((salaryRes.data || []).map(mapSalaryPaymentRow));
        setExpenses((expensesRes.data || []).map(mapExpenseRow));
        setVendorExpenses((vendorRes.data || []).map(mapVendorExpenseRow));
        setTodos((todosRes.data || []).map(mapTodoRow));
        setCustomClasses((customClassesRes.data || []).map((row: any) => ({
          id: row.code,
          rowId: row.id,
          cycle: row.cycle as ClassCycle,
          year: row.year,
          section: row.section,
          nameFr: row.name_fr,
          nameEn: row.name_en,
          isCustom: true,
        })));
      }, {
        maxRetries: 3,
        onRetry: (attempt) => {
          console.warn(`[MAMA THERA] Retrying data fetch (attempt ${attempt})...`);
          callbacksRef.current?.onRetry?.(attempt);
        },
      });
    } catch (err: any) {
      console.error('[MAMA THERA] fetchAll failed after retries:', err.message);
      setError(err.message || 'Failed to fetch data');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  const addCustomClass = async (cls: {
    code: string;
    cycle: ClassCycle;
    year: string;
    section: string;
    nameFr: string;
    nameEn: string;
  }): Promise<CustomClass | null> => {
    const code = cls.code.trim().replace(/\s+/g, ' ');
    if (!code) return null;
    const { data, error } = await supabase
      .from('custom_classes')
      .insert({
        code,
        cycle: cls.cycle,
        year: cls.year,
        section: cls.section,
        name_fr: cls.nameFr,
        name_en: cls.nameEn,
      })
      .select()
      .single();
    if (error) {
      if (error.code === '23505') {
        // Unique index is case-insensitive. Re-select the canonical row from the
        // DB rather than the (possibly stale) local state so that concurrent or
        // case-variant submissions resolve to the same class.
        const { data: existingRow } = await supabase
          .from('custom_classes')
          .select('*')
          .ilike('code', code)
          .maybeSingle();
        if (existingRow) {
          const existing: CustomClass = {
            id: existingRow.code,
            rowId: existingRow.id,
            cycle: existingRow.cycle as ClassCycle,
            year: existingRow.year,
            section: existingRow.section,
            nameFr: existingRow.name_fr,
            nameEn: existingRow.name_en,
            isCustom: true,
          };
          setCustomClasses(prev => prev.some(c => c.id === existing.id) ? prev : [...prev, existing]);
          return existing;
        }
      }
      notifyError('addCustomClass', error.message);
      return null;
    }
    const newClass: CustomClass = {
      id: data.code,
      rowId: data.id,
      cycle: data.cycle as ClassCycle,
      year: data.year,
      section: data.section,
      nameFr: data.name_fr,
      nameEn: data.name_en,
      isCustom: true,
    };
    setCustomClasses(prev => [...prev, newClass]);
    return newClass;
  };

  const updateCustomClass = async (rowId: string, updates: {
    code: string;
    cycle: ClassCycle;
    year: string;
    section: string;
    nameFr: string;
    nameEn: string;
  }): Promise<boolean> => {
    const code = updates.code.trim().replace(/\s+/g, ' ');
    if (!code) return false;
    const { error } = await supabase
      .from('custom_classes')
      .update({
        code,
        cycle: updates.cycle,
        year: updates.year,
        section: updates.section,
        name_fr: updates.nameFr,
        name_en: updates.nameEn,
      })
      .eq('id', rowId);
    if (error) {
      if (error.code === '23505') {
        notifyError('updateCustomClass', 'A class with this code already exists.');
        return false;
      }
      notifyError('updateCustomClass', error.message);
      return false;
    }
    setCustomClasses(prev => prev.map(c => c.rowId === rowId
      ? { ...c, id: code, cycle: updates.cycle, year: updates.year, section: updates.section, nameFr: updates.nameFr, nameEn: updates.nameEn }
      : c));
    notifySuccess('updateCustomClass');
    return true;
  };

  const deleteCustomClass = async (rowId: string): Promise<boolean> => {
    const { error } = await supabase
      .from('custom_classes')
      .delete()
      .eq('id', rowId);
    if (error) {
      notifyError('deleteCustomClass', error.message);
      return false;
    }
    setCustomClasses(prev => prev.filter(c => c.rowId !== rowId));
    notifySuccess('deleteCustomClass');
    return true;
  };

  // ── CRUD: Parents ───────────────────────────────────────────────────────

  const addParent = async (parent: Omit<Parent, 'id'>): Promise<Parent | null> => {
    if (isOffline()) {
      const tempId = `off_${Date.now()}`;
      const local: Parent = { id: tempId, ...parent };
      setParents(prev => [...prev, local]);
      enqueueOffline('addParent', parent);
      notifySuccess('addParent');
      return local;
    }
    const { data, error } = await supabase
      .from('parents')
      .insert(parentToRow(parent))
      .select()
      .single();
    if (error) { console.error('addParent error:', error.message); notifyError('addParent', error.message); return null; }
    const mapped = mapParentRow(data);
    setParents(prev => [...prev, mapped]);
    notifySuccess('addParent');
    return mapped;
  };

  const updateParent = async (id: string, updates: Partial<Parent>): Promise<boolean> => {
    if (isOffline()) {
      setParents(prev => prev.map(p => p.id === id ? { ...p, ...updates } : p));
      enqueueOffline('updateParent', { id, updates });
      notifySuccess('updateParent');
      return true;
    }
    const row: any = {};
    if (updates.fullName !== undefined) row.full_name = updates.fullName;
    if (updates.phones !== undefined) row.phones = updates.phones;
    if ('email' in updates) row.email = updates.email || null;
    if (updates.address !== undefined) row.address = updates.address;
    if (updates.occupation !== undefined) row.occupation = updates.occupation;
    if (updates.relationship !== undefined) row.relationship = updates.relationship;
    if (updates.notes !== undefined) row.notes = updates.notes;

    const { error } = await supabase.from('parents').update(row).eq('id', id);
    if (error) { console.error('updateParent error:', error.message); notifyError('updateParent', error.message); return false; }
    setParents(prev => prev.map(p => p.id === id ? { ...p, ...updates } : p));
    notifySuccess('updateParent');
    return true;
  };

  const deleteParent = async (id: string): Promise<boolean> => {
    if (isOffline()) {
      setParents(prev => prev.filter(p => p.id !== id));
      enqueueOffline('deleteParent', { id });
      notifySuccess('deleteParent');
      return true;
    }
    const { error } = await supabase.from('parents').delete().eq('id', id);
    if (error) { console.error('deleteParent error:', error.message); notifyError('deleteParent', error.message); return false; }
    setParents(prev => prev.filter(p => p.id !== id));
    notifySuccess('deleteParent');
    return true;
  };

  // ── CRUD: Students ──────────────────────────────────────────────────────

  const addStudent = async (student: Omit<Student, 'id' | 'payments'>): Promise<Student | null> => {
    if (isOffline()) {
      const tempId = `off_${Date.now()}`;
      const local: Student = { id: tempId, ...student, payments: [] };
      setStudents(prev => [...prev, local]);
      enqueueOffline('addStudent', student);
      notifySuccess('addStudent');
      return local;
    }
    const { data, error } = await supabase
      .from('students')
      .insert(studentToRow(student))
      .select()
      .single();
    if (error) { console.error('addStudent error:', error.message); notifyError('addStudent', error.message); return null; }
    const mapped = mapStudentRow(data, []);
    setStudents(prev => [...prev, mapped]);
    notifySuccess('addStudent');
    return mapped;
  };

  const updateStudent = async (id: string, updates: Partial<Student>): Promise<boolean> => {
    if (isOffline()) {
      setStudents(prev => prev.map(s => s.id === id ? { ...s, ...updates } : s));
      enqueueOffline('updateStudent', { id, updates });
      notifySuccess('updateStudent');
      return true;
    }
    const row = studentUpdatesToRow(updates);
    const { error } = await supabase.from('students').update(row).eq('id', id);
    if (error) { console.error('updateStudent error:', error.message); notifyError('updateStudent', error.message); return false; }
    setStudents(prev => prev.map(s => s.id === id ? { ...s, ...updates } : s));
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
    const { error } = await supabase.from('students').delete().eq('id', id);
    if (error) { console.error('deleteStudent error:', error.message); notifyError('deleteStudent', error.message); return false; }
    setStudents(prev => prev.filter(s => s.id !== id));
    notifySuccess('deleteStudent');
    return true;
  };

  // ── Record a Payment ────────────────────────────────────────────────────

  const addPayment = async (studentId: string, payment: Omit<Payment, 'receiptNumber'> & { receiptNumber?: string }): Promise<boolean> => {
    const isOnline = navigator.onLine;

    // Apply local optimistic update first
    setStudents(prev => prev.map(s => {
      if (s.id === studentId) {
        const newPayments = [...s.payments, payment];
        const newAmountPaid = s.amountPaid + payment.amount;
        return { 
          ...s, 
          payments: newPayments, 
          amountPaid: newAmountPaid,
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

      const student = students.find(s => s.id === studentId);
      if (student) {
        await supabase.from('students').update({
          amount_paid: student.amountPaid + payment.amount,
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

  // ── CRUD: Staff ─────────────────────────────────────────────────────────

  const addStaff = async (s: Omit<Staff, 'id'>): Promise<Staff | null> => {
    if (isOffline()) {
      const tempId = `off_${Date.now()}`;
      const local: Staff = { id: tempId, ...s };
      setStaff(prev => [...prev, local]);
      enqueueOffline('addStaff', s);
      notifySuccess('addStaff');
      return local;
    }
    const { data, error } = await supabase
      .from('staff')
      .insert(staffToRow(s))
      .select()
      .single();
    if (error) { console.error('addStaff error:', error.message); notifyError('addStaff', error.message); return null; }
    const mapped = mapStaffRow(data);
    setStaff(prev => [...prev, mapped]);
    notifySuccess('addStaff');
    return mapped;
  };

  const updateStaff = async (id: string, updates: Partial<Staff>): Promise<boolean> => {
    if (isOffline()) {
      setStaff(prev => prev.map(s => s.id === id ? { ...s, ...updates } : s));
      enqueueOffline('updateStaff', { id, updates });
      notifySuccess('updateStaff');
      return true;
    }
    const row: any = {};
    if (updates.name !== undefined) row.name = updates.name;
    if (updates.position !== undefined) row.position = updates.position;
    if (updates.salary !== undefined) row.salary = updates.salary;
    if ('email' in updates) row.email = updates.email || null;
    if (updates.phone !== undefined) row.phone = updates.phone;
    if (updates.bankDetails !== undefined) row.bank_details = updates.bankDetails;
    if (updates.emergencyContact !== undefined) row.emergency_contact = updates.emergencyContact;

    const { error } = await supabase.from('staff').update(row).eq('id', id);
    if (error) { console.error('updateStaff error:', error.message); notifyError('updateStaff', error.message); return false; }
    setStaff(prev => prev.map(s => s.id === id ? { ...s, ...updates } : s));
    notifySuccess('updateStaff');
    return true;
  };

  const deleteStaff = async (id: string): Promise<boolean> => {
    if (isOffline()) {
      setStaff(prev => prev.filter(s => s.id !== id));
      enqueueOffline('deleteStaff', { id });
      notifySuccess('deleteStaff');
      return true;
    }
    const { error } = await supabase.from('staff').delete().eq('id', id);
    if (error) { console.error('deleteStaff error:', error.message); notifyError('deleteStaff', error.message); return false; }
    setStaff(prev => prev.filter(s => s.id !== id));
    notifySuccess('deleteStaff');
    return true;
  };

  // ── CRUD: Salary Payments ───────────────────────────────────────────────

  const addSalaryPayment = async (sp: Omit<SalaryPayment, 'id'>): Promise<SalaryPayment | null> => {
    if (isOffline()) {
      const tempId = `off_${Date.now()}`;
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

  // ── CRUD: Expenses ──────────────────────────────────────────────────────

  const addExpense = async (exp: Omit<Expense, 'id'>): Promise<Expense | null> => {
    if (isOffline()) {
      const tempId = `off_${Date.now()}`;
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

  // ── CRUD: Vendor Expenses ───────────────────────────────────────────────

  const addVendorExpense = async (ve: Omit<VendorExpense, 'id'>): Promise<VendorExpense | null> => {
    if (isOffline()) {
      const tempId = `off_${Date.now()}`;
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
    const row: any = {};
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

  // ── CRUD: Todos ─────────────────────────────────────────────────────────

  const addTodo = async (todo: Omit<Todo, 'id'>): Promise<Todo | null> => {
    if (isOffline()) {
      const tempId = `off_${Date.now()}`;
      const local: Todo = { id: tempId, ...todo };
      setTodos(prev => [...prev, local]);
      enqueueOffline('addTodo', todo);
      notifySuccess('addTodo');
      return local;
    }
    const { data, error } = await supabase
      .from('todos')
      .insert({
        text: todo.text,
        completed: todo.completed,
        student_id: todo.studentId || null,
      })
      .select()
      .single();
    if (error) { console.error('addTodo error:', error.message); notifyError('addTodo', error.message); return null; }
    const mapped = mapTodoRow(data);
    setTodos(prev => [...prev, mapped]);
    notifySuccess('addTodo');
    return mapped;
  };

  const updateTodo = async (id: string, updates: Partial<Todo>): Promise<boolean> => {
    if (isOffline()) {
      setTodos(prev => prev.map(t => t.id === id ? { ...t, ...updates } : t));
      enqueueOffline('updateTodo', { id, updates });
      return true;
    }
    const row: any = {};
    if (updates.text !== undefined) row.text = updates.text;
    if (updates.completed !== undefined) row.completed = updates.completed;

    const { error } = await supabase.from('todos').update(row).eq('id', id);
    if (error) { console.error('updateTodo error:', error.message); notifyError('updateTodo', error.message); return false; }
    setTodos(prev => prev.map(t => t.id === id ? { ...t, ...updates } : t));
    // Don't toast for minor todo toggles to avoid notification fatigue
    return true;
  };

  const deleteTodo = async (id: string): Promise<boolean> => {
    if (isOffline()) {
      setTodos(prev => prev.filter(t => t.id !== id));
      enqueueOffline('deleteTodo', { id });
      return true;
    }
    const { error } = await supabase.from('todos').delete().eq('id', id);
    if (error) { console.error('deleteTodo error:', error.message); notifyError('deleteTodo', error.message); return false; }
    setTodos(prev => prev.filter(t => t.id !== id));
    return true;
  };

  // ── Class Promotion / Re-enrollment ──────────────────────────────────────

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

        const rowUpdates: any = {};
        if (item.action === 'promote' || item.action === 'repeat') {
          rowUpdates.academic_year = item.targetAcademicYear;
          if (item.targetGrade) rowUpdates.grade = item.targetGrade;
          if (item.newTotalDue !== undefined) rowUpdates.total_due = item.newTotalDue;
          rowUpdates.amount_paid = 0; // reset balance for new school year
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
          // Update local React state optimistically
          setStudents(prev =>
            prev.map(s => {
              if (s.id !== item.studentId) return s;
              return {
                ...s,
                academicYear: rowUpdates.academic_year ?? s.academicYear,
                grade: rowUpdates.grade ?? s.grade,
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
        details: `Processed batch promotions/re-enrollments for ${successCount} student(s)`,
      });

      notifySuccess(`Promoted ${successCount} student(s)`);
      return true;
    } catch (err: any) {
      console.error('batchPromoteStudents error:', err);
      notifyError('batchPromoteStudents', err.message || 'Promotion failed');
      return false;
    }
  };

  // ── Batch Import (Smart Excel Ingestion) ─────────────────────────────────

  const batchImportData = async (
    category: 'students' | 'payments' | 'parents' | 'staff' | 'expenses',
    records: Record<string, any>[],
    options: { academicYear: string; duplicateStrategy: 'skip' | 'update' }
  ): Promise<{ inserted: number; updated: number; errors: number }> => {
    let inserted = 0;
    let updated = 0;
    let errors = 0;
    const BATCH_SIZE = 50;

    const processBatch = async <T extends Record<string, any>>(
      table: string,
      rows: T[]
    ): Promise<{ ok: number; err: number }> => {
      let ok = 0;
      let err = 0;

      for (let i = 0; i < rows.length; i += BATCH_SIZE) {
        const chunk = rows.slice(i, i + BATCH_SIZE);
        const { data, error } = await supabase.from(table as any).insert(chunk as any).select();
        if (error) {
          console.error(`[MAMA THERA] batchImport ${table} error:`, error.message);
          err += chunk.length;
        } else {
          ok += data?.length ?? chunk.length;
        }
      }

      return { ok, err };
    };

    try {
      if (category === 'students') {
        const rows = records.map((r) => ({
          name: r.name || '',
          grade: r.grade || null,
          student_id: r.studentId || null,
          parent_name: r.parentName || '',
          parent_phone: r.parentPhone || '',
          parent_email: r.parentEmail || '',
          total_due: r.totalDue || 0,
          amount_paid: r.amountPaid || 0,
          scholarship_discount: r.scholarshipDiscount || 0,
          due_date: r.dueDate || null,
          academic_year: options.academicYear || null,
          notes: r.notes || null,
          status: 'Active',
        }));
        const result = await processBatch('students', rows);
        inserted = result.ok;
        errors = result.err;

      } else if (category === 'payments') {
        // For payments, we need to match student names to IDs
        for (const r of records) {
          const studentName = r.studentName || '';
          const matchedStudent = students.find(
            (s) => s.name.toLowerCase().trim() === studentName.toLowerCase().trim()
          );
          if (!matchedStudent) {
            errors++;
            continue;
          }
          const { error } = await supabase.from('payments').insert({
            student_id: matchedStudent.id,
            amount: r.amount || 0,
            date: r.date || new Date().toISOString().split('T')[0],
            academic_year: options.academicYear || null,
            receipt_number: r.receiptNumber || null,
          });
          if (error) {
            console.error('[MAMA THERA] payment import error:', error.message);
            errors++;
          } else {
            inserted++;
            // Also update student's amount_paid
            await supabase.from('students').update({
              amount_paid: matchedStudent.amountPaid + (r.amount || 0),
              last_payment_date: r.date || new Date().toISOString().split('T')[0],
            }).eq('id', matchedStudent.id);
          }
        }

      } else if (category === 'parents') {
        const rows = records.map((r) => ({
          full_name: r.fullName || '',
          phones: [r.phone1, r.phone2].filter(Boolean),
          email: r.email || null,
          address: r.address || '',
          occupation: r.occupation || '',
          relationship: r.relationship || '',
        }));
        const result = await processBatch('parents', rows);
        inserted = result.ok;
        errors = result.err;

      } else if (category === 'staff') {
        const rows = records.map((r) => ({
          name: r.name || '',
          position: r.position || '',
          salary: r.salary || 0,
          email: r.email || null,
          phone: r.phone || '',
          bank_details: r.bankDetails || null,
          emergency_contact: r.emergencyContact || null,
          academic_year: options.academicYear || null,
        }));
        const result = await processBatch('staff', rows);
        inserted = result.ok;
        errors = result.err;

      } else if (category === 'expenses') {
        const rows = records.map((r) => ({
          category: r.category || 'stationery',
          description: r.description || '',
          amount: r.amount || 0,
          date: r.date || new Date().toISOString().split('T')[0],
          academic_year: options.academicYear || null,
        }));
        const result = await processBatch('expenses', rows);
        inserted = result.ok;
        errors = result.err;
      }

      logAuditEvent({
        action: 'BATCH_IMPORT',
        targetType: category,
        details: `Imported ${inserted} ${category} record(s) via Excel (${errors} errors)`,
      });

      // Refresh data to reflect newly imported records
      await fetchAll();

      notifySuccess(`batchImport_${category}`);
      return { inserted, updated, errors };
    } catch (err: any) {
      console.error('[MAMA THERA] batchImportData error:', err);
      notifyError('batchImportData', err.message || 'Import failed');
      return { inserted, updated, errors: errors || records.length };
    }
  };

  // ── Return ──────────────────────────────────────────────────────────────

  return {
    // State
    parents, setParents,
    students, setStudents,
    staff, setStaff,
    salaryPayments, setSalaryPayments,
    expenses, setExpenses,
    vendorExpenses, setVendorExpenses,
    todos, setTodos,
    customClasses,
    loading,
    error,
    pendingQueueCount,
    isSyncing,
    auditLogs,
    setAuditLogs,

    // Actions
    fetchAll,
    fetchAuditLogs,
    syncOfflineQueue,
    addCustomClass,
    updateCustomClass,
    deleteCustomClass,
    addParent, updateParent, deleteParent,
    addStudent, updateStudent, deleteStudent,
    addPayment,
    addStaff, updateStaff, deleteStaff,
    addSalaryPayment,
    addExpense,
    addVendorExpense, updateVendorExpense, deleteVendorExpense,
    addTodo, updateTodo, deleteTodo,
    batchPromoteStudents,
    batchImportData,
  };
}


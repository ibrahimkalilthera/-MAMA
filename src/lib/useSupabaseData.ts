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
import type { DbInsert, DbRow, DbUpdate } from './database.types';
import { retryWithBackoff } from './networkUtils';
import { 
  enqueueOfflineAction, 
  getOfflineQueue, 
  removeOfflineAction, 
  getOfflineQueueCount, 
  OfflineActionType, 
  OfflinePayload 
} from './offlineQueue';
import { logAuditEvent, AuditLogEntry } from './auditLogger';
import { parentToRow, studentToRow, staffToRow, studentUpdatesToRow } from './offlineReplay';
import { drainOfflineQueue } from './offlineSync';
import { isNinthGradeClass, visibleStudentIdentifier } from './studentIdentifiers';

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

export interface StudentNoteEntry {
  date: string;
  text: string;
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
  noteEntries?: StudentNoteEntry[];
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
  /** Optional calendar date (YYYY-MM-DD) — tasks appear on the calendar. */
  date?: string;
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

// ─── Unique temp IDs for offline-created records ──────────────────────────────
// `Date.now()` alone can collide when several records are created in the same
// millisecond (double-clicks, batch flows). Add a monotonic counter + random
// suffix so temp IDs are unique across entities and calls.
let tempIdCounter = 0;
const createTempId = (prefix: string): string =>
  `off_${prefix}_${Date.now().toString(36)}_${(++tempIdCounter).toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

// ─── Supabase row → App type mappers ─────────────────────────────────────────

function mapParentRow(row: DbRow<'parents'>): Parent {
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

function mapStudentRow(row: DbRow<'students'>, payments: Payment[]): Student {
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

function mapStaffRow(row: DbRow<'staff'>): Staff {
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

function mapSalaryPaymentRow(row: DbRow<'salary_payments'>): SalaryPayment {
  return {
    id: row.id,
    staffId: row.staff_id ?? '',
    amount: Number(row.amount) || 0,
    date: row.date,
    academicYear: row.academic_year ?? undefined,
  };
}

function mapExpenseRow(row: DbRow<'expenses'>): Expense {
  return {
    id: row.id,
    category: row.category,
    description: row.description,
    amount: Number(row.amount) || 0,
    date: row.date,
    academicYear: row.academic_year ?? undefined,
  };
}

function mapVendorExpenseRow(row: DbRow<'vendor_expenses'>): VendorExpense {
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

function mapTodoRow(row: DbRow<'todos'>): Todo {
  return {
    id: row.id,
    text: row.text,
    completed: Boolean(row.completed),
    studentId: row.student_id ?? undefined,
    date: row.due_date ?? undefined,
  };
}

// ─── Excel Import typed reads ────────────────────────────────────────────────
// Excel data arrives as `Record<string, unknown>` (untrusted). These interfaces
// form a typed boundary so the coercion (String()/Number()/??) is explicit.

interface StudentRec {
  studentId?: string | null;
  name?: string | null;
  grade?: string | null;
  parentName?: string | null;
  parentPhone?: string | null;
  parentEmail?: string | null;
  totalDue?: number | null;
  amountPaid?: number | null;
  scholarshipDiscount?: number | null;
  dueDate?: string | null;
  notes?: string | null;
}

interface PaymentRec {
  studentName?: string | null;
  amount?: number | null;
  date?: string | null;
  receiptNumber?: string | null;
}

interface ParentRec {
  fullName?: string | null;
  phone1?: string | null;
  phone2?: string | null;
  email?: string | null;
  address?: string | null;
  occupation?: string | null;
  relationship?: string | null;
  notes?: string | null;
}

interface StaffRec {
  name?: string | null;
  position?: string | null;
  salary?: number | null;
  email?: string | null;
  phone?: string | null;
  bankDetails?: string | null;
  emergencyContact?: string | null;
}

interface ExpenseRec {
  description?: string | null;
  amount?: number | null;
  date?: string | null;
  category?: string | null;
}

type ImportTable = 'students' | 'parents' | 'staff' | 'expenses';

type ImportableRow =
  | DbInsert<'students'>
  | DbInsert<'parents'>
  | DbInsert<'staff'>
  | DbInsert<'expenses'>;

/** Loose query-builder shape names the dynamic `from(table).insert(rows)` path. */
interface InsertableBuilder {
  insert: (rows: ImportableRow[]) => {
    select: () => Promise<{
      data: Array<Record<string, unknown>> | null;
      error: { message: string } | null;
    }>;
  };
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
        const mapped: AuditLogEntry[] = data.map((row: DbRow<'audit_logs'>) => ({
          id: row.id,
          userId: row.user_id ?? '',
          userEmail: row.user_email ?? '',
          userName: row.user_name ?? '',
          userRole: row.user_role ?? '',
          action: row.action,
          targetType: row.target_type ?? '',
          targetId: row.target_id ?? '',
          details: row.details ?? '',
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
  const enqueueOffline = (type: OfflineActionType, payload: OfflinePayload['payload']) => {
    enqueueOfflineAction(type, payload);
    updateQueueCount();
  };

  // ── Offline Synchronization ─────────────────────────────────────────────

  const syncOfflineQueue = useCallback(async () => {
    if (getOfflineQueue().length === 0) return;

    setIsSyncing(true);
    let syncedCount = 0;
    try {
      // Drains the queued mutations (replay + removal per item) — the full
      // behaviour is unit-tested in tests/offline-sync.test.ts.
      syncedCount = await drainOfflineQueue(supabase);
    } finally {
      updateQueueCount();
      setIsSyncing(false);
      if (syncedCount > 0) {
        notifySuccess(`Synced ${syncedCount} transaction(s)`);
      }
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
        (paymentsRes.data || []).forEach((p: DbRow<'payments'>) => {
          const sid = p.student_id;
          if (!sid) return;
          if (!paymentsByStudent[sid]) paymentsByStudent[sid] = [];
          paymentsByStudent[sid].push({
            date: p.date,
            amount: Number(p.amount),
            academicYear: p.academic_year ?? undefined,
            receiptNumber: p.receipt_number ?? undefined,
          });
        });

        // Map rows to app types
        setParents((parentsRes.data || []).map(mapParentRow));
        setStudents((studentsRes.data || []).map((row: DbRow<'students'>) => 
          mapStudentRow(row, paymentsByStudent[row.id] || [])
        ));
        setStaff((staffRes.data || []).map(mapStaffRow));
        setSalaryPayments((salaryRes.data || []).map(mapSalaryPaymentRow));
        setExpenses((expensesRes.data || []).map(mapExpenseRow));
        setVendorExpenses((vendorRes.data || []).map(mapVendorExpenseRow));
        setTodos((todosRes.data || []).map(mapTodoRow));
        setCustomClasses((customClassesRes.data || []).map((row: DbRow<'custom_classes'>) => ({
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
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to fetch data';
      console.error('[MAMA THERA] fetchAll failed after retries:', msg);
      setError(msg);
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
      const tempId = createTempId('parent');
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
    const row: DbUpdate<'parents'> = {};
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
    const { error } = await supabase.from('students').update(row).eq('id', id);
    if (error) { console.error('updateStudent error:', error.message); notifyError('updateStudent', error.message); return false; }
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
    const { error } = await supabase.from('students').delete().eq('id', id);
    if (error) { console.error('deleteStudent error:', error.message); notifyError('deleteStudent', error.message); return false; }
    setStudents(prev => prev.filter(s => s.id !== id));
    notifySuccess('deleteStudent');
    return true;
  };

  // ── Record a Payment ────────────────────────────────────────────────────

  const addPayment = async (studentId: string, payment: Omit<Payment, 'receiptNumber'> & { receiptNumber?: string }): Promise<boolean> => {
    const isOnline = navigator.onLine;

    // Apply local optimistic update first and capture the exact new amount_paid
    // so the DB write below uses fresh state instead of a stale closure
    // (two consecutive payments could previously overwrite each other's amount_paid).
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

  // ── CRUD: Staff ─────────────────────────────────────────────────────────

  const addStaff = async (s: Omit<Staff, 'id'>): Promise<Staff | null> => {
    if (isOffline()) {
      const tempId = createTempId('staff');
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
    const row: DbUpdate<'staff'> = {};
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

  // ── CRUD: Expenses ──────────────────────────────────────────────────────

  const addExpense = async (exp: Omit<Expense, 'id'>): Promise<Expense | null> => {
    if (isOffline()) {
      const tempId = createTempId('expense');
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
      const tempId = createTempId('vendor');
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
      const tempId = createTempId('todo');
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
        due_date: todo.date || null,
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
    const row: DbUpdate<'todos'> = {};
    if (updates.text !== undefined) row.text = updates.text;
    if (updates.completed !== undefined) row.completed = updates.completed;
    if (updates.date !== undefined) row.due_date = updates.date;

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
        details: `Processed batch promotions/re-enrollments for ${successCount} student(s)`,
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

  // ── Batch Import (Smart Excel Ingestion) ─────────────────────────────────

  const batchImportData = async (
    category: 'students' | 'payments' | 'parents' | 'staff' | 'expenses',
    records: Record<string, unknown>[],
    options: { academicYear: string; duplicateStrategy: 'skip' | 'update' }
  ): Promise<{ inserted: number; updated: number; errors: number }> => {
    let inserted = 0;
    let updated = 0;
    let errors = 0;
    const BATCH_SIZE = 50;
    const strategy = options.duplicateStrategy === 'update' ? 'update' : 'skip';
    const todayStr = new Date().toISOString().split('T')[0];

    const processBatch = async (
      table: ImportTable,
      rows: ImportableRow[]
    ): Promise<{ ok: number; err: number }> => {
      let ok = 0;
      let err = 0;

      for (let i = 0; i < rows.length; i += BATCH_SIZE) {
        const chunk = rows.slice(i, i + BATCH_SIZE);
        const { data, error } = await (supabase.from(table) as unknown as InsertableBuilder).insert(chunk).select();
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
        // Index existing students by student_id, then by name+grade, so the
        // duplicateStrategy ('skip' | 'update') can be honoured.
        const byStudentId = new Map<string, Student>();
        const byNameGrade = new Map<string, Student>();
        students.forEach(s => {
          if (s.studentId) byStudentId.set(String(s.studentId).toLowerCase().trim(), s);
          byNameGrade.set(`${s.name.toLowerCase().trim()}|${(s.grade || '').toLowerCase().trim()}`, s);
        });

        const rows: DbInsert<'students'>[] = [];
        for (const r of records as StudentRec[]) {
          const importedStudentId = visibleStudentIdentifier(r.grade, r.studentId);
          const existing = (importedStudentId ? byStudentId.get(importedStudentId.toLowerCase()) : undefined)
            || byNameGrade.get(`${String(r.name || '').toLowerCase().trim()}|${String(r.grade || '').toLowerCase().trim()}`);

          if (existing) {
            if (strategy === 'update') {
              const { error } = await supabase.from('students').update({
                grade: r.grade ?? existing.grade ?? null,
                student_id: isNinthGradeClass(r.grade ?? existing.grade ?? undefined)
                  ? (visibleStudentIdentifier(r.grade ?? existing.grade ?? undefined, r.studentId ?? existing.studentId) ?? null)
                  : null,
                parent_name: r.parentName ?? existing.parentName ?? '',
                parent_phone: r.parentPhone ?? existing.parentPhone ?? '',
                parent_email: r.parentEmail ?? existing.parentEmail ?? null,
                total_due: r.totalDue ?? existing.totalDue,
                // never decrease the amount already paid
                amount_paid: Math.max(existing.amountPaid, Number(r.amountPaid) || 0),
                scholarship_discount: r.scholarshipDiscount ?? existing.scholarshipDiscount ?? 0,
                due_date: r.dueDate ?? existing.dueDate ?? null,
                academic_year: options.academicYear || existing.academicYear || null,
                notes: r.notes ?? existing.notes ?? null,
              }).eq('id', existing.id);
              if (error) { errors++; console.error('[MAMA THERA] student import update error:', error.message); }
              else updated++;
            } else {
              updated++; // duplicate present → skipped (already in DB)
            }
          } else {
            rows.push({
              name: r.name || '',
              grade: r.grade || null,
              student_id: visibleStudentIdentifier(r.grade ?? undefined, r.studentId ?? undefined) ?? null,
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
            });
          }
        }
        const result = await processBatch('students', rows);
        inserted += result.ok;
        errors += result.err;

      } else if (category === 'payments') {
        // For payments, we need to match student names to IDs
        for (const r of records as PaymentRec[]) {
          const studentName = String(r.studentName || '');
          const matchedStudent = students.find(
            (s) => s.name.toLowerCase().trim() === studentName.toLowerCase().trim()
          );
          if (!matchedStudent) {
            errors++;
            continue;
          }
          const amount = Number(r.amount) || 0;
          const date = r.date || todayStr;
          // Exact duplicate (same student, date and amount) → never double-count
          const alreadyExists = matchedStudent.payments.some(
            (p) => p.date === date && Number(p.amount) === amount
          );
          if (alreadyExists) {
            updated++;
            continue;
          }
          const { error } = await supabase.from('payments').insert({
            student_id: matchedStudent.id,
            amount,
            date,
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
              amount_paid: matchedStudent.amountPaid + amount,
              last_payment_date: date,
            }).eq('id', matchedStudent.id);
          }
        }

      } else if (category === 'parents') {
        const byKey = new Map<string, Parent>();
        parents.forEach(p => byKey.set(p.fullName.toLowerCase().trim(), p));
        const rows: DbInsert<'parents'>[] = [];
        for (const r of records as ParentRec[]) {
          const key = String(r.fullName || '').toLowerCase().trim();
          const existing = key ? byKey.get(key) : undefined;
          if (existing) {
            if (strategy === 'update') {
              const { error } = await supabase.from('parents').update({
                phones: [r.phone1, r.phone2, ...(existing.phones || [])].filter((p): p is string => Boolean(p)).slice(0, 2),
                email: r.email ?? existing.email ?? null,
                address: r.address ?? existing.address ?? '',
                occupation: r.occupation ?? existing.occupation ?? '',
                relationship: r.relationship ?? existing.relationship ?? '',
                notes: r.notes ?? existing.notes ?? null,
              }).eq('id', existing.id);
              if (error) { errors++; console.error('[MAMA THERA] parent import update error:', error.message); }
              else updated++;
            } else {
              updated++;
            }
          } else {
            rows.push({
              full_name: r.fullName || '',
              phones: [r.phone1, r.phone2].filter((p): p is string => Boolean(p)),
              email: r.email || null,
              address: r.address || '',
              occupation: r.occupation || '',
              relationship: r.relationship || '',
            });
          }
        }
        const result = await processBatch('parents', rows);
        inserted += result.ok;
        errors += result.err;

      } else if (category === 'staff') {
        const byKey = new Map<string, Staff>();
        staff.forEach(s => byKey.set(s.name.toLowerCase().trim(), s));
        const rows: DbInsert<'staff'>[] = [];
        for (const r of records as StaffRec[]) {
          const key = String(r.name || '').toLowerCase().trim();
          const existing = key ? byKey.get(key) : undefined;
          if (existing) {
            if (strategy === 'update') {
              const { error } = await supabase.from('staff').update({
                position: r.position ?? existing.position ?? '',
                salary: r.salary ?? existing.salary,
                email: r.email ?? existing.email ?? null,
                phone: r.phone ?? existing.phone ?? '',
                bank_details: r.bankDetails ?? existing.bankDetails ?? null,
                emergency_contact: r.emergencyContact ?? existing.emergencyContact ?? null,
                academic_year: options.academicYear || existing.academicYear || null,
              }).eq('id', existing.id);
              if (error) { errors++; console.error('[MAMA THERA] staff import update error:', error.message); }
              else updated++;
            } else {
              updated++;
            }
          } else {
            rows.push({
              name: r.name || '',
              position: r.position || '',
              salary: r.salary || 0,
              email: r.email || null,
              phone: r.phone || '',
              bank_details: r.bankDetails || null,
              emergency_contact: r.emergencyContact || null,
              academic_year: options.academicYear || null,
            });
          }
        }
        const result = await processBatch('staff', rows);
        inserted += result.ok;
        errors += result.err;

      } else if (category === 'expenses') {
        const byKey = new Map<string, Expense>();
        expenses.forEach(e => byKey.set(`${e.description.toLowerCase().trim()}|${e.date}|${e.amount}`, e));
        const rows: DbInsert<'expenses'>[] = [];
        for (const r of records as ExpenseRec[]) {
          const description = String(r.description || '').toLowerCase().trim();
          const amount = Number(r.amount) || 0;
          const date = r.date || todayStr;
          const existing = byKey.get(`${description}|${date}|${amount}`);
          if (existing) {
            if (strategy === 'update') {
              const { error } = await supabase.from('expenses').update({
                category: r.category ?? existing.category,
                description: r.description ?? existing.description,
                amount: r.amount ?? existing.amount,
                academic_year: options.academicYear || existing.academicYear || null,
              }).eq('id', existing.id);
              if (error) { errors++; console.error('[MAMA THERA] expense import update error:', error.message); }
              else updated++;
            } else {
              updated++;
            }
          } else {
            rows.push({
              category: r.category || 'stationery',
              description: r.description || '',
              amount,
              date,
              academic_year: options.academicYear || null,
            });
          }
        }
        const result = await processBatch('expenses', rows);
        inserted += result.ok;
        errors += result.err;
      }

      logAuditEvent({
        action: 'BATCH_IMPORT',
        targetType: category,
        details: `Imported ${inserted} ${category} record(s) via Excel (${updated} updated, ${errors} errors)`,
      });

      // Refresh data to reflect newly imported records
      await fetchAll();

      notifySuccess(`batchImport_${category}`);
      return { inserted, updated, errors };
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Import failed';
      console.error('[MAMA THERA] batchImportData error:', err);
      notifyError('batchImportData', msg);
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


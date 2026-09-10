/**
 * Supabase Data Hooks
 *
 * Custom hooks for fetching and mutating data from Supabase.
 * These replace the hardcoded mock data in App.tsx with real database operations.
 *
 * Features:
 * - Retry with exponential backoff for network resilience (Bamako connectivity)
 * - Notification callbacks for toast-based user feedback
 *
 * The CRUD mutations are split into per-domain factories (src/lib/dataOps/*)
 * built from the shared SupabaseDataCtx, mirroring the MainViews split: this
 * module owns state + fetch/sync and wires everything together.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from './supabaseClient';
import type { DbRow } from './database.types';
import { retryWithBackoff } from './networkUtils';
import {
  enqueueOfflineAction,
  getOfflineQueue,
  getOfflineQueueCount,
  OfflineActionType,
  OfflinePayload,
} from './offlineQueue';
import { drainOfflineQueue } from './offlineSync';
import type { AuditLogEntry } from './auditLogger';
import { logAuditEvent } from './auditLogger';
import { mapExpenseRow, mapParentRow, mapSalaryPaymentRow, mapStaffRow, mapStudentRow, mapTodoRow, mapVendorExpenseRow } from './rowMappers';
import { importBatchData } from './batchImport';
import type { SupabaseDataCtx } from './dataOpsContext';
import { createClassOps } from './dataOps/classes';
import { createParentOps } from './dataOps/parents';
import { createStudentOps } from './dataOps/students';
import { createPaymentOps } from './dataOps/payments';
import { createStaffOps } from './dataOps/staff';
import { createExpenseOps } from './dataOps/expenses';
import { createTodoOps } from './dataOps/todos';

// Former public type exports, preserved for importers of this module
// (App.tsx, mainViewsProps, AppModals, PayrollView, …). Single source: ./domainTypes.
export type {
  ClassCycle,
  CustomClass,
  Expense,
  Parent,
  Payment,
  SalaryPayment,
  Staff,
  Student,
  StudentNoteEntry,
  Todo,
  VendorExpense,
} from './domainTypes';
import type {
  ClassCycle,
  CustomClass,
  Expense,
  Parent,
  Payment,
  SalaryPayment,
  Staff,
  Student,
  StudentNoteEntry,
  Todo,
  VendorExpense,
} from './domainTypes';

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
      // Replayed offline mutations are audited too (the queue drain is where
      // they materialize in the DB), with the [replay] tag in details.
      syncedCount = await drainOfflineQueue(supabase, (info) => {
        if (info) void logAuditEvent(info);
      });
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

  const fetchAll = useCallback(async (opts?: { silent?: boolean }) => {
    // Silent refreshes (periodic polling) must not flash the loading screen
    // nor surface transient errors — only the initial/retry loads do.
    if (!opts?.silent) setLoading(true);
    if (!opts?.silent) setError(null);
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
      if (!opts?.silent) {
        console.error('[MAMA THERA] fetchAll failed after retries:', msg);
        setError(msg);
      }
    } finally {
      if (!opts?.silent) setLoading(false);
    }
  }, []);

  // Initial load is AUTH-GATED: no anon reads fire on the login screen. The
  // sessionStorage session is picked up by getSession() on mount; a fresh
  // sign-in (SIGNED_IN) triggers the fetch; SIGNED_OUT clears the domain
  // state so a shared computer never shows the previous account's rows (the
  // next sign-in refetches from scratch).
  useEffect(() => {
    let cancelled = false;
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (cancelled) return;
      if (event === 'SIGNED_IN') void fetchAll();
      if (event === 'SIGNED_OUT') {
        setParents([]);
        setStudents([]);
        setStaff([]);
        setSalaryPayments([]);
        setExpenses([]);
        setVendorExpenses([]);
        setTodos([]);
        setCustomClasses([]);
        setError(null);
      }
    });
    void supabase.auth.getSession().then(({ data: { session } }) => {
      if (!cancelled && session?.user) void fetchAll();
    });
    return () => {
      cancelled = true;
      subscription.unsubscribe();
    };
  }, [fetchAll]);

  // ── Per-domain CRUD (split into factories) ─────────────────────────────

  const ctx: SupabaseDataCtx = {
    students,
    staff,
    parents,
    vendorExpenses,
    setParents, setStudents, setStaff, setSalaryPayments,
    setExpenses, setVendorExpenses, setTodos, setCustomClasses,
    notifySuccess, notifyError, isOffline, enqueueOffline, updateQueueCount,
  };

  const { addCustomClass, updateCustomClass, deleteCustomClass } = createClassOps(ctx);
  const { addParent, updateParent, deleteParent } = createParentOps(ctx);
  const { addStudent, updateStudent, deleteStudent, batchPromoteStudents } = createStudentOps(ctx);
  const { addPayment, addSalaryPayment } = createPaymentOps(ctx);
  const { addStaff, updateStaff, deleteStaff } = createStaffOps(ctx);
  const { addExpense, addVendorExpense, updateVendorExpense, deleteVendorExpense } = createExpenseOps(ctx);
  const { addTodo, updateTodo, deleteTodo } = createTodoOps(ctx);

  // ── Batch Import (Smart Excel Ingestion) ─────────────────────────────────

  const batchImportData = (
    category: 'students' | 'payments' | 'parents' | 'staff' | 'expenses',
    records: Record<string, unknown>[],
    options: { academicYear: string; duplicateStrategy: 'skip' | 'update' }
  ) => importBatchData(category, records, options, {
    students, parents, staff, expenses,
    fetchAll,
    notifySuccess,
    notifyError,
  });

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
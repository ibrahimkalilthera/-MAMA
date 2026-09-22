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
import { isAuthTokenError, isStationOffline, retryWithBackoff } from './networkUtils';
import {
  pendingAuditEntries,
  readAuditJournalCache,
  writeAuditJournalCache,
} from './offlineAuditJournal';
import {
  enqueueOfflineAction,
  getOfflineQueue,
  getOfflineQueueCount,
  getOfflineQueueFailures,
  OfflineActionType,
  OfflinePayload,
} from './offlineQueue';
import { drainOfflineQueue } from './offlineSync';
import { loadOfflineSnapshot, saveOfflineSnapshot } from './offlineSnapshot';
import type { AuditLogEntry, LogAuditParams } from './auditLogger';
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

/**
 * Session facts this hook needs, and that only the auth layer knows:
 *   • `userId`  — whose snapshot this station may keep (never another account's);
 *   • `offlineSession` — the session has no token (offline sign-in), so nothing
 *     may be sent: every write is queued and the screen reads the snapshot.
 */
export interface SupabaseDataOptions {
  userId?: string | null;
  offlineSession?: boolean;
  /**
   * L'utilisateur de la station (id, courriel, nom, rôle), pour que le journal
   * affiché puisse nommer l'auteur d'une entrée encore en file — le chemin en
   * ligne, lui, le résout tout seul.
   */
  actor?: LogAuditParams['user'] | null;
}

/** How long a burst of local changes is gathered before the snapshot is written. */
const SNAPSHOT_DEBOUNCE_MS = 1200;

export function useSupabaseData(callbacks?: SupabaseDataCallbacks, options?: SupabaseDataOptions) {
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
  const [pendingFailures, setPendingFailures] = useState<number>(() => getOfflineQueueFailures());
  const [cacheSavedAt, setCacheSavedAt] = useState<string | null>(null);
  const [isSyncing, setIsSyncing] = useState(false);
  const [auditLogs, setAuditLogs] = useState<AuditLogEntry[]>([]);

  // Ce que la BASE a répondu (ou le cache du poste), sans les entrées encore en
  // file — celles-ci sont ajoutées à l'affichage par `composeAuditLogs`.
  const auditBaseRef = useRef<AuditLogEntry[]>([]);

  const composeAuditLogs = useCallback(() => {
    const pending = pendingAuditEntries(actorRef.current);
    setAuditLogs([...pending, ...auditBaseRef.current]);
  }, []);

  const fetchAuditLogs = useCallback(async () => {
    const userId = userIdRef.current;
    // Sans réseau, le journal se lit sur le poste : les entrées reçues la
    // dernière fois, PLUS les gestes faits depuis (la file), marqués.
    if (isStationOffline()) {
      auditBaseRef.current = userId ? readAuditJournalCache(userId) : [];
      composeAuditLogs();
      return;
    }
    try {
      const { data, error } = await supabase
        .from('audit_logs')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(100);

      if (error) {
        console.warn('fetchAuditLogs info/error:', error.message);
        // La base a refusé ou n'a pas répondu : le cache du poste vaut mieux
        // qu'un journal vide, qui se lirait « l'école n'a rien fait ».
        auditBaseRef.current = userId ? readAuditJournalCache(userId) : [];
        composeAuditLogs();
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
        auditBaseRef.current = mapped;
        if (userId) writeAuditJournalCache(userId, mapped);
        composeAuditLogs();
      }
    } catch (err) {
      console.warn('fetchAuditLogs exception:', err);
      auditBaseRef.current = userId ? readAuditJournalCache(userId) : [];
      composeAuditLogs();
    }
  }, [composeAuditLogs]);

  // Stable (useCallback) parce que le drainage de la file en dépend : sans cela
  // le crochet se recréerait à chaque rendu, et avec lui l'écouteur « online ».
  const updateQueueCount = useCallback(() => {
    setPendingQueueCount(getOfflineQueueCount());
    setPendingFailures(getOfflineQueueFailures());
    // La file a changé : le journal montre donc une entrée de plus (un geste
    // vient d'être mis en file) ou de moins (le rejeu vient de l'écrire en base).
    composeAuditLogs();
  }, [composeAuditLogs]);

  // Store callbacks in ref to avoid re-creating memoized functions
  const callbacksRef = useRef(callbacks);
  callbacksRef.current = callbacks;

  const notifySuccess = (operation: string) => callbacksRef.current?.onMutationSuccess?.(operation);
  const notifyError = (operation: string, msg: string) => callbacksRef.current?.onMutationError?.(operation, msg);

  // `isOffline` combines TWO impossibilities, and the second one is the whole
  // point of the offline session: no network, OR no usable session (signed in
  // from the local verifier, no token yet — see src/lib/useAuth.ts). A write
  // made in that state must be QUEUED, never attempted and lost.
  //
  // Options are read through refs because the memoized callbacks below
  // (fetchAll, syncOfflineQueue) keep the first render's binding, while the
  // session itself appears after that first render.
  const userIdRef = useRef<string | null>(options?.userId ?? null);
  userIdRef.current = options?.userId ?? null;
  const offlineSessionRef = useRef(Boolean(options?.offlineSession));
  offlineSessionRef.current = Boolean(options?.offlineSession);
  const actorRef = useRef<LogAuditParams['user'] | null>(options?.actor ?? null);
  actorRef.current = options?.actor ?? null;

  // `isStationOffline()` porte les deux impossibilités au niveau du module (voir
  // networkUtils) : une seule réponse pour ce crochet ET pour les modules qui
  // écrivent en dehors de lui — notes du calendrier, journal, année scolaire.
  const isOffline = () => offlineSessionRef.current || isStationOffline();
  const enqueueOffline = (type: OfflineActionType, payload: OfflinePayload['payload'], localId?: string) => {
    enqueueOfflineAction(type, payload, localId);
    updateQueueCount();
  };

  // ── Offline snapshot (the dataset this station last received) ───────────
  // Written after a REAL load and after every local change, read back when the
  // station has nothing to load from. `snapshotLoadedRef` is what stops an
  // empty in-memory state (a sign-out, a load that failed) from overwriting a
  // good snapshot with emptiness.
  const snapshotLoadedRef = useRef(false);

  // Un jeu de données déjà en mémoire ne doit JAMAIS être remplacé par la copie
  // du disque : depuis que l'import et la promotion peuvent travailler hors
  // ligne, l'état local porte des lignes qui n'existent nulle part ailleurs
  // (elles attendent dans la file), et les réécrire avec l'instantané les ferait
  // disparaître de l'écran.
  const hydrateFromCache = useCallback((userId: string): boolean => {
    const snapshot = loadOfflineSnapshot(userId);
    if (!snapshot) return false;
    setParents(snapshot.data.parents);
    setStudents(snapshot.data.students);
    setStaff(snapshot.data.staff);
    setSalaryPayments(snapshot.data.salaryPayments);
    setExpenses(snapshot.data.expenses);
    setVendorExpenses(snapshot.data.vendorExpenses);
    setTodos(snapshot.data.todos);
    setCustomClasses(snapshot.data.customClasses);
    snapshotLoadedRef.current = true;
    setCacheSavedAt(snapshot.savedAt);
    return true;
  }, []);

  // ── Fetch all data ──────────────────────────────────────────────────────

  const fetchAll = useCallback(async (opts?: { silent?: boolean }) => {
    // Silent refreshes (periodic polling) must not flash the loading screen
    // nor surface transient errors — only the initial/retry loads do.
    if (!opts?.silent) setLoading(true);
    if (!opts?.silent) setError(null);

    // Rien à demander à la base : ni réseau, ni session utilisable. L'écran
    // part de l'instantané de ce poste — et le bandeau dira son âge — au lieu
    // d'attendre trois tentatives (≈ 7 s) pour finir sur une base vide.
    if (isOffline()) {
      const userId = userIdRef.current;
      const hydrated = snapshotLoadedRef.current || (userId ? hydrateFromCache(userId) : false);
      if (!opts?.silent) {
        setLoading(false);
        if (!hydrated) console.warn('[MAMA THERA] Hors ligne et aucun instantané local pour ce compte.');
      }
      return;
    }
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

        // La base a répondu : à partir d'ici, l'état en mémoire est une
        // photographie VALIDE de l'école et peut être conservée sur le poste.
        snapshotLoadedRef.current = true;
      }, {
        maxRetries: 3,
        onRetry: (attempt, error) => {
          // A token rejection (PGRST300/301, « JWT issued at future ») is not a
          // data problem: the token that went out is unusable *right now*.
          // Refreshing it here — instead of waiting for the next background
          // cycle — is what makes the retry go out with a usable one, so the
          // user never sees the red banner that used to require « Réessayer ».
          if (isAuthTokenError(error instanceof Error ? error.message : String(error ?? ''))) {
            void supabase.auth.refreshSession().catch(() => {});
          }
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
    // `hydrateFromCache` est stable (useCallback sans dépendance) : l'ajouter
    // aux dépendances ne rend donc pas `fetchAll` instable, et c'est bien lui
    // qui sert l'instantané quand la base est hors de portée.
  }, [hydrateFromCache]);

  // ── Offline Synchronization ─────────────────────────────────────────────

  const syncOfflineQueue = useCallback(async () => {
    if (getOfflineQueue().length === 0) return;
    // Session hors ligne : elle n'a pas encore de jeton, donc envoyer ne
    // produirait qu'un refus de policy et marquerait comme « refusées » des
    // saisies parfaitement valides. C'est la reconnexion silencieuse (voir
    // src/lib/useAuth.ts) qui rouvre la session, et le SIGNED_IN qui en découle
    // repasse ici avec un vrai jeton.
    if (offlineSessionRef.current) return;

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
        // La base vient de recevoir ce qui attendait : on relit pour repartir de
        // SA vérité (ids réels, totaux consolidés ailleurs) et non de l'état
        // optimiste de ce poste.
        void fetchAll({ silent: true });
      }
    }
  }, [fetchAll, updateQueueCount]);

  // Auto-sync when internet comes back
  useEffect(() => {
    const handleOnline = () => {
      syncOfflineQueue();
    };
    window.addEventListener('online', handleOnline);
    return () => window.removeEventListener('online', handleOnline);
  }, [syncOfflineQueue]);

  // Enregistre l'instantané après chaque changement local (débounce : une
  // saisie produit plusieurs rendus, un seul écrit).
  useEffect(() => {
    const userId = options?.userId ?? null;
    if (!userId || !snapshotLoadedRef.current) return;
    const handle = setTimeout(() => {
      const savedAt = saveOfflineSnapshot(userId, {
        parents, students, staff, salaryPayments, expenses, vendorExpenses, todos, customClasses,
      });
      if (savedAt) setCacheSavedAt(savedAt);
    }, SNAPSHOT_DEBOUNCE_MS);
    return () => clearTimeout(handle);
  }, [options?.userId, parents, students, staff, salaryPayments, expenses, vendorExpenses, todos, customClasses]);

  // Une session hors ligne n'a PAS de jeton : aucun événement Supabase ne
  // viendra, donc rien ne déclencherait le chargement et le poste resterait
  // indéfiniment sur son écran de connexion. C'est ce drapeau qui ouvre l'écran
  // sur l'instantané de la machine.
  const offlineSession = Boolean(options?.offlineSession);
  useEffect(() => {
    if (!offlineSession) return;
    const userId = userIdRef.current;
    if (userId) hydrateFromCache(userId);
    setLoading(false);
  }, [offlineSession, hydrateFromCache]);

  // ── La session hors ligne vient d'être RÉTABLIE : vider la file ──────────
  //
  // C'est le moment qui compte, et c'est le SEUL qui marche — l'événement
  // « online » ne peut pas le faire, pour une raison d'ORDRE : il part avant que
  // le mot de passe gardé en mémoire soit rejoué, donc bien avant qu'un jeton
  // existe. `syncOfflineQueue` le voit, s'arrête (à juste titre : envoyer sans
  // jeton ne produirait qu'un refus de policy et marquerait « refusées » des
  // saisies parfaitement valides), et plus RIEN ne repassait ensuite : la
  // connexion silencieuse réussie ne redéclenche ni l'événement ni un drainage.
  // La saisie de la journée — un élève, un paiement, le reçu imprimé — restait
  // donc dans la file jusqu'au prochain démarrage de l'application.
  //
  // L'observation juste est donc la TRANSITION de la session, pas l'événement
  // réseau : à cet instant le jeton existe (Supabase vient d'émettre une vraie
  // session) et l'envoi passe.
  const wasOfflineSessionRef = useRef(false);
  useEffect(() => {
    const was = wasOfflineSessionRef.current;
    wasOfflineSessionRef.current = offlineSession;
    if (was && !offlineSession) void syncOfflineQueue();
  }, [offlineSession, syncOfflineQueue]);

  // Initial load is AUTH-GATED: no anon reads fire on the login screen. The
  // sessionStorage session is picked up by getSession() on mount; a fresh
  // sign-in (SIGNED_IN) triggers the fetch; SIGNED_OUT clears the domain
  // state so a shared computer never shows the previous account's rows (the
  // next sign-in refetches from scratch).
  //
  // The queue is drained BEFORE the load, in both entry points: an app reopened
  // with internet after an offline day must SEND what it holds first, or the
  // load that follows would erase from the screen exactly what is still waiting.
  useEffect(() => {
    let cancelled = false;
    const boot = async () => {
      await syncOfflineQueue();
      if (!cancelled) void fetchAll();
    };
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (cancelled) return;
      if (event === 'SIGNED_IN') void boot();
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
        // L'état vidé n'est pas une donnée : il ne doit jamais remplacer
        // l'instantané du poste (le prochain chargement le réécrira).
        snapshotLoadedRef.current = false;
      }
    });
    void supabase.auth.getSession().then(({ data: { session } }) => {
      if (!cancelled && session?.user) void boot();
    });
    return () => {
      cancelled = true;
      subscription.unsubscribe();
    };
  }, [fetchAll, syncOfflineQueue]);

  // ── Per-domain CRUD (split into factories) ─────────────────────────────

  const ctx: SupabaseDataCtx = {
    students,
    staff,
    parents,
    vendorExpenses,
    expenses,
    setParents, setStudents, setStaff, setSalaryPayments,
    setExpenses, setVendorExpenses, setTodos, setCustomClasses,
    notifySuccess, notifyError, isOffline, enqueueOffline, updateQueueCount,
  };

  const { addCustomClass, updateCustomClass, deleteCustomClass } = createClassOps(ctx);
  const { addParent, updateParent, deleteParent } = createParentOps(ctx);
  const { addStudent, updateStudent, deleteStudent, batchPromoteStudents } = createStudentOps(ctx);
  const { addPayment, addSalaryPayment } = createPaymentOps(ctx);
  const { addStaff, updateStaff, deleteStaff } = createStaffOps(ctx);
  const { addExpense, updateExpense, deleteExpense, addVendorExpense, updateVendorExpense, deleteVendorExpense } = createExpenseOps(ctx);
  const { addTodo, updateTodo, deleteTodo } = createTodoOps(ctx);

  // ── Batch Import (Smart Excel Ingestion) ─────────────────────────────────

  // `write` passe les fonctions du DOMAINE, pas le client Supabase : l'import
  // emprunte donc exactement la voie de la saisie à l'écran, file d'attente
  // hors ligne comprise (voir src/lib/batchImport.ts).
  const batchImportData = (
    category: 'students' | 'payments' | 'parents' | 'staff' | 'expenses',
    records: Record<string, unknown>[],
    options: { academicYear: string; duplicateStrategy: 'skip' | 'update' }
  ) => importBatchData(category, records, options, {
    students, parents, staff, expenses,
    fetchAll,
    notifySuccess,
    notifyError,
    isOffline,
    write: {
      addStudent, updateStudent,
      addParent, updateParent,
      addStaff, updateStaff,
      addExpense, updateExpense,
      addPayment,
    },
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
    /** Envoyées et refusées au moins une fois — toujours en file, jamais perdues. */
    pendingFailures,
    /** Heure du dernier instantané de ce poste (null : aucun jeu de données local). */
    cacheSavedAt,
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
    addExpense, updateExpense, deleteExpense,
    addVendorExpense, updateVendorExpense, deleteVendorExpense,
    addTodo, updateTodo, deleteTodo,
    batchPromoteStudents,
    batchImportData,
  };
}
import type { Parent, Student, Staff, SalaryPayment, Expense, VendorExpense, Todo, Payment } from './domainTypes';

/**
 * Offline Action Queue Manager
 * 
 * Manages queued mutations in localStorage when internet connectivity is lost in Bamako.
 * Enables optimistic UI updates and auto-sync when connection is restored.
 */

export type OfflineActionType =
  | 'addPayment'
  | 'addExpense'
  | 'updateExpense'
  | 'deleteExpense'
  | 'addVendorExpense'
  | 'updateVendorExpense'
  | 'deleteVendorExpense'
  | 'addStudent'
  | 'updateStudent'
  | 'deleteStudent'
  | 'addStaff'
  | 'updateStaff'
  | 'deleteStaff'
  | 'addSalaryPayment'
  | 'addParent'
  | 'updateParent'
  | 'deleteParent'
  | 'addTodo'
  | 'updateTodo'
  | 'deleteTodo'
  | 'addClass'
  | 'updateClass'
  | 'deleteClass'
  | 'addNote'
  | 'deleteNote'
  | 'setCurrentYear'
  | 'addAuditLog'
  | 'updateUserRole';

/** Une classe personnalisée, telle que le formulaire la produit (codes compris). */
export interface QueuedClassFields {
  code: string;
  cycle: string;
  year: string;
  section: string;
  nameFr: string;
  nameEn: string;
}

/**
 * L'acteur d'une entrée de journal — figé AU MOMENT DU GESTE.
 *
 * Le retrouver au rejeu le ferait attribuer à la personne qui a rebranché le
 * câble, et non à celle qui a enregistré l'élève : le journal doit dire qui a
 * fait quoi, pas qui passait par là quand la ligne est revenue.
 */
export interface QueuedAuditEntry {
  userId?: string | null;
  userEmail?: string;
  userName?: string;
  userRole?: string;
  action: string;
  targetType?: string | null;
  targetId?: string | null;
  details?: string | null;
}

/** Payload shape for each queued action type, so replay sites are type-checked. */
export type OfflinePayload =
  | { type: 'addPayment'; payload: { studentId: string; payment: Omit<Payment, 'receiptNumber'> & { receiptNumber?: string } } }
  | { type: 'addExpense'; payload: Omit<Expense, 'id'> }
  | { type: 'updateExpense'; payload: { id: string; updates: Partial<Expense> } }
  | { type: 'deleteExpense'; payload: { id: string } }
  | { type: 'addVendorExpense'; payload: Omit<VendorExpense, 'id'> }
  | { type: 'updateVendorExpense'; payload: { id: string; updates: Partial<VendorExpense> } }
  | { type: 'deleteVendorExpense'; payload: { id: string } }
  | { type: 'addStudent'; payload: Omit<Student, 'id' | 'payments'> }
  | { type: 'updateStudent'; payload: { id: string; updates: Partial<Student> } }
  | { type: 'deleteStudent'; payload: { id: string } }
  | { type: 'addStaff'; payload: Omit<Staff, 'id'> }
  | { type: 'updateStaff'; payload: { id: string; updates: Partial<Staff> } }
  | { type: 'deleteStaff'; payload: { id: string } }
  | { type: 'addSalaryPayment'; payload: Omit<SalaryPayment, 'id'> }
  | { type: 'addParent'; payload: Omit<Parent, 'id'> }
  | { type: 'updateParent'; payload: { id: string; updates: Partial<Parent> } }
  | { type: 'deleteParent'; payload: { id: string } }
  | { type: 'addTodo'; payload: Omit<Todo, 'id'> }
  | { type: 'updateTodo'; payload: { id: string; updates: Partial<Todo> } }
  | { type: 'deleteTodo'; payload: { id: string } }
  | { type: 'addClass'; payload: QueuedClassFields }
  | { type: 'updateClass'; payload: { id: string; updates: QueuedClassFields } }
  | { type: 'deleteClass'; payload: { id: string } }
  | { type: 'addNote'; payload: { date: string; text: string } }
  | { type: 'deleteNote'; payload: { id: string } }
  | { type: 'setCurrentYear'; payload: { year: string } }
  | { type: 'addAuditLog'; payload: QueuedAuditEntry }
  | { type: 'updateUserRole'; payload: { id: string; role: string } };

export interface QueueItemBase {
  id: string;
  createdAt: string;
  attempts: number;
  /**
   * The id the app gave the row while it was offline (`off_<kind>_…`, see
   * createTempId), for the actions that CREATE a row. The replay uses it to
   * rewrite the later actions that point at that row: a payment recorded for a
   * pupil enrolled offline would otherwise be sent with a student_id no
   * database ever had, and would stay queued forever.
   */
  localId?: string;
}

export type QueueItem = QueueItemBase & OfflinePayload;

const STORAGE_KEY = 'mama_thera_offline_queue';

/**
 * Storage backend: browser localStorage when available, an in-memory map
 * otherwise (SSR and the node test runner) — so the queue can be exercised
 * end-to-end without a DOM. Browser behaviour is unchanged.
 */
const memoryStore = new Map<string, string>();
const storage = {
  getItem(key: string): string | null {
    return typeof localStorage === 'undefined'
      ? (memoryStore.get(key) ?? null)
      : localStorage.getItem(key);
  },
  setItem(key: string, value: string): void {
    if (typeof localStorage === 'undefined') {
      memoryStore.set(key, value);
      return;
    }
    localStorage.setItem(key, value);
  },
  removeItem(key: string): void {
    if (typeof localStorage === 'undefined') {
      memoryStore.delete(key);
      return;
    }
    localStorage.removeItem(key);
  },
};

/**
 * Retrieve all pending offline items from localStorage.
 */
export function getOfflineQueue(): QueueItem[] {
  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (err) {
    console.error('Failed to read offline queue from localStorage:', err);
    return [];
  }
}

/**
 * Save current offline queue to localStorage.
 */
export function saveOfflineQueue(queue: QueueItem[]): void {
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(queue));
  } catch (err) {
    console.error('Failed to save offline queue to localStorage:', err);
  }
}

/**
 * Enqueue a new action for later synchronization.
 *
 * `localId` is the offline id of the row this action creates (optional: only
 * the creating actions have one) — see QueueItemBase.localId.
 */
export function enqueueOfflineAction(
  type: OfflineActionType,
  payload: OfflinePayload['payload'],
  localId?: string,
): QueueItem {
  // `type` and `payload` arrive as two independent arguments, so the
  // discriminated-union correlation cannot be verified structurally — assert
  // at this single boundary and let the union narrow every replay site.
  const item = {
    id: `off_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
    type,
    payload,
    createdAt: new Date().toISOString(),
    attempts: 0,
    localId,
  } as QueueItem;

  const queue = getOfflineQueue();
  queue.push(item);
  saveOfflineQueue(queue);

  return item;
}

/**
 * Remove a successfully processed item from the queue.
 */
export function removeOfflineAction(id: string): void {
  const queue = getOfflineQueue().filter(item => item.id !== id);
  saveOfflineQueue(queue);
}

/**
 * Clear all items in the offline queue.
 */
export function clearOfflineQueue(): void {
  try {
    storage.removeItem(STORAGE_KEY);
  } catch (err) {
    console.error('Failed to clear offline queue:', err);
  }
}

/**
 * Count one more failed attempt at sending this item.
 *
 * An item whose replay fails STAYS queued (it is retried on the next pass, and
 * nothing may be silently dropped). Counting the attempt is what lets the
 * screen DISTINGUISH « en attente d'envoi » from « refused, and it will not go
 * through on its own » — a payment stuck on a deleted pupil would otherwise be
 * retried forever, invisible, while the receipt is already in the parent's hand.
 */
export function markOfflineAttempt(id: string): void {
  const queue = getOfflineQueue().map(item =>
    item.id === id ? { ...item, attempts: item.attempts + 1 } : item,
  );
  saveOfflineQueue(queue);
}

/**
 * Get total number of pending offline actions.
 */
export function getOfflineQueueCount(): number {
  return getOfflineQueue().length;
}

/**
 * Ce type d'action attend-il déjà dans la file ?
 *
 * Sert aux gestes IDEMPOTENTS et répétés par nature — la déclaration d'année est
 * retentée à chaque démarrage : sans ce garde-fou, un poste qui redémarre dix
 * fois hors ligne empile dix fois la même écriture.
 */
export function isActionQueued(type: OfflineActionType): boolean {
  return getOfflineQueue().some(item => item.type === type);
}

/**
 * How many queued actions have already failed at least once. They are still
 * queued (never dropped) — this is the number the user must know about.
 */
export function getOfflineQueueFailures(): number {
  return getOfflineQueue().filter(item => item.attempts > 0).length;
}

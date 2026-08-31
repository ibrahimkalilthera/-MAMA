import type { Parent, Student, Staff, SalaryPayment, Expense, VendorExpense, Todo, Payment } from '../app/types';

/**
 * Offline Action Queue Manager
 * 
 * Manages queued mutations in localStorage when internet connectivity is lost in Bamako.
 * Enables optimistic UI updates and auto-sync when connection is restored.
 */

export type OfflineActionType =
  | 'addPayment'
  | 'addExpense'
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
  | 'deleteTodo';

/** Payload shape for each queued action type, so replay sites are type-checked. */
export type OfflinePayload =
  | { type: 'addPayment'; payload: { studentId: string; payment: Omit<Payment, 'receiptNumber'> & { receiptNumber?: string } } }
  | { type: 'addExpense'; payload: Omit<Expense, 'id'> }
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
  | { type: 'deleteTodo'; payload: { id: string } };

export interface QueueItemBase {
  id: string;
  createdAt: string;
  attempts: number;
}

export type QueueItem = QueueItemBase & OfflinePayload;

const STORAGE_KEY = 'mama_thera_offline_queue';

/**
 * Retrieve all pending offline items from localStorage.
 */
export function getOfflineQueue(): QueueItem[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
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
    localStorage.setItem(STORAGE_KEY, JSON.stringify(queue));
  } catch (err) {
    console.error('Failed to save offline queue to localStorage:', err);
  }
}

/**
 * Enqueue a new action for later synchronization.
 */
export function enqueueOfflineAction(type: OfflineActionType, payload: OfflinePayload['payload']): QueueItem {
  // `type` and `payload` arrive as two independent arguments, so the
  // discriminated-union correlation cannot be verified structurally — assert
  // at this single boundary and let the union narrow every replay site.
  const item = {
    id: `off_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
    type,
    payload,
    createdAt: new Date().toISOString(),
    attempts: 0,
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
    localStorage.removeItem(STORAGE_KEY);
  } catch (err) {
    console.error('Failed to clear offline queue:', err);
  }
}

/**
 * Get total number of pending offline actions.
 */
export function getOfflineQueueCount(): number {
  return getOfflineQueue().length;
}

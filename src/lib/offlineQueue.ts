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

export interface QueueItem {
  id: string;
  type: OfflineActionType;
  payload: any;
  createdAt: string;
  attempts: number;
}

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
export function enqueueOfflineAction(type: OfflineActionType, payload: any): QueueItem {
  const item: QueueItem = {
    id: `off_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
    type,
    payload,
    createdAt: new Date().toISOString(),
    attempts: 0,
  };

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

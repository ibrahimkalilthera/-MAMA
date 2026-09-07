/**
 * SupabaseDataCtx — the shared slice every per-domain data operation factory
 * (see ./dataOps/*) receives from `useSupabaseData`.
 *
 * Instead of closing over the hook's internal state setters and helpers, each
 * CRUD group is built by a factory that takes this context. That mirrors the
 * MainViews split: the orchestrator (useSupabaseData.ts) owns state and
 * wires everything, the per-domain modules stay pure and testable.
 */
import type { Dispatch, SetStateAction } from 'react';
import type {
  CustomClass,
  Expense,
  Parent,
  SalaryPayment,
  Staff,
  Student,
  Todo,
  VendorExpense,
} from './domainTypes';
import type { OfflineActionType, OfflinePayload } from './offlineQueue';

export interface SupabaseDataCtx {
  /** Current students array (needed by promotion/import logic). */
  students: Student[];
  // State setters
  setParents: Dispatch<SetStateAction<Parent[]>>;
  setStudents: Dispatch<SetStateAction<Student[]>>;
  setStaff: Dispatch<SetStateAction<Staff[]>>;
  setSalaryPayments: Dispatch<SetStateAction<SalaryPayment[]>>;
  setExpenses: Dispatch<SetStateAction<Expense[]>>;
  setVendorExpenses: Dispatch<SetStateAction<VendorExpense[]>>;
  setTodos: Dispatch<SetStateAction<Todo[]>>;
  setCustomClasses: Dispatch<SetStateAction<CustomClass[]>>;
  // Shared helpers
  notifySuccess: (operation: string) => void;
  notifyError: (operation: string, msg: string) => void;
  isOffline: () => boolean;
  enqueueOffline: (type: OfflineActionType, payload: OfflinePayload['payload']) => void;
  updateQueueCount: () => void;
}
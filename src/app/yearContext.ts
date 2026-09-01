/**
 * Academic-year context — the single owner of `selectedYear`/`lockedYears`.
 *
 * These two values were App-local state consumed by six domain hooks
 * (Dashboard, Students, Expenses, Payments, Payroll, Classes) via injected
 * deps. Lifting them into a provider gives the year state one owner and lets
 * any consumer (current or future) read it directly through `useYear()`,
 * while the domain hooks keep their deps-args interface (staying unit-testable
 * without a provider). App reads the context and still passes the values down
 * as hook deps and props.
 *
 * Component files only export components (react-refresh/only-export-components):
 * the context + hook live here, the provider in src/app/YearProvider.tsx.
 */
import { createContext, useContext } from 'react';
import type { Dispatch, SetStateAction } from 'react';

export interface YearContextValue {
  selectedYear: string;
  setSelectedYear: Dispatch<SetStateAction<string>>;
  lockedYears: string[];
  setLockedYears: Dispatch<SetStateAction<string[]>>;
}

export const YearContext = createContext<YearContextValue | null>(null);

export function useYear(): YearContextValue {
  const ctx = useContext(YearContext);
  if (!ctx) throw new Error('useYear must be used within a YearProvider');
  return ctx;
}

/**
 * Academic-year provider — owns `selectedYear`/`lockedYears` for the whole
 * app. The context + useYear hook live in src/app/yearContext.ts; this file
 * only exports the component (react-refresh/only-export-components).
 */
import { useState } from 'react';
import type { ReactNode } from 'react';
import { YearContext } from './yearContext';

export function YearProvider({ children }: { children: ReactNode }) {
  const [selectedYear, setSelectedYear] = useState<string>('2026-2027');
  const [lockedYears, setLockedYears] = useState<string[]>([]);

  return (
    <YearContext.Provider value={{ selectedYear, setSelectedYear, lockedYears, setLockedYears }}>
      {children}
    </YearContext.Provider>
  );
}

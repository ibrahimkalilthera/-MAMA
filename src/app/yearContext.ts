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
import type { AcademicYearRow } from '../lib/academicYears';

export interface YearContextValue {
  selectedYear: string;
  setSelectedYear: Dispatch<SetStateAction<string>>;
  lockedYears: string[];
  setLockedYears: Dispatch<SetStateAction<string[]>>;
  /**
   * Les lignes d'`academic_years` telles que la base les a rendues — année ET
   * bornes de scolarité (`start_month`/`end_month`).
   *
   * Elles vivent ici parce que la PLAGE de l'année est une donnée de l'année,
   * pas d'un écran : le tableau de bord, la fiche élève, le rapprochement et le
   * reçu lisent la même ligne, donc les mêmes mois. Un écran qui recomposerait
   * la plage à sa façon ferait réclamer juillet à une famille dont l'école
   * s'arrête en juin.
   */
  yearRows: AcademicYearRow[];
  setYearRows: Dispatch<SetStateAction<AcademicYearRow[]>>;
  /**
   * Les mois d'une année scolaire, de son début à sa fin RÉGLÉS PAR L'ÉCOLE
   * (`academic_years.start_month`/`end_month`, septembre→juin par défaut).
   *
   * Sans argument : l'année de travail. Une année que la base ne connaît pas
   * (fiche ancienne, poste hors ligne) reçoit la plage par défaut — la même
   * valeur que la colonne de la base, jamais un mois inventé.
   */
  yearMonths: (year?: string) => string[];
}

export const YearContext = createContext<YearContextValue | null>(null);

export function useYear(): YearContextValue {
  const ctx = useContext(YearContext);
  if (!ctx) throw new Error('useYear must be used within a YearProvider');
  return ctx;
}

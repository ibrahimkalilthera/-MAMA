/**
 * Table density context (comfort / compact).
 *
 * The choice is owned once by <App> (`useDensityState`) and provided through
 * `DensityContext` so both the app-shell root (which carries the `density-*`
 * class the CSS keys on) and the Settings → Préférences toggle read the SAME
 * value. A consumer without a provider gets the default (`comfort`) and a no-op
 * setter, so shell tests that mount <AppShell> alone keep working unchanged.
 *
 * No component lives here on purpose (react-refresh only exports components
 * from .tsx files): the provider is used directly as
 * `<DensityContext.Provider value={…}>` in App.tsx.
 */
import { createContext, useCallback, useContext, useState } from 'react';

import { DEFAULT_DENSITY, getStoredDensity, saveDensity } from '../lib/density';
import type { TableDensity } from '../lib/density';

export interface DensityValue {
  density: TableDensity;
  setDensity: (density: TableDensity) => void;
}

const fallback: DensityValue = { density: DEFAULT_DENSITY, setDensity: () => {} };

export const DensityContext = createContext<DensityValue>(fallback);

/** Read the current density. Safe outside a provider (defaults to comfort). */
export const useDensity = (): DensityValue => useContext(DensityContext);

/** Own the density state and persist every change. Meant to be called once. */
export function useDensityState(): DensityValue {
  const [density, setDensityValue] = useState<TableDensity>(() => getStoredDensity());
  const setDensity = useCallback((next: TableDensity) => {
    setDensityValue(next);
    saveDensity(next);
  }, []);
  return { density, setDensity };
}

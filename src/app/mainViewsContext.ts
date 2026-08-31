/**
 * Runtime context binding the views to the MainViews contract.
 *
 * Types live in mainViewsProps.ts (types-only, contract-tested); this module
 * holds the actual React context and the useMainViews hook so that component
 * files only export components (react-refresh/only-export-components).
 */
import { createContext, useContext } from 'react';
import type { MainViewsProps } from './mainViewsProps';

export const MainViewsContext = createContext<MainViewsProps | null>(null);

export function useMainViews(): MainViewsProps {
  const ctx = useContext(MainViewsContext);
  if (!ctx) throw new Error('useMainViews must be used inside <MainViews>');
  return ctx;
}

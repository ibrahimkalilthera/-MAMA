/**
 * Root boundary — the ErrorBoundary guard around the WHOLE app tree, i.e.
 * the very first render (crash inside App itself, not a lazy chunk).
 *
 * Extracted from main.tsx so it can be unit-tested without importing the
 * entry point: the entry pulls `import './index.css'`, which the node test
 * runner (tsx) cannot parse, and its module-level code executes on import.
 *
 * Without this guard a throw during the first render of App unmounts the
 * whole React tree → silent blank page. The async-import catch in main.tsx
 * only covers a MODULE-load failure (missing Supabase config); a render-time
 * crash must land here.
 */
import type { ComponentType, ReactNode } from 'react';
import { YearProvider } from './YearProvider';
import { ErrorBoundary } from '../components/ErrorBoundary';

// Fallback theme tokens for the root error boundary: at the very first render
// the app theme is not available yet (App itself crashed), so we use the
// default light tokens instead of a blank page.
const ROOT_FALLBACK_THEME = {
  card: 'bg-white',
  muted: 'text-slate-400',
  border: 'border-slate-100',
  isDark: false,
} as const;

/** Wraps the app in the ErrorBoundary (label « l'application ») + YearProvider. */
export function RootBoundary({ App }: { App: ComponentType }): ReactNode {
  return (
    <ErrorBoundary currentTheme={ROOT_FALLBACK_THEME} label="l'application">
      <YearProvider>
        <App />
      </YearProvider>
    </ErrorBoundary>
  );
}
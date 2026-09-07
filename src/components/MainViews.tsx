/**
 * MainViews — the per-tab view router of the authenticated app.
 *
 * Every tab renders its own lazy view component inside a Suspense fallback.
 * The views (DashboardView … SettingsView) read what they need from the
 * MainViewsContext (provided here) instead of receiving the full props
 * object through {…props}; see src/app/mainViewsProps.ts for the contract.
 * This file used to inline the calendar, notes, audit and settings screens
 * (~900 lines); they were extracted to their own components following the
 * PayrollView / ExpensesView model.
 */
import { lazy, Suspense } from 'react';
import type { MainViewsProps } from '../app/mainViewsProps';
import { MainViewsContext } from '../app/mainViewsContext';

const DashboardView = lazy(() => import('./DashboardView').then(m => ({ default: m.DashboardView })));
const StudentsView = lazy(() => import('./StudentsView').then(m => ({ default: m.StudentsView })));
const ParentsView = lazy(() => import('./ParentsView').then(m => ({ default: m.ParentsView })));
const PayrollView = lazy(() => import('./PayrollView').then(m => ({ default: m.PayrollView })));
const ExpensesView = lazy(() => import('./ExpensesView').then(m => ({ default: m.ExpensesView })));
const CalendarView = lazy(() => import('./CalendarView').then(m => ({ default: m.CalendarView })));
const NotesView = lazy(() => import('./NotesView').then(m => ({ default: m.NotesView })));
const AuditView = lazy(() => import('./AuditView').then(m => ({ default: m.AuditView })));
const SettingsView = lazy(() => import('./SettingsView').then(m => ({ default: m.SettingsView })));

export function MainViews(props: MainViewsProps) {
  const { activeTab, currentTheme } = props;

  const fallback = (
    <div className={`${currentTheme.card} p-6 rounded-2xl border ${currentTheme.border} animate-pulse`}>
      <div className="h-6 w-56 bg-slate-200 dark:bg-slate-700 rounded-lg mb-6" />
      <div className="h-[240px] w-full bg-slate-100 dark:bg-slate-800 rounded-xl" />
    </div>
  );

  return (
    <MainViewsContext.Provider value={props}>
      <Suspense fallback={fallback}>
        {activeTab === 'dashboard' && <DashboardView />}
        {activeTab === 'students' && <StudentsView />}
        {activeTab === 'parents' && <ParentsView />}
        {activeTab === 'payroll' && <PayrollView />}
        {activeTab === 'expenses' && <ExpensesView />}
        {activeTab === 'calendar' && <CalendarView />}
        {activeTab === 'notes' && <NotesView />}
        {activeTab === 'audit' && <AuditView />}
        {activeTab === 'settings' && <SettingsView />}
      </Suspense>
    </MainViewsContext.Provider>
  );
}

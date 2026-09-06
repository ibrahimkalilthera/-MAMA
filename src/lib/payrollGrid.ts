/**
 * School-year payroll grid cell rule (used by PayrollView's 12-month grid).
 *
 * Lives outside the component so it is unit-testable and does not trip the
 * react-refresh fast-refresh rule (a component file may only export
 * components). Shares the single late rule (src/lib/payrollWindow.ts): the
 * window is open 1st–10th, an unpaid month is only late from the 11th.
 */
import { isPayrollWindowOverdue } from './payrollWindow';

export type PayrollGridCellStatus = 'scheduled' | 'open' | 'unpaid' | 'settle' | 'partial';

/**
 * Per-employee status of one calendar month of the school year — used by the
 * payment-history grid of the individual payment fiche (pdfPayrollFiche.ts).
 *
 * A month is 'paid' when the employee's payments that month cover the whole
 * expected salary; a positive but insufficient total is 'partial'; the
 * current month with no payment yet is 'current' (it is the period being
 * paid, never "late"); elapsed months with nothing paid are 'unpaid'.
 */
export type PayrollMonthStatus = 'paid' | 'partial' | 'current' | 'unpaid' | 'future';

export const payrollMonthStatus = (opts: {
  totalPaid: number;
  expected: number;
  isFuture: boolean;
  isCurrent: boolean;
}): PayrollMonthStatus => {
  const { totalPaid, expected, isFuture, isCurrent } = opts;
  if (isFuture) return 'future';
  const isPaid = expected > 0 ? totalPaid >= expected : totalPaid > 0;
  if (isPaid) return 'paid';
  if (totalPaid > 0) return 'partial';
  if (isCurrent) return 'current';
  return 'unpaid';
};

/**
 * Status of one cell of the school-year payroll grid.
 *
 * The CURRENT month gets a grace period (status 'open') while the window is
 * still open, so the grid never flashes red before the sidebar/banner call
 * the month late.
 */
export const payrollGridCellStatus = (opts: {
  isFuture: boolean;
  isCurrentCell: boolean;
  totalPaid: number;
  totalExpected: number;
  now: Date;
}): PayrollGridCellStatus => {
  const { isFuture, isCurrentCell, totalPaid, totalExpected, now } = opts;
  if (isFuture) return 'scheduled';
  if (totalPaid === 0) {
    if (isCurrentCell && !isPayrollWindowOverdue(now.getDate())) return 'open';
    return 'unpaid';
  }
  if (totalPaid >= totalExpected) return 'settle';
  return 'partial';
};

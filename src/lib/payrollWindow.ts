/**
 * Payroll window policy — SINGLE source of truth for the monthly salary
 * window and its late threshold.
 *
 * The window opens on the 1st of the month and closes on the 10th (the
 * school's payroll period). From the 11th the month is late — the sidebar
 * badge, the dashboard banner AND the employee-card red styling all read
 * this same rule, so the signals can never disagree again (they used to:
 * the window said "late" from day 11 while the cards waited for day 25).
 */
export const PAYROLL_WINDOW_LAST_DAY = 10;

/** Day 1..10 of the month: the payroll window is open. */
export const isPayrollWindowOpen = (dayOfMonth: number): boolean =>
  dayOfMonth >= 1 && dayOfMonth <= PAYROLL_WINDOW_LAST_DAY;

/** Day 11+ of the month: the month is late (payroll window closed). */
export const isPayrollWindowOverdue = (dayOfMonth: number): boolean =>
  dayOfMonth > PAYROLL_WINDOW_LAST_DAY;
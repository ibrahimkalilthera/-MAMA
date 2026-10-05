/**
 * Dashboard/stats domain hook — extracted verbatim from App.tsx.
 *
 * Owns the seven derived memos that feed the dashboard KPIs, the charts and
 * the payroll window alerts: `stats`, `notifications`, `lateStudents`,
 * `chartData`, `pieData`, `missedMonths` and `payrollWindowStatus`. All deps
 * (data + `today` + `selectedYear` + `t`) are injected as arguments; the hook
 * is pure derivation — no state, no side effects. The "this month" KPIs read
 * BOTH the month and the year from the same clock (`now`): mixing the injected
 * `currentMonth` with the clock's year let the two drift apart, which is why
 * the month is no longer an injected arg.
 * `filteredStudents` (the students-list filter/sort) intentionally stays in
 * App.tsx: it is list-view state, not dashboard derivation.
 *
 * Call-site note: App.tsx calls this hook after `today` is declared and before
 * `useFloatingChat` (which consumes `stats`).
 */
import { useMemo } from 'react';
import type { Student, Staff, Expense, VendorExpense, SalaryPayment } from './types';
import type { DashboardStats, PayrollWindowStatus } from './mainViewsProps';
import type { TranslationDict } from '../i18n/translations';
import { inAcademicYear, systemClock, type Clock } from '../lib/dateWindows';
import { isPayrollWindowOpen, isPayrollWindowOverdue } from '../lib/payrollWindow';

export interface DashboardNotification {
  id: string;
  /** `archive` = le rappel du journal hebdomadaire (voir useAuditArchiveReminder). */
  type: 'due' | 'note' | 'payroll' | 'archive';
  message: string;
  /** Present for student reminders; absent for team-wide alerts (payroll). */
  studentId?: string;
  /** Anchor date of the reminder (due date / last note date / missed month start). */
  date: string;
}

const MONTH_KEYS: (keyof TranslationDict)[] = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

export interface UseDashboardDeps {
  t: TranslationDict;
  today: string;
  selectedYear: string | null;
  students: Student[];
  staff: Staff[];
  expenses: Expense[];
  vendorExpenses: VendorExpense[];
  salaryPayments: SalaryPayment[];
  /**
   * Reference clock for the monthly KPIs. Defaults to `systemClock`; a test
   * pins it (e.g. `() => new Date(2026, 8, 2)`) so "this month" is decided by
   * the injected date rather than the wall clock.
   */
  now?: Clock;
}

export function useDashboard(deps: UseDashboardDeps) {
  const { t, today, selectedYear, students, staff, expenses, vendorExpenses, salaryPayments, now: nowFn = systemClock } = deps;

  const stats = useMemo<DashboardStats>(() => {
    const filteredStudents = students.filter(s => !selectedYear || s.academicYear === selectedYear || !s.academicYear);
    const filteredExpenses = expenses.filter(e => !selectedYear || e.academicYear === selectedYear || !e.academicYear);
    const filteredVendorExpenses = vendorExpenses.filter(v => !selectedYear || v.academicYear === selectedYear || !v.academicYear);
    const filteredSalaryPayments = salaryPayments.filter(s => !selectedYear || s.academicYear === selectedYear || !s.academicYear);

    const totalOutstanding = filteredStudents.reduce((acc, s) => {
      const discount = s.scholarshipDiscount || 0;
      const discountedTotal = s.totalDue * (1 - discount / 100);
      return acc + Math.max(0, discountedTotal - s.amountPaid);
    }, 0);
    
    const totalFees = filteredStudents.reduce((acc, s) => acc + s.amountPaid, 0);

    const totalVendorExpensesPaid = filteredVendorExpenses.reduce((acc, v) => {
      if (v.paymentStatus === 'paid') {
        return acc + v.amount;
      } else if (v.paymentStatus === 'partial') {
        return acc + (v.amountPaid || 0);
      }
      return acc;
    }, 0);

    const totalExpenses = filteredExpenses.reduce((acc, e) => acc + e.amount, 0) + 
                          filteredSalaryPayments.reduce((acc, s) => acc + s.amount, 0) +
                          totalVendorExpensesPaid;

    // One clock for every "this month" KPI below: month AND year are read from
    // the SAME reference date, so a month that disagrees with the year can no
    // longer leak the previous month's figures into the current-month totals —
    // and an injected clock makes the whole block deterministic in test.
    const now = nowFn();

    const totalArrears = staff.reduce((acc, s) => {
      const paidThisMonth = filteredSalaryPayments
        .filter(p => p.staffId === s.id && new Date(p.date).getMonth() === now.getMonth() && new Date(p.date).getFullYear() === now.getFullYear())
        .reduce((sum, p) => sum + p.amount, 0);
      return acc + Math.max(0, s.salary - paidThisMonth);
    }, 0);

    const collectedThisMonth = filteredStudents.reduce((acc, s) => {
      const thisMonthPayments = s.payments.filter(p => {
        const payDate = new Date(p.date);
        // Filter by both month AND year so previous years' payments don't leak into this month's KPIs
        return payDate.getMonth() === now.getMonth() && payDate.getFullYear() === now.getFullYear();
      });
      return acc + thisMonthPayments.reduce((sum, p) => sum + p.amount, 0);
    }, 0);

    const prevMonth = (now.getMonth() + 11) % 12;
    const prevMonthYear = now.getMonth() === 0 ? now.getFullYear() - 1 : now.getFullYear();

    const prevMonthCollected = filteredStudents.reduce((acc, s) => {
      const prevMonthPayments = s.payments.filter(p => {
        const payDate = new Date(p.date);
        return payDate.getMonth() === prevMonth && payDate.getFullYear() === prevMonthYear;
      });
      return acc + prevMonthPayments.reduce((sum, p) => sum + p.amount, 0);
    }, 0);

    const lateParentsCount = filteredStudents.filter(s => {
      const discount = s.scholarshipDiscount || 0;
      const discountedTotal = s.totalDue * (1 - discount / 100);
      return (discountedTotal - s.amountPaid) > 0 && s.dueDate < today;
    }).length;

    const vendorExpensesThisMonth = filteredVendorExpenses.reduce((acc, v) => {
      const dueDateObj = new Date(v.dueDate);
      if (dueDateObj.getMonth() === now.getMonth() && dueDateObj.getFullYear() === now.getFullYear()) {
        if (v.paymentStatus === 'paid') {
          return acc + v.amount;
        } else if (v.paymentStatus === 'partial') {
          return acc + (v.amountPaid || 0);
        }
      }
      return acc;
    }, 0);

    const expensesThisMonth = filteredExpenses.reduce((acc, e) => {
      const expDate = new Date(e.date);
      return expDate.getMonth() === now.getMonth() && expDate.getFullYear() === now.getFullYear() ? acc + e.amount : acc;
    }, 0) + filteredSalaryPayments.reduce((acc, s) => {
      const salDate = new Date(s.date);
      return salDate.getMonth() === now.getMonth() && salDate.getFullYear() === now.getFullYear() ? acc + s.amount : acc;
    }, 0) + vendorExpensesThisMonth;

    const enrolledStudentsCount = filteredStudents.length;

    return { 
      totalOutstanding, 
      collectedMonth: collectedThisMonth, 
      prevMonthCollected,
      lateParentsCount,
      totalFees,
      // Alias used by the students print summary (was previously undefined → KPI showed 0)
      totalCollected: totalFees,
      totalExpenses,
      totalArrears,
      expensesThisMonth,
      enrolledStudentsCount
    };
  }, [students, today, expenses, vendorExpenses, salaryPayments, staff, selectedYear, nowFn]);

  const lateStudents = useMemo<Student[]>(() => {
    return students.filter(s => {
      const discount = s.scholarshipDiscount || 0;
      const discountedTotal = s.totalDue * (1 - discount / 100);
      return (!selectedYear || s.academicYear === selectedYear || !s.academicYear) &&
             (discountedTotal - s.amountPaid) > 0 && s.dueDate < today;
    });
  }, [students, today, selectedYear]);

  const chartData = useMemo(() => {
    const months = [t.jan, t.feb, t.mar, t.apr, t.may, t.jun, t.jul, t.aug, t.sep, t.oct, t.nov, t.dec];
    return months.map((month, index) => {
      const monthIncome = students.reduce((acc, s) => {
        const thisMonthPayments = s.payments.filter(p => {
          const d = new Date(p.date);
          return d.getMonth() === index && (!selectedYear || inAcademicYear(d, selectedYear) || !s.academicYear);
        });
        return acc + thisMonthPayments.reduce((sum, p) => sum + p.amount, 0);
      }, 0);

      const monthExpenses = expenses.filter(e => {
        const d = new Date(e.date);
        return d.getMonth() === index && (!selectedYear || inAcademicYear(d, selectedYear) || !e.academicYear);
      }).reduce((acc, e) => acc + e.amount, 0) + 
      salaryPayments.filter(p => {
        const d = new Date(p.date);
        return d.getMonth() === index && (!selectedYear || inAcademicYear(d, selectedYear) || !p.academicYear);
      }).reduce((acc, p) => acc + p.amount, 0);

      return {
        name: month.substring(0, 3),
        income: monthIncome,
        expenses: monthExpenses
      };
    });
  }, [students, expenses, salaryPayments, selectedYear, t]);

  const pieData = useMemo(() => {
    const filteredStudents = students.filter(s => !selectedYear || s.academicYear === selectedYear || !s.academicYear);
    const totalPaid = filteredStudents.reduce((acc, s) => acc + s.amountPaid, 0);
    const totalOutstanding = filteredStudents.reduce((acc, s) => {
      const discount = s.scholarshipDiscount || 0;
      const discountedTotal = s.totalDue * (1 - discount / 100);
      return acc + Math.max(0, discountedTotal - s.amountPaid);
    }, 0);

    return [
      { name: t.paid, value: totalPaid },
      { name: t.outstanding, value: totalOutstanding }
    ];
  }, [students, selectedYear, t]);

  const missedMonths = useMemo<{ year: number; month: number }[]>(() => {
    // If no staff members exist yet, do not trigger false missed-payroll warnings
    if (staff.length === 0) return [];

    const now = nowFn();
    const currentCalendarYear = now.getFullYear();
    const currentCalendarMonth = now.getMonth();
    // The school year starts in September. Months before September belong to
    // the previous school year — they are never flagged (the app launched in
    // September 2026; pre-launch months do not count).
    const schoolYearStartYear = currentCalendarMonth >= 8 ? currentCalendarYear : currentCalendarYear - 1;
    const missed: { year: number; month: number }[] = [];

    for (let y = schoolYearStartYear; y <= currentCalendarYear; y++) {
      const from = y === schoolYearStartYear ? 8 : 0;
      const to = y === currentCalendarYear ? currentCalendarMonth : 11;
      for (let m = from; m <= to; m++) {
        const monthPayments = salaryPayments.filter(p => {
          const payDate = new Date(p.date);
          return payDate.getFullYear() === y && payDate.getMonth() === m && (!selectedYear || p.academicYear === selectedYear);
        });
        const totalPaid = monthPayments.reduce((sum, p) => sum + p.amount, 0);
        if (totalPaid === 0) {
          missed.push({ year: y, month: m });
        }
      }
    }
    return missed;
  }, [salaryPayments, staff.length, selectedYear, nowFn]);

  const notifications = useMemo<DashboardNotification[]>(() => {
    const list: DashboardNotification[] = [];
    
    const relevantStudents = students.filter(s => !selectedYear || s.academicYear === selectedYear);

    relevantStudents.forEach(s => {
      const balance = s.totalDue - s.amountPaid;
      if (balance > 0) {
        // Due Date < 2 days
        const due = new Date(s.dueDate);
        const now = new Date(today);
        const diffTime = due.getTime() - now.getTime();
        const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
        
        if (diffDays >= 0 && diffDays < 2) {
          list.push({
            id: `due-${s.id}`,
            type: 'due',
            message: `${s.name}: ${t.dueReminder}`,
            studentId: s.id,
            date: s.dueDate
          });
        }

        // Late parent + note > 3 days ago + no payment update
        // We check if balance is still > 0 and s.dueDate < today
        if (diffDays < 0 && s.lastNoteDate) {
          const noteDate = new Date(s.lastNoteDate);
          const diffNoteTime = now.getTime() - noteDate.getTime();
          const diffNoteDays = Math.floor(diffNoteTime / (1000 * 60 * 60 * 24));
          
          if (diffNoteDays > 3) {
            list.push({
              id: `note-${s.id}`,
              type: 'note',
              message: `${s.name}: ${t.noteReminder}`,
              studentId: s.id,
              date: s.lastNoteDate
            });
          }
        }
      }
    });

    // Missed payroll months → bell alerts (one per month without salary
    // payments; anchored on the month's start so the relative label reads
    // as a date for older months).
    for (const { year, month: m } of missedMonths) {
      list.push({
        id: `payroll-${year}-${m}`,
        type: 'payroll',
        message: t.noPayrollWarning.replace('{month}', t[MONTH_KEYS[m]]),
        date: `${year}-${String(m + 1).padStart(2, '0')}-01`,
      });
    }

    return list;
  }, [students, today, t, selectedYear, missedMonths]);

  const payrollWindowStatus = useMemo<PayrollWindowStatus>(() => {
    const now = nowFn();
    const currentDay = now.getDate();
    const currentCalendarYear = now.getFullYear();
    const currentCalendarMonth = now.getMonth();

    // If no staff members exist yet, payroll window alerts are inactive
    if (staff.length === 0) {
      return {
        currentDay,
        currentCalendarYear,
        currentCalendarMonth,
        totalPaidCurrentMonth: 0,
        isOverdue: false,
        isOpen: false
      };
    }

    const currentMonthPayments = salaryPayments.filter(p => {
      const payDate = new Date(p.date);
      return payDate.getFullYear() === currentCalendarYear && payDate.getMonth() === currentCalendarMonth && (!selectedYear || p.academicYear === selectedYear);
    });
    const totalPaidCurrentMonth = currentMonthPayments.reduce((sum, p) => sum + p.amount, 0);

    // Single late rule for the whole app (see src/lib/payrollWindow.ts): the
    // window is open 1st–10th; from the 11th an unpaid month is late.
    const isOverdue = isPayrollWindowOverdue(currentDay) && totalPaidCurrentMonth === 0;
    const isOpen = isPayrollWindowOpen(currentDay);

    return {
      currentDay,
      currentCalendarYear,
      currentCalendarMonth,
      totalPaidCurrentMonth,
      isOverdue,
      isOpen
    };
  }, [salaryPayments, staff.length, selectedYear, nowFn]);

  return {
    stats,
    notifications,
    lateStudents,
    chartData,
    pieData,
    missedMonths,
    payrollWindowStatus,
  };
}

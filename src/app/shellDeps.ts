/**
 * Shell wiring dependencies — the intersection of the three shell contracts
 * (`MainViewsProps`, `AppModalsProps`, and the shell-only `AppShellExtras` minus
 * its own `viewsProps`), minus everything `buildShellProps` supplies itself:
 * the lucide icons, `HighlightText`/`ChartsFallback`, the lazy `DashboardCharts`,
 * `Suspense`, and the `formatDate`/`getGradeDisplay`/`getStatus` helpers.
 *
 * Extracted verbatim from src/app/viewsWiring.ts (split campaign, no behaviour
 * change): this long `Omit` list is part of what held that file at the 700-line
 * budget. `buildShellProps` and `buildShellExtras` both consume it, so it lives
 * in its own module rather than in either of them.
 */
import type { MainViewsProps } from './mainViewsProps';
import type { AppModalsProps } from '../components/AppModals';
import type { AppShellExtras } from '../components/AppShell';

export type ShellDeps = Omit<
  MainViewsProps & AppModalsProps & Omit<AppShellExtras, 'viewsProps'>,
  'AlertCircle' | 'ArrowDown' | 'ArrowUp' | 'ArrowUpDown' | 'Award' | 'Bell' | 'BookOpen' | 'Briefcase' | 'Calendar' |
  'ChartsFallback' | 'CheckCircle2' | 'CheckSquare' | 'ChevronDown' | 'ChevronLeft' | 'ChevronRight' | 'ChevronUp' |
  'Clock' | 'Coins' | 'Copy' | 'Cpu' | 'CreditCard' | 'DashboardCharts' | 'DollarSign' | 'Download' | 'Droplet' |
  'Edit2' | 'FileText' | 'Flag' | 'Globe' | 'GraduationCap' | 'Hammer' | 'Heart' | 'HighlightText' | 'Landmark' |
  'Layers' | 'Mail' | 'MapPin' | 'MessageSquare' | 'Phone' | 'PieChart' | 'Plus' | 'Printer' | 'Receipt' | 'Search' |
  'Shield' | 'ShieldCheck' | 'Sparkles' | 'Sprout' | 'StickyNote' | 'Sun' | 'Suspense' | 'Trash2' | 'TrendingDown' |
  'TrendingUp' | 'Unlink' | 'UploadCloud' | 'UserCheck' | 'UserPlus' | 'Users' | 'Utensils' | 'Wallet' | 'Wifi' |
  'X' | 'Zap' | 'formatDate' | 'getGradeDisplay' | 'generateExpensesReportPdf' | 'generateStaffPayslipPdf' |
  'generatePaymentReceiptPdf' | 'generateMultiYearReportPdf' | 'generateFinancialReportPdf' | 'getStatus'
>;

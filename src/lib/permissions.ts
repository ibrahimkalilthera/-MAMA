/**
 * Role predicates — the single source of truth for what each account role may
 * do. Business hooks and components never compare raw role strings; they ask
 * one of these predicates, so a policy change lands in exactly one place.
 *
 * Role ladder (see src/lib/useAuth.ts):
 *   - dev / admin        account owners — everything, INCLUDING user/role
 *                        management, settings and audit (the "promoter" pair:
 *                        the only roles that may overwrite sensitive vendor
 *                        fields on existing records);
 *   - general_manager    Gestionnaire Principal — full FINANCE administration
 *                        (vendor expenses, scholarship discounts, imports,
 *                        staff & salary writes) but NOT user management;
 *   - staff / econome    two job titles sharing the baseline authority:
 *                        daily entries only (payments, plain expenses, …).
 *
 * A null/undefined role (session not loaded, no profile) grants nothing.
 */
import type { AppRole } from './useAuth';

/** Role value the predicates accept — unknown/no-session roles grant nothing. */
export type Role = AppRole | null | undefined;

/**
 * dev/admin: account owners. Gates user & role management, settings, audit —
 * and, today, the promoter-only fields (vendor name/amount on existing
 * records), because the promoter pair IS exactly the account-owner pair.
 */
export const canManageUsers = (role: Role): boolean =>
  role === 'admin' || role === 'dev';

/** The finance-management set shared by the two finance predicates. */
const isFinanceManager = (role: Role): boolean =>
  canManageUsers(role) || role === 'general_manager';

/**
 * dev/admin/general_manager: finance-administration writes — creating or
 * deleting vendor expenses and the like. (Daily-entry writes — payments,
 * plain expenses — are baseline and need no predicate.)
 */
export const canWriteFinance = (role: Role): boolean => isFinanceManager(role);

/**
 * dev/admin/general_manager: applying scholarship discounts on student
 * profiles. Kept as its own predicate even though it currently coincides
 * with `canWriteFinance`, so the two policies can diverge independently.
 */
export const canEditScholarship = (role: Role): boolean => isFinanceManager(role);

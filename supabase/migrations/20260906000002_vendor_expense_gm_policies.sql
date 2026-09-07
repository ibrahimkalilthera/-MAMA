-- Migration: vendor_expenses write policies → finance admins.
--
-- The app has ALWAYS treated the general_manager (Gestionnaire Principal) as a
-- finance admin able to CREATE and DELETE vendor expenses: the UI gates
-- (ExpensesView canManageVendors, useExpenses isFinanceAdmin) and the submit
-- handler's "only the promoter can create a vendor expense" alert all fire
-- for finance admins (admin/dev + general_manager), and the role migration
-- 20260902000000 documented general_manager as "full FINANCIAL
-- administration: vendor expenses, scholarship discounts, Excel imports,
-- staff & salary writes".
--
-- The RLS policies introduced by 20260828000000 were never widened when the
-- general_manager role landed: INSERT and DELETE still demanded
-- public.is_admin() (admin/dev only), so a general_manager saw the create /
-- delete buttons in the UI but every write was silently rejected by Postgres
-- ("new row violates row-level security policy"). This migration closes that
-- app↔DB gap.
--
-- The promoter-only monopoly is NOT removed for existing records: the
-- BEFORE UPDATE trigger (protect_vendor_expense_financial_edit) still keeps
-- vendor_name / amount immutable for everyone but admin/dev, so the update
-- semantics documented in 20260828000000 are unchanged.

-- ─── 1. INSERT: finance admins may create ───────────────────────────────────
DROP POLICY IF EXISTS "Promoter insert vendor_expenses" ON public.vendor_expenses;

CREATE POLICY "Finance admins insert vendor_expenses"
    ON public.vendor_expenses
    FOR INSERT
    TO authenticated
    WITH CHECK (public.is_finance_admin());

-- ─── 2. DELETE: finance admins may delete ───────────────────────────────────
DROP POLICY IF EXISTS "Promoter delete vendor_expenses" ON public.vendor_expenses;

CREATE POLICY "Finance admins delete vendor_expenses"
    ON public.vendor_expenses
    FOR DELETE
    TO authenticated
    USING (public.is_finance_admin());

-- ─── 3. PostgREST schema cache reload ───────────────────────────────────────
NOTIFY pgrst, 'reload schema';

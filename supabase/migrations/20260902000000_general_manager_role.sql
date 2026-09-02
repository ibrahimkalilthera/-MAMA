-- Migration: introduce the `general_manager` role (Gestionnaire Principal).
--
-- Semantics (distinct from admin/dev):
--   • admin/dev        → full access: user & role management, settings, audit
--                        trail, academic-year close-out, destructive deletes.
--   • general_manager  → full FINANCIAL administration: vendor expenses,
--                        scholarship discounts, Excel imports, staff & salary
--                        writes — but NOT user management, settings, audit,
--                        year close-out or profile deletes.
--   • staff            → daily entries (students, payments, receipts, expenses).
--
-- App-level gates (useAuthWelcome, Sidebar, AppHeader, useYearOps, useUsers)
-- keep `is_admin()` semantics for admin/dev-only screens; only the FINANCE
-- write surfaces widen to include general_manager.

-- ─── 1. Widen the role CHECK constraint ─────────────────────────────────────
ALTER TABLE public.user_profiles
  DROP CONSTRAINT IF EXISTS user_profiles_role_check;
ALTER TABLE public.user_profiles
  ADD CONSTRAINT user_profiles_role_check
  CHECK (role IN ('admin', 'staff', 'dev', 'general_manager'));

-- ─── 2. Helper: financial administration (admin, dev, general_manager) ──────
CREATE OR REPLACE FUNCTION public.is_finance_admin()
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_profiles
    WHERE id = auth.uid() AND role IN ('admin', 'dev', 'general_manager')
  );
$$;

-- ─── 3. Staff & salary_payments: financial admins may write ─────────────────
DROP POLICY IF EXISTS "Admin insert staff" ON public.staff;
CREATE POLICY "Finance admins insert staff" ON public.staff
    FOR INSERT WITH CHECK (public.is_finance_admin());

DROP POLICY IF EXISTS "Admin update staff" ON public.staff;
CREATE POLICY "Finance admins update staff" ON public.staff
    FOR UPDATE USING (public.is_finance_admin());

DROP POLICY IF EXISTS "Admin delete staff" ON public.staff;
CREATE POLICY "Finance admins delete staff" ON public.staff
    FOR DELETE USING (public.is_finance_admin());

DROP POLICY IF EXISTS "Admin insert salary_payments" ON public.salary_payments;
CREATE POLICY "Finance admins insert salary_payments" ON public.salary_payments
    FOR INSERT WITH CHECK (public.is_finance_admin());

DROP POLICY IF EXISTS "Admin update salary_payments" ON public.salary_payments;
CREATE POLICY "Finance admins update salary_payments" ON public.salary_payments
    FOR UPDATE USING (public.is_finance_admin());

DROP POLICY IF EXISTS "Admin delete salary_payments" ON public.salary_payments;
CREATE POLICY "Finance admins delete salary_payments" ON public.salary_payments
    FOR DELETE USING (public.is_finance_admin());

-- ─── 4. PostgREST schema cache reload ───────────────────────────────────────
NOTIFY pgrst, 'reload schema';

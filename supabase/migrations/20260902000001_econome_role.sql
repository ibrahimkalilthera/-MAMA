-- Migration: introduce the `econome` (Accountant) role position.
--
-- Staff and econome are TWO distinct job titles that can be defined when
-- creating accounts, but they share the exact same authority in the app —
-- neither is admin/dev/general_manager, so every existing permission gate
-- (isAdmin, isFinanceAdmin, year ops, audit) already treats them alike.
-- This migration only widens the role CHECK constraint; no policy changes
-- are needed (econome stays outside is_finance_admin, like staff).

ALTER TABLE public.user_profiles
  DROP CONSTRAINT IF EXISTS user_profiles_role_check;
ALTER TABLE public.user_profiles
  ADD CONSTRAINT user_profiles_role_check
  CHECK (role IN ('admin', 'staff', 'dev', 'general_manager', 'econome'));

-- ─── PostgREST schema cache reload ─────────────────────────────────────────
NOTIFY pgrst, 'reload schema';
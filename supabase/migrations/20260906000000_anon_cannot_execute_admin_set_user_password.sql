-- Migration: anon must never execute admin_set_user_password.
--
-- The original hardening (20260902000004) revoked EXECUTE FROM public, but
-- Supabase's default privileges (ALTER DEFAULT PRIVILEGES ... GRANT EXECUTE
-- ON FUNCTIONS TO anon, authenticated, service_role) grant the anon role a
-- DIRECT execute right when the function is created — a REVOKE FROM public
-- does not remove it. The in-function role check was therefore the only
-- barrier, and anon could actually execute the RPC (it raised the exception
-- after running). This migration removes the direct anon grant; the RPC
-- stays callable for authenticated (admin/dev) only.

REVOKE EXECUTE ON FUNCTION public.admin_set_user_password(uuid, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.admin_set_user_password(uuid, text) FROM public;
GRANT EXECUTE ON FUNCTION public.admin_set_user_password(uuid, text) TO authenticated;
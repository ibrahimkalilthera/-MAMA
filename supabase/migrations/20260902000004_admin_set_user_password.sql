-- Migration: admin/dev can set any account's password directly.
--
-- The settings screen previously only offered an email-based reset. This
-- RPC lets an authenticated admin or dev set a new password for any account
-- immediately (no email round-trip). SECURITY DEFINER + in-function role
-- check: only profiles with role 'admin' or 'dev' may call it.
--
-- GoTrue verifies bcrypt hashes of the form $2a$<cost>$...; crypt(pw,
-- gen_salt('bf', 10)) produces exactly that format (cost 10), so the
-- updated password works with signInWithPassword.

CREATE OR REPLACE FUNCTION public.admin_set_user_password(target_user_id uuid, new_password text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
    caller_role TEXT;
BEGIN
    SELECT role INTO caller_role
    FROM public.user_profiles
    WHERE id = auth.uid();

    IF caller_role IS NULL OR caller_role NOT IN ('admin', 'dev') THEN
        RAISE EXCEPTION 'only admin or dev can set passwords';
    END IF;

    IF new_password IS NULL OR char_length(new_password) < 6 THEN
        RAISE EXCEPTION 'password must be at least 6 characters';
    END IF;

    UPDATE auth.users
    SET encrypted_password = crypt(new_password, gen_salt('bf', 10)),
        updated_at = now()
    WHERE id = target_user_id;

    RETURN FOUND;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_set_user_password(uuid, text) FROM public;
GRANT EXECUTE ON FUNCTION public.admin_set_user_password(uuid, text) TO authenticated;
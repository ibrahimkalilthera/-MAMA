-- Migration: handle_new_user profile guard
-- Never create a profile with the default "New User" display name.
--
-- Security note: the role is intentionally NOT read from user metadata here.
-- supabase.auth.signUp() accepts arbitrary metadata, and createStaffUser runs
-- under the ANON key, so honoring a metadata "role" would let anyone
-- self-promote to admin/dev. New signups therefore always land as 'staff';
-- promotion to admin/dev happens via the admin-only updateUserRole flow.

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_full_name TEXT;
BEGIN
    -- Real name from metadata if provided, otherwise derive a readable
    -- display name from the email local-part (never the literal "New User").
    v_full_name := NULLIF(btrim(NEW.raw_user_meta_data->>'full_name'), '');
    IF v_full_name IS NULL THEN
        -- Derive a readable display name from the email local-part:
        -- split on '.' / '_' / '-' and a camel-case-ish boundary.
        BEGIN
            v_full_name := regexp_replace(split_part(NEW.email, '@', 1), '[-_.]', ' ', 'g');
            v_full_name := regexp_replace(v_full_name, '([a-z0-9])([A-Z])', '\1 \2', 'g');
            v_full_name := initcap(btrim(v_full_name));
        EXCEPTION WHEN OTHERS THEN
            v_full_name := split_part(NEW.email, '@', 1);
        END;
    END IF;

    INSERT INTO public.user_profiles (id, email, full_name, role)
    VALUES (NEW.id, NEW.email, v_full_name, 'staff');
    RETURN NEW;
END;
$$;
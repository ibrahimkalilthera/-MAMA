-- ============================================================================
-- MAMA THERA Finance Suite — Team-wide settings (inactivity auto-logout)
-- ============================================================================
-- The auto-logout window is a TEAM decision: one row, shared by every
-- account and every browser (previously each browser kept its own value in
-- localStorage). Anyone authenticated may READ the settings (every client
-- applies the window at login); only admin/dev may WRITE (the Settings tab,
-- the only UI that changes it, is admin-only anyway).
--
-- The row is seeded with the historical default (30 minutes) so the DB is
-- authoritative from the first deploy; browser localStorage remains only a
-- fast-start cache while no row exists.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.app_settings (
    key TEXT PRIMARY KEY,
    value JSONB NOT NULL,
    updated_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

ALTER TABLE public.app_settings ENABLE ROW LEVEL SECURITY;

-- Read: any authenticated account (every client applies the window).
DROP POLICY IF EXISTS "app_settings_read" ON public.app_settings;
CREATE POLICY "app_settings_read"
    ON public.app_settings
    FOR SELECT
    USING (auth.role() = 'authenticated');

-- Write: admin/dev only, re-checked server-side (is_admin() helper).
DROP POLICY IF EXISTS "app_settings_write" ON public.app_settings;
CREATE POLICY "app_settings_write"
    ON public.app_settings
    FOR INSERT
    WITH CHECK (is_admin());

DROP POLICY IF EXISTS "app_settings_update" ON public.app_settings;
CREATE POLICY "app_settings_update"
    ON public.app_settings
    FOR UPDATE
    USING (is_admin());

-- Seed the historical default so the setting exists team-wide immediately.
INSERT INTO public.app_settings (key, value)
VALUES ('inactivity_minutes', '30'::jsonb)
ON CONFLICT (key) DO NOTHING;
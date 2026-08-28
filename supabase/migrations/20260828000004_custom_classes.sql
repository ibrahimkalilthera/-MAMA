-- Migration: custom_classes — single source of truth for shared custom classes
-- Supersedes the localStorage-based class management and the custom_grades
-- table. Custom classes are shared across all authenticated users.
--
-- Schema: id (uuid), code (display id, e.g. '1D' or a custom name),
-- cycle/year/section, French/English display names.

CREATE TABLE IF NOT EXISTS public.custom_classes (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    code TEXT NOT NULL,
    cycle TEXT NOT NULL DEFAULT 'other',
    year TEXT NOT NULL DEFAULT '',
    section TEXT NOT NULL DEFAULT '',
    name_fr TEXT NOT NULL,
    name_en TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

-- Case-insensitive uniqueness on the display code, mirroring the UI dedup
-- behavior (no '1B' vs '1b' duplicates).
CREATE UNIQUE INDEX IF NOT EXISTS custom_classes_code_lower_unique
    ON public.custom_classes (lower(code));

ALTER TABLE public.custom_classes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated read custom classes" ON public.custom_classes;
CREATE POLICY "Authenticated read custom classes"
    ON public.custom_classes FOR SELECT
    TO authenticated
    USING (true);

DROP POLICY IF EXISTS "Authenticated insert custom classes" ON public.custom_classes;
CREATE POLICY "Authenticated insert custom classes"
    ON public.custom_classes FOR INSERT
    TO authenticated
    WITH CHECK (true);

DROP POLICY IF EXISTS "Authenticated update custom classes" ON public.custom_classes;
CREATE POLICY "Authenticated update custom classes"
    ON public.custom_classes FOR UPDATE
    TO authenticated
    USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Authenticated delete custom classes" ON public.custom_classes;
CREATE POLICY "Authenticated delete custom classes"
    ON public.custom_classes FOR DELETE
    TO authenticated
    USING (true);

-- Explicit API privileges for the authenticated role (PostgREST).
GRANT SELECT, INSERT, UPDATE, DELETE ON public.custom_classes TO authenticated;

-- Migrate any rows left in the superseded custom_grades table into
-- custom_classes (as 'other' cycle), then drop custom_grades.
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'custom_grades') THEN
        INSERT INTO public.custom_classes (code, cycle, year, section, name_fr, name_en)
        SELECT name, 'other', '', '', name, name
        FROM public.custom_grades
        ON CONFLICT DO NOTHING;
        DROP TABLE public.custom_grades;
    END IF;
END
$$;

-- Shared custom classes used by all authenticated school users
CREATE TABLE IF NOT EXISTS public.custom_grades (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    CONSTRAINT custom_grades_name_unique UNIQUE (name)
);

ALTER TABLE public.custom_grades ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated read custom grades" ON public.custom_grades;
CREATE POLICY "Authenticated read custom grades"
    ON public.custom_grades FOR SELECT
    TO authenticated
    USING (true);

DROP POLICY IF EXISTS "Authenticated insert custom grades" ON public.custom_grades;
CREATE POLICY "Authenticated insert custom grades"
    ON public.custom_grades FOR INSERT
    TO authenticated
    WITH CHECK (true);

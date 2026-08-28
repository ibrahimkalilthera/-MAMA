-- Migration: custom_grades — case-insensitive uniqueness + explicit API grants
-- The UI deduplicates class names case-insensitively, but the previous UNIQUE(name)
-- constraint was case-sensitive, allowing "1ère année B" and "1ERE ANNEE B" to both
-- be stored. Replace it with a case-insensitive unique index so the database matches
-- the front-end behavior and no case-duplicate classes can accumulate.
--
-- Supabase exposes tables to the REST/PostgREST API through privileges on the
-- `authenticated` role (the "API privileges" panel toggles these). State them
-- explicitly here so access does not depend on dashboard configuration.

-- Replace the case-sensitive unique constraint with a case-insensitive unique index.
ALTER TABLE public.custom_grades DROP CONSTRAINT IF EXISTS custom_grades_name_unique;

CREATE UNIQUE INDEX IF NOT EXISTS custom_grades_name_lower_unique
    ON public.custom_grades (lower(name));

-- Rebuild the insert policy so a redundant exact/case variant cannot be inserted
-- (PostgREST relies on the unique index; keep the policy aligned with it).
DROP POLICY IF EXISTS "Authenticated insert custom grades" ON public.custom_grades;
CREATE POLICY "Authenticated insert custom grades"
    ON public.custom_grades FOR INSERT
    TO authenticated
    WITH CHECK (true);

-- Explicit API privileges for the authenticated role.
GRANT SELECT, INSERT ON public.custom_grades TO authenticated;
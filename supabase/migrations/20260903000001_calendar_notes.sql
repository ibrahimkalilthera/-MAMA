-- ============================================================================
-- MAMA THERA Finance Suite — Team-wide calendar day notes
-- ============================================================================
-- A note added from the calendar day modal is a TEAM artefact: every account
-- sees it, like todos (which already live in the shared todos table). The
-- standalone notes were previously stored in the author's browser
-- localStorage only (`calendar-day-notes` key) — invisible to everyone else.
--
-- Access: any authenticated account can read and write (same posture as
-- todos); anonymous access is denied by RLS.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.calendar_notes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    note_date DATE NOT NULL,
    text TEXT NOT NULL,
    created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

CREATE INDEX IF NOT EXISTS calendar_notes_note_date_idx ON public.calendar_notes (note_date);

ALTER TABLE public.calendar_notes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated read calendar_notes" ON public.calendar_notes;
CREATE POLICY "Authenticated read calendar_notes"
    ON public.calendar_notes
    FOR SELECT
    USING (auth.role() = 'authenticated');

DROP POLICY IF EXISTS "Authenticated insert calendar_notes" ON public.calendar_notes;
CREATE POLICY "Authenticated insert calendar_notes"
    ON public.calendar_notes
    FOR INSERT
    WITH CHECK (auth.role() = 'authenticated');

DROP POLICY IF EXISTS "Authenticated update calendar_notes" ON public.calendar_notes;
CREATE POLICY "Authenticated update calendar_notes"
    ON public.calendar_notes
    FOR UPDATE
    USING (auth.role() = 'authenticated');

DROP POLICY IF EXISTS "Authenticated delete calendar_notes" ON public.calendar_notes;
CREATE POLICY "Authenticated delete calendar_notes"
    ON public.calendar_notes
    FOR DELETE
    USING (auth.role() = 'authenticated');
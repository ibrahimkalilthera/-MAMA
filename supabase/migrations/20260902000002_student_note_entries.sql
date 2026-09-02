-- Migration: persist dated notes (Notes ⇄ Calendar bridge) on students.
--
-- The bridge stores dated entries as `noteEntries` on the Student model
-- (calendar day modal → student sheet, and the reverse). The column was
-- never created: `studentUpdatesToRow` silently dropped `noteEntries` at
-- the DB boundary, so notes only ever survived the current session.
-- This column is the persistence half of the bridge.

ALTER TABLE public.students
  ADD COLUMN IF NOT EXISTS note_entries jsonb NOT NULL DEFAULT '[]'::jsonb;
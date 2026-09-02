-- Migration: matricules are only used by ninth-year students.
--
-- The application enforces the same policy at every read/write boundary. This
-- cleanup removes values written by older versions for students whose class is
-- not ninth year, while preserving 9A/9B/9C/9D and equivalent display labels.
-- It is idempotent and deliberately leaves the internal UUID `students.id`
-- untouched; payments, todos, and notifications continue to use that UUID.

UPDATE public.students
SET student_id = NULL
WHERE student_id IS NOT NULL
  AND (
    grade IS NULL
    OR grade !~* '(^|[^0-9])9(ème|eme|th|e|[[:alpha:]])?[[:alpha:]]?([^[:alnum:]]|$)'
  );

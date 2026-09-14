-- Migration: durable staff category (employee / technique / admin).
--
-- Until now, WHICH KIND of member a staff row was had no home in the schema: it
-- was guessed at render time from the free-text `position`, matched against the
-- curated admin/technique label lists in whichever language the form happened to
-- be filled in (src/lib/adminPositions.ts). Two defects followed from that, both
-- observable on the payroll screen:
--
--   1. A member added through "Ajouter un Membre du Centre T et P" whose typed
--      position was not one of the curated labels was NOT recognised as a
--      technical-center member, so the download button handed them the employee
--      fiche (fiche-paiement-salaire.pdf) instead of the T e P fiche.
--   2. Editing the position (the edit form always uses the free-text employee
--      mode) silently moved a member from one category to another — and with the
--      category went their document and their place in the payroll filters.
--
-- The category is therefore a column, written by the flow that created the
-- member. It is language-independent, so switching the interface language no
-- longer changes what a member is.
--
-- Backfill: existing rows get the category their stored position implies (the
-- same two bilingual lists as src/lib/adminPositions.ts, lowercased and
-- trimmed); anything else is an employee, which is what the app already showed
-- for them — so this migration changes no existing document, it only stops the
-- guess from happening again.

ALTER TABLE public.staff
    ADD COLUMN IF NOT EXISTS category TEXT NOT NULL DEFAULT 'employee';

ALTER TABLE public.staff
    DROP CONSTRAINT IF EXISTS staff_category_check;
ALTER TABLE public.staff
    ADD CONSTRAINT staff_category_check
    CHECK (category IN ('employee', 'technique', 'admin'));

-- Technicians first, then administration: the two lists are disjoint today, and
-- running them in this order keeps the result identical if a label ever appears
-- in both.
UPDATE public.staff
   SET category = 'technique'
 WHERE lower(btrim(position)) IN (
        'membre du centre technique', 'technicien', 'technicienne',
        'agent technique', 'formateur technique', 'instructeur technique',
        'technical center member', 'technician', 'technical agent',
        'technical trainer', 'technical instructor'
       );

UPDATE public.staff
   SET category = 'admin'
 WHERE lower(btrim(position)) IN (
        'promotrice', 'gestionnaire principal', 'proviseur', 'censeur',
        'surveillant général', 'secrétaire', 'économe', 'directeur général',
        'directeur des études', 'chef des travaux',
        'founder', 'general manager', 'principal', 'discipline master',
        'head supervisor', 'secretary', 'bursar', 'general director',
        'director of studies', 'head of works'
       );

-- A staff row whose category is unknown can no longer exist: the CHECK above
-- plus NOT NULL means the three kinds above are the only values, and the payroll
-- filter/PDF dispatch can read the column instead of matching prose.

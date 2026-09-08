-- calendar_notes : restreint la modification/suppression à l'auteur.
--
-- Jusqu'ici, toute personne authentifiée pouvait modifier ou supprimer la note
-- d'un autre compte (politiques "Authenticated update/delete" sur
-- auth.role()='authenticated' uniquement). On veut conserver la lecture
-- partagée (toute l'équipe voit les notes) mais limiter l'écriture/édition/
-- suppression à l'auteur.
--
-- En plus, `created_by` n'était jamais peuplé à l'insertion (l'app ne le
-- renseigne pas), ce qui rendrait une restriction `created_by = auth.uid()`
-- inopérante (toutes les lignes auraient created_by NULL). On ajoute donc un
-- trigger BEFORE INSERT qui renseigne created_by = auth.uid().

-- ─── 1. Trigger : renseigne created_by à l'insertion ──────────────────────
CREATE OR REPLACE FUNCTION public.set_calendar_note_created_by()
RETURNS TRIGGER AS $$
BEGIN
    NEW.created_by := auth.uid();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS calendar_notes_set_created_by ON public.calendar_notes;
CREATE TRIGGER calendar_notes_set_created_by
    BEFORE INSERT ON public.calendar_notes
    FOR EACH ROW
    EXECUTE FUNCTION public.set_calendar_note_created_by();

-- ─── 2. Lecture : inchangée (tout authentifié lit) ─────────────────────────
DROP POLICY IF EXISTS "Authenticated read calendar_notes" ON public.calendar_notes;
CREATE POLICY "Authenticated read calendar_notes"
    ON public.calendar_notes
    FOR SELECT
    USING (auth.role() = 'authenticated');

-- ─── 3. Insertion : inchangée (tout authentifié crée une note) ────────────
DROP POLICY IF EXISTS "Authenticated insert calendar_notes" ON public.calendar_notes;
CREATE POLICY "Authenticated insert calendar_notes"
    ON public.calendar_notes
    FOR INSERT
    WITH CHECK (auth.role() = 'authenticated');

-- ─── 4. Modification : auteur uniquement ───────────────────────────────────
DROP POLICY IF EXISTS "Authenticated update calendar_notes" ON public.calendar_notes;
CREATE POLICY "Owner update calendar_notes"
    ON public.calendar_notes
    FOR UPDATE
    USING (auth.role() = 'authenticated' AND created_by = auth.uid())
    WITH CHECK (auth.role() = 'authenticated' AND created_by = auth.uid());

-- ─── 5. Suppression : auteur uniquement ────────────────────────────────────
DROP POLICY IF EXISTS "Authenticated delete calendar_notes" ON public.calendar_notes;
CREATE POLICY "Owner delete calendar_notes"
    ON public.calendar_notes
    FOR DELETE
    USING (auth.role() = 'authenticated' AND created_by = auth.uid());
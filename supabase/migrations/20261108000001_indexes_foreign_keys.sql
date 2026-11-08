-- Migration: les trois clés étrangères qui grandissent avec l'école reçoivent leur index.
--
-- ─── La mesure ──────────────────────────────────────────────────────────────
-- Le 2026-11-08, le catalogue de la base partagée (`rpcjdohfxwukbqngbprw`) a été
-- interrogé pour une seule question : quelles clés étrangères n'ont AUCUN index
-- couvrant leur colonne ? Réponse : **5**.
--
--     app_settings.updated_by      (app_settings_updated_by_fkey)
--     calendar_notes.created_by    (calendar_notes_created_by_fkey)
--     salary_payments.staff_id     (salary_payments_staff_id_fkey)   ← ici
--     students.parent_id           (students_parent_id_fkey)         ← ici
--     todos.student_id             (todos_student_id_fkey)           ← ici
--
-- PostgreSQL ne crée PAS d'index derrière une clé étrangère. Sans lui, les deux
-- gestes que ces clés rendent possibles lisent toute la table :
--   • la suppression en cascade (`todos.student_id … ON DELETE CASCADE`,
--     `salary_payments.staff_id … ON DELETE CASCADE`) ;
--   • la mise à NULL (`students.parent_id … ON DELETE SET NULL`) — supprimer un
--     parent balaie donc tous les élèves pour trouver ceux à détacher.
--
-- ─── Pourquoi ces trois-là, et pas les cinq ────────────────────────────────
-- Un index se paie à chaque écriture. Les trois tables ci-dessus grandissent avec
-- l'école (un élève, une fiche de paie, une tâche par geste) : leur coût est
-- réel et leur absence le deviendra. `app_settings` porte une poignée de lignes
-- de réglages et `calendar_notes` quelques notes de calendrier — y poser un
-- index serait de la cérémonie, pas de la performance. Elles restent nues, et
-- c'est dit ici pour que la prochaine mesure ne les redécouvre pas comme un
-- oubli.
--
-- Rien d'autre ne change : aucune colonne, aucune contrainte, aucune politique.
-- Idempotent (`IF NOT EXISTS`) — le fichier peut être rejoué.
--
-- ─── Appliquée hors de `db:apply`, et pourquoi ──────────────────────────────
-- `db:apply` compte comme objets observables les tables, colonnes, contraintes,
-- fonctions, politiques et déclencheurs — pas les index. Il refuse donc ce
-- fichier (« aucun objet observable »). Il a été appliqué par une transaction
-- directe avec preuve avant/après (0 des 3, puis 3 des 3), et c'est
-- `check:db-objects`, qui suit les index, qui le prouve en base.

CREATE INDEX IF NOT EXISTS idx_students_parent_id
    ON public.students(parent_id);

CREATE INDEX IF NOT EXISTS idx_salary_payments_staff_id
    ON public.salary_payments(staff_id);

CREATE INDEX IF NOT EXISTS idx_todos_student_id
    ON public.todos(student_id);

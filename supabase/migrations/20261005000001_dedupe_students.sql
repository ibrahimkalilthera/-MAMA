-- Migration: nettoyage des doublons de `students` (mesurés le 2026-10-05).
--
-- ─── Ce que la base porte encore ────────────────────────────────────────────
-- Le correctif du 2026-10-05 (commit 49ec45b) a fermé la CAUSE — l'id du geste
-- rend la création en ligne idempotente, et le drainage n'a plus d'exclusion
-- mutuelle manquante. Il n'a PAS retiré les lignes déjà écrites : la décision
-- d'alors (development history) était de laisser les 14 lignes en trop en base,
-- « leur retrait est une décision de l'école, pas de l'outil ».
--
-- Re-mesuré le 2026-10-05 après coupure (lecture seule, service role) :
--   • 414 lignes dans `students` ;
--   • 9 groupes en doublon — MÊME nom, MÊME téléphone parent, MÊME classe,
--     MÊME année — soit 14 lignes en trop :
--       Mahamadou DJIRE (7A, 77705323)        ×7
--       Fousseyni BALLO (3B, 83435352)        ×2
--       Gnide Youma BARRO (3B, 76160219)      ×2
--       Fatou BOLLY (3B, 75016354)            ×2
--       Cheickné COULIBALY (2B, 92689026)     ×2
--       Thierno Hady TRAORE (2B, 78212140)    ×2
--       Bourama DIARRA (8A, 75722758)         ×2
--       Mamadou SIDIBE (6A, 79068145)         ×2
--       Fatoumata A COULIBALY (8A, 76640124)  ×2
--   • AUCUNE de ces lignes ne porte de paiement ni de tâche (vérifié : les 2
--     seuls paiements de la base pointent sur d'autres élèves, 0 tâche liée).
--     Le `ON DELETE CASCADE` de `payments` / `todos` ne détruit donc rien ici.
--
-- ⚠️ Piège, déjà signalé : d'autres noms se RÉPÈTENT sans être des doublons
-- (« Awa DIARRA » ×3, « Bourama COULIBALY » ×2, « Adam TRAORE »… : téléphones,
-- classes ou montants DIFFÉRENTS — des personnes distinctes). La clé de
-- regroupement inclut donc le téléphone, la classe ET l'année : deux homonymes
-- d'une même famille ne sont jamais fusionnés s'ils ne partagent pas les trois.
--
-- ─── Ce que fait cette migration ────────────────────────────────────────────
--   1. copie les lignes condamnées dans `students_dupe_backup_20261005`
--      → le nettoyage est RÉVERSIBLE (ligne à ligne, champ à champ) ;
--   2. RE-POINTE d'abord tout paiement / tâche des jumelles vers la survivante
--      (défensif : aucune n'en a aujourd'hui, mais une future paire le pourrait) ;
--   3. supprime les jumelles, en GARDANT la plus ancienne (`created_at`, puis
--      `id` : ordre déterministe) — la première trace d'un geste unique.
--
-- Rejouable : une base déjà nettoyée n'a plus aucun `rn > 1`, donc n'insère ni
-- ne supprime rien. Aucune donnée n'est perdue au passage (tout est sauvegardé).
--
-- Contrôle APRÈS application (doit renvoyer 0 ligne) :
--   SELECT lower(btrim(name)), btrim(coalesce(parent_phone,'')),
--          lower(btrim(coalesce(grade,''))), coalesce(academic_year,'')
--   FROM public.students
--   GROUP BY 1,2,3,4 HAVING count(*) > 1;

-- ─── 1) Table de sauvegarde (réversibilité) ─────────────────────────────────
-- `CREATE TABLE ... AS SELECT ... WHERE false` fabrique la STRUCTURE (mêmes
-- colonnes/types) sans copier de ligne ; le contenu arrive à l'étape 2.
CREATE TABLE IF NOT EXISTS public.students_dupe_backup_20261005 AS
SELECT * FROM public.students WHERE false;

-- ─── 2)+3) Sauvegarde des jumelles, re-pointage, suppression ────────────────
-- `rn` numérote les lignes d'un même groupe ; `survivor_id` est la première.
WITH ranked AS (
    SELECT
        id,
        row_number() OVER (
            PARTITION BY lower(btrim(name)),
                         btrim(coalesce(parent_phone, '')),
                         lower(btrim(coalesce(grade, ''))),
                         coalesce(academic_year, '')
            ORDER BY created_at ASC, id ASC
        ) AS rn,
        first_value(id) OVER (
            PARTITION BY lower(btrim(name)),
                         btrim(coalesce(parent_phone, '')),
                         lower(btrim(coalesce(grade, ''))),
                         coalesce(academic_year, '')
            ORDER BY created_at ASC, id ASC
        ) AS survivor_id
    FROM public.students
),
doomed AS (
    SELECT id, survivor_id FROM ranked WHERE rn > 1
)
-- 2a) on archive AVANT d'effacer (no-op si déjà fait : plus de `doomed`).
INSERT INTO public.students_dupe_backup_20261005
SELECT s.* FROM public.students s
JOIN doomed d ON d.id = s.id;

-- 2b) on ramène paiements et tâches vers la survivante (défensif).
WITH ranked AS (
    SELECT
        id,
        row_number() OVER (
            PARTITION BY lower(btrim(name)),
                         btrim(coalesce(parent_phone, '')),
                         lower(btrim(coalesce(grade, ''))),
                         coalesce(academic_year, '')
            ORDER BY created_at ASC, id ASC
        ) AS rn,
        first_value(id) OVER (
            PARTITION BY lower(btrim(name)),
                         btrim(coalesce(parent_phone, '')),
                         lower(btrim(coalesce(grade, ''))),
                         coalesce(academic_year, '')
            ORDER BY created_at ASC, id ASC
        ) AS survivor_id
    FROM public.students
),
doomed AS (
    SELECT id, survivor_id FROM ranked WHERE rn > 1
)
UPDATE public.payments p
SET student_id = d.survivor_id
FROM doomed d
WHERE p.student_id = d.id;

WITH ranked AS (
    SELECT
        id,
        row_number() OVER (
            PARTITION BY lower(btrim(name)),
                         btrim(coalesce(parent_phone, '')),
                         lower(btrim(coalesce(grade, ''))),
                         coalesce(academic_year, '')
            ORDER BY created_at ASC, id ASC
        ) AS rn,
        first_value(id) OVER (
            PARTITION BY lower(btrim(name)),
                         btrim(coalesce(parent_phone, '')),
                         lower(btrim(coalesce(grade, ''))),
                         coalesce(academic_year, '')
            ORDER BY created_at ASC, id ASC
        ) AS survivor_id
    FROM public.students
),
doomed AS (
    SELECT id, survivor_id FROM ranked WHERE rn > 1
)
UPDATE public.todos t
SET student_id = d.survivor_id
FROM doomed d
WHERE t.student_id = d.id;

-- 3) on retire les jumelles.
WITH ranked AS (
    SELECT
        id,
        row_number() OVER (
            PARTITION BY lower(btrim(name)),
                         btrim(coalesce(parent_phone, '')),
                         lower(btrim(coalesce(grade, ''))),
                         coalesce(academic_year, '')
            ORDER BY created_at ASC, id ASC
        ) AS rn
    FROM public.students
)
DELETE FROM public.students s
USING ranked r
WHERE s.id = r.id AND r.rn > 1;

-- La sauvegarde se supprime UNE FOIS le nettoyage confirmé sur l'application :
--   DROP TABLE public.students_dupe_backup_20261005;

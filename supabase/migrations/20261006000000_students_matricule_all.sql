-- Migration: un matricule pour TOUS les élèves — les 423 déjà enregistrés comme
-- tous ceux qui seront ajoutés ensuite.
--
-- ─── La demande, et la politique qu'elle remplace ────────────────────────────
-- `students.student_id` (l'étiquette « MATRICULE » de l'application) existe
-- depuis l'init mais n'était renseigné que pour les classes de 9e, où l'école
-- SAISIT un numéro d'examen à la main (migration 20260902000006 : « matricules
-- are only used by ninth-year students »). Demande du propriétaire : « un numéro
-- de matricule pour tous les élèves ajoutés, et pour tous ceux qui seront ajoutés
-- dans le futur ». La COLONNE ne change donc pas — elle devient attribuée par la
-- base, et l'application cesse de la conditionner à la classe.
--
-- ─── Ce que fait cette migration ─────────────────────────────────────────────
--   1. un COMPTEUR PAR ANNÉE (`student_matricule_counters`) — la seule forme qui
--      attribue un numéro séquentiel sans course entre deux insertions ;
--   2. le RATTRAPAGE des fiches dont le matricule est vide, numérotées
--      `MT-<année d'entrée>-<n°>` dans l'ordre de leur création ;
--   3. un DÉCLENCHEUR d'attribution : toute fiche écrite sans matricule en reçoit
--      un, sans que l'application ait à le demander ni à l'inventer.
--
-- ─── Ce qui est PRÉSERVÉ, et pourquoi l'ordre compte ─────────────────────────
-- Un matricule déjà porté n'est JAMAIS réécrit : les numéros d'examen saisis à la
-- main restent tels quels (l'école s'en sert sur des documents), et le compteur
-- d'une année repart APRÈS le plus grand numéro déjà utilisé — sinon le premier
-- rattrapage entrerait en collision avec l'index UNIQUE de `student_id` et ferait
-- échouer la migration. C'est aussi pourquoi le compteur est ouvert (étape 2a)
-- AVANT de numéroter (2b).
--
-- ─── L'ANNÉE DU MATRICULE ────────────────────────────────────────────────────
-- `coalesce(enrollment_date, created_at::date)` : l'année d'ENTRÉE quand la fiche
-- la connaît, sinon l'année où la ligne est apparue en base. C'est la seule
-- information disponible pour les fiches existantes — elle est donc DITE ici
-- plutôt que devinée ailleurs, et un matricule déjà porté ne bouge pas.
--
-- ─── Ce que ça change pour l'application ────────────────────────────────────
-- Un INSERT sans `student_id` n'écrit plus NULL : la base attribue la valeur et
-- PostgREST renvoie la ligne complète (matricule compris). L'application n'invente
-- donc plus aucun numéro côté client, l'import Excel respecte un matricule fourni,
-- et une mise à jour ne peut plus effacer un matricule existant
-- (voir src/lib/offlineReplay.ts et src/lib/studentIdentifiers.ts).
--
-- Idempotent : le rattrapage ne touche que les matricules vides, le compteur ne
-- recule jamais (`GREATEST`), le déclencheur est recréé sans erreur.
--
-- Contrôle APRÈS application — doit renvoyer 0 :
--   SELECT count(*) FROM public.students
--   WHERE student_id IS NULL OR btrim(student_id) = '';

-- ─── 1) Le compteur par année ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.student_matricule_counters (
    yr TEXT PRIMARY KEY,
    last_seq INTEGER NOT NULL DEFAULT 0
);

-- Non exposée à PostgREST : RLS active SANS policy (le déclencheur y écrit en
-- SECURITY DEFINER, donc sous les droits du propriétaire, jamais ceux du client).
ALTER TABLE public.student_matricule_counters ENABLE ROW LEVEL SECURITY;

-- ─── 2a) Ouvrir chaque compteur AU-DESSUS de ce qui est déjà porté ──────────
INSERT INTO public.student_matricule_counters (yr, last_seq)
SELECT split_part(student_id, '-', 2) AS yr,
       max((regexp_replace(student_id, '^MT-[0-9]{4}-', ''))::int) AS last_seq
FROM public.students
WHERE student_id ~ '^MT-[0-9]{4}-[0-9]+$'
GROUP BY 1
ON CONFLICT (yr) DO UPDATE
    SET last_seq = GREATEST(public.student_matricule_counters.last_seq, EXCLUDED.last_seq);

-- ─── 2b) Numéroter les fiches qui n'en ont pas ──────────────────────────────
-- `row_number()` par année, dans l'ordre de création (created_at puis id :
-- déterministe, donc rejouable à l'identique sur une copie de la base).
WITH blank AS (
    SELECT id,
           to_char(coalesce(enrollment_date, created_at::date), 'YYYY') AS yr,
           row_number() OVER (
               PARTITION BY to_char(coalesce(enrollment_date, created_at::date), 'YYYY')
               ORDER BY created_at ASC, id ASC
           ) AS rn
    FROM public.students
    WHERE student_id IS NULL OR btrim(student_id) = ''
),
seeded AS (
    SELECT b.id, b.yr, b.rn + coalesce(c.last_seq, 0) AS n
    FROM blank b
    LEFT JOIN public.student_matricule_counters c ON c.yr = b.yr
)
UPDATE public.students s
SET student_id = 'MT-' || seeded.yr || '-' || lpad(seeded.n::text, 3, '0')
FROM seeded
WHERE s.id = seeded.id;

-- ─── 2c) Avancer les compteurs de ce qui vient d'être attribué ──────────────
-- Même calcul que 2a, un cran plus loin : c'est lui qui met le compteur à jour
-- pour ce que le rattrapage vient d'écrire.
INSERT INTO public.student_matricule_counters (yr, last_seq)
SELECT split_part(student_id, '-', 2) AS yr,
       max((regexp_replace(student_id, '^MT-[0-9]{4}-', ''))::int) AS last_seq
FROM public.students
WHERE student_id ~ '^MT-[0-9]{4}-[0-9]+$'
GROUP BY 1
ON CONFLICT (yr) DO UPDATE
    SET last_seq = GREATEST(public.student_matricule_counters.last_seq, EXCLUDED.last_seq);

-- ─── 3) L'attribution pour ce qui s'écrira ensuite ──────────────────────────
CREATE OR REPLACE FUNCTION public.assign_student_matricule()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
-- `search_path` figé : une fonction SECURITY DEFINER qui le laisse libre est un
-- détournement connu (une table homonyme posée par un client s'y ferait lire).
SET search_path = public, pg_temp
AS $$
DECLARE
    v_yr  TEXT;
    v_seq INTEGER;
BEGIN
    -- Un matricule DÉJÀ fourni (le numéro d'examen d'un 9e, ou celui d'un import)
    -- est respecté : la base ne numérote que ce qui est vide.
    IF NEW.student_id IS NOT NULL AND btrim(NEW.student_id) <> '' THEN
        RETURN NEW;
    END IF;

    v_yr := to_char(coalesce(NEW.enrollment_date, current_date), 'YYYY');

    -- `INSERT ... ON CONFLICT DO UPDATE ... RETURNING` est ATOMIQUE : deux
    -- insertions simultanées ne peuvent pas recevoir le même numéro, là où un
    -- `max() + 1` lu puis écrit le pourrait — et l'index UNIQUE transformerait
    -- cette course en « ajout impossible » côté école.
    INSERT INTO public.student_matricule_counters (yr, last_seq)
    VALUES (v_yr, 1)
    ON CONFLICT (yr) DO UPDATE
        SET last_seq = public.student_matricule_counters.last_seq + 1
    RETURNING last_seq INTO v_seq;

    NEW.student_id := 'MT-' || v_yr || '-' || lpad(v_seq::text, 3, '0');
    RETURN NEW;
END;
$$;

-- INSERT **ou** UPDATE : l'invariant (« tout élève porte un matricule ») vaut
-- pour TOUT écrivain — l'application, un script, une main dans le SQL. Une mise
-- à jour ordinaire ne le déclenche pas (la valeur est déjà non vide) ; seule une
-- remise à vide en reçoit un nouveau, ce qui est préférable à un élève sans
-- matricule.
DROP TRIGGER IF EXISTS students_assign_matricule ON public.students;
CREATE TRIGGER students_assign_matricule
    BEFORE INSERT OR UPDATE ON public.students
    FOR EACH ROW
    EXECUTE FUNCTION public.assign_student_matricule();

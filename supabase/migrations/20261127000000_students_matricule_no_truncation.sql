-- Migration: le matricule ne se TRONQUE plus — l'ajout d'élève ne se bloque plus au 1000e.
--
-- ─── L'incident, mesuré ────────────────────────────────────────────────────
-- Le 2026-11-24 à 14:08, la base a attribué `MT-2026-999` au 999e élève de
-- l'année. Toute insertion suivante a été REFUSÉE :
--
--   ERROR: duplicate key value violates unique constraint "students_student_id_key"
--   DETAIL: Key (student_id)=(MT-2026-100) already exists.
--
-- La cause est dans `assign_student_matricule()` :
--
--   NEW.student_id := 'MT-' || v_yr || '-' || lpad(v_seq::text, 3, '0');
--
-- `lpad` en PostgreSQL TRONQUE quand la chaîne est plus longue que la longueur
-- demandée : `lpad('1000', 3, '0')` rend `'100'`, pas `'1000'`. Le 1000e élève
-- recevait donc le matricule du 100e — déjà porté — et l'index UNIQUE refusait
-- l'écriture. Mesures du 2026-11-27 sur la base partagée : compteur `2026` à
-- 999, 898 matricules `MT-2026-001` … `MT-2026-999`, aucune fiche créée depuis
-- le 24/11, et une insertion de sonde (transaction annulée) refusée sur
-- `students_student_id_key` avec `(MT-2026-100) already exists`.
--
-- Côté école, le symptôme est trompeur : l'application traduit tout `23505` en
-- « Doublon détecté : cet enregistrement existe déjà », alors que l'élève
-- n'existe pas — c'est son NUMÉRO qui est pris. Les paiements saisis pour cet
-- élève, eux, restent en file et échouent en `23503` sur `payments` (le
-- `student_id` visé n'a jamais été créé).
--
-- ─── Ce que cette migration change ─────────────────────────────────────────
-- 1. La longueur demandée à `lpad` suit le numéro : `GREATEST(3, length(...))`.
--    `MT-2026-1000`, `MT-2026-10000`… s'écrivent en entier ; les numéros à
--    trois chiffres gardent exactement leur forme actuelle.
-- 2. L'attribution devient AUTO-RÉPARATRICE : si un matricule a été saisi à la
--    main au-delà du compteur (import Excel, numéro d'examen d'un 9e), la boucle
--    avance d'un cran au lieu de heurter l'index. Un numéro pris n'est plus une
--    panne d'ajout, c'est le numéro SUIVANT.
-- 3. Les compteurs sont réalignés au-dessus de ce qui est déjà porté
--    (`GREATEST`, jamais de recul) : un compteur en retard sur la réalité est
--    exactement la situation qui a produit l'incident.
--
-- Aucune ligne de `students` n'est touchée : les 898 matricules existants
-- restent tels quels, et le prochain numéro attribué est `MT-2026-1000`.
--
-- Idempotente (`CREATE OR REPLACE`, `IF NOT EXISTS`, `GREATEST`) et réversible :
--   -- revenir à la version d'origine : rejouer
--   -- supabase/migrations/20261006000000_students_matricule_all.sql
--
-- Contrôle APRÈS application (doit renvoyer 0 ligne) :
--   SELECT student_id FROM public.students
--   WHERE student_id ~ '^MT-[0-9]{4}-[0-9]+$'
--   GROUP BY student_id HAVING count(*) > 1;

-- ─── 1) Le compteur ne recule jamais, et rattrape ce qui est déjà porté ─────
-- Même calcul que la migration d'origine, rejoué : il remonte le compteur si un
-- matricule saisi à la main l'a dépassé.
INSERT INTO public.student_matricule_counters (yr, last_seq)
SELECT split_part(student_id, '-', 2) AS yr,
       max((regexp_replace(student_id, '^MT-[0-9]{4}-', ''))::int) AS last_seq
FROM public.students
WHERE student_id ~ '^MT-[0-9]{4}-[0-9]+$'
GROUP BY 1
ON CONFLICT (yr) DO UPDATE
    SET last_seq = GREATEST(public.student_matricule_counters.last_seq, EXCLUDED.last_seq);

-- ─── 2) L'attribution : numéro entier, et jamais un matricule déjà pris ────
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
    v_id  TEXT;
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
    --
    -- La boucle n'est pas une ceinture de sécurité décorative : elle rend
    -- l'attribution auto-réparatrice. Un matricule saisi à la main qui dépasse
    -- le compteur (import, numéro d'examen) faisait auparavant échouer TOUTE
    -- insertion suivante ; ici, le compteur avance jusqu'au premier numéro
    -- libre. Le nombre de tours est borné par le nombre de matricules pris
    -- au-delà du compteur — en pratique 0 ou 1.
    LOOP
        INSERT INTO public.student_matricule_counters (yr, last_seq)
        VALUES (v_yr, 1)
        ON CONFLICT (yr) DO UPDATE
            SET last_seq = public.student_matricule_counters.last_seq + 1
        RETURNING last_seq INTO v_seq;

        -- `GREATEST(3, length(...))` : au moins trois chiffres, et JAMAIS de
        -- troncature. C'est la ligne qui a bloqué l'école au 1000e élève
        -- (`lpad('1000', 3, '0')` rendait '100').
        v_id := 'MT-' || v_yr || '-' || lpad(v_seq::text, GREATEST(3, length(v_seq::text)), '0');

        EXIT WHEN NOT EXISTS (SELECT 1 FROM public.students WHERE student_id = v_id);
    END LOOP;

    NEW.student_id := v_id;
    RETURN NEW;
END;
$$;

-- Le déclencheur n'est pas recréé : `CREATE OR REPLACE FUNCTION` suffit, et le
-- recréer ferait perdre son ordre par rapport aux autres déclencheurs BEFORE
-- (`students_balance_derived`). Contrôle de présence, sans écriture :
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_trigger
        WHERE tgrelid = 'public.students'::regclass
          AND tgname = 'students_assign_matricule'
          AND NOT tgisinternal
    ) THEN
        RAISE EXCEPTION 'déclencheur students_assign_matricule absent — rejouer 20261006000000_students_matricule_all.sql';
    END IF;
END;
$$;

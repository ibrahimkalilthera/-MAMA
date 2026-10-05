-- Migration: l'unicité métier des élèves, tenue par la BASE (pas seulement par l'app).
--
-- ─── Pourquoi cette migration, après le nettoyage ───────────────────────────
-- La migration `20261005000001_dedupe_students` a retiré les 14 lignes en trop
-- (414 → 400). Le correctif applicatif (commit `49ec45b` puis `f5ed1dc`) a
-- fermé la CAUSE côté client : chaque création porte l'id du geste, et un
-- `23505` se lit « geste déjà enregistré ». Mais les deux protections vivent
-- dans l'APPLICATION : un INSERT écrit à la main (SQL direct, un autre client,
-- un script, un futur bug) créait encore un doublon sans que rien ne s'y
-- oppose. Cette migration porte la règle DANS LA BASE — le dernier endroit où
-- un doublon peut encore naître.
--
-- ─── La clé métier, exactement celle du nettoyage ───────────────────────────
--   lower(btrim(name))                     — le nom, insensible casse/espaces
--   btrim(coalesce(parent_phone, ''))      — le téléphone du parent
--   lower(btrim(coalesce(grade, '')))      — la classe
--   coalesce(academic_year, '')            — l'année scolaire
-- C'est la clé éprouvée le 2026-10-05 : elle désignait EXACTEMENT les 9 groupes
-- de la même personne (14 lignes en trop) et laissait intactes les familles
-- d'homonymes légitimes (« Awa DIARRA » ×3, « Bourama COULIBALY », « Adam
-- TRAORE »… : téléphones, classes ou montants différents = personnes
-- distinctes). Rien n'est inventé ici : on grave la clé déjà mesurée.
--
-- ─── Pourquoi PARTIEL ──────────────────────────────────────────────────────
-- `WHERE btrim(name) <> ''` : la contrainte ne s'applique qu'aux lignes qui
-- portent un NOM — la seule chose qui fait d'une ligne une personne. Une ligne
-- sans nom (import à moitié rempli, brouillon) n'est pas une identité : la
-- forcer à l'unicité bloquerait deux brouillons anonymes légitimes. `name` est
-- déjà `NOT NULL` en base ; ce prédicat borne la règle au sens métier.
--
-- ─── Ce que ça change pour l'application ───────────────────────────────────
-- Un doublon créé par un geste DIFFÉRENT (deux fiches vraiment saisies deux
-- fois) échoue désormais à l'INSERT avec `23505` au lieu de s'écrire en
-- silence : c'est le comportement voulu — l'app affiche l'erreur et n'ajoute
-- pas la ligne. Le même geste rejoué (double clic, reprise après coupure) reste
-- déjà couvert par l'id du geste.
--
-- Idempotent (`IF NOT EXISTS`) et réversible :
--   DROP INDEX IF EXISTS public.students_business_key_unique;
--
-- Contrôle APRÈS application (doit renvoyer 0 ligne) :
--   SELECT lower(btrim(name)), btrim(coalesce(parent_phone,'')),
--          lower(btrim(coalesce(grade,''))), coalesce(academic_year,'')
--   FROM public.students
--   GROUP BY 1,2,3,4 HAVING count(*) > 1;

CREATE UNIQUE INDEX IF NOT EXISTS students_business_key_unique
    ON public.students (
        lower(btrim(name)),
        btrim(coalesce(parent_phone, '')),
        lower(btrim(coalesce(grade, ''))),
        coalesce(academic_year, '')
    )
    WHERE btrim(name) <> '';

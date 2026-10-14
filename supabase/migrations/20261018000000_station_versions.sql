-- ============================================================================
-- MAMA THERA Finance Suite — LE BATTEMENT DE VERSION DU PARC
-- ============================================================================
-- Spécification : docs/CANAL_MISE_A_JOUR.md §7 (« Battement de version »).
--
-- La section 6 de cette spécification ne peut pas se vérifier toute seule : pour
-- savoir si le parc est passé à la version de bascule, il faut un RELEVÉ par
-- poste. Sans lui, « toutes les stations sont passées » se prouve poste par
-- poste — c'est-à-dire ne se prouve pas. Cette table est ce relevé : une ligne
-- par poste, écrite par le poste lui-même, et lue par `npm run fleet:versions`.
--
-- ─── Ce qu'un battement porte, et ce qu'il ne porte JAMAIS ─────────────────
-- Quatre faits, aucun d'identité : `station_id` est un identifiant ALÉATOIRE
-- rangé sur le poste (aucun nom de machine, aucun nom d'école, aucun compte),
-- la version installée, le majeur de Windows, et l'état du dernier contrôle de
-- mise à jour (avec la version proposée). C'est un recensement de parc, pas une
-- télémétrie d'usage : rien ici ne dit qui s'est servi de l'application, ni
-- combien.
--
-- ─── Pourquoi une FONCTION, et pas l'`upsert` que la spécification décrivait ─
-- La spécification demandait deux choses incompatibles telles quelles : un
-- `upsert` (une ligne par poste, `seen_at` rafraîchi à chaque battement) ET
-- « aucune politique de DELETE/UPDATE ». Un `upsert` PostgREST est un
-- `INSERT … ON CONFLICT DO UPDATE` : il exige le privilège UPDATE **et** une
-- politique UPDATE — les deux que la spécification refuse. Arbitré avec le
-- propriétaire le 2026-10-14 : l'écriture passe par cette fonction nommée
-- (`SECURITY DEFINER`, `EXECUTE` accordée au seul rôle `anon`), et la TABLE
-- n'ouvre plus rien du tout. Conséquence, et c'est un gain : `anon` ne peut ni
-- lire, ni écrire, ni supprimer directement — il ne peut qu'appeler ce geste,
-- dont les champs sont validés ici, avant que la moindre ligne soit touchée.
--
-- ─── Le point sensible, et il est chiffré ──────────────────────────────────
-- Une clé publique qui peut écrire est une surface : rien n'empêche d'appeler
-- cette fonction avec des `station_id` inventés, et la table grossirait alors
-- sans fin. Trois garde-fous, tous NOMMÉS :
--   • `npm run fleet:versions` refuse un relevé au-delà d'un seuil de lignes
--     (`--max-rows`, 200 par défaut — le parc réel est de l'ordre de la dizaine) ;
--   • le battement se DÉSACTIVE sur un poste (`STATION_HEARTBEAT=off`) sans
--     toucher au canal : une écriture refusée ici n'a aucun effet sur les mises
--     à jour, qui ne dépendent ni de cette table ni de la clé anon ;
--   • les bornes ci-dessous refusent une ligne qui ne dit rien d'exploitable.
--
-- ─── Ordre imposé par la spécification ─────────────────────────────────────
-- « jamais activé avant que le contrôle anon ne prouve l'insertion sans
-- lecture ». C'est pourquoi `scripts/verify-anon-rls.mjs` sonde les DEUX
-- directions dans cette même migration : l'appel de la fonction PASSE, et la
-- lecture de la table rend 0 ligne. La seule surface d'écriture anonyme de
-- l'application ne peut pas précéder sa preuve.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.station_versions (
    station_id TEXT PRIMARY KEY,
    app_version TEXT NOT NULL,
    os_version TEXT,
    last_check TEXT NOT NULL,
    last_check_version TEXT,
    seen_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    CONSTRAINT station_versions_station_id_bounds CHECK (char_length(station_id) BETWEEN 8 AND 64),
    CONSTRAINT station_versions_app_version_bounds CHECK (char_length(app_version) BETWEEN 1 AND 32),
    CONSTRAINT station_versions_os_version_bounds CHECK (
        os_version IS NULL OR char_length(os_version) BETWEEN 1 AND 32
    ),
    -- Les quatre états du contrôle, nommés : un état libre serait un journal
    -- qu'on ne peut plus agréger (et « ok » se lirait comme « à jour » alors que
    -- `feed-absent` dit le contraire).
    CONSTRAINT station_versions_last_check_enum CHECK (
        last_check IN ('ok', 'feed-absent', 'html', 'unreachable')
    ),
    CONSTRAINT station_versions_last_check_version_bounds CHECK (
        last_check_version IS NULL OR char_length(last_check_version) BETWEEN 1 AND 32
    )
);

COMMENT ON TABLE public.station_versions IS
    'Relevé du parc (§7 de docs/CANAL_MISE_A_JOUR.md) : une ligne par poste, écrite par le poste via public.record_station_beat(). Aucun nom, aucune identité — un station_id aléatoire. Inscriptible par anon, ILLISIBLE par anon.';

ALTER TABLE public.station_versions ENABLE ROW LEVEL SECURITY;

-- ─── La table n'ouvre RIEN à personne par le canal REST ────────────────────
-- Le verrou est la RLS SANS AUCUNE POLITIQUE, et c'est le précédent du dépôt
-- pour une table qu'une fonction `security definer` atteint seule :
-- `student_matricule_counters`, mesurée le 2026-10-18 (RLS activée, zéro
-- politique, privilèges REST par défaut de Supabase laissés en place). Avec
-- zéro politique : zéro ligne lisible, et toute écriture refusée (403) pour
-- `anon` comme pour `authenticated` — le seul chemin d'écriture est la fonction
-- ci-dessous, qui est `SECURITY DEFINER` et tourne donc avec les droits de son
-- propriétaire, pas avec ceux de l'appelant.
--
-- ─── Pourquoi les privilèges REST ne sont PAS révoqués ─────────────────────
-- Parce qu'ils ne sont pas ce qui protège ici, et que les révoquer coûterait un
-- angle mort. `check:hosted-schema` sonde la base de production par le canal de
-- l'application (la clé `anon`) pour vérifier que les colonnes déclarées
-- EXISTENT, et un 401 « permission denied » y est un « pas de verdict possible »
-- (sortie 2) : une table qu'aucune sonde ne peut atteindre est une table que
-- personne ne surveille. Ce qui garde celle-ci, c'est l'ABSENCE de politique,
-- et elle est surveillée deux fois : `check:public-rls` la nomme « scellée »
-- (RLS activée, 0 politique, aucun rôle client ne lit), et
-- `scripts/verify-anon-rls.mjs` éprouve à chaque exécution que la lecture anon
-- rend 0 ligne et que l'écriture anon est refusée. La conséquence est DITE, pas
-- cachée : ajouter un jour une politique permissive sur cette table l'ouvrirait
-- d'un coup — c'est exactement le geste que ces deux contrôles attrapent.

-- ─── Le geste, et lui seul ─────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.record_station_beat(
    p_station_id TEXT,
    p_app_version TEXT,
    p_os_version TEXT DEFAULT NULL,
    p_last_check TEXT DEFAULT 'ok',
    p_last_check_version TEXT DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_station_id TEXT := btrim(coalesce(p_station_id, ''));
    v_app_version TEXT := btrim(coalesce(p_app_version, ''));
    v_os_version TEXT := nullif(btrim(coalesce(p_os_version, '')), '');
    v_last_check TEXT := btrim(coalesce(p_last_check, 'ok'));
    v_last_check_version TEXT := nullif(btrim(coalesce(p_last_check_version, '')), '');
BEGIN
    -- Le refus est BRUYANT et nommé : une écriture silencieusement tronquée
    -- ferait croire à un battement reçu alors que la base porte autre chose.
    IF char_length(v_station_id) < 8 OR char_length(v_station_id) > 64 THEN
        RAISE EXCEPTION 'station_id invalide : longueur % hors bornes (8..64)', char_length(v_station_id)
            USING ERRCODE = 'check_violation';
    END IF;
    IF char_length(v_app_version) < 1 OR char_length(v_app_version) > 32 THEN
        RAISE EXCEPTION 'app_version invalide : longueur % hors bornes (1..32)', char_length(v_app_version)
            USING ERRCODE = 'check_violation';
    END IF;
    IF v_os_version IS NOT NULL AND char_length(v_os_version) > 32 THEN
        RAISE EXCEPTION 'os_version invalide : longueur % hors bornes (0..32)', char_length(v_os_version)
            USING ERRCODE = 'check_violation';
    END IF;
    IF v_last_check NOT IN ('ok', 'feed-absent', 'html', 'unreachable') THEN
        RAISE EXCEPTION 'last_check invalide : « % » n''est pas un état connu', v_last_check
            USING ERRCODE = 'check_violation';
    END IF;
    IF v_last_check_version IS NOT NULL AND char_length(v_last_check_version) > 32 THEN
        RAISE EXCEPTION 'last_check_version invalide : longueur % hors bornes (0..32)', char_length(v_last_check_version)
            USING ERRCODE = 'check_violation';
    END IF;

    -- Une ligne par poste, et le battement REMPLACE : `seen_at` avance à chaque
    -- appel (c'est lui qui décide du silence dans le relevé), et l'historique
    -- n'est pas conservé — ce relevé dit l'état du parc AUJOURD'HUI, pas son
    -- passé.
    INSERT INTO public.station_versions (
        station_id, app_version, os_version, last_check, last_check_version, seen_at
    )
    VALUES (
        v_station_id, v_app_version, v_os_version, v_last_check, v_last_check_version,
        timezone('utc'::text, now())
    )
    ON CONFLICT (station_id) DO UPDATE SET
        app_version = excluded.app_version,
        os_version = excluded.os_version,
        last_check = excluded.last_check,
        last_check_version = excluded.last_check_version,
        seen_at = excluded.seen_at;
END;
$$;

COMMENT ON FUNCTION public.record_station_beat(TEXT, TEXT, TEXT, TEXT, TEXT) IS
    'Le battement d''un poste (§7 du canal) : le seul chemin d''écriture de station_versions, ouvert à `anon` et à lui seul. Le privilège UPDATE sur la table n''existe pour personne : c''est cette fonction qui remplace la ligne du poste.';

-- Supabase accorde EXECUTE à `anon` ET `public` par défaut sur une fonction
-- neuve : on retire les deux, puis on rend le geste au SEUL `anon` — c'est la
-- même discipline que les migrations de 2026-09 et 2026-10 ont posée dans
-- l'autre sens (retirer `anon` d'un RPC d'administration).
REVOKE ALL ON FUNCTION public.record_station_beat(TEXT, TEXT, TEXT, TEXT, TEXT) FROM public;
REVOKE ALL ON FUNCTION public.record_station_beat(TEXT, TEXT, TEXT, TEXT, TEXT) FROM anon;
GRANT EXECUTE ON FUNCTION public.record_station_beat(TEXT, TEXT, TEXT, TEXT, TEXT) TO anon;

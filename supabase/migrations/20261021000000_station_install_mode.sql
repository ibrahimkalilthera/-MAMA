-- ============================================================================
-- MAMA THERA Finance Suite — LA TRACE DES CONVERSIONS PORTABLE → INSTALLÉ
-- ============================================================================
-- Spécification : docs/CANAL_MISE_A_JOUR.md §7 (« Battement de version »).
--
-- ─── Pourquoi cette migration existe ───────────────────────────────────────
-- Depuis le 2026-10-16, un poste PORTABLE n'est plus condamné à rester en
-- arrière : il télécharge l'installeur annoncé, l'exécute en silencieux et
-- devient un poste INSTALLÉ, qui se met à jour tout seul ensuite (voir
-- `electron/updater-policy.cjs`, `PORTABLE_INSTALL_ARGS`). Le geste est décidé,
-- testé, justifié — mais RIEN ne disait qu'il avait eu lieu. Le relevé du parc
-- (§7) portait la version et l'état du dernier contrôle, jamais la FORME du
-- poste : une école dont le poste restait portable était indiscernable d'une
-- école dont le poste s'était converti, et « le parc s'est converti » serait
-- resté une espérance — exactement ce que la section 7 a été écrite pour
-- supprimer. C'est la même leçon que la section 6 : un fait qui n'est pas relevé
-- se prouve poste par poste, c'est-à-dire ne se prouve pas.
--
-- ─── Ce que la conversion EST, et ce qu'elle n'est pas ─────────────────────
-- Deux faits DISTINCTS, et ils sont rangés séparément :
--   • `install_mode` — ce que le poste DIT de lui-même à son dernier battement :
--     `portable` ou `installed`, ou NULL quand il ne le MESURE pas (une
--     application non empaquetée n'a pas de forme à déclarer) ;
--   • `converted_at` / `converted_to_version` — la PREMIÈRE conversion
--     portable → installé OBSERVÉE sur cette ligne, horodatée par la BASE et
--     jamais effacée : c'est la trace, et elle survit à une réinstallation comme
--     à un poste qui redémarrerait un jour sous sa forme portable (le fait a eu
--     lieu ; l'effacer serait réécrire l'histoire).
-- Le mode COURANT et la trace ne disent donc pas la même chose, et les confondre
-- — lire « install_mode = portable » comme « ne s'est jamais converti » —
-- perdrait précisément le cas qu'on veut constater.
--
-- ─── La transition est reconnue DANS la fonction, et pourquoi ──────────────
-- Le relevé ne conserve aucune histoire : une ligne par poste, remplacée à
-- chaque battement (migration du 2026-10-18). Une transition ne peut donc être
-- vue qu'au moment où elle arrive, en comparant la ligne EN PLACE à ce qui
-- arrive — le seul instant où l'ancienne et la nouvelle valeur existent
-- ensemble. C'est pourquoi la reconnaissance vit dans l'instruction d'écriture
-- elle-même (`ON CONFLICT … DO UPDATE`, dont les expressions lisent la ligne
-- d'AVANT), et non dans une lecture préalable : aucune course n'est possible
-- entre ce qui serait lu et ce qui serait écrit.
--
-- Le sens compte : `portable` → `installed`, et lui seul. L'inverse (relancer
-- l'exe portable sur une machine installée) n'est pas une conversion mais un
-- retour en arrière ; il ne produit aucune trace, et le mode du jour, lui, dit
-- la vérité.
--
-- ─── La signature change, donc l'ancienne fonction est RETIRÉE ─────────────
-- Postgres identifie une fonction par (nom, liste des types d'arguments) : un
-- `CREATE OR REPLACE` avec un argument de plus ne remplace RIEN, il AJOUTE une
-- surcharge. Deux surcharges rendraient ambigu l'appel d'un poste resté sur la
-- version en service (cinq arguments nommés, que les deux candidates acceptent
-- grâce à leurs défauts) — et un poste qui n'arrive plus à battre est la panne
-- silencieuse même que la section 7 existe pour supprimer. L'ancienne signature
-- est donc retirée explicitement, et la nouvelle porte
-- `p_install_mode TEXT DEFAULT NULL` pour que les postes déjà équipés
-- continuent de battre sans rien changer.
--
-- Les bornes et les GRANT de la version précédente sont repris À L'IDENTIQUE :
-- cette migration change la forme du battement, jamais qui peut battre.
-- ============================================================================

-- ─── Les trois colonnes, et leurs bornes NOMMÉES ───────────────────────────
-- L'énumération est contrainte ici comme `last_check` l'est : un mode libre
-- rendrait la répartition fausse sans que personne ne s'en aperçoive, et c'est
-- exactement la lecture qu'on vient chercher dans ce relevé.
ALTER TABLE public.station_versions
    ADD COLUMN IF NOT EXISTS install_mode TEXT;

ALTER TABLE public.station_versions
    ADD COLUMN IF NOT EXISTS converted_at TIMESTAMPTZ;

ALTER TABLE public.station_versions
    ADD COLUMN IF NOT EXISTS converted_to_version TEXT;

ALTER TABLE public.station_versions
    DROP CONSTRAINT IF EXISTS station_versions_install_mode_enum;
ALTER TABLE public.station_versions
    ADD CONSTRAINT station_versions_install_mode_enum
    CHECK (install_mode IS NULL OR install_mode IN ('portable', 'installed'));

-- La version à laquelle la conversion a été observée : bornée comme
-- `app_version`, parce que c'est la même chose vue au moment du basculement.
ALTER TABLE public.station_versions
    DROP CONSTRAINT IF EXISTS station_versions_converted_to_version_bounds;
ALTER TABLE public.station_versions
    ADD CONSTRAINT station_versions_converted_to_version_bounds
    CHECK (converted_to_version IS NULL OR char_length(converted_to_version) BETWEEN 1 AND 32);

COMMENT ON COLUMN public.station_versions.install_mode IS
    'Forme du poste telle qu''il la DÉCLARE (portable / installed). NULL = pas mesurée (application non empaquetée, ou poste pas encore à jour de ce champ) — jamais devinée.';
COMMENT ON COLUMN public.station_versions.converted_at IS
    'Horodatage (posé par la BASE) de la PREMIÈRE conversion portable → installé observée sur ce poste. Jamais effacé : la colonne dit un fait, pas l''état du jour.';
COMMENT ON COLUMN public.station_versions.converted_to_version IS
    'La version que le poste exécutait au battement qui a porté la conversion (celle du passage, pas la version du jour).';

-- ─── Le geste, remplacé — et l'ancienne signature retirée ──────────────────
DROP FUNCTION IF EXISTS public.record_station_beat(TEXT, TEXT, TEXT, TEXT, TEXT);

CREATE OR REPLACE FUNCTION public.record_station_beat(
    p_station_id TEXT,
    p_app_version TEXT,
    p_os_version TEXT DEFAULT NULL,
    p_last_check TEXT DEFAULT 'ok',
    p_last_check_version TEXT DEFAULT NULL,
    p_install_mode TEXT DEFAULT NULL
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
    v_install_mode TEXT := nullif(btrim(coalesce(p_install_mode, '')), '');
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
    -- Une forme inventée est refusée par la base, comme les quatre états du
    -- contrôle : `NULL` veut dire « pas mesurée », jamais « autre chose ».
    IF v_install_mode IS NOT NULL AND v_install_mode NOT IN ('portable', 'installed') THEN
        RAISE EXCEPTION 'install_mode invalide : « % » n''est pas une forme connue (portable, installed)', v_install_mode
            USING ERRCODE = 'check_violation';
    END IF;

    -- Une ligne par poste, et le battement REMPLACE : `seen_at` avance à chaque
    -- appel (c'est lui qui décide du silence dans le relevé), et l'historique
    -- n'est pas conservé — sauf la trace de la conversion ci-dessous, qui est le
    -- seul fait de ce relevé qui parle du PASSÉ plutôt que du jour.
    INSERT INTO public.station_versions (
        station_id, app_version, os_version, last_check, last_check_version,
        install_mode, seen_at
    )
    VALUES (
        v_station_id, v_app_version, v_os_version, v_last_check, v_last_check_version,
        v_install_mode, timezone('utc'::text, now())
    )
    ON CONFLICT (station_id) DO UPDATE SET
        app_version = excluded.app_version,
        os_version = excluded.os_version,
        last_check = excluded.last_check,
        last_check_version = excluded.last_check_version,
        -- Un battement qui ne MESURE pas la forme n'efface pas celle mesurée
        -- avant : un poste ne cesse pas d'avoir une forme parce qu'il s'est tu
        -- sur elle (poste resté sur une version qui ne l'envoie pas encore).
        install_mode = COALESCE(excluded.install_mode, station_versions.install_mode),
        -- La PREMIÈRE conversion observée, et elle seule : `COALESCE` garde la
        -- date déjà inscrite, donc une seconde lecture de la même transition
        -- (et la suivante, si le poste repassait par le portable) ne la déplace
        -- pas. `excluded.seen_at` est l'horodatage du battement qui a porté la
        -- transition — posé par la base, jamais par l'horloge du poste.
        converted_at = CASE
            WHEN station_versions.install_mode = 'portable'
             AND excluded.install_mode = 'installed'
                THEN COALESCE(station_versions.converted_at, excluded.seen_at)
            ELSE station_versions.converted_at
        END,
        converted_to_version = CASE
            WHEN station_versions.install_mode = 'portable'
             AND excluded.install_mode = 'installed'
                THEN COALESCE(station_versions.converted_to_version, excluded.app_version)
            ELSE station_versions.converted_to_version
        END,
        seen_at = excluded.seen_at;
END;
$$;

COMMENT ON FUNCTION public.record_station_beat(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT) IS
    'Le battement d''un poste (§7 du canal) : le seul chemin d''écriture de station_versions, ouvert à `anon` et à lui seul. Le privilège UPDATE sur la table n''existe pour personne : c''est cette fonction qui remplace la ligne du poste — et qui y inscrit la première conversion portable → installé observée.';

-- Supabase accorde EXECUTE à `anon` ET `public` par défaut sur une fonction
-- neuve : on retire les deux, puis on rend le geste au SEUL `anon`. Le `DROP`
-- ci-dessus a emporté le GRANT de la version précédente avec la fonction, donc
-- ces trois instructions sont la seule raison pour laquelle le parc continue de
-- pouvoir battre : les tenir ici, c'est tenir la seule écriture anonyme de
-- l'application.
REVOKE ALL ON FUNCTION public.record_station_beat(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT) FROM public;
REVOKE ALL ON FUNCTION public.record_station_beat(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT) FROM anon;
GRANT EXECUTE ON FUNCTION public.record_station_beat(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT) TO anon;

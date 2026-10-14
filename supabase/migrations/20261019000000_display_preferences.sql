-- ============================================================================
-- MAMA THERA Finance Suite — Les préférences d'affichage voyagent en base
-- ============================================================================
-- Le thème, la densité des tableaux, le verre des icônes et la langue vivaient
-- dans le `localStorage` du poste, et NULLE PART ailleurs. Conséquence mesurée
-- le 2026-10-14 : un poste réinstallé — Windows refait, navigateur vidé, machine
-- neuve — repartait aux défauts, alors que la sauvegarde de la base, elle, se
-- restaure. Les quatre réglages deviennent donc des LIGNES d'`app_settings` :
-- cette table est déjà sauvée et déjà restaurée (`scripts/lib/db-tables.mjs`,
-- `npm run backup:db` / `restore:db`), donc rien de neuf n'a à voyager — les
-- préférences voyagent parce qu'elles sont des données comme les autres.
--
-- POURQUOI DES POLITIQUES EN PLUS, jamais une politique élargie :
-- `app_settings_write` / `app_settings_update` réservent l'écriture à
-- `is_admin()`, et c'est juste — `app_settings` est le magasin des réglages
-- d'ÉQUIPE. Élargir CES politiques ouvrirait la table entière : n'importe quel
-- compte écrirait n'importe quelle clé, y compris celles qui n'existent pas
-- encore. En RLS, deux politiques permissives de même (table, commande)
-- s'ADDITIONNENT : les deux politiques ci-dessous n'ouvrent donc QUE les quatre
-- clés de préférences, et l'administration reste seule au-dessus.
--
-- QUI écrit, et pourquoi ce n'est pas un droit d'administration : ces quatre
-- réglages sont ceux d'un ÉCRAN (densité pour une tablette de classe, verre pour
-- un vidéoprojecteur, langue pour le poste du guichet), pas d'une décision
-- comptable. La personne devant le poste est celle qui sait. Elle peut donc les
-- enregistrer, avec ou sans le rôle d'administration — et le journal d'audit
-- garde qui l'a fait.
--
-- POURQUOI AUCUN ENSEMENCEMENT : les quatre clés n'existent qu'à partir du
-- moment où l'école a réellement changé quelque chose. Ensemencer des valeurs
-- recopierait en SQL les constantes du code (`DEFAULT_THEME`, `DEFAULT_DENSITY`,
-- `DEFAULT_ICON_GLASS`, « fr ») — deux vérités à tenir d'accord, ce que ce dépôt
-- refuse partout ailleurs. Une clé ABSENTE veut donc dire « personne n'a jamais
-- choisi », et le poste garde ses défauts compilés : c'est exactement l'état
-- d'une école qui n'a rien réglé.
--
-- CE QUE LA RESTAURATION EN FAIT, et le piège qu'elle évite : `updated_by` reste
-- NUL pour ces lignes. La colonne existe, mais `restorableRows` (une seule
-- écriture de la règle, `scripts/lib/db-tables.mjs`) écarte toute ligne dont le
-- compte n'existe pas dans la cible — car les empreintes de `auth.users` ne
-- voyagent pas. Nommer un compte ici rendrait donc les préférences NON
-- RESTAURABLES dans une cible fraîche, c'est-à-dire exactement le jour où on en
-- a besoin. L'attribution vit dans `audit_logs`, qui, lui, est restaurable.
-- ============================================================================

-- ─── 1. Les quatre clés : une forme tenue par la base, pas par la politesse ──
-- Une préférence est une CHAÎNE (« animated », « compact », « fr ») : la
-- contrainte le dit une fois pour toutes, et la lecture côté app peut alors
-- valider une valeur au lieu de deviner ce que le JSONB contenait.

ALTER TABLE public.app_settings
    DROP CONSTRAINT IF EXISTS app_settings_display_keys_check;

ALTER TABLE public.app_settings
    ADD CONSTRAINT app_settings_display_keys_check CHECK (
        key NOT IN ('display.theme', 'display.density', 'display.icon_glass', 'display.language')
        OR jsonb_typeof(value) = 'string'
    );

-- ─── 2. Les privilèges de table ──────────────────────────────────────────────
-- Les politiques ouvrent des LIGNES ; le privilège ouvre la TABLE. Les deux
-- doivent être d'accord (l'écriture d'un réglage passait déjà par une politique
-- d'administration : le privilège existait, il est ici écrit au lieu d'être
-- supposé).

GRANT SELECT, INSERT, UPDATE ON public.app_settings TO authenticated;

-- ─── 3. L'écriture des quatre clés, pour tout compte connecté ────────────────
-- Ces deux politiques n'ajoutent rien aux lignes que la table porte : elles
-- disent QUI peut écrire CES clés-là. Un `key` hors de la liste laisse la
-- demande aux politiques d'administration, qui refusent tout autre compte —
-- la clé est donc bornée deux fois : par le `WITH CHECK` et par le `CHECK` de
-- table ajouté plus haut.

DROP POLICY IF EXISTS "app_settings_display_insert" ON public.app_settings;
CREATE POLICY "app_settings_display_insert"
    ON public.app_settings
    FOR INSERT
    TO authenticated
    WITH CHECK (key IN ('display.theme', 'display.density', 'display.icon_glass', 'display.language'));

DROP POLICY IF EXISTS "app_settings_display_update" ON public.app_settings;
CREATE POLICY "app_settings_display_update"
    ON public.app_settings
    FOR UPDATE
    TO authenticated
    USING (key IN ('display.theme', 'display.density', 'display.icon_glass', 'display.language'))
    WITH CHECK (key IN ('display.theme', 'display.density', 'display.icon_glass', 'display.language'));

-- Lecture : rien à ajouter. `app_settings_read` ouvre déjà `SELECT` à tout
-- compte connecté, et c'est la même lecture qui sert au poste neuf — adopter la
-- préférence d'école demande de la LIRE, pas d'être administrateur.

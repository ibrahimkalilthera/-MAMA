-- ============================================================================
-- MAMA THERA Finance Suite — LE NOM DE L'ÉCOLE, écrit une fois pour tout le parc
-- ============================================================================
-- Demande du propriétaire (2026-10-16) : « Ajoute un réglage “nom de l'école”
-- (app_settings, écran, droits, RLS) et fais-le porter par les remontées du poste
-- à côté du nom de la machine. »
--
-- ─── Pourquoi une ligne d'`app_settings`, et pas un réglage d'écran ──────────
-- Le nom de l'école n'est PAS une préférence de poste : c'est un fait de
-- l'ÉTABLISSEMENT. La densité d'un tableau se règle devant une tablette de
-- classe, et chaque poste peut vouloir autre chose ; le nom de l'école, non — il
-- est le même partout, y compris sur une remontée qui arrive du poste d'une
-- autre salle. Il vit donc dans `app_settings`, la table que
-- `scripts/lib/db-tables.mjs` sauvegarde et que `npm run restore:db` restaure :
-- il voyage avec la sauvegarde de l'école parce qu'il est une donnée de l'école.
--
-- ─── Pourquoi AUCUNE politique nouvelle n'est ajoutée ───────────────────────
-- `app_settings_write` / `app_settings_update` réservent déjà l'écriture à
-- `public.is_admin()` (`20260902000005_team_inactivity_setting.sql`), et c'est
-- exactement le droit qu'un nom d'école demande : un fait d'établissement se
-- déclare à l'administration. La migration
-- `20261019000000_display_preferences.sql` a ouvert, elle, deux politiques
-- bornées aux quatre clés `display.` — celles-là sont des réglages d'ÉCRAN, la
-- personne devant le poste sait mieux que quiconque, et l'écart est assumé. Les
-- recopier ici aurait ouvert le nom de l'école à tout compte connecté, ce qui
-- n'est pas la décision : l'écran des Paramètres est déjà réservé à
-- l'administration (`SettingsView`), donc la base et l'écran disent la même
-- chose sans qu'une politique soit ajoutée. Ce fichier ne change QUE la FORME de
-- la valeur.
--
-- ─── La forme de la valeur, et pourquoi elle est contrainte ici ─────────────
-- Une CHAÎNE, de 2 à 120 caractères — les bornes du contrat de l'app
-- (`src/lib/schoolName.ts`, qui refuse en plus le séparateur des rapports de
-- poste). La contrainte est posée en base pour la même raison que les quatre
-- clés d'affichage : une écriture peut arriver par un autre chemin que l'écran
-- (un script, un `curl` avec un compte d'administration), et une valeur non
-- textuelle se lirait plus loin comme un nombre ou un objet au lieu d'un nom.
-- L'app est plus STRICTE que la base, jamais plus large : ce qu'elle accepte est
-- toujours accepté ici.
--
-- ─── Pourquoi la borne est écrite ÉCLATÉE, et non en `BETWEEN` ─────────────
-- La forme naturelle serait `char_length(value #>> '{}') BETWEEN 2 AND 120`.
-- Elle a été écrite, appliquée, puis MESURÉE : `npm run check:db-objects` l'a
-- signalée comme une dérive (« la base dit autre chose ») — non parce que la
-- règle différait, mais parce que le catalogue rend l'idiome éclaté avec son
-- opérande RÉPÉTÉ (`(char_length((value #>> '{}'::text[])) >= 2) AND (…) <= 120`),
-- et que la comparaison ne réduit QUE les bornes SIMPLES (littéral, nombre) : une
-- borne composée reste intacte, DÉLIBÉRÉMENT, pour qu'une vraie différence soit
-- signalée plutôt que blanchie (`tests/db-objects.test.ts` verrouille ce refus —
-- « une borne COMPOSÉE n'est pas blanchie »). Ici l'opérande contient `#>> '{}'`,
-- donc composé. Le fichier écrit donc la règle telle que le catalogue la rend :
-- c'est la MÊME règle, dans l'autre écriture, et le contrôle le vérifie sans
-- qu'aucune tolérance soit ajoutée au contrôle — ce qui aurait été une décision
-- sur l'équilibre du contrôle, pas sur le nom de l'école.
--
-- ─── Ce que la restauration en fait ────────────────────────────────────────
-- `updated_by` reste NUL quand l'app écrit cette ligne, même raison que les
-- préférences d'affichage : `restorableRows` (`scripts/lib/db-tables.mjs`) écarte
-- toute ligne dont le compte n'existe pas dans la cible, et les empreintes de
-- `auth.users` ne voyagent pas. Nommer un compte ici rendrait le nom de l'école
-- NON RESTAURABLE dans une cible fraîche — c'est-à-dire exactement le jour où on
-- en a besoin. Qui l'a changé vit dans `audit_logs`, qui, lui, se restaure.
--
-- ─── Ce que cette migration NE fait PAS, et c'est dit ──────────────────────
-- Aucun ensemencement : une école qui n'a jamais écrit son nom n'en a pas de
-- ligne, et l'app le dit (`null` = personne ne l'a déclaré) au lieu d'afficher
-- en dur un nom qui ne serait celui d'aucune école. Inventer un nom par défaut
-- recopierait dans le SQL une constante de l'application — deux vérités à tenir
-- d'accord, ce que ce dépôt refuse partout ailleurs.
-- ============================================================================

ALTER TABLE public.app_settings
    DROP CONSTRAINT IF EXISTS app_settings_school_name_check;

ALTER TABLE public.app_settings
    ADD CONSTRAINT app_settings_school_name_check CHECK (
        key <> 'school.name'
        OR (
            jsonb_typeof(value) = 'string'
            AND char_length(value #>> '{}') >= 2
            AND char_length(value #>> '{}') <= 120
        )
    );

COMMENT ON CONSTRAINT app_settings_school_name_check ON public.app_settings IS
    'Le nom de l''école (clé school.name) est une CHAÎNE de 2 à 120 caractères. Les bornes sont celles du contrat de l''app (src/lib/schoolName.ts) : une écriture qui passerait à côté de l''écran est refusée ici plutôt que de se lire plus loin comme autre chose qu''un nom.';

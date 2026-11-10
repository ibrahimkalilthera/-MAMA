-- Migration: le MONTANT d'un mois décidé par l'école, et l'ANNÉE publiée au parc.
--
-- ─── 1. `students.month_dues` — « à régler pour ce mois » n'est plus un calcul ─
--
-- Jusqu'ici, le montant qu'un mois réclamait était DÉRIVÉ : les frais annuels
-- nets de bourse, divisés par le nombre de mois de l'année scolaire
-- (`monthlyFee`, `src/lib/paymentInstallments.ts`). C'est une moyenne, pas une
-- décision : une école qui fixe 9 000 FCFA pour novembre, ou qui reconnaît un
-- arrangement pour une famille, ne pouvait pas le dire — le guichet affichait un
-- dixième de l'année, et le reçu s'appuyait dessus.
--
-- `month_dues` porte donc les montants que l'école a DÉCIDÉS, par mois :
--
--     { "2026-11": 9000, "2026-12": 12000 }
--
-- Le mois est la clé `YYYY-MM` — la même forme que `payments.months`, donc un
-- montant ne peut pas glisser d'une année scolaire à l'autre (septembre 2026 et
-- septembre 2027 sont deux clés). Un mois ABSENT n'est pas une erreur : il
-- retombe sur la part des frais annuels, exactement le comportement d'avant.
-- C'est ce qui rend la colonne compatible avec les fiches déjà en base : `{}`
-- veut dire « aucune décision », pas « ce mois ne coûte rien ».
--
-- Le montant vit sur l'ÉLÈVE et non sur un reçu : la décision vaut pour tous les
-- postes (elle se lit avec la fiche), elle survit à la réimpression d'un reçu, et
-- le reste dû (`installmentTarget`) comme la liste des versements partiels la
-- lisent au même endroit (`students.month_dues`).
--
-- Écriture : la politique `students UPDATE` existante (tout compte connecté,
-- comme les autres champs de la fiche) ; l'écran est plus ÉTROIT et le déclare
-- (`src/app/appModalsProps.ts`, `canEditMonthDue` = `is_payment_month_editor()`,
-- admin/dev/économe). Aucune politique nouvelle n'est donc créée ici.
--
-- Le CHECK exige un OBJET JSON : un tableau, un nombre ou une chaîne seraient
-- relus comme « aucune décision » par le code, donc écrits pour rien — mieux
-- vaut un refus de la base.
--
-- ─── 2. `academic_years.selected_at` — l'année décidée pour TOUS les postes ───
--
-- Chaque poste garde son année de travail dans son `localStorage`, et c'est
-- voulu : un caissier peut consulter une archive sans changer l'année des
-- autres. Mais le geste inverse manquait : quand l'ADMIN ou le DEV change
-- l'année scolaire, l'école entière doit suivre — c'est le même travail, la même
-- rentrée, les mêmes frais.
--
-- `selected_at` est l'instant de cette décision PARTAGÉE. Il n'est écrit QUE par
-- le geste explicite (`publishWorkingYear`, appelé par le sélecteur d'année d'un
-- admin/dev), jamais par l'entretien automatique du 1er septembre
-- (`keepAcademicYearCurrent`) : une maintenance ne décide rien pour le parc.
--
-- NULL = « aucune décision publiée » : les postes retombent sur les règles
-- d'avant (choix local de l'année en cours, calendrier, déclaration de la base),
-- donc les stations existantes ne bougent pas tant qu'un administrateur n'a pas
-- publié. `pickWorkingYear` ne suit une publication que si elle est PLUS RÉCENTE
-- que le choix du poste : la dernière décision gagne, et un poste qui choisit une
-- archive après la publication garde son choix jusqu'à la publication suivante.

ALTER TABLE public.students
    ADD COLUMN IF NOT EXISTS month_dues JSONB NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE public.students
    DROP CONSTRAINT IF EXISTS students_month_dues_object_check;

ALTER TABLE public.students
    ADD CONSTRAINT students_month_dues_object_check
    CHECK (jsonb_typeof(month_dues) = 'object');

COMMENT ON COLUMN public.students.month_dues IS
    'Montants de mois DÉCIDÉS par l''école ({ "YYYY-MM": montant }) ; un mois absent retombe sur la part des frais annuels (voir src/lib/paymentInstallments.ts).';

ALTER TABLE public.academic_years
    ADD COLUMN IF NOT EXISTS selected_at TIMESTAMPTZ;

COMMENT ON COLUMN public.academic_years.selected_at IS
    'Instant où un admin/dev a publié cette année comme année de travail de TOUS les postes ; NULL = aucune publication (les postes suivent leurs règles locales).';

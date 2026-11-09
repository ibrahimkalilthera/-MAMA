-- Migration: la PLAGE DE SCOLARITÉ d'une année — son premier et son dernier mois.
--
-- L'application demandait à chaque famille les frais de DOUZE mois, de septembre
-- à août, pour toutes les écoles. Ce n'est pas ce que fait une école malienne :
-- l'année va le plus souvent de septembre à juin, parfois d'octobre à juin (la
-- rentrée glisse), parfois jusqu'en juillet (les compositions se terminent
-- tard). Une famille dont l'année s'arrête en juin recevait donc un reçu qui
-- réclamait encore « juillet, août » — et le rapprochement comptait deux mois
-- qui n'existent pas dans son année.
--
-- `start_month` / `end_month` sont ces bornes, en numéro de mois CIVIL (1 =
-- janvier … 12 = décembre) : c'est la même numérotation que les `YYYY-MM` des
-- paiements, donc la plage se déroule sans table de correspondance. Elles
-- appartiennent à l'ANNÉE (une ligne), pas à l'école entière : un
-- établissement peut ouvrir 2026-2027 en octobre et 2027-2028 en septembre.
--
-- Le défaut est septembre → juin, appliqué aux lignes DÉJÀ présentes : c'est la
-- rentrée la plus courante, et une année qui va jusqu'en août doit désormais le
-- DIRE (`end_month = 8`) au lieu de l'obtenir parce que le code ne savait rien
-- d'autre. Le code porte le même défaut (`DEFAULT_SCHOOL_MONTHS`,
-- `src/lib/paymentMonths.ts`), et le test de schéma compare les deux — une base
-- et un code qui divergeraient d'un mois feraient réclamer à une famille des
-- frais que l'école n'a jamais fixés.
--
-- Le CHECK refuse les mois hors 1..12 : une borne à 0 ou 13 déroulerait une
-- plage que `academicYearMonths` ne peut pas nommer, donc un reçu muet sur ses
-- mois. Il n'interdit PAS `end_month` antérieur à `start_month` : la plage
-- traverse le passage décembre → janvier (octobre → juin), et une année qui se
-- terminerait « avant » son début dans le même cycle n'a pas de sens ici, mais
-- la contrainte inverse serait, elle, fausse pour toutes les années normales.
--
-- Aucune politique RLS à ajouter : celles d'`academic_years` sont au niveau
-- TABLE (`is_admin()` pour l'écriture, lecture pour tout compte connecté), et
-- deux colonnes de plus ne changent ni qui lit, ni qui écrit.

ALTER TABLE public.academic_years
    ADD COLUMN IF NOT EXISTS start_month SMALLINT NOT NULL DEFAULT 9;

ALTER TABLE public.academic_years
    ADD COLUMN IF NOT EXISTS end_month SMALLINT NOT NULL DEFAULT 6;

ALTER TABLE public.academic_years
    DROP CONSTRAINT IF EXISTS academic_years_start_month_check;

ALTER TABLE public.academic_years
    ADD CONSTRAINT academic_years_start_month_check
    CHECK (start_month BETWEEN 1 AND 12);

ALTER TABLE public.academic_years
    DROP CONSTRAINT IF EXISTS academic_years_end_month_check;

ALTER TABLE public.academic_years
    ADD CONSTRAINT academic_years_end_month_check
    CHECK (end_month BETWEEN 1 AND 12);

COMMENT ON COLUMN public.academic_years.start_month IS
    'Premier mois de scolarité de l''année, en numéro civil (1 = janvier) ; 9 = septembre par défaut.';

COMMENT ON COLUMN public.academic_years.end_month IS
    'Dernier mois de scolarité de l''année, en numéro civil (1 = janvier) ; 6 = juin par défaut.';

-- Migration: le refus d'une écriture anon reste un refus RLS (401), pas un 400.
--
-- ─── Le défaut, mesuré en CI le 2026-11-08 ───────────────────────────────────
-- `20261108000000_vendor_expense_paid_consistency.sql` a posé la règle
-- statut/montant dans un déclencheur BEFORE. PostgreSQL exécute, dans cet ordre,
-- pour un INSERT :
--
--     1. les déclencheurs BEFORE ROW,
--     2. la vérification RLS (`WITH CHECK`),
--     3. les contraintes (NOT NULL, CHECK, clés étrangères…),
--     4. les déclencheurs AFTER.
--
-- Un `RAISE` en (1) passe donc AVANT le refus de la politique. Sur la pile de
-- recette, l'insert `{}` d'anon sur `vendor_expenses` est revenu en **400**
-- (le message du déclencheur, `payment_status` nul) au lieu du **401** attendu —
-- run 42469503697 : « ✖ insert anon refusé sur vendor_expenses (400) ».
--
-- `scripts/verify-anon-rls.mjs` a raison de refuser ce 400 : sur un payload
-- `{}`, un 400 signifie qu'une politique a laissé la ligne franchir (2), et que
-- ce sont les contraintes (3) qui l'ont arrêtée. Un refus obtenu au mauvais
-- étage ne prouve pas que l'étage d'autorisation tient.
--
-- ─── La correction : normaliser en BEFORE, refuser en AFTER ─────────────────
--   • `normalize_vendor_expense_paid` (BEFORE) ne REFUSE plus rien : elle range
--     `amount_paid` selon le statut déclaré (`paid` → dû, `unpaid` → 0) et met
--     à zéro les NULL. C'est le seul travail qui exige un BEFORE (modifier la
--     ligne), et il ne produit jamais d'erreur, donc jamais de 400 avant RLS.
--   • `validate_vendor_expense_paid` (AFTER) porte les trois REFUS : statut
--     inconnu, montant négatif, partiel hors bornes. Exécuté en (4), il ne
--     s'exécute qu'APRÈS le refus RLS (2) et les contraintes (3) : une écriture
--     non autorisée reste un 401, et une écriture autorisée mal formée lève
--     toujours `23514`, avec la ligne nommée — le comportement visible pour
--     l'application ne change pas.
--
-- ─── Ce que la normalisation ne fait PLUS ───────────────────────────────────
-- Elle ne remplace plus `amount` NULL par 0. `amount` est `NOT NULL` : le
-- coercement silencieux aurait accepté une ligne que la contrainte refuse, donc
-- masqué une corruption de saisie au lieu de la nommer. Un partiel hors bornes
-- n'est pas non plus corrigé : il est refusé par l'AFTER, comme avant.
--
-- ─── Aucun changement de sens ───────────────────────────────────────────────
-- La règle, la direction (le statut est le fait, le montant s'y range), l'ordre
-- alphabétique avec `protect_vendor_expense_financial_fields` (20260828000000,
-- qui compare les valeurs BRUTES avant normalisation) et le comportement des
-- écritures légitimes sont inchangés. Le rattrapage de l'histoire est déjà fait
-- par `20261108000000` ; ce fichier ne réécrit aucune ligne — il ne déplace que
-- l'étage des refus.
--
-- Idempotent : `CREATE OR REPLACE`, `DROP TRIGGER IF EXISTS`, rejouable.

-- ─── 1) BEFORE : ranger, sans jamais refuser ────────────────────────────────
CREATE OR REPLACE FUNCTION public.normalize_vendor_expense_paid()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
    -- `payment_status` NULL ou inconnu : ce n'est pas ici qu'on le juge (voir
    -- l'AFTER). Un BEFORE qui lève passe avant la politique RLS et transformerait
    -- un refus d'autorisation en erreur de forme.
    NEW.amount_paid := coalesce(NEW.amount_paid, 0);

    IF NEW.payment_status = 'paid' THEN
        -- Remplacé, pas corrigé après coup : la valeur envoyée ne survit pas.
        NEW.amount_paid := NEW.amount;
    ELSIF NEW.payment_status = 'unpaid' THEN
        NEW.amount_paid := 0;
    END IF;

    -- `partial` : la valeur est CONSERVÉE telle quelle, y compris hors bornes ;
    -- c'est l'AFTER qui la refuse. La corriger ici inventerait une saisie.
    RETURN NEW;
END;
$$;

-- ─── 2) AFTER : les trois refus, derrière l'autorisation ────────────────────
CREATE OR REPLACE FUNCTION public.validate_vendor_expense_paid()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
    -- `payment_status` est `NOT NULL` : la contrainte (étage 3) a déjà refusé un
    -- statut nul avant d'arriver ici. Seul un statut NON NUL mais inconnu reste
    -- à juger.
    IF NEW.payment_status NOT IN ('unpaid', 'partial', 'paid') THEN
        RAISE EXCEPTION 'Statut de paiement inconnu sur la dépense % : % (attendu : unpaid, partial, paid)',
            NEW.id, NEW.payment_status
            USING ERRCODE = '23514';
    END IF;

    IF NEW.amount < 0 OR NEW.amount_paid < 0 THEN
        RAISE EXCEPTION 'Montant négatif interdit sur la dépense % : dû %, payé %',
            NEW.id, NEW.amount, NEW.amount_paid
            USING ERRCODE = '23514';
    END IF;

    IF NEW.payment_status = 'partial'
       AND (NEW.amount_paid <= 0 OR NEW.amount_paid >= NEW.amount) THEN
        RAISE EXCEPTION 'Sur la dépense %, un paiement partiel doit être strictement entre 0 et % FCFA (reçu : %)',
            NEW.id, NEW.amount, NEW.amount_paid
            USING ERRCODE = '23514';
    END IF;

    -- Un AFTER sur des lignes n'a rien à rendre : la valeur est ignorée, et NULL
    -- le dit (PostgreSQL l'exige pour une orientation ROW).
    RETURN NULL;
END;
$$;

-- ─── 3) Les déclencheurs, recréés au bon étage ──────────────────────────────
DROP TRIGGER IF EXISTS vendor_expense_paid_consistency ON public.vendor_expenses;
CREATE TRIGGER vendor_expense_paid_consistency
    BEFORE INSERT OR UPDATE ON public.vendor_expenses
    FOR EACH ROW
    EXECUTE FUNCTION public.normalize_vendor_expense_paid();

DROP TRIGGER IF EXISTS vendor_expense_paid_validation ON public.vendor_expenses;
CREATE TRIGGER vendor_expense_paid_validation
    AFTER INSERT OR UPDATE ON public.vendor_expenses
    FOR EACH ROW
    EXECUTE FUNCTION public.validate_vendor_expense_paid();

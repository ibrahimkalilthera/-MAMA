-- Migration: le montant payé d'une dépense fournisseur ne contredit plus son statut.
--
-- ─── Le défaut ──────────────────────────────────────────────────────────────
-- `vendor_expenses` porte DEUX copies du même fait : `payment_status` (« payé »,
-- « partiel », « impayé ») et `amount_paid` (le montant). Les quatre calculs
-- d'argent de l'application les lisent ensemble — `src/app/useDashboard.ts`
-- (`totalExpenses`, `expensesThisMonth`), `src/components/ExpensesView.tsx`,
-- `src/app/useYearOps.ts`, `src/lib/pdfExpensesReport.ts` :
--
--     status === 'paid'    ? amount
--     status === 'partial' ? amount_paid
--                         : 0
--
-- et rien, en base, ne les empêchait de se contredire. Un `paid` à 0 FCFA, un
-- `partial` à 500 000 sur une dette de 100 000, un `unpaid` qui porte un montant,
-- ou un montant négatif : la dépense de l'école est annoncée fausse, et aucun
-- contrôle ne la compare à quoi que ce soit (contrairement au registre des reçus,
-- qui a son `check:payment-ledger`).
--
-- La règle EXISTAIT déjà, mais seulement dans l'écran : `useExpenses.ts` écrit
-- `status === 'paid' ? amount : status === 'unpaid' ? 0 : amountPaid`. Toute
-- autre écriture la contournait — le rejeu hors ligne
-- (`src/lib/offlineReplay.ts`, branche `addVendorExpense` / `updateVendorExpense`)
-- envoie le nombre brut, et un client direct encore davantage. Ce fichier ne
-- change donc pas la convention : il la rend autoritaire, là où elle ne peut plus
-- être sautée.
--
-- ─── La direction retenue : le statut est le fait, le montant en découle ────
-- C'est l'ordre de l'interface (le champ « montant payé » n'apparaît qu'en
-- « partiel ») et celui du formulaire. Donc :
--
--   • `paid`   → `amount_paid` est REMPLACÉ par `amount` (écriture neutralisée) ;
--   • `unpaid` → `amount_paid` est REMPLACÉ par 0 ;
--   • `partial` → le nombre est une VRAIE saisie : il est VALIDÉ (strictement
--     entre 0 et `amount`), jamais inventé. Un partiel hors bornes est refusé,
--     pas corrigé en silence — c'est le seul cas où l'opérateur doit trancher.
--
-- L'inverse (dériver le statut du nombre) casserait le chemin nominal : à
-- l'insertion d'un `paid`, le champ montant est masqué et vaut 0 ; le déclarer
-- « impayé » contredirait la case cochée. Le statut reste donc la déclaration, et
-- c'est le montant qui s'y range.
--
-- ─── L'ordre des déclencheurs, et pourquoi il compte ────────────────────────
-- `protect_vendor_expense_financial_fields` (20260828000000) refuse à un
-- non-admin tout changement de `vendor_name` ou `amount`. PostgreSQL exécute les
-- déclencheurs BEFORE de même événement dans l'ordre ALPHABÉTIQUE de leur nom :
-- `protect_…` passe donc AVANT `vendor_expense_paid_consistency`, et le garde
-- admin compare les valeurs BRUTES envoyées par le client. Une normalisation ne
-- peut pas servir à masquer un changement de montant — l'ordre est une garantie,
-- pas un hasard, et le renommer un jour le changerait.
--
-- ─── Ce que ce fichier ne fait pas ──────────────────────────────────────────
--   • Il ne vérifie pas les DROITS : c'est le rôle du déclencheur ci-dessus et
--     des politiques. Ici on ne juge qu'une FORME.
--   • Il n'est pas `SECURITY DEFINER` : il ne lit ni n'écrit aucune table, donc
--     il n'a aucun privilège à emprunter (les déclencheurs du solde, eux, lisent
--     `payments` et doivent l'emprunter).
--   • Il ne répare pas les lignes à montant NÉGATIF : un dû négatif est une
--     saisie corrompue, pas une incohérence statut/montant — la réécrire
--     inventerait une dette. Ces lignes sont laissées telles quelles et
--     échoueront bruyamment à la première écriture qui les touche, avec leur id.
--
-- Idempotent : `CREATE OR REPLACE`, `DROP TRIGGER IF EXISTS`, et le rattrapage
-- ne touche que les lignes qui divergent vraiment.

-- ─── 1) La règle, en un seul endroit ────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.normalize_vendor_expense_paid()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
    IF NEW.payment_status IS NULL
       OR NEW.payment_status NOT IN ('unpaid', 'partial', 'paid') THEN
        RAISE EXCEPTION 'Statut de paiement inconnu sur la dépense % : % (attendu : unpaid, partial, paid)',
            NEW.id, NEW.payment_status
            USING ERRCODE = '23514';
    END IF;

    NEW.amount      := coalesce(NEW.amount, 0);
    NEW.amount_paid := coalesce(NEW.amount_paid, 0);

    IF NEW.amount < 0 OR NEW.amount_paid < 0 THEN
        RAISE EXCEPTION 'Montant négatif interdit sur la dépense % : dû %, payé %',
            NEW.id, NEW.amount, NEW.amount_paid
            USING ERRCODE = '23514';
    END IF;

    IF NEW.payment_status = 'paid' THEN
        -- Remplacé, pas corrigé après coup : la valeur envoyée ne survit pas.
        NEW.amount_paid := NEW.amount;
    ELSIF NEW.payment_status = 'unpaid' THEN
        NEW.amount_paid := 0;
    ELSIF NEW.amount_paid <= 0 OR NEW.amount_paid >= NEW.amount THEN
        RAISE EXCEPTION 'Sur la dépense %, un paiement partiel doit être strictement entre 0 et % FCFA (reçu : %)',
            NEW.id, NEW.amount, NEW.amount_paid
            USING ERRCODE = '23514';
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS vendor_expense_paid_consistency ON public.vendor_expenses;
CREATE TRIGGER vendor_expense_paid_consistency
    BEFORE INSERT OR UPDATE ON public.vendor_expenses
    FOR EACH ROW
    EXECUTE FUNCTION public.normalize_vendor_expense_paid();

-- ─── 2) Le rattrapage des lignes déjà en base ───────────────────────────────
-- Il passe APRÈS la création du déclencheur, volontairement : les valeurs
-- écrites ici traversent la même règle que les écritures futures — une seconde
-- convention de réparation finirait par diverger de la première.
--
-- Il est borné aux lignes qui divergent (`WHERE`) : rejouer le fichier ne
-- réécrit rien, et les lignes déjà justes ne sont pas touchées. Le statut déclaré
-- (`paid` / `unpaid`) est RESPECTÉ — c'est le montant qui s'y range ; seul un
-- `partial` hors bornes est reclassé d'après son nombre, puisque c'est la seule
-- lecture possible d'un état qui n'a pas de sens.
--
-- `amount >= 0` : une dette négative est une corruption de saisie, pas une
-- incohérence statut/montant (voir l'en-tête) — on ne la réécrit pas.
UPDATE public.vendor_expenses v
   SET payment_status = CASE
           WHEN v.payment_status IN ('paid', 'unpaid') THEN v.payment_status
           WHEN coalesce(v.amount_paid, 0) <= 0 THEN 'unpaid'
           WHEN coalesce(v.amount_paid, 0) >= v.amount THEN 'paid'
           ELSE 'partial'
       END,
       amount_paid = CASE
           WHEN v.payment_status = 'paid' THEN v.amount
           WHEN v.payment_status = 'unpaid' THEN 0
           ELSE least(greatest(coalesce(v.amount_paid, 0), 0), greatest(v.amount, 0))
       END
 WHERE v.amount >= 0
   AND (
        v.payment_status IS NULL
     OR v.payment_status NOT IN ('unpaid', 'partial', 'paid')
     OR (v.payment_status = 'paid'   AND v.amount_paid IS DISTINCT FROM v.amount)
     OR (v.payment_status = 'unpaid' AND coalesce(v.amount_paid, 0) <> 0)
     OR (v.payment_status = 'partial' AND (coalesce(v.amount_paid, 0) <= 0 OR v.amount_paid >= v.amount))
   );

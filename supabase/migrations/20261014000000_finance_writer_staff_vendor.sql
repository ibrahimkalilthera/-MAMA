-- Migration: l'économe (Accountant) peut AJOUTER un membre du personnel et une
--            dépense fournisseur — « il a accès à tout sauf les paramètres du
--            système » (propriétaire, 2026-10-13).
--
-- ─── Le défaut, mesuré le 2026-10-13 sur la base de l'école ─────────────────
-- Sur le poste connecté `econome` (aggeediarra@mamathera.org), deux écrans
-- n'offraient AUCUNE action, et deux autres l'offraient pour être refusés :
--
--   • « Pai/Salaires » → Répertoire du personnel : « Ajouter un employé »,
--     « Ajouter un membre de l'administration », « Ajouter un membre T et P »
--     n'apparaissaient pas — `canManageStaff` ne citait que `is_finance_admin()`.
--     Mesuré en base : insertion `staff` en `econome` → 42501 :
--       [INSERT] « Admin can insert staff »        CHECK is_admin()
--       [INSERT] « Finance admins insert staff »   CHECK is_finance_admin()
--
--   • « Dépenses » → Dépenses générales : l'icône ✚ « Ajouter une dépense »
--     n'apparaissait pas non plus (la porte de l'écran citait le même
--     `isPromoter || isGeneralManager`). Là, la base ACCEPTAIT déjà l'économe
--     (`Authenticated insert expenses` → insertion mesurée : 1) : c'est
--     l'INTERFACE qui fermait, pas la policy. Ces deux portes passent par la
--     droit nommé ci-dessous, qui dit qui écrit sans dépendre d'un booléen
--     d'écran.
--
--   • « Dépenses » → Fournisseurs & Services : insertion `vendor_expenses` en
--     `econome` ET en `general_manager` → 42501. La seule policy d'insertion en
--     base est encore « Promoter insert vendor_expenses » CHECK is_admin(),
--     c'est-à-dire la version d'AVANT `20260906000002_vendor_expense_gm_policies.sql`
--     — laquelle n'a jamais été appliquée ici : le Gestionnaire Principal voit
--     le bouton « Ajouter une dépense fournisseur » depuis son poste et la base
--     refuse chacune de ses écritures. Ce n'est pas la demande, c'est le même
--     défaut dans la même table : le corriger est le seul moyen de nommer la
--     règle d'écriture des dépenses fournisseur une fois pour tout le monde.
--
-- ─── La décision ────────────────────────────────────────────────────────────
-- Un droit NOMMÉ, `public.is_finance_writer()` = `is_finance_admin()`
-- (admin, dev, general_manager) **plus `econome`** — la même forme que
-- `public.is_payroll_writer()` (20261005000000). Les policies d'ÉCRITURE du
-- personnel et d'INSERTION des dépenses fournisseur passent par lui ; l'écran
-- lit la même liste (`src/lib/financeRights.ts`), donc un rôle ajouté d'un seul
-- côté fait rougir `tests/finance-rights.test.ts` au lieu de rouvrir une action
-- que la base refuse (42501) ou d'en cacher une qu'elle accepte.
--
-- CE QUI NE BOUGE PAS, et pourquoi :
--   • la SUPPRESSION d'un membre du personnel reste `is_finance_admin()` —
--     recruter et licencier ne sont pas le même droit. L'économe enregistre le
--     personnel et la paie ; il ne supprime ni l'un ni l'autre.
--   • la SUPPRESSION d'une dépense (générale ou fournisseur) reste `is_admin()`
--     (`Admin can delete expenses`, `Promoter delete vendor_expenses`) : mesuré,
--     l'économe y reçoit 0 ligne touchée. L'écran ne lui montre donc pas de
--     corbeille (`canDelete`, `src/lib/deleteRights.ts`).
--   • les policies d'écriture de `expenses` sont laissées INTACTES : elles
--     acceptent déjà l'économe (et tout compte authentifié — la saisie
--     quotidienne des dépenses fait partie du rôle `staff`, décision de
--     20260902000000). Resserrer ici retirerait un droit que des comptes
--     exercent déjà : cette migration ne fait qu'OUVRIR ce qui est fermé.
--   • la modification d'une dépense fournisseur existante : la policy large et le
--     trigger `protect_vendor_expense_financial_fields` gardent `vendor_name` et
--     `amount` au promoteur (20260828000000) — inchangé.

-- ─── Helper: qui ÉCRIT le personnel et les dépenses fournisseur ─────────────
CREATE OR REPLACE FUNCTION public.is_finance_writer()
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_profiles
    WHERE id = auth.uid() AND role IN ('admin', 'dev', 'general_manager', 'econome')
  );
$$;

-- ─── staff : insertion et correction ouvertes à l'économe ────────────────────
-- Deux noms hérités se succèdent sur cette table (« Admin can … » puis
-- « Finance admins … ») : les deux partent. Les policies permissives se
-- cumulent par OR, donc en laisser une n'aurait pas changé le RÉSULTAT — mais
-- elle laisserait croire que `is_admin()` ou `is_finance_admin()` est encore la
-- règle de l'écriture du personnel. Rejouable : on retire AUSSI les noms que
-- cette migration crée, avant de les recréer (une migration appliquée deux fois
-- échouait sur « policy already exists » et annulait tout son bloc).
DROP POLICY IF EXISTS "Admin can insert staff" ON public.staff;
DROP POLICY IF EXISTS "Finance admins insert staff" ON public.staff;
DROP POLICY IF EXISTS "Finance writers insert staff" ON public.staff;
CREATE POLICY "Finance writers insert staff" ON public.staff
    FOR INSERT WITH CHECK (public.is_finance_writer());

DROP POLICY IF EXISTS "Admin can update staff" ON public.staff;
DROP POLICY IF EXISTS "Finance admins update staff" ON public.staff;
DROP POLICY IF EXISTS "Finance writers update staff" ON public.staff;
CREATE POLICY "Finance writers update staff" ON public.staff
    FOR UPDATE USING (public.is_finance_writer());

-- ─── vendor_expenses : insertion ouverte à l'économe (et au gestionnaire) ───
-- Cette policy répare au passage la dérive mesurée sur la base de l'école : le
-- Gestionnaire Principal, promis « full FINANCIAL administration » depuis
-- 20260902000000, était refusé à l'insertion.
DROP POLICY IF EXISTS "Promoter insert vendor_expenses" ON public.vendor_expenses;
DROP POLICY IF EXISTS "Finance admins insert vendor_expenses" ON public.vendor_expenses;
DROP POLICY IF EXISTS "Finance writers insert vendor_expenses" ON public.vendor_expenses;
CREATE POLICY "Finance writers insert vendor_expenses" ON public.vendor_expenses
    FOR INSERT WITH CHECK (public.is_finance_writer());

-- ─── PostgREST schema cache reload ──────────────────────────────────────────
NOTIFY pgrst, 'reload schema';

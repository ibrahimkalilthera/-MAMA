-- Migration: l'économe (Accountant) peut ENREGISTRER les paiements de salaire.
--
-- ─── Le défaut, mesuré le 2026-10-05 ────────────────────────────────────────
-- Un poste connecté avec le compte `econome` (aggeediarra@mamathera.org) a
-- enregistré la paie hors ligne. À la reconnexion, chaque rejeu a été refusé :
--
--   new row violates row-level security policy for table "salary_payments" [42501]
--
-- … par la policy « Finance admins insert salary_payments », dont
-- `public.is_finance_admin()` vaut `admin`, `dev`, `general_manager`
-- (20260902000000_general_manager_role.sql). L'`econome` en était exclu — la
-- décision de 20260902000001_econome_role.sql le disait d'ailleurs : « econome
-- stays outside is_finance_admin, like staff ».
--
-- Or l'écran Payroll (src/components/PayrollView.tsx) et son bouton
-- « Enregistrer Salaire » n'avaient AUCUNE garde de rôle : l'application offrait
-- une écriture que la base refusait. Les saisies restaient donc dans la file,
-- recomptées « refusées » à chaque passage — jamais envoyées, jamais expliquées.
--
-- ─── La décision (propriétaire, 2026-10-05) ─────────────────────────────────
-- L'économe ENREGISTRE la paie — c'est son métier (écritures financières
-- quotidiennes, reçus & caisse) — mais ne GÈRE PAS le personnel. On élargit donc
-- les seules policies d'ÉCRITURE de `salary_payments` à un rôle de plus, via une
-- fonction NOMMÉE : la règle que lit l'app (`src/lib/payrollRights.ts`) et celle
-- que lit la base restent comparables, et `tests/payroll-rights.test.ts` compare
-- les deux listes DANS LES DEUX SENS — un rôle ajouté d'un seul côté rouvrirait
-- un bouton qui ne peut pas aboutir, exactement le défaut réparé ici.
--
-- `staff` reste réservé à `is_finance_admin()` : recruter un membre n'est pas
-- une écriture de caisse. La SUPPRESSION d'un paiement de salaire reste, elle
-- aussi, un acte de gestionnaire financier (`is_finance_admin`) — enregistrer et
-- détruire ne sont pas le même droit.

-- ─── Helper: qui peut ÉCRIRE un paiement de salaire ─────────────────────────
CREATE OR REPLACE FUNCTION public.is_payroll_writer()
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

-- ─── salary_payments : insertion et correction ouvertes à l'économe ─────────
DROP POLICY IF EXISTS "Finance admins insert salary_payments" ON public.salary_payments;
CREATE POLICY "Payroll writers insert salary_payments" ON public.salary_payments
    FOR INSERT WITH CHECK (public.is_payroll_writer());

DROP POLICY IF EXISTS "Finance admins update salary_payments" ON public.salary_payments;
CREATE POLICY "Payroll writers update salary_payments" ON public.salary_payments
    FOR UPDATE USING (public.is_payroll_writer());

-- ─── PostgREST schema cache reload ──────────────────────────────────────────
NOTIFY pgrst, 'reload schema';

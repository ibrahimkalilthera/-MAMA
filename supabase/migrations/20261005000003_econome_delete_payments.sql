-- Migration: l'économe peut SUPPRIMER un paiement d'élève saisi par erreur.
--
-- ─── Le défaut, mesuré le 2026-10-05 ────────────────────────────────────────
-- Le bouton « supprimer un paiement » (src/components/StudentDetailsModal.tsx)
-- n'apparaît que là où la base l'autorise. Or la SUPPRESSION d'un paiement était
-- réservée à `public.is_admin()` — `admin`, `dev` (20260809000000_auth_and_rls.sql,
-- policies « Admin delete payments » et l'héritée « Admin can delete payments »).
-- L'`econome`, qui tient la caisse et saisit les reçus, ne pouvait donc PAS
-- corriger sa propre erreur : le bouton lui était caché, et s'il l'avait forcé,
-- PostgREST aurait rendu une suppression à zéro ligne.
--
-- ─── La décision (propriétaire, 2026-10-05) ─────────────────────────────────
-- L'économe SUPPRIME un paiement — c'est son métier (corriger une caisse qui se
-- trompe), mais ne supprime RIEN d'autre : `students`, `parents`, `staff`,
-- `expenses`, `salary_payments`… restent à `is_admin()` ou `is_finance_admin()`.
-- « Enregistrer et détruire ne sont pas le même droit » (voir
-- 20261005000000_econome_payroll_writes.sql, qui a ouvert à l'économe l'ÉCRITURE
-- de la paie sans lui ouvrir sa suppression). On ouvre donc la SEULE policy de
-- suppression de `payments` à un rôle de plus, via une fonction NOMMÉE : la
-- règle que lit l'app (`src/lib/paymentRights.ts`) et celle que lit la base
-- restent comparables, et `tests/payment-rights.test.ts` compare les deux listes
-- DANS LES DEUX SENS — un rôle ajouté d'un seul côté rouvrirait un bouton qui ne
-- peut pas aboutir, exactement le défaut réparé ici.

-- ─── Helper: qui peut SUPPRIMER un paiement d'élève ─────────────────────────
CREATE OR REPLACE FUNCTION public.is_payment_deleter()
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_profiles
    WHERE id = auth.uid() AND role IN ('admin', 'dev', 'econome')
  );
$$;

-- ─── payments : la suppression s'ouvre à l'économe ──────────────────────────
-- DEUX noms hérités se sont succédé sur cette table (« Admin delete payments »,
-- puis « Admin can delete payments ») : les deux sont retirés. Les policies
-- permissives se cumulent par OR, donc en laisser une n'aurait pas changé le
-- RÉSULTAT — mais elle laisserait croire que `is_admin()` (admin, dev) est encore
-- la règle de la suppression des paiements. Elle ne l'est plus : l'économe la
-- partage. On retire AUSSI le nom que cette migration crée, pour être rejouable.
DROP POLICY IF EXISTS "Admin delete payments" ON public.payments;
DROP POLICY IF EXISTS "Admin can delete payments" ON public.payments;
DROP POLICY IF EXISTS "Payment deleters delete payments" ON public.payments;
CREATE POLICY "Payment deleters delete payments" ON public.payments
    FOR DELETE USING (public.is_payment_deleter());

-- ─── PostgREST schema cache reload ──────────────────────────────────────────
NOTIFY pgrst, 'reload schema';

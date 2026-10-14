-- Migration: la SUPPRESSION d'une dépense fournisseur passe aux finance admins
--            (admin, dev, Gestionnaire Principal) — pas aux seuls admin/dev.
--
-- ─── Ce que ce fichier devait faire, et ce qu'il en reste ───────────────────
-- Écrit le 2026-09-06 pour le Gestionnaire Principal, il n'a JAMAIS été appliqué
-- à la base de l'école. Entre-temps, sa moitié INSERTION a été livrée autrement
-- et sa moitié SUPPRESSION est restée fermée : les deux moitiés ne se rejouent
-- donc pas de la même façon, et ce fichier dit maintenant laquelle il porte.
--
--   • INSERTION (`vendor_expenses`) — SUPPLANTÉE, retirée de ce fichier.
--     L'insertion que cette migration ouvrait à `is_finance_admin()` a été livrée
--     le 2026-10-13 par `20261014000000_finance_writer_staff_vendor.sql`, sous une
--     règle PLUS LARGE — `public.is_finance_writer()`, qui ajoute l'économe
--     (« il a accès à tout sauf les paramètres du système », propriétaire,
--     2026-10-13). La recréer ici rouvrirait un SECOND nom pour la même écriture,
--     c'est-à-dire exactement ce que `20261014000000` a retiré.
--     MESURÉ le 2026-10-13 : le fichier tel qu'il était écrit ne s'appliquait
--     même plus — `npm run db:apply` répondait « déjà ABSENT avant :
--     policy:Promoter insert vendor_expenses », parce que sa moitié INSERT avait
--     déjà été retirée par `20261014000000`. C'est la preuve que cette moitié est
--     de l'HISTOIRE, pas un geste à rejouer.
--
--   • SUPPRESSION (`vendor_expenses`) — c'est ce que ce fichier applique.
--     La base de l'école porte DEUX noms hérités, tous deux `is_admin()` :
--       « Admin can delete vendor_expenses »  — qu'AUCUNE migration ne déclare
--                                              ni ne retire (génération d'avant
--                                              les migrations) ;
--       « Promoter delete vendor_expenses »   — déclaré par 20260828000000,
--                                              supplanté ici.
--     Mesuré le 2026-10-13 par `npm run check:rls-policies` : « Finance admins
--     delete vendor_expenses » ABSENTE en base, ces deux noms EN TROP. Le
--     Gestionnaire Principal voyait donc le bouton « Supprimer » sur sa page
--     Dépenses — l'écran le lui montrait depuis 20260902000000 — et la base
--     refusait chacune de ses suppressions : le même défaut app↔base que
--     l'insertion, dans la même table, cinq semaines plus tard.
--
-- ─── La décision ────────────────────────────────────────────────────────────
-- La suppression d'une dépense fournisseur appartient à `public.is_finance_admin()`
-- (`20260902000000_general_manager_role.sql`) : admin, dev, Gestionnaire Principal.
-- L'économe n'y est PAS : il SAISIT les dépenses fournisseur
-- (`is_finance_writer()`), il ne les détruit pas — écrire et détruire ne sont pas
-- le même droit (même partage que la paie, 20261005000000 / 20261005000003).
-- L'écran lit la même règle (`canDeleteVendorExpenses`, `src/lib/payrollRights.ts`) :
-- un rôle ajouté d'un seul côté fait rougir `tests/finance-rights.test.ts` au lieu
-- d'ouvrir une corbeille que la base refuse (42501) ou d'en cacher une qu'elle
-- accepte.
--
-- Ce qui NE bouge pas : le monopole promoteur sur les enregistrements EXISTANTS
-- (trigger `protect_vendor_expense_financial_fields` : `vendor_name` et `amount`
-- restent à admin/dev hors création, 20260828000000), la lecture de la table
-- (tout compte connecté), et la suppression d'une dépense GÉNÉRALE (`expenses`),
-- qui reste `is_admin()` — le Gestionnaire Principal n'y reçoit toujours pas de
-- corbeille (`canDelete`, `src/lib/deleteRights.ts`).
--
-- Rejouable : le nom que cette migration crée est retiré AVANT d'être recréé.

-- ─── vendor_expenses : la suppression passe aux finance admins ───────────────
-- Les deux noms hérités partent. Les policies permissives se cumulent par OR,
-- donc en laisser un n'aurait pas changé le RÉSULTAT — mais il laisserait croire
-- que `is_admin()` (admin, dev) est encore la règle de la suppression d'une
-- dépense fournisseur. Elle ne l'est plus : le Gestionnaire Principal la partage.
DROP POLICY IF EXISTS "Admin can delete vendor_expenses" ON public.vendor_expenses;
DROP POLICY IF EXISTS "Promoter delete vendor_expenses" ON public.vendor_expenses;
DROP POLICY IF EXISTS "Finance admins delete vendor_expenses" ON public.vendor_expenses;
CREATE POLICY "Finance admins delete vendor_expenses" ON public.vendor_expenses
    FOR DELETE TO authenticated
    USING (public.is_finance_admin());

-- ─── PostgREST schema cache reload ──────────────────────────────────────────
NOTIFY pgrst, 'reload schema';

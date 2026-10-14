-- Migration: retirer les POLITIQUES HÉRITÉES de cinq tables — students, parents,
--            staff, salary_payments, expenses — celles de la mise en place
--            MANUELLE de la base, antérieures aux politiques du dépôt.
--
-- ─── Le défaut, mesuré le 2026-10-13 sur la base de l'ÉCOLE ─────────────────
-- `20261013000001_payments_write_lock.sql` a fermé les trois politiques héritées
-- de `payments` — celles que `20260809000000_auth_and_rls.sql` n'avait jamais
-- retirées parce qu'elles portaient d'AUTRES noms que les « Allow anonymous … »
-- qu'il retirait. Cinq autres tables portaient la même génération de politiques :
-- quinze noms que le dépôt ne déclare ni ne retire, sur des tables du registre
-- scolaire et de l'argent. `npm run check:rls-policies` les nomme « en base,
-- déclarée par AUCUNE migration » — et ils y restaient parce que le défaut de
-- `payments` avait été traité seul.
--
-- ─── CE QUI EST MESURÉ AVANT D'ÉCRIRE, et pourquoi c'est nécessaire ─────────
-- Les politiques PERMISSIVES s'ADDITIONNENT : lire le texte d'une policy ne dit
-- pas qui passe, c'est l'UNION de toutes celles de la table. Avant de retirer
-- quoi que ce soit, la carte des écritures a donc été MESURÉE sur la base réelle,
-- rôle par rôle, dans une transaction annulée (`SET LOCAL ROLE authenticated` et
-- les deux claims JWT, exactement ce que PostgREST pose) :
--
--   table             lire   insérer                    corriger   corriger$   supprimer
--   students          tous   tous                       tous       tous ⚠️     admin, dev
--   parents           tous   tous                       tous       —           admin, dev
--   staff             tous   admin, dev, GM, économe    idem       idem        admin, dev, GM
--   salary_payments   tous   admin, dev, GM, économe    idem       idem        admin, dev, GM
--   expenses          tous   tous                       tous       tous ⚠️     admin, dev
--
--   « tous » = tout compte connecté ; « corriger$ » = la colonne de l'ARGENT
--   (`students.amount_paid`, `expenses.amount`, `staff.salary`,
--   `salary_payments.amount`) ; `anon` est refusé partout (0 ligne).
--
-- ─── CE QUE CETTE MIGRATION FAIT, ET CE QU'ELLE NE FAIT PAS ─────────────────
-- Elle retire les quinze noms hérités, et RIEN d'autre. Chacun a, sur la même
-- table et pour la même commande, un homologue DÉCLARÉ par le dépôt dont l'effet
-- le COUVRE :
--
--   students         « Authenticated users can read / insert / update students »
--                    → « Authenticated read / insert / update students »
--                      (`auth.role() = 'authenticated'`, 20260809000000)
--                    « Admin can delete students » → « Admin delete students »
--                      (`public.is_admin()`)
--   parents          les quatre mêmes paires, sur `parents`
--   expenses         les quatre mêmes paires, sur `expenses`
--   staff            « Authenticated users can read staff » → « Authenticated
--                      read staff »
--                    « Admin can delete staff » → « Finance admins delete staff »
--                      (`public.is_finance_admin()`, 20260902000000) : un
--                      SUR-ENSEMBLE — `is_admin()` ⊂ `is_finance_admin()`
--   salary_payments  « Authenticated users can read salary_payments »
--                    → « Authenticated read salary_payments »
--
-- Donc AUCUN droit ne change : c'est une déduplication, pas un resserrement. Ce
-- qu'elle retire, c'est le SECOND endroit qui décidait — celui que le dépôt ne
-- lit pas, et dans lequel une relecture de la sécurité voit une règle
-- `USING (true)` que rien ne rattache au code.
--
-- ⚠️ CE QUI RESTE OUVERT est un CHOIX, pas un oubli, et il est nommé ici parce
-- qu'une fermeture qui se tait sur ce qu'elle laisse ouverte se lit comme un
-- quitus. Sur `students`, `parents` et `expenses`, la règle DÉCLARÉE est
-- elle-même large (`auth.role() = 'authenticated'`) : la saisie quotidienne du
-- guichet — fiches, reçus, dépenses — est le métier du rôle `staff`
-- (20260902000000_general_manager_role.sql : « staff → daily entries (students,
-- payments, receipts, expenses) »). En particulier `students.amount_paid` est
-- réécrit par l'APPLICATION à chaque geste d'argent (`addPayment`,
-- `deletePayment`, `restorePayment`, `src/lib/dataOps`) : le fermer aux comptes
-- du guichet demanderait de faire passer ces gestes par une FONCTION bornée,
-- comme les mois d'un reçu — c'est une décision, et une autre migration.
--
-- ─── ORDRE, ET REJOUABILITÉ ────────────────────────────────────────────────
-- Ce fichier s'applique APRÈS `20261014000000_finance_writer_staff_vendor.sql` :
-- celui-ci remplace « Admin insert staff » et « Admin update staff » par
-- « Finance writers insert / update staff », et n'a AUCUN nom en commun avec les
-- quinze ci-dessous. Un `DROP POLICY IF EXISTS` ne dépend donc pas de l'ordre —
-- mais l'écrire ici évite qu'un rejeu chronologique laisse croire le contraire.
-- Rejouable : `IF EXISTS` partout, aucun `CREATE` à heurter.

-- ─── 1. students ────────────────────────────────────────────────────────────
-- Restent : « Authenticated read students », « Authenticated insert students »,
-- « Authenticated update students » (authenticated) et « Admin delete students »
-- (`is_admin()`).
DROP POLICY IF EXISTS "Authenticated users can read students" ON public.students;
DROP POLICY IF EXISTS "Authenticated users can insert students" ON public.students;
DROP POLICY IF EXISTS "Authenticated users can update students" ON public.students;
DROP POLICY IF EXISTS "Admin can delete students" ON public.students;

-- ─── 2. parents ─────────────────────────────────────────────────────────────
-- Restent : les trois « Authenticated … parents » et « Admin delete parents ».
DROP POLICY IF EXISTS "Authenticated users can read parents" ON public.parents;
DROP POLICY IF EXISTS "Authenticated users can insert parents" ON public.parents;
DROP POLICY IF EXISTS "Authenticated users can update parents" ON public.parents;
DROP POLICY IF EXISTS "Admin can delete parents" ON public.parents;

-- ─── 3. expenses ────────────────────────────────────────────────────────────
-- Restent : les trois « Authenticated … expenses » et « Admin delete expenses ».
DROP POLICY IF EXISTS "Authenticated users can read expenses" ON public.expenses;
DROP POLICY IF EXISTS "Authenticated users can insert expenses" ON public.expenses;
DROP POLICY IF EXISTS "Authenticated users can update expenses" ON public.expenses;
DROP POLICY IF EXISTS "Admin can delete expenses" ON public.expenses;

-- ─── 4. staff ───────────────────────────────────────────────────────────────
-- Restent : « Authenticated read staff », « Finance writers insert / update
-- staff » (`is_finance_writer()`) et « Finance admins delete staff »
-- (`is_finance_admin()`).
DROP POLICY IF EXISTS "Authenticated users can read staff" ON public.staff;
DROP POLICY IF EXISTS "Admin can delete staff" ON public.staff;

-- ─── 5. salary_payments ─────────────────────────────────────────────────────
-- Restent : « Authenticated read salary_payments », « Payroll writers insert /
-- update salary_payments » (`is_payroll_writer()`) et « Finance admins delete
-- salary_payments » (`is_finance_admin()`).
DROP POLICY IF EXISTS "Authenticated users can read salary_payments" ON public.salary_payments;

-- ─── PostgREST schema cache reload ──────────────────────────────────────────
NOTIFY pgrst, 'reload schema';

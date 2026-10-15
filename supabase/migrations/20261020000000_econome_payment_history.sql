-- Migration: l'économe LIT l'historique des paiements — et RIEN d'autre du journal.
--
-- ─── Le défaut, mesuré le 2026-10-15 ────────────────────────────────────────
-- Demande du propriétaire : « l'économe doit avoir accès à l'historique des
-- paiements » — constaté par lui : la ligne ne s'affiche pas dans le rail. La
-- cause n'est pas dans le rail : `audit_logs` n'est lisible que par `admin`/`dev`
-- (policy « Admins can view audit logs », 20260814000000), et l'historique des
-- paiements se LIT dans ce journal — c'est le seul endroit du dépôt qui nomme
-- l'encaisseur (`payments` ne porte ni auteur, ni nom : mesuré le 2026-10-06).
-- Ouvrir l'onglet sans la lecture aurait affiché « rien encaissé » sur une caisse
-- pleine — un mensonge, pas un écran vide.
--
-- ─── La décision (propriétaire, 2026-10-15) ─────────────────────────────────
-- L'économe lit les GESTES DE CAISSE et les CORRECTIONS D'ARGENT — exactement ce
-- que l'écran affiche — et rien d'autre du journal : ni les changements de rôle,
-- ni les suppressions d'élèves, ni les réglages. `audit_logs` reste donc fermé à
-- son rôle, et c'est une policy SUPPLÉMENTAIRE, filtrée par ACTION, qui lui ouvre
-- les sept lignes dont cet écran est fait :
--   • les trois gestes de caisse (`PAYMENT_HISTORY_ACTIONS`, src/lib/paymentHistory.ts) ;
--   • les quatre gestes de correction (`CORRECTION_HISTORY_ACTIONS`,
--     src/lib/correctionHistory.ts), qui composent le bloc « gestes de correction »
--     du MÊME écran — un bloc vide se lirait « rien n'a été retiré du registre ».
-- Les deux listes restent écrites dans l'application, à côté de l'écran qui les
-- montre, et `tests/payment-history-rights.test.ts` exige que leur UNION soit la
-- liste de cette policy : l'économe voit les lignes de son écran, pas une de plus.
--
-- ─── Pourquoi une policy filtrée, et pas une vue ni une fonction de lecture ──
-- Parce que les policies permissives s'ADDITIONNENT : la lecture entière des deux
-- autres rôles ne bouge pas d'une ligne, et l'application ne porte AUCUN second
-- chemin de lecture — `fetchAuditLogs` et `fetchAuditJournalRange` continuent de
-- lire la même table, et c'est la base qui rend à l'économe les lignes de son
-- écran. La RLS FILTRE les lignes, elle ne refuse pas la requête : il n'y a donc
-- pas d'erreur à interpréter, ni d'écran vide à expliquer.
--
-- ─── Ce que la fonction laisse passer, comme ses sœurs ──────────────────────
-- `public.is_payment_history_viewer()` n'est pas restreinte, exactement comme
-- `is_admin()`, `is_payment_deleter()`, `is_payment_month_editor()`,
-- `is_finance_writer()` et `is_payroll_writer()` : elle ne lit que le rôle de
-- l'appelant et ne rend vrai que pour lui. Aucun droit d'EXÉCUTION n'est donc à
-- retirer (la leçon du 2026-09-06 — `ALTER DEFAULT PRIVILEGES` donne à `anon` un
-- EXECUTE direct sur toute fonction créée — vaut pour les fonctions qui FONT
-- quelque chose, comme `set_payment_months` ou `admin_set_user_password`).
--
-- ─── Mesuré APRÈS application, sur la base de l'école (2026-10-15) ──────────
-- Sonde `pg` en transactions ANNULÉES, `SET LOCAL ROLE authenticated` **et** les
-- deux claims JWT — l'impersonation se prouve (auth.uid() relu, non nul) : le
-- journal portait 770 entrées, dont 104 gestes de caisse et 666 autres
-- (510 ADD_STUDENT, 124 UPDATE_STUDENT, …). Résultat : `admin`/`dev` lisent les
-- 770 (leur garde d'avant, inchangée), **l'économe en lit 104 — exactement les
-- gestes de caisse (RECORD_PAYMENT 102, DELETE_PAYMENT 2) et RIEN d'autre**,
-- `general_manager` 0, un compte connecté sans profil 0, `anon` 0.
--
-- ─── Ce que la policy ne fait PAS ───────────────────────────────────────────
-- Elle n'ouvre aucune ÉCRITURE : le journal reste en insertion seule pour tout
-- compte connecté (policy d'INSERT d'origine), et la suppression d'un reçu
-- (`is_payment_deleter()`) comme la correction des mois (`set_payment_months()`)
-- sont déjà décidées ailleurs. Lire une ligne du journal n'a jamais été un droit
-- d'écriture.

-- ─── Helper: qui peut LIRE l'historique des paiements ───────────────────────
CREATE OR REPLACE FUNCTION public.is_payment_history_viewer()
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

-- ─── La lecture BORNÉE : les gestes de caisse et les corrections, rien d'autre ─
-- `DROP POLICY IF EXISTS` avant le CREATE : la migration doit pouvoir être rejouée
-- (elle est idempotente comme ses voisines, et `db:apply` refuse un ajout déjà
-- présent plutôt que de le doubler).
--
-- Les sept gestes, dans l'ordre de l'écran — les trois de la caisse
-- (`PAYMENT_HISTORY_ACTIONS`) puis les quatre corrections
-- (`CORRECTION_HISTORY_ACTIONS`). Ce commentaire est HORS de l'expression, et
-- c'est une mesure, pas une coquetterie : `check-rls-policies` compare les JETONS
-- de la condition déclarée à ceux du catalogue, et la prose écrite DANS le
-- `USING (…)` ajoutait ses mots aux jetons — la politique apparaissait alors
-- « CHANGÉE » alors que la base appliquait exactement la règle écrite ici.
DROP POLICY IF EXISTS "Payment history viewers read payment gestures" ON public.audit_logs;
CREATE POLICY "Payment history viewers read payment gestures"
    ON public.audit_logs
    FOR SELECT
    TO authenticated
    USING (
        public.is_payment_history_viewer()
        AND action IN (
            'RECORD_PAYMENT',
            'DELETE_PAYMENT',
            'RESTORE_PAYMENT',
            'DELETE_SALARY_PAYMENT',
            'RESTORE_SALARY_PAYMENT',
            'DELETE_EXPENSE',
            'DELETE_VENDOR_EXPENSE'
        )
    );

-- ─── PostgREST schema cache reload ──────────────────────────────────────────
NOTIFY pgrst, 'reload schema';

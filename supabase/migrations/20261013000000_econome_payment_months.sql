-- Migration: l'économe peut RENSEIGNER les mois d'un reçu — et RIEN d'autre.
--
-- ─── Le défaut, mesuré le 2026-10-13 ────────────────────────────────────────
-- La fiche de l'élève offre « Renseigner les mois » sur un reçu muet, mais
-- seulement là où la base l'autorise : l'écriture de `payments.months` passait
-- par la policy « Admin update payments » (`public.is_admin()` = admin, dev —
-- 20260809000000_auth_and_rls.sql). Or c'est l'économe qui tient la caisse,
-- repartage les reçus et sait ce qu'un reçu ANTÉRIEUR à la colonne
-- (20261011000000_payments_months.sql) couvrait. Il SUPPRIME déjà un reçu fautif
-- (`public.is_payment_deleter()` = admin, dev, econome) mais ne pouvait pas en
-- renseigner les mois : refuser le second tout en accordant le premier laissait
-- l'école devant un reçu qui ne nomme qu'un mois, indéfiniment — et le seul
-- recours était de le SUPPRIMER pour le ressaisir, ce qui change son numéro, sa
-- date et son auteur au journal.
--
-- ─── La décision (propriétaire, 2026-10-13) ─────────────────────────────────
-- L'économe RENSEIGNE les mois — c'est ce que son guichet voit — mais il ne
-- réécrit pas l'ARGENT : ni `amount`, ni `date`, ni `receipt_number`, ni
-- `student_id`.
--
-- Pourquoi une FONCTION, et pas une policy élargie. Une policy RLS est au niveau
-- de la LIGNE : `FOR UPDATE USING (public.is_payment_month_editor())` laisserait
-- le rôle `authenticated` — que TOUS les postes partagent — réécrire n'importe
-- quelle colonne d'un reçu autorisé, montant compris. Les privilèges de colonne
-- (`GRANT UPDATE (months) …`) ne répondent pas non plus : ils sont portés par le
-- rôle de BASE, pas par le rôle métier, donc ils s'appliqueraient aussi à `admin`,
-- et le seul AUTRE UPDATE de `payments` de l'application — `student_id`, la
-- ré-attribution d'un reçu lors d'une fusion d'élèves
-- (src/lib/dataOps/students.ts) — devrait être ouvert avec, ce qui donnerait à
-- l'économe le pouvoir de DÉPLACER de l'argent d'un élève à un autre. Le rôle
-- d'écriture est donc borné par CONSTRUCTION : `public.set_payment_months()` est
-- le seul chemin, et la seule colonne nommée dans sa requête est `months`.
--
-- Ce qui n'est PAS borné, volontairement : réécrire des mois DÉJÀ déclarés. La
-- borne « seulement si le reçu ne déclare rien » serait un théâtre : l'économe
-- détient la suppression, donc il peut retirer le reçu et le ressaisir avec les
-- mois de son choix. Une borne plus faible que celle déjà accordée ne protège
-- rien ; elle ferait seulement croire que la caisse est plus contrainte qu'elle
-- ne l'est. L'écran, lui, n'offre le geste que sur un reçu muet.
--
-- ─── Ce que la fonction REFUSE, et ce qu'elle rend ──────────────────────────
--   • un appelant qui n'est ni `admin`, ni `dev`, ni `econome` → `42501` (le code
--     que l'école a déjà vu dans la file de rejeu) ;
--   • un identifiant de reçu absent → `23514`, plutôt qu'un UPDATE qui ne touche
--     rien et rendrait « 0 » sans dire pourquoi ;
--   • un tableau de mois VIDE → `23514` : écrire `{}` ne déclare rien de plus que
--     le silence d'avant, en donnant l'impression d'une fiche complétée ;
--   • un mois qui n'est pas `AAAA-MM` (ou `NULL`) → `23514`, la même forme que le
--     CHECK `payments_months_shape_check`, refusée ici avec un message qui dit
--     quoi écrire.
--
-- Elle rend le NOMBRE de lignes écrites. Zéro n'est pas un succès : l'application
-- le DIT, comme pour la suppression — une cible absente rend un succès HTTP sans
-- avoir rien écrit, et un « 0 » avalé ferait annoncer « mois renseignés » sur rien.
--
-- ─── L'EXECUTE, nommément (leçon du 2026-09-06) ─────────────────────────────
-- `ALTER DEFAULT PRIVILEGES` de Supabase donne à `anon` un droit d'exécution
-- DIRECT sur toute fonction créée — un `REVOKE … FROM public` ne le retire pas
-- (20260906000000_anon_cannot_execute_admin_set_user_password.sql). On retire
-- donc explicitement `anon` ET `public`, et on n'accorde qu'à `authenticated`.
-- La garde de rôle dans le corps reste la barrière : `anon` n'a pas de session,
-- donc `auth.uid()` est NULL et `is_payment_month_editor()` est faux.
--
-- `public.is_payment_month_editor()` n'est pas restreinte, comme `is_admin()`,
-- `is_payment_deleter()` et `is_payroll_writer()` : elle ne lit que le rôle de
-- l'appelant et ne rend vrai que pour lui.

-- ─── Helper: qui peut RENSEIGNER les mois d'un reçu ─────────────────────────
CREATE OR REPLACE FUNCTION public.is_payment_month_editor()
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

-- ─── L'écriture bornée : les mois d'un reçu, et rien d'autre ────────────────
CREATE OR REPLACE FUNCTION public.set_payment_months(
    p_payment_id UUID,
    p_months TEXT[]
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_months TEXT[];
  v_rows INTEGER;
BEGIN
  IF NOT public.is_payment_month_editor() THEN
    RAISE EXCEPTION 'renseigner les mois d’un reçu demande le rôle admin, dev ou econome'
      USING ERRCODE = '42501';
  END IF;

  IF p_payment_id IS NULL THEN
    RAISE EXCEPTION 'le reçu à renseigner doit être nommé (identifiant manquant)'
      USING ERRCODE = '23514';
  END IF;

  IF p_months IS NULL OR cardinality(p_months) = 0 THEN
    RAISE EXCEPTION 'au moins un mois est requis : un tableau vide ne déclare rien'
      USING ERRCODE = '23514';
  END IF;

  -- `m IS NULL` est nommé : `NULL !~ '…'` vaut NULL, donc un élément NULL
  -- traverserait le EXISTS sans être refusé, et n'irait buter que sur le CHECK.
  IF EXISTS (
    SELECT 1 FROM unnest(p_months) AS m
    WHERE m IS NULL OR m !~ '^\d{4}-(0[1-9]|1[0-2])$'
  ) THEN
    RAISE EXCEPTION 'un mois s’écrit AAAA-MM (par exemple 2026-09)'
      USING ERRCODE = '23514';
  END IF;

  -- Canonique : dédoublonné et rangé. L'application trie déjà avant d'appeler
  -- (src/lib/paymentMonths.ts) ; le refaire ici ferme la question pour TOUT
  -- appelant, y compris un appel direct à la RPC.
  SELECT array_agg(DISTINCT m ORDER BY m) INTO v_months FROM unnest(p_months) AS m;

  -- UNE seule colonne. Ni `amount`, ni `date`, ni `receipt_number`, ni
  -- `student_id` : ce n'est pas une convention, c'est la requête.
  UPDATE public.payments SET months = v_months WHERE id = p_payment_id;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RETURN v_rows;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.set_payment_months(uuid, text[]) FROM anon;
REVOKE EXECUTE ON FUNCTION public.set_payment_months(uuid, text[]) FROM public;
GRANT EXECUTE ON FUNCTION public.set_payment_months(uuid, text[]) TO authenticated;

-- ─── PostgREST schema cache reload ──────────────────────────────────────────
NOTIFY pgrst, 'reload schema';

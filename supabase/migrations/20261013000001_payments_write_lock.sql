-- Migration: refermer l'écriture d'un reçu — l'argent ne se réécrit plus par un
-- UPDATE de table, et la seule ré-attribution utile passe par une FONCTION bornée.
--
-- ─── Le défaut, mesuré le 2026-10-13 sur la base de l'ÉCOLE ─────────────────
-- `20261013000000_econome_payment_months.sql` promet une borne : l'économe
-- renseigne les MOIS d'un reçu, et l'argent lui reste fermé (`Admin update
-- payments` = `public.is_admin()`). La promesse était vraie dans les migrations et
-- FAUSSE dans la base : celle-ci portait encore les trois politiques de sa mise en
-- place manuelle — « Authenticated users can read / insert / update payments »,
-- cette dernière avec `USING (true)` — ANTÉRIEURES aux politiques du dépôt
-- (xid 1282 contre 1505-1507), et `20260809000000_auth_and_rls.sql` ne les avait
-- jamais retirées : il retirait les « Allow anonymous … », un autre jeu de noms.
--
-- Or les politiques PERMISSIVE s'ADDITIONNENT : `USING (true)` rendait la garde
-- `is_admin()` inopérante. Mesuré, transaction annulée, sur un reçu réel de la
-- base partagée : `general_manager` — `is_admin()` faux, `is_payment_deleter()`
-- faux, `is_payment_month_editor()` faux — modifiait `amount` (1 ligne). Tout
-- compte connecté le pouvait, et `payments` est la table de l'argent.
--
-- ─── Ce que ces trois `DROP` changent, et ce qu'ils ne changent pas ─────────
--   • `… can update payments` (`USING true`) : LE trou. Sans elle, la seule
--     écriture directe de `payments` redevient « Admin update payments »
--     (`public.is_admin()` : admin, dev) — ce que le dépôt déclare depuis le
--     2026-08-09, et que `tests/payment-rights.test.ts` verrouille.
--   • `… can insert payments` (`WITH CHECK (true)`) et `… can read payments`
--     (`USING true`) : des DOUBLONS. La base porte déjà « Authenticated insert
--     payments » (`auth.role() = 'authenticated'`) et « Authenticated read
--     payments » (même condition) — MÊME portée, même effet pour un compte
--     connecté. Les retirer ne change donc rien pour personne : c'est la même
--     paire, écrite une fois, dans le seul jeu que le dépôt lit. Ce qui change,
--     c'est qu'il n'y a plus DEUX endroits qui décident, dont un que le dépôt ne
--     lit pas. `anon`, lui, était déjà refusé (ses « Allow anonymous … » sont
--     parties le 2026-08-09) : mesuré, 0 ligne.
--
-- Insérer un reçu reste ouvert à tout compte connecté, et ce n'est pas un oubli :
-- c'est le geste du GUICHET — la caisse saisit un reçu, et plusieurs rôles le
-- font. Le retirer demanderait de nommer qui encaisse : une autre décision. Ce que
-- ce fichier ferme, c'est l'écriture d'un reçu DÉJÀ enregistré, celle qui touche
-- l'argent et ne laisse aucune trace du geste.
--
-- ─── La seule ré-attribution utile, ouverte NOMMÉMENT ──────────────────────
-- Le dépôt a UN autre UPDATE de `payments` : la fusion de deux fiches d'élève
-- déplace leurs reçus (`src/lib/dataOps/students.ts`). Une policy borne des
-- LIGNES, pas des colonnes — la rouvrir pour ça rouvrirait le MONTANT avec, et
-- fermer sans rien ouvrir casserait la fusion. Le geste devient donc une FONCTION
-- bornée, comme les mois :
--
--   `public.reassign_payment_student(p_payment_id, p_from_student_id, p_to_student_id)`
--     • gardée par `public.is_admin()` — le rôle que l'écran offre DÉJÀ pour
--       fusionner ou supprimer une fiche (`src/lib/deleteRights.ts`, `ADMIN_ROLES`) ;
--     • un seul SET : `student_id` ;
--     • la fiche d'ORIGINE est EXIGÉE : un reçu qui n'est plus sur la fiche
--       attendue rend 0. C'est le `WHERE student_id = …` que le filtre du client
--       portait ; sans lui, la fusion pourrait déplacer un reçu que quelqu'un vient
--       de rattacher ailleurs — et c'est ce compte, ligne par ligne, qui arrête le
--       geste AVANT que la fiche soit supprimée (la cascade emporterait les reçus
--       restés derrière : c'est l'accident que ce contrôle existe pour empêcher) ;
--     • elle rend le NOMBRE de lignes écrites : zéro n'est pas un succès, et
--       l'application le DIT.
--
-- ORDRE DE DÉPLOIEMENT : l'application doit être livrée avec ce fichier. Un poste
-- qui fusionnerait encore par UPDATE direct sera refusé (« Reçus non rattachés —
-- droits insuffisants, ou les reçus ont changé. Rien n'a été fusionné. »), et la
-- fusion s'arrête AVANT toute suppression : un refus, jamais un demi-geste.
--
-- ─── L'EXECUTE, nommément (leçon du 2026-09-06) ─────────────────────────────
-- `ALTER DEFAULT PRIVILEGES` de Supabase donne à `anon` un droit d'exécution
-- DIRECT sur toute fonction créée — un `REVOKE … FROM public` ne le retire pas
-- (`20260906000000_anon_cannot_execute_admin_set_user_password.sql`). On retire
-- donc explicitement `anon` ET `public`, et on n'accorde qu'à `authenticated` :
-- la garde de rôle du corps reste la barrière, et `anon` n'a pas de session.

-- ─── 1. Fermer l'écriture ouverte à tout compte connecté ────────────────────
DROP POLICY IF EXISTS "Authenticated users can update payments" ON public.payments;
DROP POLICY IF EXISTS "Authenticated users can insert payments" ON public.payments;
DROP POLICY IF EXISTS "Authenticated users can read payments" ON public.payments;

-- ─── 2. Rouvrir le SEUL chemin nommé : la ré-attribution d'un reçu ──────────
CREATE OR REPLACE FUNCTION public.reassign_payment_student(
    p_payment_id UUID,
    p_from_student_id UUID,
    p_to_student_id UUID
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rows INTEGER;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'déplacer un reçu d’une fiche à une autre demande le rôle admin ou dev'
      USING ERRCODE = '42501';
  END IF;

  IF p_payment_id IS NULL OR p_from_student_id IS NULL OR p_to_student_id IS NULL THEN
    RAISE EXCEPTION 'le reçu, sa fiche d’origine et sa fiche d’arrivée doivent être nommés'
      USING ERRCODE = '23514';
  END IF;

  -- Déplacer un reçu vers la fiche où il est déjà ne déplace rien : l'annoncer
  -- comme un succès ferait croire à une fusion qui n'a pas eu lieu.
  IF p_from_student_id = p_to_student_id THEN
    RAISE EXCEPTION 'un reçu ne se déplace pas vers la fiche où il est déjà (rien à faire)'
      USING ERRCODE = '23514';
  END IF;

  -- UNE seule colonne, et la fiche d'origine dans le filtre : ce n'est pas une
  -- convention, c'est la requête. Ni `amount`, ni `date`, ni `receipt_number`.
  UPDATE public.payments
     SET student_id = p_to_student_id
   WHERE id = p_payment_id AND student_id = p_from_student_id;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RETURN v_rows;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.reassign_payment_student(uuid, uuid, uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.reassign_payment_student(uuid, uuid, uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.reassign_payment_student(uuid, uuid, uuid) TO authenticated;

-- ─── PostgREST schema cache reload ──────────────────────────────────────────
NOTIFY pgrst, 'reload schema';

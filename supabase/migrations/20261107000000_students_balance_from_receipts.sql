-- Migration: le solde d'un élève est CALCULÉ par la base, plus écrit par le client.
--
-- ─── Le défaut, mesuré le 2026-10-11 ────────────────────────────────────────
-- `students.amount_paid` duplique la somme de `payments.amount`. Jusqu'ici, la
-- copie était réécrite par le CLIENT — en valeur absolue, depuis un instantané
-- en mémoire (`src/lib/dataOps/payments.ts`), sans lire l'erreur de l'écriture.
-- Deux reçus encaissés à 52 secondes d'intervalle (REC-223352 à 14:59:47,
-- REC-276036 à 15:00:40) ont laissé un élève à 4 000 FCFA alors que ses deux
-- lignes en valaient 8 000 : le second `UPDATE` est parti d'un instantané qui ne
-- contenait pas encore le premier. Les deux gestes sont au journal d'audit, le
-- solde n'en compte qu'un. Rien ne le voyait — ni l'écran, ni la CI, ni le
-- rapport hebdomadaire des doublons.
--
-- `scripts/check-payment-ledger.mjs` révèle cet écart et le répare quand on le
-- lui demande, mais il le dit lui-même : « la cause (une valeur dérivée réécrite
-- par le client) se répare en base — la faire calculer par Postgres ». C'est ce
-- que fait ce fichier.
--
-- ─── Ce qui change, et ce qui ne change pas ─────────────────────────────────
--   • `payments` EST le registre : un reçu, une ligne, un montant, une date. La
--     somme des lignes, et elle seule, fait le solde.
--   • Deux déclencheurs, et ils ferment les deux côtés :
--       1. `students_balance_derived` (BEFORE INSERT OR UPDATE sur `students`)
--          REMPLACE `amount_paid` et `last_payment_date` par ce que disent les
--          reçus, quoi que le client ait envoyé. Une écriture de ces deux
--          colonnes depuis l'application ne peut donc plus faire dériver quoi
--          que ce soit : elle est neutralisée, pas « corrigée après coup ».
--       2. `payments_sync_student_balance` (AFTER INSERT OR UPDATE OR DELETE sur
--          `payments`) recalcule la fiche touchée — et les DEUX fiches quand un
--          reçu change de fiche (ré-attribution de la fusion,
--          `public.reassign_payment_student`).
--   • Les autres colonnes de `students` (nom, classe, notes, total dû, statut,
--     parent…) ne sont pas concernées : `studentUpdatesToRow` continue de les
--     écrire, et un `UPDATE` qui ne nomme que celles-là est un geste ordinaire.
--
-- ─── Une CONSÉQUENCE assumée : un solde sans reçu n'existe plus ─────────────
-- Une fiche importée d'un tableur avec une colonne « Montant Payé » mais sans
-- AUCUNE ligne de reçu arrivait avec un solde que rien ne justifiait. C'est
-- exactement la classe « balance-without-receipt » que
-- `scripts/lib/payment-ledger.mjs` nomme comme un écart, et que `--repair`
-- remet à zéro. Après ce fichier, ce solde vaut 0 : l'argent encaissé s'écrit
-- en reçus (la feuille « payments » de l'import, ou la saisie au guichet), jamais
-- en solde posé à la main. Un import de fiches qui portait des montants payés
-- doit donc être suivi de l'import de ses reçus — c'est la même règle que la
-- caisse applique tous les jours, et elle rend le solde EXPLICABLE.
--
-- ─── Aucune écriture perdue, aucun demi-geste ───────────────────────────────
-- Les déclencheurs sont `SECURITY DEFINER` avec `search_path` figé (l'idiome du
-- dépôt, voir `assign_student_matricule`) : le solde se recalcule même quand
-- l'auteur du geste n'a pas le droit d'écrire `students`, et une policy RLS ne
-- peut pas vider l'`UPDATE` en silence (un `UPDATE` filtré écrit 0 ligne sans
-- erreur — le solde resterait alors en arrière, ce qui est précisément le défaut
-- qu'on ferme).
--
-- Idempotent : le fichier peut être rejoué (`CREATE OR REPLACE`,
-- `DROP TRIGGER IF EXISTS`), et le rattrapage réécrit la même valeur.
--
-- ─── Le rattrapage ──────────────────────────────────────────────────────────
-- Les 657 élèves de la base partagée se refermaient déjà le jour de l'écriture
-- (2 284 000 FCFA des deux côtés, 0 écart mesuré par `check:payment-ledger`) :
-- ce bloc ne change donc rien aujourd'hui. Il existe pour les bases qui, elles,
-- portent un écart — un fichier qui ne répare que les états futurs laisserait
-- l'ancien mensonge en place.

-- ─── 1) La dérivation, en UN seul endroit ───────────────────────────────────
-- Rend (somme des reçus, date du dernier reçu) pour une fiche. `SUM` sur zéro
-- ligne vaut NULL : `coalesce` rend 0, et `max(date)` rend NULL — « aucun reçu »,
-- jamais « 0 FCFA le 1er janvier ».
CREATE OR REPLACE FUNCTION public.student_balance_from_receipts(p_student_id uuid)
RETURNS TABLE (amount_paid numeric, last_payment_date date)
LANGUAGE sql
STABLE
SECURITY DEFINER
-- `search_path` figé : une fonction SECURITY DEFINER qui le laisse libre est un
-- détournement connu (une table homonyme posée par un client s'y ferait lire).
SET search_path = public, pg_temp
AS $$
    SELECT coalesce(sum(p.amount), 0)::numeric AS amount_paid,
           max(p.date)::date AS last_payment_date
      FROM public.payments p
     WHERE p.student_id = p_student_id;
$$;

-- ─── 2) Le côté `students` : une valeur envoyée par le client ne survit pas ─
CREATE OR REPLACE FUNCTION public.derive_student_balance()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
    -- `NEW.amount_paid` et `NEW.last_payment_date`, quel que soit ce que
    -- l'appelant a envoyé, sont REMPLACÉS. À l'INSERT, `NEW.id` est déjà posé
    -- (les DEFAULT sont évalués avant les triggers BEFORE) et la fiche n'a pas
    -- encore de reçu : le solde part donc de 0, jamais d'un montant déclaré.
    SELECT b.amount_paid, b.last_payment_date
      INTO NEW.amount_paid, NEW.last_payment_date
      FROM public.student_balance_from_receipts(NEW.id) AS b;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS students_balance_derived ON public.students;
CREATE TRIGGER students_balance_derived
    BEFORE INSERT OR UPDATE ON public.students
    FOR EACH ROW
    EXECUTE FUNCTION public.derive_student_balance();

-- ─── 3) Le côté `payments` : le registre recalcule la fiche qu'il touche ─────
CREATE OR REPLACE FUNCTION public.sync_student_balance_from_receipts()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_ids uuid[] := ARRAY[]::uuid[];
BEGIN
    -- Une ré-attribution change de fiche : les DEUX côtés se recalculent, sinon
    -- la fiche d'origine garderait le montant d'un reçu qui n'est plus à elle.
    IF TG_OP <> 'INSERT' AND OLD.student_id IS NOT NULL THEN
        v_ids := v_ids || OLD.student_id;
    END IF;
    IF TG_OP <> 'DELETE' AND NEW.student_id IS NOT NULL
       AND NOT (v_ids @> ARRAY[NEW.student_id]) THEN
        v_ids := v_ids || NEW.student_id;
    END IF;

    UPDATE public.students s
       SET amount_paid = b.amount_paid,
           last_payment_date = b.last_payment_date
      FROM unnest(v_ids) AS target(id)
      CROSS JOIN LATERAL public.student_balance_from_receipts(target.id) AS b
     WHERE s.id = target.id;

    -- Un trigger AFTER sur des lignes n'a rien à rendre : la valeur de retour est
    -- ignorée, et `NULL` le dit (PostgreSQL l'exige pour une orientation ROW).
    RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS payments_sync_student_balance ON public.payments;
CREATE TRIGGER payments_sync_student_balance
    AFTER INSERT OR UPDATE OR DELETE ON public.payments
    FOR EACH ROW
    EXECUTE FUNCTION public.sync_student_balance_from_receipts();

-- ─── 4) L'index qui rend le calcul soutenable ───────────────────────────────
-- Chaque geste de caisse interroge les reçus d'UNE fiche, et chaque écriture
-- d'une fiche recalcule son solde : sans cet index, la somme relirait toute la
-- table `payments`. `IF NOT EXISTS` : un rejeu ne casse rien.
CREATE INDEX IF NOT EXISTS idx_payments_student_id ON public.payments(student_id);

-- ─── 5) Le rattrapage des fiches déjà en base ───────────────────────────────
-- Un `UPDATE` de table (et non un `UPDATE` silencieux par fiche) : il réveille
-- le déclencheur ci-dessus, donc la valeur écrite est la même que celle que le
-- registre produira désormais — aucune seconde convention.
UPDATE public.students s
   SET amount_paid = coalesce(
           (SELECT sum(p.amount) FROM public.payments p WHERE p.student_id = s.id), 0),
       last_payment_date = (
           SELECT max(p.date) FROM public.payments p WHERE p.student_id = s.id);

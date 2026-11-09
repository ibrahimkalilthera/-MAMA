-- Migration: le montant ATTENDU d'un paiement — ce que ce reçu était censé régler.
--
-- Une famille qui ne peut pas payer les frais d'un mois d'un coup verse une
-- PARTIE au guichet. Jusqu'ici la seule trace de ce geste était `amount` : le
-- reçu imprimé ne disait donc ni que le versement était partiel, ni ce qu'il
-- restait à payer — et la fiche de l'élève, elle, fermait le mois comme s'il
-- était réglé. La famille revenait avec le complément, et l'application refusait
-- le mois en le déclarant déjà payé.
--
-- `due_amount` est donc le montant que CE geste était censé régler : les frais
-- des mois qu'il déclare (scolarité), au moment de la saisie. La comparaison
-- `amount < due_amount` dit « versement partiel », `amount >= due_amount` dit
-- « soldé » — et c'est cette lecture (`src/lib/paymentInstallments.ts`) qui
-- décide si un mois se ferme. Un versement partiel le LAISSE OUVERT : le
-- complément, saisi plus tard, le fermera.
--
-- Le montant est FIGÉ ici, et pas recalculé à la réimpression : les frais de
-- l'élève peuvent changer (bourse, révision), et un reçu réimprimé doit dire ce
-- qu'il disait le jour où la famille l'a reçu.
--
-- `NULL` = « non déclaré » — les lignes d'avant cette colonne, les imports, et
-- les gestes qui ne portent pas de notion de reste (inscription). Le reçu et la
-- fiche retombent alors sur le comportement d'avant : mois fermés, papier
-- inchangé. C'est le même contrat que `months` et `motif` avant elles : un reçu
-- déjà imprimé ne change pas d'un caractère.
--
-- Le CHECK refuse une valeur négative ou non finie. La base ne peut pas
-- vérifier que `due_amount >= amount` (un trop-perçu est légitime : une famille
-- peut régler plus que le mois), mais elle refuse un reste dû qui n'existe pas.
--
-- Aucune politique RLS à ajouter : celles de `payments` sont au niveau TABLE,
-- et une colonne de plus ne change ni qui lit, ni qui écrit.

ALTER TABLE public.payments
    ADD COLUMN IF NOT EXISTS due_amount NUMERIC;

ALTER TABLE public.payments
    DROP CONSTRAINT IF EXISTS payments_due_amount_nonnegative_check;

ALTER TABLE public.payments
    ADD CONSTRAINT payments_due_amount_nonnegative_check
    CHECK (due_amount IS NULL OR (due_amount >= 0 AND due_amount <> 'NaN'::numeric));

COMMENT ON COLUMN public.payments.due_amount IS
    'Montant que ce paiement était censé régler (frais des mois déclarés) au moment de la saisie ; NULL = non déclaré (ligne d''avant la colonne, import, inscription).';

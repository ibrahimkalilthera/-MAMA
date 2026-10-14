-- Migration: À QUOI correspond un paiement — scolarité ou inscription.
--
-- Le reçu officiel (`public/templates/recu-parent.pdf`) porte une ligne
-- « Motif » sous « Classe ». Jusqu'ici le générateur y imprimait TOUJOURS le
-- même mot (« Frais de scolarité »), parce que la base ne savait pas dire
-- l'autre : une famille qui venait payer le DROIT D'INSCRIPTION recevait un
-- reçu qui parlait de scolarité. Le geste était enregistré, le papier était
-- faux — et une réimpression tirée de l'historique l'aurait été aussi.
--
-- Le motif est donc une COLONNE, écrite par le geste qui l'a choisi et relue à
-- chaque réimpression, comme `months` avant elle.
--
-- Forme stockée : une clé courte et stable — `scolarite` / `inscription` —
-- jamais un libellé. « Frais de scolarité » gravé ici serait faux dans un reçu
-- anglais, et un libellé ne se traduit pas ; c'est `src/lib/paymentMotifs.ts`
-- qui rend le mot, dans la langue du reçu.
--
-- Le CHECK tient la forme : `motif IS NULL` (les lignes d'avant la colonne, et
-- tout import qui n'en déclare pas) OU l'une des deux clés connues. Une chaîne
-- inventée est refusée par la base, pas seulement par l'écran.
--
-- Les lignes existantes gardent `NULL` — « motif non renseigné » — et le reçu
-- retombe alors sur « Frais de scolarité », exactement comme avant : un reçu
-- déjà imprimé ne change pas d'un caractère.
--
-- Aucune politique RLS à ajouter : celles de `payments` sont au niveau TABLE
-- (« Authenticated read payments », « Authenticated insert payments », …), et
-- une colonne de plus ne change ni qui lit, ni qui écrit.

ALTER TABLE public.payments
    ADD COLUMN IF NOT EXISTS motif TEXT;

ALTER TABLE public.payments
    DROP CONSTRAINT IF EXISTS payments_motif_shape_check;

ALTER TABLE public.payments
    ADD CONSTRAINT payments_motif_shape_check
    CHECK (motif IS NULL OR motif IN ('scolarite', 'inscription'));

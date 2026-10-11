-- Migration: quels MOIS un paiement couvre.
--
-- Un paiement porte une `date` — le jour où l'argent est entré. Elle ne dit pas
-- quels mois de scolarité cet argent règle. Au guichet, une famille qui solde
-- septembre, octobre et décembre le même matin reçoit UN reçu : la seule date y
-- fait lire « Décembre », et les deux autres mois disparaissent du papier que la
-- famille garde — puis de toute réimpression tirée de l'historique.
--
-- Le choix des mois est donc une COLONNE, écrite par le geste qui l'a saisi et
-- relue à chaque réimpression.
--
-- Forme stockée : `YYYY-MM` (`2026-09`, `2027-01`), jamais un libellé. Un
-- « Septembre » gravé ici serait faux dans un reçu anglais, et un « sep » ne
-- dirait pas de quelle année. L'ordre est celui du calendrier, mais aucune
-- contrainte ne l'impose : l'affichage trie (src/lib/paymentMonths.ts), donc une
-- ligne écrite dans le désordre ne casse rien.
--
-- Le CHECK tient la forme sans fonction ni sous-requête : la représentation
-- texte d'un tableau est `{}`, `{2026-09}` ou `{2026-09,2026-10}`, et
-- l'expression ci-dessous n'accepte QUE ces trois formes-là. Une chaîne qui
-- n'est pas un mois est refusée par la base, pas seulement par l'écran.
--
-- Aucune politique RLS à ajouter : celles de `payments` sont au niveau TABLE
-- (« Authenticated read payments », « Authenticated insert payments », …), et
-- une colonne de plus ne change ni qui lit, ni qui écrit.
--
-- Les lignes existantes prennent `{}` — « mois non renseigné » — et le reçu
-- retombe alors sur le mois de sa date, exactement comme avant. Un reçu déjà
-- imprimé ne change donc pas de contenu.

ALTER TABLE public.payments
    ADD COLUMN IF NOT EXISTS months TEXT[] NOT NULL DEFAULT '{}';

ALTER TABLE public.payments
    DROP CONSTRAINT IF EXISTS payments_months_shape_check;

ALTER TABLE public.payments
    ADD CONSTRAINT payments_months_shape_check
    CHECK (months::text ~ '^\{(\d{4}-(0[1-9]|1[0-2]))?(,\d{4}-(0[1-9]|1[0-2]))*\}$');

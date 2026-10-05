-- Migration: une colonne `metadata` au journal d'audit — de quoi ANNULER une suppression.
--
-- ─── Le défaut, mesuré le 2026-10-05 ────────────────────────────────────────
-- Le bouton « supprimer un paiement » (20261005000003_econome_delete_payments.sql)
-- retire la ligne de `payments` et n'écrit au journal qu'une PHRASE : « Paiement
-- de 4000 FCFA (reçu REC-549205) du 2026-10-05 supprimé — élève Djenebou DIALLO ».
-- C'est assez pour RELIRE le geste, pas pour le DÉFAIRE : le montant et le reçu
-- sont dans du texte libre, l'`id` d'origine, l'année académique et le `student_id`
-- n'y sont pas. Une suppression était donc définitive.
--
-- ─── La décision ────────────────────────────────────────────────────────────
-- Un reçu retiré par erreur doit pouvoir REVENIR. On ne réécrit pas les vieilles
-- entrées (un journal d'audit qui se réécrit n'est plus une trace) : on ajoute une
-- colonne `metadata` JSONB, et les NOUVELLES suppressions y déposent l'instantané
-- de la ligne retirée — exactement de quoi la réinsérer à l'identique.
--
-- Pourquoi ici et pas dans une table d'archive à part : le journal est DÉJÀ
-- append-only (policy d'INSERT ouverte, aucune de mise à jour ni de suppression),
-- et il est DÉJÀ lu par l'écran d'audit. Garder l'instantané avec l'entrée qui
-- raconte le geste fait tenir la cause et la réparation dans la même ligne ; une
-- table d'archive aurait dupliqué qui/quoi/quand, avec deux vérités à tenir.
--
-- La restauration elle-même écrit une NOUVELLE entrée (`RESTORE_PAYMENT`) : le
-- geste inverse laisse sa trace à côté de la suppression, il ne l'efface pas.

ALTER TABLE public.audit_logs
    ADD COLUMN IF NOT EXISTS metadata JSONB;

COMMENT ON COLUMN public.audit_logs.metadata IS
    'instantané structuré du geste quand une phrase ne suffit pas à le défaire (ex : ligne `payments` retirée, pour la restaurer)';

-- ─── PostgREST schema cache reload ──────────────────────────────────────────
NOTIFY pgrst, 'reload schema';

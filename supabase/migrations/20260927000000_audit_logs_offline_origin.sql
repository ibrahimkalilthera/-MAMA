-- Migration: Audit Trail — l'ORIGINE HORS LIGNE d'une entrée
--
-- Le défaut mesuré : un geste fait sans réseau était mis en file, puis écrit
-- dans `audit_logs` au RETOUR de la ligne. `created_at` ayant un défaut
-- `now()`, l'entrée portait l'instant de la RECONNEXION — le dimanche 22 h 50
-- devenait le lundi 8 h 05. Conséquence directe sur l'archive hebdomadaire : le
-- geste de dimanche basculait dans la semaine SUIVANTE, et son heure affichée
-- était celle du câble, pas celle du travail.
--
-- Deux colonnes, et chacune répond à une question distincte :
--
--   • `recorded_offline` — « ce geste a-t-il été SAISI sans réseau ? ». C'est le
--     drapeau que l'écran et le PDF lisent pour écrire la ligne en ROUGE, et il
--     est écrit au rejeu, jamais deviné depuis un texte libre (chercher
--     « [replay] » dans `details` rapprocherait deux entrées d'un même mot) ;
--   • `synced_at` — « quand cette entrée a-t-elle ATTEINT la base ? ». Par défaut
--     `now()`, donc identique à `created_at` pour une entrée en ligne ; au rejeu,
--     c'est l'instant du câble retrouvé, à côté de l'instant du geste. Les deux
--     dates se lisent alors côte à côte, et aucune n'a besoin d'être devinée.
--
-- `created_at` garde son nom et change de SENS pour ce seul cas : il porte
-- désormais l'instant du GESTE (fourni par le poste qui l'a fait), parce que
-- c'est lui qui décide de la semaine d'archive. Un poste hors ligne est la
-- seule source possible de cette date — le serveur ne l'a jamais vue.
--
-- Idempotente (`IF NOT EXISTS`) : une base où la migration a déjà été appliquée
-- à la main n'échoue pas.

ALTER TABLE public.audit_logs
    ADD COLUMN IF NOT EXISTS recorded_offline BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE public.audit_logs
    ADD COLUMN IF NOT EXISTS synced_at TIMESTAMPTZ NOT NULL DEFAULT now();

-- L'archive hebdomadaire ne filtre pas sur ce drapeau (elle lit une fenêtre de
-- dates, déjà indexée) : l'index partiel sert au CONTRÔLE — « combien d'entrées
-- sont arrivées hors ligne cette semaine-là » — et il ne coûte rien sur une
-- table qui reste très majoritairement en ligne.
CREATE INDEX IF NOT EXISTS idx_audit_logs_recorded_offline
    ON public.audit_logs (created_at DESC)
    WHERE recorded_offline;

COMMENT ON COLUMN public.audit_logs.recorded_offline IS
    'vrai : le geste a été saisi sans réseau et écrit à la reconnexion (ligne à lire en rouge)';
COMMENT ON COLUMN public.audit_logs.synced_at IS
    'instant où la ligne a atteint la base : identique à created_at en ligne, postérieur pour une saisie hors ligne';
COMMENT ON COLUMN public.audit_logs.created_at IS
    'instant du GESTE (fourni par le poste hors ligne), pas celui de l''écriture';

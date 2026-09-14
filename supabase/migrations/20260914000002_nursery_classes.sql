-- Migration: the three CR (crèche / jardin d'enfants) classes.
--
-- « Ajouter CR » enrôle un enfant dans la crèche : même formulaire que
-- « Ajouter un Élève » (même parent, mêmes frais, même reçu, même fiche), seule
-- la liste de classes diffère — Petit, Moyen, Grand.
--
-- Ces trois classes sont ÉCRITES ICI, en base, et pas seulement dans le code :
--   • `custom_classes` est lu par CHAQUE poste à la connexion, donc un poste
--     dont le build n'embarque pas encore la liste (application de bureau
--     installée, version publiée antérieure) voit les classes CR quand même —
--     c'est la différence entre « disponible » et « disponible après mise à
--     jour ».
--   • elles restent déclarées côté application (`DEFAULT_SCHOOL_CLASSES`,
--     cycle Maternelle / Jardin d'Enfants) pour que l'app les connaisse hors
--     ligne et que le cycle soit le même partout ; la fusion
--     `useClasses.availableClasses` dédoublonne par code (insensible à la
--     casse), donc la ligne de base ne crée pas de doublon visible.
--
-- Cycle `maternelle` : c'est le cycle « Maternelle / Jardin d'Enfants » que les
-- modales de classe proposent déjà (PS / MS / GS). Aucun cycle nouveau n'est
-- introduit — le formulaire CR n'affiche que ce cycle, et `students.grade`
-- garde le code de la classe ('CR-PETIT', 'CR-MOYEN', 'CR-GRAND'), comme
-- partout ailleurs.
--
-- Idempotence : l'index unique `custom_classes_code_lower_unique` rend la
-- seconde exécution sans effet (ON CONFLICT DO NOTHING). Le contrôle final
-- refuse une exécution qui n'aurait PAS laissé les trois lignes — un seed
-- silencieusement incomplet est un échec, pas un succès.

INSERT INTO public.custom_classes (code, cycle, year, section, name_fr, name_en)
VALUES
    ('CR-PETIT', 'maternelle', 'PS', 'CR', 'CR Petit (CR-PETIT)', 'CR Petit (CR-PETIT)'),
    ('CR-MOYEN', 'maternelle', 'MS', 'CR', 'CR Moyen (CR-MOYEN)', 'CR Moyen (CR-MOYEN)'),
    ('CR-GRAND', 'maternelle', 'GS', 'CR', 'CR Grand (CR-GRAND)', 'CR Grand (CR-GRAND)')
ON CONFLICT DO NOTHING;

DO $$
DECLARE
    seeded INTEGER;
BEGIN
    SELECT count(*) INTO seeded
      FROM public.custom_classes
     WHERE lower(code) IN ('cr-petit', 'cr-moyen', 'cr-grand');

    IF seeded <> 3 THEN
        RAISE EXCEPTION 'Classes CR incomplètes : % / 3 en base après le seed', seeded;
    END IF;
END
$$;

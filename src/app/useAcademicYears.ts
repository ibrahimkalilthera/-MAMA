/**
 * Charge les années scolaires, fixe l'ANNÉE DE TRAVAIL, et l'entretient.
 *
 * Trois propriétés, et chacune répare une moitié de l'incident du 2026-09-13 (un
 * élève enregistré puis invisible, tableau de bord à zéro) :
 *
 *   1. la liste vient de la base — le sélecteur ne peut plus ignorer l'année où
 *      les données vivent ;
 *   2. l'année de travail est celle du **calendrier** (`pickWorkingYear`), donc
 *      elle avance toute seule au 1er septembre : aucune déclaration à penser à
 *      changer, et aucune déclaration périmée ne peut la retenir ;
 *   3. l'année de travail est **toujours proposée** dans le sélecteur, même
 *      quand la base ne la connaît pas encore — un 1er septembre, personne ne l'a
 *      créée, et ne pas pouvoir la choisir obligerait à travailler dans une année
 *      qu'on ne voit pas.
 *
 * L'ENTRETIEN de la déclaration partagée est séparé de la lecture, parce que le
 * rôle arrive après la session : l'effet se rejoue quand `isAdmin` bascule, sans
 * refaire le choix d'année (il est déjà fixé). Ce que l'entretien écrit engage
 * tout le parc, donc il est réservé aux rôles que la policy autorise et son échec
 * ne casse rien : l'année du poste reste juste.
 */
import { useCallback, useEffect, useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';

import {
  FALLBACK_ACADEMIC_YEARS,
  pickWorkingYear,
  readStoredYear,
  yearNames,
} from '../lib/academicYears';
import { fetchAcademicYears, keepAcademicYearCurrent, publishWorkingYear } from '../lib/dataOps/academicYears';
import { useYear } from './yearContext';

export function useAcademicYears({ isAdmin = false }: { isAdmin?: boolean } = {}): {
  academicYears: string[];
  /** Le setter reste exposé : fermer une année ajoute la suivante à la liste. */
  setAcademicYears: Dispatch<SetStateAction<string[]>>;
  /**
   * Le geste du SÉLECTEUR d'année. Un admin/dev ne change pas seulement SON
   * poste : il PUBLIE l'année pour tout le parc (`publishWorkingYear`), et
   * chaque poste l'adopte à sa prochaine lecture de la base. Un caissier, lui,
   * change son poste — consulter une archive n'est pas une décision d'école.
   */
  selectYear: (year: string) => void;
} {
  const { setSelectedYear, setYearRows } = useYear();
  const [academicYears, setAcademicYears] = useState<string[]>(FALLBACK_ACADEMIC_YEARS);
  const [workingYear, setWorkingYear] = useState('');

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const rows = await fetchAcademicYears();
      if (cancelled) return;
      // Les BORNES de scolarité de chaque année partent avec la liste : la
      // lecture qui fixe l'année de travail est la même qui décide des mois
      // qu'un reçu réclame (voir `yearMonths`, `src/app/yearContext.ts`).
      setYearRows(rows ?? []);
      // `rows ?? []` : une base injoignable et une base sans années se lisent
      // pareil pour la règle (« on ne sait pas »), et c'est voulu — un échec
      // réseau ne doit pas valoir « l'école n'a aucune année ».
      const year = pickWorkingYear({ rows: rows ?? [], stored: readStoredYear(), today: new Date() });
      setAcademicYears(yearNames([...(rows ?? []), { year_name: year }]));
      setSelectedYear(year);
      setWorkingYear(year);
    })();
    return () => {
      cancelled = true;
    };
  }, [setSelectedYear, setYearRows]);

  useEffect(() => {
    if (!workingYear || !isAdmin) return;
    void keepAcademicYearCurrent(workingYear);
  }, [workingYear, isAdmin]);

  const selectYear = useCallback(
    (year: string) => {
      const name = String(year ?? '').trim();
      setSelectedYear(name);
      // Pas de publication sans année (le choix « toutes les années » du
      // sélecteur) ni sans le droit : la policy d'`academic_years` est
      // `is_admin()`, donc tenter l'écriture pour un caissier ne produirait
      // qu'un 403 muet.
      if (!name || !isAdmin) return;
      void publishWorkingYear(name).then((published) => {
        if (!published) console.warn('Année de travail non publiée pour le parc :', name);
      });
    },
    [isAdmin, setSelectedYear],
  );

  return { academicYears, setAcademicYears, selectYear };
}

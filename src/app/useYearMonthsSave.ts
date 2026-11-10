/**
 * ─── Régler la plage de scolarité de l'année, et la PUBLIER d'un coup ────────
 *
 * L'écran des Paramètres écrit les deux bornes (`start_month`/`end_month`), et
 * cette écriture ne regarde pas un poste : elle change ce que les reçus de
 * TOUTE l'école réclament. Elle a donc un seul propriétaire — ce hook — pour
 * deux raisons :
 *
 *   1. **écrire**, par `saveAcademicYearMonths` (`src/lib/dataOps`) : la même
 *      ligne `academic_years` et le même contrat `saved`/`queued`/`refused` que
 *      la file hors ligne, avec son refus des mois hors 1..12 ;
 *   2. **publier le résultat tout de suite**, en mettant à jour les lignes du
 *      contexte d'année (`setYearRows`, `src/app/yearContext.ts`). Sans cette
 *      seconde moitié, l'administrateur enregistrerait une plage et verrait
 *      encore l'ancienne : les écrans lisent `yearMonths`, qui lit ces lignes-là.
 *      Un rechargement corrigerait l'affichage, mais l'écran aurait menti entre
 *      les deux — et c'est précisément ce qu'une garde de composition mesure.
 *
 * `queued` met à jour les lignes AUSSI : le poste est hors ligne, la base ne sait
 * pas encore, mais l'école vient de CHOISIR — lui montrer l'ancienne plage
 * laisserait croire que le geste n'a pas été pris. Le rejeu (voir
 * `offlineReplayAcademicYear`) écrit la même chose au retour de la ligne.
 */
import { useCallback } from 'react';

import { withYearSpan } from '../lib/academicYears';
import type { AcademicYearMonthsSaveResult } from '../lib/dataOps/academicYears';
import { saveAcademicYearMonths } from '../lib/dataOps/academicYears';
import { isSchoolMonth } from '../lib/paymentMonths';
import { useYear } from './yearContext';

export function useYearMonthsSave() {
  const { selectedYear, setYearRows } = useYear();

  const saveYearMonths = useCallback(
    async (startMonth: number, endMonth: number): Promise<AcademicYearMonthsSaveResult> => {
      const year = selectedYear;
      if (!year || !isSchoolMonth(startMonth) || !isSchoolMonth(endMonth)) return 'refused';
      const result = await saveAcademicYearMonths(year, startMonth, endMonth);
      // Rien n'a changé en base : ne rien publier. Ce qui a changé (enregistré ou
      // mis en file) se lit désormais sur les MÊMES lignes que le reste de l'app.
      //
      // `withYearSpan` et non un `map` : la liste peut ne PAS porter l'année —
      // une lecture d'années faite sans session revient vide (la policy est
      // `to authenticated`) — et un `map` sans correspondance laisserait alors
      // l'écran sur la plage par défaut (septembre→juin) alors que la base a
      // reçu octobre. L'administration verrait son geste « revenir tout seul ».
      if (result !== 'refused') {
        setYearRows((rows) => withYearSpan(rows, year, startMonth, endMonth));
      }
      return result;
    },
    [selectedYear, setYearRows],
  );

  return { saveYearMonths };
}
